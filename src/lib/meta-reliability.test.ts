import { describe, it, expect } from 'vitest';
import { MockMetaProvider, extractJsonObject, backoffMs, isRetryableError, JobBudget, Semaphore } from './meta-reliability';
import { withMetaRetry } from './meta-budget';

describe('inference reliability, MOCKED ONLY — no live Meta call in this file', () => {
  it('timeout: bounded retry, then a clear non-fabricated failure, never a model result', async () => {
    const mock = new MockMetaProvider('timeout');
    const r = await withMetaRetry(() => mock.call().then((m) => ({ ok: m.ok, error: m.error })), { sleepMs: () => 0 });
    expect(mock.calls).toBe(3);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('TIMEOUT');
  });
  it('malformed/partial output: validation failure, content is not treated as a result', async () => {
    const bad = await new MockMetaProvider('malformed').call();
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe('INVALID_PROVIDER_RESPONSE');
    const partial = await new MockMetaProvider('partial').call();
    expect(partial.ok).toBe(true);
    // A partial JSON body must not parse as a complete object result.
    expect(extractJsonObject(partial.content ?? '')).toBeNull();
    expect(extractJsonObject('prefix {"a":1} suffix')).toEqual({ a: 1 });
    expect(extractJsonObject('no json here')).toBeNull();
  });
  it('rate limit: backoff delays are bounded and resume does not double-spend', async () => {
    expect(backoffMs(0)).toBe(500);
    expect(backoffMs(1)).toBe(1000);
    expect(backoffMs(10)).toBe(8000);
    expect(isRetryableError('RATE_LIMIT:429')).toBe(true);
    expect(isRetryableError('AUTH_OR_ENTITLEMENT:401')).toBe(false);
    const budget = new JobBudget(1);
    const mock = new MockMetaProvider('rate_limit');
    // Two rate-limited attempts consume no budget; a later success records once.
    await withMetaRetry(() => mock.call().then((m) => ({ ok: m.ok, error: m.error })), { sleepMs: () => 0, maxAttempts: 2 });
    expect(budget.spentUsd).toBe(0);
    budget.recordSuccess(0.5);
    expect(budget.spentUsd).toBe(0.5);
    expect(budget.calls).toBe(1);
  });
  it('budget exhaustion: per-job gate stops new Meta calls, prior batches intact', () => {
    const budget = new JobBudget(1);
    budget.recordSuccess(0.9);
    expect(budget.canSpend(0.2)).toBe(false);
    expect(budget.canSpend(0.1)).toBe(true);
    budget.recordFailure();
    expect(budget.spentUsd).toBe(0.9);
    expect(budget.calls).toBe(1);
  });
  it('concurrency: semaphore caps in-flight calls at the configured max', async () => {
    const sem = new Semaphore(2);
    let peak = 0;
    let current = 0;
    const work = async () => {
      const release = await sem.acquire();
      current++;
      peak = Math.max(peak, current);
      await new Promise((r) => setTimeout(r, 5));
      current--;
      release();
    };
    await Promise.all([work(), work(), work(), work(), work()]);
    expect(peak).toBe(2);
    expect(sem.inFlight).toBe(0);
  });
  it('auth errors are never retried and never fabricated', async () => {
    const mock = new MockMetaProvider('auth_error');
    const r = await withMetaRetry(() => mock.call().then((m) => ({ ok: m.ok, error: m.error })), { sleepMs: () => 0 });
    expect(mock.calls).toBe(1);
    expect(r.error).toBe('AUTH_OR_ENTITLEMENT:401');
  });
});
