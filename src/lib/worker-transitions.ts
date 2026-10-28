// Pure job state machine — no database import, so it is unit-testable
// without Prisma generation or a running Postgres.
export const JOB_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['QUEUED', 'CANCELLED'],
  QUEUED: ['RUNNING', 'PAUSED', 'CANCELLING', 'CANCELLED'],
  RUNNING: ['PAUSED', 'CANCELLING', 'COMPLETED', 'PARTIAL', 'FAILED'],
  PAUSED: ['QUEUED', 'CANCELLING', 'CANCELLED'],
  CANCELLING: ['CANCELLED'],
  CANCELLED: [],
  COMPLETED: [],
  PARTIAL: ['QUEUED'],
  FAILED: ['QUEUED'],
};

export function canTransition(from: string, to: string): boolean {
  return (JOB_TRANSITIONS[from] ?? []).includes(to);
}

export const LEASE_MS = 5 * 60 * 1000;

export const TERMINAL_STATUSES = ['COMPLETED', 'CANCELLED'];
export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** A RUNNING job whose lease has expired is reclaimable by a newer worker. */
export function isStalledLease(job: { status: string; leaseExpiresAt: Date | string | null }, now = new Date()): boolean {
  if (job.status !== 'RUNNING' || !job.leaseExpiresAt) return false;
  return new Date(job.leaseExpiresAt).getTime() < now.getTime();
}
