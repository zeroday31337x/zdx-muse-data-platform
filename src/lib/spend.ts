// Three-way spend accounting (corrected sequence §3).
// - CONFIRMED: provider-verified actual cost (UsageLedger.costUsd only).
// - RESERVED: estimated maximum cost held before a call.
// - PENDING_RECONCILIATION: outcome uncertain (e.g. timeout). The
//   reservation STAYS counted; it is never released as $0 without
//   reconciliation evidence, because a timeout does not prove Meta
//   failed to process the request.
// - SETTLED_AT_MAXIMUM: conservative settlement at the maximum
//   permitted cost when reconciliation cannot prove otherwise. This is
//   NEVER presented as verified provider usage.
// Pure functions first; persistence helpers (SpendReservation rows)
// follow. Persistence helpers throw on DB error so callers fail closed.
import { MODEL_PRICING } from './meta';
import { tierKeyForTenant } from './tier-allowlist';

export type CostStatus = 'CONFIRMED' | 'RESERVED' | 'PENDING_RECONCILIATION' | 'SETTLED_AT_MAXIMUM';

export type Reservation = {
  requestKey: string;
  tenantId: string;
  jobId: string | null;
  model: string;
  maxCostUsd: number;
  confirmedCostUsd: number | null;
  settledCostUsd: number | null;
  status: CostStatus;
};

/** Verified-price models for reservation math. Text models use the
 * code pricing table; SAM/image/voice prices are UNVERIFIED and return
 * null so the caller blocks with MODEL_PRICE_UNVERIFIED (never $0). */
export function verifiedTextPrice(model: string): { input: number; output: number } | null {
  if (model === 'muse-spark-1.3' || model === 'muse-spark-1.3-contributor') {
    const p = MODEL_PRICING[model];
    return { input: p.input, output: p.output };
  }
  return null;
}

/** Conservative maximum cost: max tokens × verified prices. */
export function estimateMaxCost(model: string, maxInputTokens: number, maxOutputTokens: number): number | null {
  const price = verifiedTextPrice(model);
  if (!price) return null;
  return (maxInputTokens * price.input + maxOutputTokens * price.output) / 1_000_000;
}

export function newReservation(input: {
  requestKey: string; tenantId: string; jobId?: string | null; model: string; maxCostUsd: number;
}): Reservation {
  return {
    requestKey: input.requestKey,
    tenantId: input.tenantId,
    jobId: input.jobId ?? null,
    model: input.model,
    maxCostUsd: input.maxCostUsd,
    confirmedCostUsd: null,
    settledCostUsd: null,
    status: 'RESERVED',
  };
}

/** Provider-confirmed actual cost. Only this path writes UsageLedger. */
export function confirmReservation(res: Reservation, actualCostUsd: number): Reservation {
  return { ...res, confirmedCostUsd: actualCostUsd, status: 'CONFIRMED' };
}

/** Uncertain outcome (timeout/network): keep the reservation counted. */
export function markPendingReconciliation(res: Reservation): Reservation {
  return { ...res, status: 'PENDING_RECONCILIATION' };
}

/**
 * Conservative settlement at the maximum permitted cost, used only
 * when reconciliation cannot prove otherwise. The settled figure is
 * NOT verified provider usage and must never be displayed as such.
 */
export function settleAtMaximum(res: Reservation): Reservation {
  return { ...res, settledCostUsd: res.maxCostUsd, status: 'SETTLED_AT_MAXIMUM' };
}

/** Amount currently counted against budgets for this reservation. */
export function countedCost(res: Reservation): number {
  if (res.status === 'CONFIRMED') return res.confirmedCostUsd ?? 0;
  if (res.status === 'SETTLED_AT_MAXIMUM') return res.settledCostUsd ?? res.maxCostUsd;
  return res.maxCostUsd; // RESERVED and PENDING_RECONCILIATION count at max
}

/** Retry keying: a retry of an uncertain request reuses the original
 * requestKey and must NOT create a second independent reservation. */
export function retryRequestKey(originalRequestKey: string): string {
  return originalRequestKey;
}

// ---- Persistence: counted spend, allowances, atomic reservations ----
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Engineering bound for reservation math AND for the provider request
 * (passed as max_tokens by callers): a single Meta call may produce at
 * most this many completion tokens, so the conservative maximum cost is
 * finite. This is a technical safety bound, not a policy quota. Without
 * it, "maximum permitted cost" would be unbounded and no reservation
 * could be checked — which is why unbounded calls fail closed.
 */
export const META_CALL_MAX_OUTPUT_TOKENS = 4096;

