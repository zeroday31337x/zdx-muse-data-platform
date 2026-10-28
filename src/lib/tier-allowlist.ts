// Server-side tier → model allowlist (model-tier amendment, revised).
// The allowlist is platform/admin-configured, server-side only. It is
// never client-supplied, never stored in a cookie, and never trusted
// from a request body, query, or header. A tenant/job preference is
// an INPUT to the gate, never the gate itself.
// Per-job budget caps below are PROPOSED ONLY (model proposal §2 /
// revised spec §3.7) — VPS-safety caps, not approved policy, not
// commercial prices, not plan quotas.
export type TierAllowlist = {
  text: string[];
  image: string[];
  voice: string[];
  sam: string[];
  wonder: boolean;
  perJobBudgetUsd: number | null;
  defaultModel: string | null;
};

// Text prices in code are the only prices treated as usable for
// resolution. SAM/image/voice prices in code are placeholders or
// unverified and are therefore NOT in any allowlist value below:
// a request for them is rejected with MODEL_PRICE_UNVERIFIED by the
// resolver, never recorded at $0 and never shown as free.
//
// TIER KEYS, 2026-10-27 compliance correction:
// - 'basic' is REMOVED. It was the scratched book-studio tier; it is
//   now an unmapped key and must never silently map to 'professional'.
//   A tenant row carrying subscriptionPlan='basic' falls through to the
//   status fallback below (active → 'none' → EMPTY: no Meta).
// - 'professional' is the single commercial plan key for the hackathon
//   scope (PROPOSED-STAGING-TEST $99/month, NOT production pricing,
//   NOT an approved contract change). Its per-job budget cap is
//   UNDEFINED (BLOCKED input) — perJobBudgetUsd null means the
//   resolver applies no per-job cap; enforcement for Professional
//   comes from the $10 tenant allowance (spend.ts) + the hard ceiling.
// - 'restricted' is RETAINED as the internal free-tier state. Its text
//   allowlist is EMPTY: the previously documented Contributor-only
//   pathway (eligibility + consent) is DISABLED under the staging-test
//   $0 free inference allowance — any paid inference, however cheap,
//   exceeds $0. Re-enabling it requires a separately approved
//   exception with its own budget line; until then restricted tenants
//   get labelled deterministic results, never Meta calls. This is the
//   implemented resolution of the user-flagged restricted-Contributor
//   issue (2026-10-27), chosen over an exception because no exception
//   budget line exists to approve against.
// - 'legacy' is the pre-billing snapshot only; its allowance is
//   UNDEFINED (BLOCKED input — needs a migrate-or-cap decision).
export const TIER_ALLOWLISTS: Record<string, TierAllowlist> = {
  professional: {
    text: ['muse-spark-1.3', 'muse-spark-1.3-contributor'],
    image: [], voice: [], sam: [], wonder: false,
    perJobBudgetUsd: null, // BLOCKED: no approved per-job cap for Professional yet
    defaultModel: 'muse-spark-1.3',
  },
  legacy: {
    text: ['muse-spark-1.3', 'muse-spark-1.3-contributor'],
    image: [], voice: [], sam: [], wonder: false,
    perJobBudgetUsd: 2.0, // PROPOSED (pre-billing snapshot safety value)
    defaultModel: 'muse-spark-1.3',
  },
  restricted: {
    // DISABLED 2026-10-27: $0 free inference allowance (see note above).
    text: [],
    image: [], voice: [], sam: [], wonder: false,
    perJobBudgetUsd: 0.1, // PROPOSED safety value; unreachable while text is empty
    defaultModel: null,
  },
};

export const EMPTY_ALLOWLIST: TierAllowlist = {
  text: [], image: [], voice: [], sam: [], wonder: false,
  perJobBudgetUsd: 0, defaultModel: null,
};

