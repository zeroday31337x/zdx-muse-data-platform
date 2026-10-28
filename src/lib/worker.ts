// Durable job state machine, independent of the browser.
// tx is intentionally any-typed: the Prisma transaction client is
// generated at build time (see src/lib/db.ts).
/* eslint-disable @typescript-eslint/no-explicit-any */
// - Claim: one worker, one lease, FOR UPDATE SKIP LOCKED, 5-minute lease.
// - Checkpoint: committed count + last processed index, saved in the same
//   transaction as the records, so a crash replays from the checkpoint
//   without duplicating (recordKey uniqueness is the second guard).
// - Lease continuation: after a partial batch the job is atomically
//   re-queued (status QUEUED, lease cleared) instead of staying RUNNING
//   until its lease expires, so the next tick claims it immediately.
//   There is no 5-minute delay between batches for a live worker.
// - Stale-lease protection: checkpoint/finish updates are conditional
//   on leaseOwner + status RUNNING. A worker that lost its lease
//   (expired, reclaimed, cancelled, paused) cannot overwrite the new
//   owner's progress; its update affects 0 rows and it must abort.
// - Cancel: QUEUED/PAUSED jobs go straight to CANCELLED. RUNNING jobs
//   go to CANCELLING, and the owning worker finalises them to CANCELLED
//   after its current batch; a worker tick also finalises any
//   CANCELLING job whose lease expired or was never held. CANCELLING
//   is therefore never a terminal resting state.
// - Pause / resume: pause is checked between batches, not only at start.
//   A paused job keeps its checkpoint and resumes from it.
// - Crash recovery: leases older than now() are reclaimable; a worker
//   that dies mid-batch leaves RUNNING + expired lease, which the next
//   claim picks up as QUEUED.
import { prisma } from './db';
import { canTransition, LEASE_MS } from './worker-transitions';
import { checkConcurrency } from './billing';
export { canTransition, JOB_TRANSITIONS, LEASE_MS } from './worker-transitions';

/**
 * Per-tenant concurrency at claim time (contract §3e / corrected error
 * table): a tenant already at its RUNNING cap does NOT get a new job
 * claimed — the job stays QUEUED (never FAILED) for a later tick.
 * Candidates are locked with FOR UPDATE SKIP LOCKED, so concurrent
 * workers cannot claim the same job and cannot both pass the same
 * tenant's cap check: the count is read after the row lock, inside
 * the same transaction that performs the claim. Caps are the PROPOSED
 * VPS safety values (1 restricted / 2 entitled); approved per-tier
 * concurrency caps are a BLOCKED input and must not be confused with
 * these safety limits.
 */
export async function claimNextJob(workerId: string) {
  const db = prisma();
  // Claim inside ONE transaction: the FOR UPDATE SKIP LOCKED row lock
  // only holds for the transaction's duration, so selecting and then
  // updating outside a transaction would let two workers claim the
  // same QUEUED job. Reclaiming stale leases and finalising stale
  // cancellations happen in the same transaction.
  return db.$transaction(async (tx: any) => {
    await tx.$executeRaw`UPDATE "Job" SET status='QUEUED', "leaseOwner"=NULL, "leaseExpiresAt"=NULL WHERE status='RUNNING' AND "leaseExpiresAt" < NOW()`;
    await tx.$executeRaw`UPDATE "Job" SET status='CANCELLED', "leaseOwner"=NULL, "leaseExpiresAt"=NULL WHERE status='CANCELLING' AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" < NOW())`;
    const jobs = await tx.$queryRaw<{ id: string; tenantId: string }[]>`SELECT id, "tenantId" FROM "Job" WHERE status='QUEUED' ORDER BY "createdAt" ASC LIMIT 20 FOR UPDATE SKIP LOCKED`;
    for (const candidate of jobs) {
      const tenant = await tx.tenant.findUnique({ where: { id: candidate.tenantId } });
      // Orphaned job (tenant row gone): leave QUEUED for operator
      // review; never claim work for a tenant that cannot be gated.
      if (!tenant) continue;
      const restricted = tenant.subscriptionStatus === 'restricted' || tenant.subscriptionStatus === 'incomplete' || tenant.subscriptionStatus === 'incomplete_expired';
      const running = await tx.job.count({ where: { tenantId: candidate.tenantId, status: 'RUNNING' } });
      if (!checkConcurrency(running, restricted).ok) continue; // stays QUEUED
      const leaseExpiresAt = new Date(Date.now() + LEASE_MS);
      return tx.job.update({ where: { id: candidate.id }, data: { status: 'RUNNING', leaseOwner: workerId, leaseExpiresAt, attempts: { increment: 1 } } });
    }
    return null;
  });
}

/** Finalise every CANCELLING job that is not currently held by a live lease. Returns how many were finalised. */
export async function finalizeCancellingJobs() {
  const db = prisma();
  const r = await db.$executeRaw`UPDATE "Job" SET status='CANCELLED', "leaseOwner"=NULL, "leaseExpiresAt"=NULL WHERE status='CANCELLING' AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" < NOW())`;
  return Number(r);
}

