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
