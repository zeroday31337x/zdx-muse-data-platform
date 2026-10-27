import { describe, it, expect } from 'vitest';
import { canTransition } from './worker-transitions';
import { spendCheck, withMetaRetry } from './meta-budget';

describe('job transitions', () => {
  it('allows QUEUED->RUNNING, RUNNING->PAUSED, PAUSED->QUEUED, blocks COMPLETED->QUEUED', () => {
    expect(canTransition('QUEUED', 'RUNNING')).toBe(true);
    expect(canTransition('RUNNING', 'PAUSED')).toBe(true);
    expect(canTransition('PAUSED', 'QUEUED')).toBe(true);
    expect(canTransition('COMPLETED', 'QUEUED')).toBe(false);
    expect(canTransition('RUNNING', 'COMPLETED')).toBe(true);
  });
});
describe('spending limits', () => {
  it('refuses a call that would exceed the daily cap', () => {
    expect(spendCheck(19.99, 0, 0.02).ok).toBe(false);
    expect(spendCheck(0, 0, 0.01).ok).toBe(true);
  });
});
describe('retry budget', () => {
  it('retries transient failures at most 3 times, never retries auth failures', async () => {
    let calls = 0;
    const r = await withMetaRetry(async () => { calls++; return { ok: false, error: 'AUTH_OR_ENTITLEMENT:401' }; }, { sleepMs: () => 0 });
    expect(calls).toBe(1); expect(r.ok).toBe(false);
    calls = 0;
    const r2 = await withMetaRetry(async () => { calls++; return calls < 3 ? { ok: false, error: 'RATE_LIMIT:429' } : { ok: true }; }, { sleepMs: () => 0 });
    expect(calls).toBe(3); expect(r2.ok).toBe(true);
  });
});
