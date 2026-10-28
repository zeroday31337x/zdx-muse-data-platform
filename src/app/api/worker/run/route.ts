/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { prisma, dbConfigured } from '@/lib/db';
import { claimNextJob, requeueAfterBatch, finishJob, finalizeCancellingJobs, getJob } from '@/lib/worker';
import { checkCompositionInTx } from '@/lib/composition-db';
import { recordKeyFor, estimateTokens } from '@/lib/store';
import { batchSlice } from '@/lib/batch';
import { logEvent } from '@/lib/observability';
import { workerAuth } from '@/lib/authz';
import { assertJobRunnable } from '@/lib/billing';
import { recordCapForTenant } from '@/lib/tier-spec';
import { runDueReconciliationRetries } from '@/lib/reconciliation-retry';
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
  // App-side reconciliation retry schedule (B9, PROPOSED delays): due
  // retries for tenants whose reconciliation failed run on worker
  // ticks. The sweep never blocks job claiming: its own failures are
  // swallowed, and a per-tenant retry failure changes no entitlement.
  let reconciliationRetries = null;
  try {
    reconciliationRetries = await runDueReconciliationRetries(db, new Date());
    if (reconciliationRetries.due > 0) logEvent('worker.reconciliation-retry', { ...reconciliationRetries });
  } catch { /* retry sweep must never block job claiming */ }
  const job = await claimNextJob(WORKER_ID);
  if (!job) return NextResponse.json({ claimed: false, finalizedCancelling: finalized, reconciliationRetries });
  const leaseOwner = WORKER_ID;
  // Worker double-gate (contract §3d): revalidate tenant entitlement
  // from the DB row at claim time, independent of any browser session.
  // A tenant that lost entitlement after enqueue does NOT run: the
  // job pauses with its checkpoint preserved (never FAILED, never run
  // on revoked entitlement). Grace-expired tenants pause all kinds.
  // OPTION A HOOK: when a Meta-backed job kind is introduced, its
  // eligibility + budget revalidation MUST happen here, immediately
  // after this assertJobRunnable call and before any Meta call (see
  // billing.ts assertJobRunnable for the exact contract). Until then,
  // Meta kinds pause via assertJobRunnable and never execute.
  try {
    const tenant = await db.tenant.findUnique({ where: { id: job.tenantId } });
    if (!tenant) {
      await db.job.update({ where: { id: job.id }, data: { status: 'PAUSED', error: 'ENTITLEMENT_REVOKED', leaseOwner: null, leaseExpiresAt: null } });
      return NextResponse.json({ claimed: true, jobId: job.id, status: 'PAUSED', error: 'ENTITLEMENT_REVOKED' });
    }
    const runnable = assertJobRunnable({ subscriptionStatus: tenant.subscriptionStatus as string, accessRestriction: tenant.accessRestriction ?? null }, { kind: job.kind });
    if (!runnable.ok) {
      await db.job.update({ where: { id: job.id }, data: { status: 'PAUSED', error: runnable.reason, leaseOwner: null, leaseExpiresAt: null } });
      return NextResponse.json({ claimed: true, jobId: job.id, status: 'PAUSED', error: runnable.reason });
    }
  } catch {
    // If the revalidation read itself fails, do not run blind: leave
    // the job RUNNING under its lease so the next tick retries the
    // check rather than spending work on an unverified tenant.
    return NextResponse.json({ claimed: true, jobId: job.id, error: 'ENTITLEMENT_REVALIDATION_FAILED' }, { status: 503 });
  }
  try {
    const payload = (job.payload ?? {}) as { rows?: Record<string, unknown>[]; count?: number; provenance?: string };
    // Record-cap check at execution time (tier spec, PROPOSED values): a
    // QUEUED job must not push its tenant past the tier cap. Caps only
    // grow (by tier change), so an over-cap job FAILS rather than pausing:
    // retrying cannot help. The route-level pre-checks (ingest/augment)
    // are the first line; this is the execution-time guard for jobs queued
    // before a cap change or via any other path. Remaining rows (not just
    // the next batch) are counted, so a job that can never complete
    // within the cap fails whole instead of inserting a partial batch.
    // A missing tenant row yields no cap here; the claim-time gate above
    // already pauses jobs whose tenant row is gone.
    const tenantRow = await db.tenant.findUnique({ where: { id: job.tenantId } });
    const cap = recordCapForTenant(tenantRow);
    if (cap !== null && (job.kind === 'ingest' || job.kind === 'augment')) {
      const total = await db.record.count({ where: { dataset: { tenantId: job.tenantId } } });
      const remaining = job.kind === 'ingest' && payload.rows
        ? payload.rows.length - (((job.checkpoint ?? {}) as { index?: number }).index ?? 0)
        : (payload.count ?? 0);
      if (total + remaining > cap) {
        await finishJob(job.id, 'FAILED', 'QUOTA_EXCEEDED', leaseOwner);
        return NextResponse.json({ claimed: true, jobId: job.id, error: 'QUOTA_EXCEEDED' }, { status: 409 });
      }
    }
    if (job.kind === 'ingest' && payload.rows) {
      const checkpoint = (job.checkpoint ?? {}) as { index?: number };
      let index = checkpoint.index ?? 0;
      // Bounded batch (100) via the shared helper. createMany with
      // skipDuplicates is the idempotency guard: a replayed batch
      // inserts 0 new rows, and committed counts ONLY newly inserted
      // rows — the old per-row upsert incremented committed even for
      // duplicates, overstating progress on replay. The job update is
      // guarded by leaseOwner (not by status, so a batch that started
      // RUNNING and was paused/cancelled mid-batch still commits, then
      // the post-batch PAUSED/CANCELLING handling below applies); a
      // worker whose lease was reclaimed (leaseOwner changed) affects
      // 0 rows and must abort with STALE_LEASE, never overwrite the
      // new owner's progress.
      const batch = batchSlice(payload.rows, index, 100);
      let committed = job.committed;
      let insertedInBatch = 0;
      await db.$transaction(async (tx: any) => {
        const rowsToInsert = batch.map((row, i) => ({
          datasetId: job.datasetId,
          recordKey: recordKeyFor(job.datasetId, row, index + i),
          data: row,
          provenance: (payload.provenance ?? 'AUTHENTIC_UNVERIFIED') as any,
          sourceId: 'worker',
          sourceFamilyId: null,
          tokens: estimateTokens(row),
        }));
        const inserted = rowsToInsert.length > 0
          ? await tx.record.createMany({ data: rowsToInsert, skipDuplicates: true })
          : { count: 0 };
        insertedInBatch = inserted.count;
        committed = job.committed + inserted.count;
        index = index + batch.length;
        const upd = await tx.job.updateMany({
          where: { id: job.id, leaseOwner },
          data: { committed, checkpoint: { index } },
        });
        if (upd.count === 0) throw new Error('STALE_LEASE');
      });
      logEvent('worker.ingest.batch', { jobId: job.id, datasetId: job.datasetId, batchSize: batch.length, inserted: insertedInBatch, committed, nextIndex: index });
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
        const upd = await tx.job.updateMany({ where: { id: job.id, leaseOwner }, data: { committed } });
        if (upd.count === 0) throw new Error('STALE_LEASE');
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
