// Pure model resolver (revised spec §3.2–§3.6). No network, no DB.
// INVARIANT: if the requested model cannot be used for ANY reason,
// the resolver REJECTS explicitly. It NEVER runs a different model,
// never records a different model as if it were the requested model,
// and never presents another model's output as the requested model's.
// The withdrawn "recorded resolution" exception (Contributor preference
// + private data → Standard) is NOT implemented: that case is a
// rejection (MODEL_PROHIBITED_FOR_DATA_CLASS), and the caller may
// make a NEW explicit selection afterwards.
// Gate order implemented here (caller handles 401/404, free-tier/VPS
// limits, and 70/30 before calling; entitlement is re-checked here
// as defense-in-depth):
//   entitlement → data class → tier allowlist → Contributor
//   eligibility/consent → price verification / Wonder → budget.
import type { TierAllowlist } from './tier-allowlist';

export type DataClass = 'public' | 'private' | 'secret' | 'unknown';
export type ModelSource = 'platform-default' | 'tenant-preference' | 'job-preference';
export type RejectionCode =
  | 'MODEL_NOT_ALLOWED_FOR_TIER'
  | 'MODEL_PROHIBITED_FOR_DATA_CLASS'
  | 'MODEL_NOT_ELIGIBLE_CONTRIBUTOR'
  | 'MODEL_PRICE_UNVERIFIED'
  | 'MODEL_DISABLED_WONDER'
  | 'MODEL_ENTITLEMENT_REQUIRED'
  | 'MODEL_BUDGET_EXCEEDED'
  | 'GRACE_EXPIRED_UNVERIFIED';

export type ResolveOk = { ok: true; model: string; source: ModelSource; reason: ModelSource };
export type ResolveReject = { ok: false; rejectionCode: RejectionCode; reason: 'rejected' };
export type ResolveResult = ResolveOk | ResolveReject;

export const NO_META_ENTITLEMENTS = new Set(['past_due', 'unpaid', 'canceled', 'paused', 'incomplete', 'incomplete_expired']);

export function isContributorModel(model: string): boolean {
  return model.endsWith('-contributor');
}

/** Text models whose code pricing is treated as usable for resolution.
 * SAM/image/voice prices in code are placeholders/unverified and are
 * NOT in this set: requests for them are MODEL_PRICE_UNVERIFIED.
 * Text pricing still needs account re-verification before it is relied
 * on for billing-adjacent cost display (revised spec §3.4). */
export const PRICE_VERIFIED_TEXT_MODELS = new Set(['muse-spark-1.3', 'muse-spark-1.3-contributor']);

/**
 * Determine requestedModel + source (revised §10.4): a job preference
 * wins, else the tenant default, else the tier default — and the
 * resolved default is recorded AS requestedModel, never as a silent
 * substitution. Returns null when nothing is requested and the tier
 * has no default.
 */
export function determineRequestedModel(input: {
  jobPreference?: string | null;
  tenantPreference?: string | null;
  tierDefault?: string | null;
}): { requestedModel: string; source: ModelSource } | null {
  if (input.jobPreference) return { requestedModel: input.jobPreference, source: 'job-preference' };
  if (input.tenantPreference) return { requestedModel: input.tenantPreference, source: 'tenant-preference' };
  if (input.tierDefault) return { requestedModel: input.tierDefault, source: 'platform-default' };
  return null;
}

export function resolveModel(input: {
  requestedModel: string;
  source: ModelSource;
  dataClass: DataClass;
  entitlementAllowed: boolean;
  allowlist: TierAllowlist;
  modality?: 'text' | 'image' | 'voice' | 'sam';
  contributorEligible?: boolean;
  contributorConsented?: boolean;
  estimatedCostUsd?: number | null;
  hardPerJobCapUsd?: number | null;
}): ResolveResult {
  const modality = input.modality ?? 'text';
  const reject = (code: RejectionCode): ResolveReject => ({ ok: false, rejectionCode: code, reason: 'rejected' });
  // 1. Entitlement (defense-in-depth re-check; caller gates first).
  if (!input.entitlementAllowed) return reject('MODEL_ENTITLEMENT_REQUIRED');
  // 2. Data class: secret always refused; private/unknown never to
  //    Contributor. These are rejections, never substitutions.
  if (input.dataClass === 'secret') return reject('MODEL_PROHIBITED_FOR_DATA_CLASS');
  if (isContributorModel(input.requestedModel) && (input.dataClass === 'private' || input.dataClass === 'unknown')) {
    return reject('MODEL_PROHIBITED_FOR_DATA_CLASS');
  }
  // 3. Wonder: disabled by default. In this branch Wonder is ALWAYS
  //    rejected: verified Wonder pricing does not exist, and the
  //    enable flag alone is never sufficient (revised §3.4).
  if (input.requestedModel === 'muse-wonder-1.0') return reject('MODEL_DISABLED_WONDER');
  // 4. Price verification: SAM/image/voice are unverified → blocked,
  //    never $0, never shown as free.
  if (modality !== 'text' || !PRICE_VERIFIED_TEXT_MODELS.has(input.requestedModel)) {
    if (modality !== 'text') return reject('MODEL_PRICE_UNVERIFIED');
    // Text model outside the verified set (unknown model id) is not
    // in any allowlist either; fall through to the allowlist check,
    // which rejects it as MODEL_NOT_ALLOWED_FOR_TIER.
  }
  // 5. Tier allowlist for this plan + modality.
  const allowed = modality === 'text' ? input.allowlist.text : modality === 'image' ? input.allowlist.image : modality === 'voice' ? input.allowlist.voice : input.allowlist.sam;
  if (!allowed.includes(input.requestedModel)) return reject('MODEL_NOT_ALLOWED_FOR_TIER');
  // 6. Contributor eligibility + consent (BOTH required, at call time).
  if (isContributorModel(input.requestedModel)) {
    if (input.dataClass !== 'public') return reject('MODEL_PROHIBITED_FOR_DATA_CLASS');
    if (!input.contributorEligible || !input.contributorConsented) return reject('MODEL_NOT_ELIGIBLE_CONTRIBUTOR');
  }
  // 7. Budget: per-job cap AND hard ceiling — effective cap is the
  //    lowest. Over budget = refused BEFORE the call, never after.
  if (input.estimatedCostUsd !== undefined && input.estimatedCostUsd !== null) {
    const caps = [input.allowlist.perJobBudgetUsd, input.hardPerJobCapUsd].filter((c): c is number => typeof c === 'number');
    if (caps.length > 0 && input.estimatedCostUsd > Math.min(...caps)) return reject('MODEL_BUDGET_EXCEEDED');
  }
  return { ok: true, model: input.requestedModel, source: input.source, reason: input.source };
}
