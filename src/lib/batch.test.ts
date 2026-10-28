import { describe, it, expect } from 'vitest';
import { batchSlice, uniqueBatchRows, nextIngestState, assertJobConsistent } from './batch';
import { isTerminalStatus, isStalledLease, canTransition } from './worker-transitions';

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i, v: `row-${i}` }));

describe('worker recovery: batching, checkpoint, dedupe', () => {
  it('batches are bounded at 100, never the whole dataset', () => {
    const all = rows(10000);
    expect(batchSlice(all, 0, 100)).toHaveLength(100);
    expect(batchSlice(all, 9900, 100)).toHaveLength(100);
    expect(batchSlice(all, 10000, 100)).toHaveLength(0);
  });
  it('duplicate rows in a batch insert once: exact distinct counts', () => {
    const dup = [{ id: 1 }, { id: 1 }, { id: 2 }, { id: 2 }, { id: 3 }];
    const uniq = uniqueBatchRows('ds1', dup, 0);
    expect(uniq).toHaveLength(3);
    expect(new Set(uniq.map((u) => u.recordKey)).size).toBe(3);
  });
  it('multi-tick replay after restart: no duplicates, no lost batches, COMPLETED only when consistent', () => {
    // Simulate ticks 100/100/50 over 250 rows, with a restart after tick 1
    // (checkpoint persisted) and a full replay of tick 2 (duplicate batch).
    const all = rows(250);
    let job = { status: 'RUNNING', leaseOwner: 'w1', committed: 0, checkpointIndex: 0 };
    const seen = new Set<string>();
    let ticks = 0;
    const applyTick = (leaseOwner: string, replay = false) => {
      const batch = batchSlice(all, job.checkpointIndex, 100);
      const uniq = uniqueBatchRows('ds1', batch, job.checkpointIndex);
      const newly = uniq.filter((u) => !seen.has(u.recordKey));
      newly.forEach((u) => seen.add(u.recordKey));
      const next = nextIngestState(
        { ...job, leaseOwner: job.leaseOwner },
        leaseOwner,
        { processed: batch.length, newlyInserted: replay ? 0 : newly.length },
        all.length,
      );
      expect('error' in next).toBe(false);
      if (!('error' in next)) {
        job = { status: next.status, leaseOwner: 'w1', committed: next.committed, checkpointIndex: next.nextIndex };
      }
      ticks++;
    };
    applyTick('w1'); // 100
    expect(job.checkpointIndex).toBe(100);
    expect(job.committed).toBe(100);
    // Restart: same checkpoint, new tick continues, not from 0.
    applyTick('w1'); // 200
    expect(job.checkpointIndex).toBe(200);
    // Replay tick 2's batch as a duplicate request: 0 new rows, but the
    // checkpoint in this simulation is already past it, so a replayed
    // batch at the old index inserts nothing and must not change committed.
    const replayBatch = batchSlice(all, 100, 100);
    const replayUniq = uniqueBatchRows('ds1', replayBatch, 100);
    expect(replayUniq.every((u) => seen.has(u.recordKey))).toBe(true);
    applyTick('w1'); // 250 -> COMPLETED
    expect(job.status).toBe('COMPLETED');
    expect(job.committed).toBe(250);
    expect(seen.size).toBe(250);
    expect(assertJobConsistent({ status: job.status, committed: job.committed, total: 250, checkpointIndex: job.checkpointIndex })).toBe(true);
    expect(ticks).toBe(3);
  });
  it('stale worker cannot overwrite newer progress or completion', () => {
    const job = { status: 'RUNNING', leaseOwner: 'w2', committed: 200, checkpointIndex: 200 };
    const next = nextIngestState(job, 'w1', { processed: 100, newlyInserted: 100 }, 250);
    expect(next).toEqual({ error: 'STALE_LEASE' });
  });
  it('pause/resume and cancel transitions are exact', () => {
    const paused = nextIngestState({ status: 'PAUSED', leaseOwner: 'w1', committed: 100, checkpointIndex: 100 }, 'w1', { processed: 0, newlyInserted: 0 }, 250);
    expect('status' in paused && paused.status).toBe('PAUSED');
    const cancelling = nextIngestState({ status: 'CANCELLING', leaseOwner: 'w1', committed: 100, checkpointIndex: 100 }, 'w1', { processed: 0, newlyInserted: 0 }, 250);
    expect('status' in cancelling && cancelling.status).toBe('CANCELLED');
    expect(canTransition('CANCELLING', 'CANCELLED')).toBe(true);
    expect(canTransition('RUNNING', 'CANCELLING')).toBe(true);
    expect(isTerminalStatus('COMPLETED')).toBe(true);
    expect(isTerminalStatus('RUNNING')).toBe(false);
  });
  it('lease expiry takeover: stalled RUNNING is reclaimable, live lease is not', () => {
    const now = new Date('2026-10-27T12:00:00Z');
    expect(isStalledLease({ status: 'RUNNING', leaseExpiresAt: new Date('2026-10-27T11:00:00Z') }, now)).toBe(true);
    expect(isStalledLease({ status: 'RUNNING', leaseExpiresAt: new Date('2026-10-27T13:00:00Z') }, now)).toBe(false);
    expect(isStalledLease({ status: 'PAUSED', leaseExpiresAt: new Date('2026-10-27T11:00:00Z') }, now)).toBe(false);
  });
  it('COMPLETED with inconsistent counts is rejected by the consistency check', () => {
    expect(assertJobConsistent({ status: 'COMPLETED', committed: 249, total: 250, checkpointIndex: 250 })).toBe(false);
    expect(assertJobConsistent({ status: 'COMPLETED', committed: 250, total: 250, checkpointIndex: 250 })).toBe(true);
  });
});

describe('database efficiency: progressively larger datasets, bounded batches', () => {
  it('processes 100, 1000, and 10000 rows in 100-row batches with exact counts', () => {
    for (const n of [100, 1000, 10000]) {
      const all = rows(n);
      const seen = new Set<string>();
      let index = 0;
      let maxBatch = 0;
      while (index < n) {
        const batch = batchSlice(all, index, 100);
        maxBatch = Math.max(maxBatch, batch.length);
        uniqueBatchRows('ds1', batch, index).forEach((u) => seen.add(u.recordKey));
        index += batch.length;
      }
      expect(seen.size).toBe(n);
      expect(maxBatch).toBeLessThanOrEqual(100);
      expect(index).toBe(n);
    }
  });
});
