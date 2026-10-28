// Bounded batching helpers used by the worker ingest path.
// Pure functions, so the exact batching / dedupe / checkpoint rules
// are unit-testable without Postgres. The worker route uses these
// helpers for slicing and keying; the DB transaction itself (lease
// guard + createMany skipDuplicates) is the second, independent guard,
// and its behaviour is staging-gated on an isolated DB.
import { recordKeyFor } from './store';

export type IngestJobState = {
  status: string;
  leaseOwner: string | null;
  committed: number;
  checkpointIndex: number;
};

/** Slice one bounded batch. Never returns more than batchSize rows. */
export function batchSlice<T>(rows: T[], index: number, batchSize: number): T[] {
  if (index < 0) index = 0;
  if (batchSize <= 0) return [];
  return rows.slice(index, index + batchSize);
}

/** Dedupe a batch by stable recordKey, first occurrence wins. */
export function uniqueBatchRows(
  datasetId: string,
  rows: Record<string, unknown>[],
  startIndex: number,
): { row: Record<string, unknown>; recordKey: string; index: number }[] {
  const seen = new Set<string>();
  const out: { row: Record<string, unknown>; recordKey: string; index: number }[] = [];
  rows.forEach((row, i) => {
    const key = recordKeyFor(datasetId, row, startIndex + i);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ row, recordKey: key, index: startIndex + i });
  });
  return out;
}

/**
 * Decide the post-batch job state, mirroring the worker route.
 * - leaseOwner mismatch (stale worker) => STALE_LEASE, no state change.
 * - PAUSED / CANCELLING set mid-batch are honoured, not overwritten.
 * - Otherwise: finished => COMPLETED, partial => QUEUED (requeue).
 * A job is COMPLETED only when every input row has been processed
 * (nextIndex >= total) AND the batch committed without error.
 */
export function nextIngestState(
  job: IngestJobState,
  callerLeaseOwner: string,
  batch: { processed: number; newlyInserted: number },
  totalRows: number,
): { status: string; committed: number; nextIndex: number } | { error: 'STALE_LEASE' } {
  if (job.leaseOwner !== callerLeaseOwner) return { error: 'STALE_LEASE' };
  const nextIndex = job.checkpointIndex + batch.processed;
  const committed = job.committed + batch.newlyInserted;
  if (job.status === 'PAUSED') return { status: 'PAUSED', committed, nextIndex };
  if (job.status === 'CANCELLING') return { status: 'CANCELLED', committed, nextIndex };
  if (nextIndex >= totalRows) return { status: 'COMPLETED', committed, nextIndex };
  return { status: 'QUEUED', committed, nextIndex };
}

/** A COMPLETED job must be consistent: committed == total and index == total. */
export function assertJobConsistent(job: { status: string; committed: number; total: number; checkpointIndex: number }): boolean {
  if (job.status !== 'COMPLETED') return true;
  return job.committed === job.total && job.checkpointIndex === job.total;
}