/**
 * Checkpoint update guarded by lease ownership. Returns true if the
 * update applied, false if this worker no longer holds the lease
 * (stale worker: caller must abort, not continue or finish the job).
 */
export async function updateCheckpoint(jobId: string, committed: number, checkpoint: Record<string, unknown>, leaseOwner?: string) {
  const db = prisma();
  if (!leaseOwner) {
    await db.job.update({ where: { id: jobId }, data: { committed, checkpoint } });
    return true;
  }
  const r = await db.job.updateMany({ where: { id: jobId, leaseOwner, status: 'RUNNING' }, data: { committed, checkpoint } });
  return r.count > 0;
}

/**
 * Atomically re-queue a partially finished job after a batch, so the
 * next tick claims it immediately (no lease-expiry wait). Guarded by
 * lease ownership and by status: if the job was paused or cancelled
 * mid-batch, it is NOT re-queued here — the caller handles those
 * states from a fresh read instead.
 */
export async function requeueAfterBatch(jobId: string, committed: number, checkpoint: Record<string, unknown>, leaseOwner: string) {
  const db = prisma();
  const r = await db.job.updateMany({ where: { id: jobId, leaseOwner, status: 'RUNNING' }, data: { committed, checkpoint, status: 'QUEUED', leaseOwner: null, leaseExpiresAt: null } });
  return r.count > 0;
}

export async function finishJob(jobId: string, status: 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CANCELLED', error?: string | null, leaseOwner?: string) {
  const db = prisma();
  if (!leaseOwner) {
    return db.job.update({ where: { id: jobId }, data: { status, error: error ?? null, leaseOwner: null, leaseExpiresAt: null } });
  }
  // For CANCELLED, the lease may already have been cleared by a cancel
  // request; allow it if the job is RUNNING with this lease OR already
  // CANCELLING. For other terminal states, require the live RUNNING lease.
  const where = status === 'CANCELLED'
    ? { id: jobId, OR: [{ leaseOwner, status: 'RUNNING' }, { status: 'CANCELLING' }] }
    : { id: jobId, leaseOwner, status: 'RUNNING' };
  const r = await db.job.updateMany({ where, data: { status, error: error ?? null, leaseOwner: null, leaseExpiresAt: null } });
  if (r.count === 0) throw new Error('STALE_LEASE');
  return r;
}

export async function getJob(jobId: string) {
  return prisma().job.findUnique({ where: { id: jobId } });
}

export async function requestPause(jobId: string, tenantId?: string) {
  const db = prisma();
  const job = tenantId ? await db.job.findFirst({ where: { id: jobId, tenantId } }) : await db.job.findUnique({ where: { id: jobId } });
  if (!job || !canTransition(job.status, 'PAUSED')) return { ok: false, error: job ? 'INVALID_TRANSITION' : 'NOT_FOUND', status: job?.status };
  // Pausing a RUNNING job does not kill its current batch; the worker
  // checks status after the batch and leaves it PAUSED with checkpoint.
  await db.job.update({ where: { id: jobId }, data: { status: 'PAUSED' } });
  return { ok: true, status: 'PAUSED' };
}

export async function requestResume(jobId: string, tenantId?: string) {
  const db = prisma();
  const job = tenantId ? await db.job.findFirst({ where: { id: jobId, tenantId } }) : await db.job.findUnique({ where: { id: jobId } });
  if (!job || !canTransition(job.status, 'QUEUED')) return { ok: false, error: job ? 'INVALID_TRANSITION' : 'NOT_FOUND', status: job?.status };
  await db.job.update({ where: { id: jobId }, data: { status: 'QUEUED', leaseOwner: null, leaseExpiresAt: null } });
  return { ok: true, status: 'QUEUED' };
}

export async function requestCancel(jobId: string, tenantId?: string) {
  const db = prisma();
  const job = tenantId ? await db.job.findFirst({ where: { id: jobId, tenantId } }) : await db.job.findUnique({ where: { id: jobId } });
  if (!job) return { ok: false, error: 'NOT_FOUND' };
  if (job.status === 'QUEUED' || job.status === 'PAUSED') {
    // Not running: cancel immediately, no CANCELLING intermediate.
    await db.job.update({ where: { id: jobId }, data: { status: 'CANCELLED', leaseOwner: null, leaseExpiresAt: null } });
    return { ok: true, status: 'CANCELLED' };
  }
  if (job.status === 'RUNNING') {
    await db.job.update({ where: { id: jobId }, data: { status: 'CANCELLING' } });
    return { ok: true, status: 'CANCELLING' };
  }
  if (job.status === 'CANCELLING') {
    return { ok: true, status: 'CANCELLING' };
  }
  return { ok: false, error: 'INVALID_TRANSITION', status: job.status };
}
