// Mocked-only Meta inference reliability helpers.
// NOTHING in this file makes a real Meta call. The mock provider below
// is for tests and for staging-gated validation only; every result it
// produces is labelled 'mock', never 'meta', and must never be stored
// or reported as a live inference result.

export type MockMode = 'ok' | 'timeout' | 'malformed' | 'partial' | 'rate_limit' | 'auth_error';

export type MockCallResult = {
  ok: boolean;
  source: 'mock';
  content: string | null;
  error?: string;
  status?: number;
  calls: number;
};

/** Deterministic mock provider: one failure mode per instance, counted calls. */
export class MockMetaProvider {
  calls = 0;
  constructor(public mode: MockMode = 'ok') {}
  async call(): Promise<MockCallResult> {
    this.calls++;
    switch (this.mode) {
      case 'ok':
        return { ok: true, source: 'mock', content: '{"fields":[{"name":"a","type":"string"}]}', calls: this.calls };
      case 'timeout':
        return { ok: false, source: 'mock', content: null, error: 'TIMEOUT', calls: this.calls };
      case 'malformed':
        return { ok: false, source: 'mock', content: null, error: 'INVALID_PROVIDER_RESPONSE', calls: this.calls };
      case 'partial':
        return { ok: true, source: 'mock', content: '{"fields":[{"name":"a"', calls: this.calls };
      case 'rate_limit':
        return { ok: false, source: 'mock', content: null, error: 'RATE_LIMIT:429', status: 429, calls: this.calls };
      case 'auth_error':
        return { ok: false, source: 'mock', content: null, error: 'AUTH_OR_ENTITLEMENT:401', status: 401, calls: this.calls };
    }
  }
}

/** Extract the first {...} JSON object from model text, or null if unparseable. */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Exponential backoff with a cap, in ms. Pure, so tests assert exact delays. */
export function backoffMs(attempt: number, baseMs = 500, capMs = 8000): number {
  return Math.min(capMs, baseMs * 2 ** Math.max(0, attempt));
}

export const RETRYABLE_ERRORS = ['RATE_LIMIT', 'PROVIDER_5XX', 'TIMEOUT', 'NETWORK_ERROR'];
export function isRetryableError(error?: string): boolean {
  return !!error && RETRYABLE_ERRORS.some((p) => error.startsWith(p));
}

/** Per-job inference budget: spend is recorded only on successful calls. */
export class JobBudget {
  spentUsd = 0;
  calls = 0;
  constructor(public maxUsd: number) {}
  canSpend(estimatedUsd: number): boolean {
    return this.spentUsd + estimatedUsd <= this.maxUsd;
  }
  recordSuccess(costUsd: number): void {
    this.spentUsd += costUsd;
    this.calls++;
  }
  /** Failed / retried calls never consume budget and never fabricate a result. */
  recordFailure(): void {}
}

/** Bounded concurrency semaphore: at most `max` holders at once. */
export class Semaphore {
  private running = 0;
  private queue: (() => void)[] = [];
  constructor(public max: number) {}
  async acquire(): Promise<() => void> {
    if (this.running < this.max) {
      this.running++;
      return () => this.release();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.running++;
        resolve(() => this.release());
      });
    });
  }
  private release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) next();
  }
  get inFlight(): number {
    return this.running;
  }
}