/**
 * Conservative maximum cost for a prompt: input tokens estimated as
 * ceil(chars/4) × 2 (2× tokenizer safety margin — chars/4 undercounts
 * dense scripts, so the margin keeps the reservation conservative),
 * plus META_CALL_MAX_OUTPUT_TOKENS of output, at verified text prices.
 * Returns null for unverified prices (caller blocks, never $0).
 */
export function estimateMaxCostForPrompt(promptText: string, model: string): number | null {
  const maxInputTokens = Math.ceil(promptText.length / 4) * 2;
  return estimateMaxCost(model, maxInputTokens, META_CALL_MAX_OUTPUT_TOKENS);
}

/**
 * Per-tenant Meta inference allowance (staging-test tier proposal,
 * PROPOSED-STAGING-TEST — not production pricing, not an approved
 * contract change). Professional: $10 per tenant. The INTERVAL is
 * presumed monthly but TO-CONFIRM (BLOCKED input), so until it is
 * confirmed the $10 is enforced ALL-TIME (stricter than monthly, never
 * looser). Restricted: $0 — no paid inference (the Contributor
 * pathway is disabled, see tier-allowlist.ts). Legacy: null — no
 * allowance defined (BLOCKED: needs a migrate-or-cap decision);
 * callers must NOT treat null as unlimited: the hard ceiling still
 * applies, and the gap is recorded in the audit. Unmapped/empty tiers:
 * $0 (defense in depth; the resolver already rejects them).
 */
export const PROFESSIONAL_META_ALLOWANCE_USD_STAGING_TEST = 10;

export function allowanceCapForTenant(tenant: { subscriptionPlan?: string | null; subscriptionStatus: string }): { capUsd: number; basis: string } | null {
  const key = tierKeyForTenant(tenant);
  if (key === 'professional') return { capUsd: PROFESSIONAL_META_ALLOWANCE_USD_STAGING_TEST, basis: 'professional-allowance-all-time-until-interval-confirmed' };
  if (key === 'legacy') return null;
  return { capUsd: 0, basis: `${key}-zero-allowance` };
}

export type CountedSpend = {
  confirmedDaily: number;
  confirmedTotal: number;
  reservedDaily: number;
  reservedTotal: number;
  settledDaily: number;
  settledTotal: number;
  countedDaily: number;
  countedTotal: number;
};

/**
 * Counted spend for a tenant. CONFIRMED cost comes ONLY from
 * UsageLedger (confirmed reservations are never double-counted).
 * RESERVED + PENDING_RECONCILIATION count at maxCostUsd; SETTLED rows
 * count at settledCostUsd (falling back to maxCostUsd if unset).
 * Daily figures use the UTC day boundary and reservation createdAt.
 * Throws on DB error — callers must fail closed, never proceed.
 */
export async function countedSpendForTenant(db: any, tenantId: string, now = new Date()): Promise<CountedSpend> {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const confirmedDailyAgg = await db.usageLedger.aggregate({ where: { tenantId, createdAt: { gte: dayStart } }, _sum: { costUsd: true } });
  const confirmedTotalAgg = await db.usageLedger.aggregate({ where: { tenantId }, _sum: { costUsd: true } });
  const reservedDailyAgg = await db.spendReservation.aggregate({ where: { tenantId, createdAt: { gte: dayStart }, status: { in: ['RESERVED', 'PENDING_RECONCILIATION'] } }, _sum: { maxCostUsd: true } });
  const reservedTotalAgg = await db.spendReservation.aggregate({ where: { tenantId, status: { in: ['RESERVED', 'PENDING_RECONCILIATION'] } }, _sum: { maxCostUsd: true } });
  const settledRows = await db.spendReservation.findMany({ where: { tenantId, status: 'SETTLED_AT_MAXIMUM' }, select: { createdAt: true, maxCostUsd: true, settledCostUsd: true } });
  let settledDaily = 0;
  let settledTotal = 0;
  for (const r of settledRows) {
    const v = r.settledCostUsd ?? r.maxCostUsd;
    settledTotal += v;
    if (new Date(r.createdAt) >= dayStart) settledDaily += v;
  }
  const confirmedDaily = confirmedDailyAgg._sum.costUsd ?? 0;
  const confirmedTotal = confirmedTotalAgg._sum.costUsd ?? 0;
  const reservedDaily = reservedDailyAgg._sum.maxCostUsd ?? 0;
  const reservedTotal = reservedTotalAgg._sum.maxCostUsd ?? 0;
  return {
    confirmedDaily, confirmedTotal, reservedDaily, reservedTotal, settledDaily, settledTotal,
    countedDaily: confirmedDaily + reservedDaily + settledDaily,
    countedTotal: confirmedTotal + reservedTotal + settledTotal,
  };
}