/**
 * Resolve the tier key for a tenant. subscriptionPlan (an allowlist
 * plan KEY, never a price ID) wins when it names a known allowlist;
 * otherwise the derived entitlement state supplies the fallback
 * (legacy → legacy allowlist, restricted/incomplete* → restricted
 * allowlist, everything else → empty allowlist: no new Meta).
 */
export function tierKeyForTenant(tenant: { subscriptionPlan?: string | null; subscriptionStatus: string }): string {
  if (tenant.subscriptionPlan && TIER_ALLOWLISTS[tenant.subscriptionPlan]) return tenant.subscriptionPlan;
  if (tenant.subscriptionStatus === 'legacy') return 'legacy';
  if (tenant.subscriptionStatus === 'restricted' || tenant.subscriptionStatus === 'incomplete' || tenant.subscriptionStatus === 'incomplete_expired') return 'restricted';
  return 'none';
}

export function allowlistForTenant(tenant: { subscriptionPlan?: string | null; subscriptionStatus: string }): TierAllowlist {
  const key = tierKeyForTenant(tenant);
  return TIER_ALLOWLISTS[key] ?? EMPTY_ALLOWLIST;
}

/** Models allowed for a modality from an allowlist value. */
export function modelsForModality(allowlist: TierAllowlist, modality: 'text' | 'image' | 'voice' | 'sam'): string[] {
  if (modality === 'text') return allowlist.text;
  if (modality === 'image') return allowlist.image;
  if (modality === 'voice') return allowlist.voice;
  return allowlist.sam;
}

/**
 * Hard infrastructure ceiling (revised spec §2.8, contract row C5).
 * Lives in env/code ONLY — never in a dashboard-editable setting.
 * There is NO fallback: when any of the three values is missing or
 * invalid, the ceiling is NOT CONFIGURED and every paid inference
 * path must FAIL CLOSED (see hardCeilingStatus + meta-gate.ts).
 * The previously documented "meta-budget caps act as fallback" reading
 * is REMOVED by this correction: meta-budget.ts daily $20 / total $170
 * defaults are a separate independent budget check, never a substitute
 * for the hard ceiling, and must never silently authorize spending.
 * The ceiling VALUE itself remains an external decision (BLOCKED) and
 * is never invented here. An admin-configured cap above the hard
 * ceiling is rejected at write time and clamped at call time.
 */
export function hardCeiling(): { dailyUsd: number | null; totalUsd: number | null; perJobUsd: number | null } {
  const parse = (raw: string | undefined): number | null => {
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return {
    dailyUsd: parse(process.env.HARD_META_DAILY_CAP_USD),
    totalUsd: parse(process.env.HARD_META_TOTAL_CAP_USD),
    perJobUsd: parse(process.env.HARD_META_PER_JOB_CAP_USD),
  };
}

/** Fail-closed ceiling validation: configured ONLY when all three values are present, finite, and > 0. */
export function hardCeilingStatus(): {
  configured: boolean;
  dailyUsd: number | null;
  totalUsd: number | null;
  perJobUsd: number | null;
  problems: string[];
} {
  const c = hardCeiling();
  const problems: string[] = [];
  if (process.env.HARD_META_DAILY_CAP_USD !== undefined && c.dailyUsd === null) problems.push('HARD_META_DAILY_CAP_USD missing or invalid');
  if (process.env.HARD_META_TOTAL_CAP_USD !== undefined && c.totalUsd === null) problems.push('HARD_META_TOTAL_CAP_USD missing or invalid');
  if (process.env.HARD_META_PER_JOB_CAP_USD !== undefined && c.perJobUsd === null) problems.push('HARD_META_PER_JOB_CAP_USD missing or invalid');
  if (c.dailyUsd === null) problems.push('HARD_META_DAILY_CAP_USD not set');
  if (c.totalUsd === null) problems.push('HARD_META_TOTAL_CAP_USD not set');
  if (c.perJobUsd === null) problems.push('HARD_META_PER_JOB_CAP_USD not set');
  return { configured: c.dailyUsd !== null && c.totalUsd !== null && c.perJobUsd !== null, ...c, problems };
}
