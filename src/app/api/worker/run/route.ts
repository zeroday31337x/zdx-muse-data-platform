/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { prisma, dbConfigured } from '@/lib/db';
import { claimNextJob, requeueAfterBatch, finishJob, finalizeCancellingJobs, getJob } from '@/lib/worker';
import { checkCompositionInTx } from '@/lib/composition-db';
import { recordKeyFor, estimateTokens } from '@/lib/store';
import { workerAuth } from '@/lib/authz';
export const dynamic = 'force-dynamic';

/**
 * Worker tick: claim one queued job and process one bounded batch.
 * Service-authenticated only (X-Worker-Secret vs WORKER_SECRET).
 * A browser session can never drive this endpoint.
 *
 * Lifecycle, after each batch:
 * - PAUSED (set mid-batch): checkpoint is saved, lease is cleared,
 *   job stays PAUSED. Resume re-queues it from the checkpoint.
 * - CANCELLING (set mid-batch): job is finalised to CANCELLED with
 *   the committed count preserved. CANCELLING is never terminal.
 * - Otherwise, a partial ingest batch is atomically re-queued
 *   (QUEUED, lease cleared) so the next tick claims it immediately —
 *   no 5-minute lease-expiry wait for a live worker.
 * - Checkpoint/finish updates are guarded by lease ownership, so a
 *   stale worker (lease expired, reclaimed, paused, cancelled)
 *   cannot overwrite the new owner's progress.
 * Batches are 100 records, checkpointed per batch, so a crash
 * resumes from the last committed batch without duplication
 * (recordKey uniqueness is the second guard).
 */
const WORKER_ID = 'api-worker';

export async function POST(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const auth = workerAuth(req);
  if ('response' in auth) return auth.response;
  const db = prisma();
  const finalized = await finalizeCancellingJobs();
  const job = await claimNextJob(WORKER_ID);
  if (!job) return NextResponse.json({ claimed: false, finalizedCancelling: finalized });
  const leaseOwner = WORKER_ID;
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
      const current = await getJob(job.id);
      if (current?.status === 'PAUSED') {
        await db.job.update({ where: { id: job.id }, data: { leaseOwner: null, leaseExpiresAt: null } });
        return NextResponse.json({ claimed: true, jobId: job.id, committed, status: 'PAUSED', nextIndex: index });
      }
      if (current?.status === 'CANCELLING') {
        await finishJob(job.id, 'CANCELLED', null, leaseOwner).catch(() => finishJob(job.id, 'CANCELLED'));
        return NextResponse.json({ claimed: true, jobId: job.id, committed, status: 'CANCELLED', nextIndex: index });
      }
      if (index >= payload.rows.length) {
        await finishJob(job.id, 'COMPLETED', null, leaseOwner);
        return NextResponse.json({ claimed: true, jobId: job.id, committed, status: 'COMPLETED' });
      }
      const requeued = await requeueAfterBatch(job.id, committed, { index }, leaseOwner);
      if (!requeued) return NextResponse.json({ claimed: true, jobId: job.id, error: 'STALE_LEASE' }, { status: 409 });
      return NextResponse.json({ claimed: true, jobId: job.id, committed, total: payload.rows.length, nextIndex: index, status: 'QUEUED' });
    }
    if (job.kind === 'augment' && payload.count) {
      // Cancel/pause between claim and transaction: do not run the
      // augment at all. (Cancel during the atomic transaction itself
      // completes, because the batch is already committed — cancel
      // takes effect between batches, not by rolling back work.)
      const before = await getJob(job.id);
      if (before?.status === 'PAUSED') {
        await db.job.update({ where: { id: job.id }, data: { leaseOwner: null, leaseExpiresAt: null } });
        return NextResponse.json({ claimed: true, jobId: job.id, status: 'PAUSED' });
      }
      if (before?.status === 'CANCELLING') {
        await finishJob(job.id, 'CANCELLED', null, leaseOwner).catch(() => finishJob(job.id, 'CANCELLED'));
        return NextResponse.json({ claimed: true, jobId: job.id, status: 'CANCELLED' });
      }
      const count = payload.count;
      // Transactional composition gate, then one createMany (not one
      // upsert per row: 4,285 per-row upserts exceeded Prisma's 5s
      // interactive-transaction timeout and left a partial batch).
      // Synthetic keys are unique per job, so concurrent jobs cannot
      // upsert each other's rows, and skipDuplicates keeps a replay
      // of the same job idempotent.
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
      await finishJob(job.id, 'COMPLETED', null, leaseOwner);
      return NextResponse.json({ claimed: true, jobId: job.id, committed: result, status: 'COMPLETED' });
    }
    await finishJob(job.id, 'FAILED', 'UNKNOWN_JOB_KIND', leaseOwner);
    return NextResponse.json({ claimed: true, jobId: job.id, error: 'UNKNOWN_JOB_KIND' }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'WORKER_ERROR';
    if (msg === 'STALE_LEASE') {
      return NextResponse.json({ claimed: true, jobId: job.id, error: 'STALE_LEASE' }, { status: 409 });
    }
    try {
      await finishJob(job.id, 'FAILED', msg, leaseOwner);
    } catch {
      return NextResponse.json({ claimed: true, jobId: job.id, error: 'STALE_LEASE' }, { status: 409 });
    }
    return NextResponse.json({ claimed: true, jobId: job.id, error: msg }, { status: msg === 'SYNTHETIC_CAP_EXCEEDED' ? 409 : 500 });
  }
}
