/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { prisma, dbConfigured } from '@/lib/db';
import { claimNextJob, updateCheckpoint, finishJob } from '@/lib/worker';
import { checkCompositionInTx } from '@/lib/composition-db';
import { recordKeyFor, estimateTokens } from '@/lib/store';
export const dynamic = 'force-dynamic';

/**
 * Worker tick: claim one queued job and process one bounded batch.
 * This is the worker loop in API form for Phase 2. A standalone
 * process that calls this endpoint on a timer, or imports claimNextJob
 * directly, is the next step — the state machine, leases, and
 * checkpointing are already the same.
 * Streaming / large datasets: batches are 100 records, checkpointed
 * per batch, so a crash resumes from the last committed batch.
 */
export async function POST() {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const db = prisma();
  const job = await claimNextJob('api-worker');
  if (!job) return NextResponse.json({ claimed: false });
  try {
    const payload = (job.payload ?? {}) as { rows?: Record<string, unknown>[]; count?: number; provenance?: string };
    if (job.kind === 'ingest' && payload.rows) {
      const checkpoint = (job.checkpoint ?? {}) as { index?: number };
      let index = checkpoint.index ?? 0;
      const batch = payload.rows.slice(index, index + 100);
      let committed = job.committed;
      await db.$transaction(async (tx: any) => {
        for (const row of batch) {
          const key = recordKeyFor(job.datasetId, row, index);
          await tx.record.upsert({
            where: { datasetId_recordKey: { datasetId: job.datasetId, recordKey: key } },
            update: {},
            create: { datasetId: job.datasetId, recordKey: key, data: row, provenance: (payload.provenance ?? 'AUTHENTIC_UNVERIFIED') as any, sourceId: 'worker', sourceFamilyId: null, tokens: estimateTokens(row) },
          });
          committed++; index++;
        }
        await tx.job.update({ where: { id: job.id }, data: { committed, checkpoint: { index } } });
      });
      await updateCheckpoint(job.id, committed, { index });
      if (index >= payload.rows.length) await finishJob(job.id, 'COMPLETED');
      else return NextResponse.json({ claimed: true, jobId: job.id, committed, total: payload.rows.length, nextIndex: index });
      return NextResponse.json({ claimed: true, jobId: job.id, committed, status: 'COMPLETED' });
    }
    if (job.kind === 'augment' && payload.count) {
      const count = payload.count;
      // Transactional composition gate, then insert synthetic rows.
      // One createMany, not one upsert per row: 4,285 per-row upserts
      // exceeded Prisma's 5s interactive-transaction timeout and left
      // a partially committed batch. createMany is a single statement,
      // so the gate + insert commit or roll back together, and
      // skipDuplicates keeps a replay of the same job idempotent
      // (committed counts only rows actually inserted).
      // Synthetic keys must be unique per job, not just per base
      // record + index: two augment jobs that both start at i=0
      // previously upserted the same key, so the second job reported
      // success without creating a distinct record (and the cap
      // gate could not arbitrate concurrent jobs). Job id in the
      // key makes each job's synthetics distinct.
      const result = await db.$transaction(async (tx: any) => {
        const check = await checkCompositionInTx(tx, job.datasetId, count);
        if (!check.ok) throw new Error('SYNTHETIC_CAP_EXCEEDED');
        const authentic = await tx.record.findMany({ where: { datasetId: job.datasetId, provenance: 'AUTHENTIC_VERIFIED' }, take: count });
        const rows = [];
        for (let i = 0; i < count; i++) {
          const base = authentic[i % authentic.length];
          if (!base) break;
          const data = { ...(base.data as Record<string, unknown>) };
          for (const f of ['order_id', 'id', 'record_id']) if (data[f] !== undefined) { data[f] = `SYN-${String(data[f])}-${i}`; break; }
          rows.push({ datasetId: job.datasetId, recordKey: `${base.recordKey}-syn-${job.id}-${i}`, data, provenance: 'SYNTHETIC', sourceId: base.sourceId, sourceFamilyId: base.sourceFamilyId, tokens: estimateTokens(data) });
        }
        const inserted = rows.length > 0 ? await tx.record.createMany({ data: rows, skipDuplicates: true }) : { count: 0 };
        const committed = job.committed + inserted.count;
        await tx.job.update({ where: { id: job.id }, data: { committed } });
        return committed;
      }, { timeout: 60000 });
      await finishJob(job.id, 'COMPLETED');
      return NextResponse.json({ claimed: true, jobId: job.id, committed: result, status: 'COMPLETED' });
    }
    await finishJob(job.id, 'FAILED', 'UNKNOWN_JOB_KIND');
    return NextResponse.json({ claimed: true, jobId: job.id, error: 'UNKNOWN_JOB_KIND' }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'WORKER_ERROR';
    await finishJob(job.id, msg === 'SYNTHETIC_CAP_EXCEEDED' ? 'FAILED' : 'FAILED', msg);
    return NextResponse.json({ claimed: true, jobId: job.id, error: msg }, { status: msg === 'SYNTHETIC_CAP_EXCEEDED' ? 409 : 500 });
  }
}
