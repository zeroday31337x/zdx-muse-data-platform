// Spending limits, retry budgets, and usage tracking for Meta calls.
// Defaults are the hackathon interim budget, not a promise of credit:
// - Daily cap $20 (the founder's interim card budget until the $150 grant lands)
// - Total cap $170 ($150 grant + $20 interim) — override with env vars.
// A call that would exceed either cap is refused BEFORE it is made,
// never after. Usage is recorded in the UsageLedger (DB) or, in Phase 1
// file mode, in the file store — both are metadata only, never prompt bodies.
export function spendLimits() {
  return {
    dailyUsd: Number(process.env.META_DAILY_SPEND_LIMIT_USD ?? 20),
    totalUsd: Number(process.env.META_TOTAL_SPEND_LIMIT_USD ?? 170),
  };
}

export function spendCheck(dailySpentUsd: number, totalSpentUsd: number, estimatedCostUsd: number) {
  const { dailyUsd, totalUsd } = spendLimits();
  if (dailySpentUsd + estimatedCostUsd > dailyUsd) return { ok: false, error: 'DAILY_SPEND_LIMIT_EXCEEDED', dailyUsd, totalUsd };
  if (totalSpentUsd + estimatedCostUsd > totalUsd) return { ok: false, error: 'TOTAL_SPEND_LIMIT_EXCEEDED', dailyUsd, totalUsd };
  return { ok: true, dailyUsd, totalUsd };
}

export const MAX_META_RETRIES = 3;
export const RETRYABLE_PREFIXES = ['RATE_LIMIT', 'PROVIDER_5XX', 'TIMEOUT', 'NETWORK_ERROR'];

/** Retry only transient failures, with exponential backoff, bounded at 3 attempts. */
export async function withMetaRetry<T extends { ok: boolean; error?: string }>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number; sleepMs?: (attempt: number) => number } = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? MAX_META_RETRIES;
  const sleep = opts.sleepMs ?? ((attempt: number) => Math.min(8000, 500 * 2 ** attempt));
  let last: T | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await fn();
    last = result;
    if (result.ok) return result;
    const retryable = RETRYABLE_PREFIXES.some((p) => result.error?.startsWith(p));
    if (!retryable || attempt === maxAttempts - 1) return result;
    await new Promise((r) => setTimeout(r, sleep(attempt)));
  }
  return last as T;
}