/**
 * Atomically reserve spend for one Meta call. Takes the ROOT db client
 * (not a tx): inside one transaction it locks the Tenant row
 * (SELECT ... FOR UPDATE), re-reads counted spend, and only then
 * inserts the reservation — so concurrent reservations for the same
 * tenant serialize on the row lock and cannot jointly exceed any cap.
 * Caps are all optional except that the caller must pass the hard
 * ceiling (meta-gate guarantees it is configured before this runs).
 * A duplicate requestKey (retry reusing a key) returns
 * DUPLICATE_REQUEST_KEY: the caller must look up the original
 * reservation instead of creating a second one.
 */
export async function reserveSpend(
  db: any,
  opts: {
    tenantId: string; requestKey: string; model: string; maxCostUsd: number; jobId?: string | null;
    caps: { perJobUsd?: number | null; dailyUsd?: number | null; totalUsd?: number | null; allowanceUsd?: number | null };
  },
): Promise<{ ok: true; reservationId: string } | { ok: false; code: string; detail: string }> {
  return db.$transaction(async (tx: any) => {
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${opts.tenantId} FOR UPDATE`;
    const counted = await countedSpendForTenant(tx, opts.tenantId);
    if (opts.caps.perJobUsd !== null && opts.caps.perJobUsd !== undefined && opts.maxCostUsd > opts.caps.perJobUsd) {
      return { ok: false as const, code: 'MODEL_BUDGET_EXCEEDED', detail: 'per-job cap' };
    }
    if (opts.caps.dailyUsd !== null && opts.caps.dailyUsd !== undefined && counted.countedDaily + opts.maxCostUsd > opts.caps.dailyUsd) {
      return { ok: false as const, code: 'MODEL_BUDGET_EXCEEDED', detail: 'daily hard ceiling' };
    }
    if (opts.caps.totalUsd !== null && opts.caps.totalUsd !== undefined && counted.countedTotal + opts.maxCostUsd > opts.caps.totalUsd) {
      return { ok: false as const, code: 'MODEL_BUDGET_EXCEEDED', detail: 'total hard ceiling' };
    }
    if (opts.caps.allowanceUsd !== null && opts.caps.allowanceUsd !== undefined && counted.countedTotal + opts.maxCostUsd > opts.caps.allowanceUsd) {
      return { ok: false as const, code: 'MODEL_BUDGET_EXCEEDED', detail: 'tenant allowance' };
    }
    try {
      const row = await tx.spendReservation.create({
        data: { tenantId: opts.tenantId, jobId: opts.jobId ?? null, requestKey: opts.requestKey, model: opts.model, maxCostUsd: opts.maxCostUsd, status: 'RESERVED' },
      });
      return { ok: true as const, reservationId: row.id };
    } catch (e: any) {
      if (String(e?.code) === 'P2002' || /unique/i.test(String(e?.message))) {
        return { ok: false as const, code: 'DUPLICATE_REQUEST_KEY', detail: 'requestKey already reserved; look up the original reservation' };
      }
      throw e;
    }
  });
}

/** Confirm a reservation at the provider-verified actual cost. */
export async function confirmSpendReservation(db: any, id: string, actualCostUsd: number): Promise<void> {
  await db.spendReservation.update({ where: { id }, data: { status: 'CONFIRMED', confirmedCostUsd: actualCostUsd } });
}

/** Mark a reservation PENDING_RECONCILIATION (uncertain outcome). */
export async function pendingSpendReservation(db: any, id: string): Promise<void> {
  await db.spendReservation.update({ where: { id }, data: { status: 'PENDING_RECONCILIATION' } });
}

/**
 * Release a reservation (delete the row). ONLY for failures that prove
 * non-processing (4xx, validation, MODEL_NOT_ALLOWED): the provider
 * refused before processing, so nothing can have been charged. NEVER
 * for timeouts, network errors, or 5xx — those go to PENDING.
 */
export async function releaseSpendReservation(db: any, id: string): Promise<void> {
  await db.spendReservation.delete({ where: { id } });
}

/** Conservatively settle a reservation at its maximum permitted cost. */
export async function settleSpendReservationAtMaximum(db: any, id: string): Promise<void> {
  const row = await db.spendReservation.findUnique({ where: { id } });
  if (!row) return;
  await db.spendReservation.update({ where: { id }, data: { status: 'SETTLED_AT_MAXIMUM', settledCostUsd: row.maxCostUsd } });
}
