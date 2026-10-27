// Durable job state machine, independent of the browser.
// - Claim: one worker, one lease, FOR UPDATE SKIP LOCKED, 5-minute lease.
// - Checkpoint: committed count + last processed index, saved in the same
//   transaction as the records, so a crash replays from the checkpoint
//   without duplicating (recordKey uniqueness is the second guard).
// - Pause / resume / cancel: status transitions are validated here, and
//   cancellation is checked between batches, not only at start.
// - Crash recovery: leases older than now() are reclaimable; a worker
//   that dies mid-batch leaves RUNNING + expired lease, which the next
//   claim picks up as QUEUED.
import { prisma } from './db';
import { canTransition, LEASE_MS } from './worker-transitions';
export { canTransition, JOB_TRANSITIONS, LEASE_MS } from './worker-transitions';

export async function claimNextJob(workerId: string) {
  const db = prisma();
  // Reclaim stale leases first.
  await db.$executeRaw`UPDATE "Job" SET status='QUEUED', "leaseOwner"=NULL, "leaseExpiresAt"=NULL WHERE status='RUNNING' AND "leaseExpiresAt" < NOW()`;
  const jobs = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Job" WHERE status='QUEUED' ORDER BY "createdAt" ASC LIMIT 1 FOR UPDATE SKIP LOCKED`;
  if (jobs.length === 0) return null;
  const leaseExpiresAt = new Date(Date.now() + LEASE_MS);
  const job = await db.job.update({ where: { id: jobs[0].id }, data: { status: 'RUNNING', leaseOwner: workerId, leaseExpiresAt, attempts: { increment: 1 } } });
  return job;
}

export async function updateCheckpoint(jobId: string, committed: number, checkpoint: Record<string, unknown>) {
  return prisma().job.update({ where: { id: jobId }, data: { committed, checkpoint } });
}

export async function finishJob(jobId: string, status: 'COMPLETED' | 'PARTIAL' | 'FAILED', error?: string | null) {
  return prisma().job.update({ where: { id: jobId }, data: { status, error: error ?? null, leaseOwner: null, leaseExpiresAt: null } });
}

export async function requestPause(jobId: string) {
  const job = await prisma().job.findUnique({ where: { id: jobId } });
  if (!job || !canTransition(job.status, 'PAUSED')) return { ok: false, error: 'INVALID_TRANSITION', status: job?.status };
  await prisma().job.update({ where: { id: jobId }, data: { status: 'PAUSED' } });
  return { ok: true, status: 'PAUSED' };
}

export async function requestResume(jobId: string) {
  const job = await prisma().job.findUnique({ where: { id: jobId } });
  if (!job || !canTransition(job.status, 'QUEUED')) return { ok: false, error: 'INVALID_TRANSITION', status: job?.status };
  await prisma().job.update({ where: { id: jobId }, data: { status: 'QUEUED', leaseOwner: null, leaseExpiresAt: null } });
  return { ok: true, status: 'QUEUED' };
}

export async function requestCancel(jobId: string) {
  const job = await prisma().job.findUnique({ where: { id: jobId } });
  if (!job) return { ok: false, error: 'NOT_FOUND' };
  if (job.status === 'RUNNING' || job.status === 'QUEUED' || job.status === 'PAUSED') {
    await prisma().job.update({ where: { id: jobId }, data: { status: 'CANCELLING' } });
    return { ok: true, status: 'CANCELLING' };
  }
  return { ok: false, error: 'INVALID_TRANSITION', status: job.status };
}
