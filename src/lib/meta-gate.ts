/* eslint-disable @typescript-eslint/no-explicit-any */
// DB-backed inference gate: resolves a Meta model for a tenant +
// dataset through the pure resolver, re-checking entitlement, tier
// allowlist, data class, eligibility/consent, price, and budget at
// call time (revised §3.2). The caller must pass the DB client;
// tenant identity always comes from the session, never from input.
// A rejection is returned, never a substitute model.
//
// FAIL-CLOSED ORDER (contract row C5, compliance correction): before
// the resolver runs, the gate rejects when (a) the tenant carries a
// grace-expired restriction, (b) the hard ceiling is not configured
// (missing/invalid env — NO fallback to meta-budget caps, NO default
// that could authorize spending), (c) counted spend already meets or
// exceeds a hard ceiling or the tenant allowance, or (d) counted spend
// cannot be read at all (DB error). The per-call atomic reservation
// (spend.ts reserveSpend) then enforces counted + maxCost <= caps for
// the call itself; this gate check is defense in depth, not a
// substitute for the reservation.
import { entitlementGate, graceRestrictionActive } from './billing';
import { allowlistForTenant, tierKeyForTenant, hardCeilingStatus } from './tier-allowlist';
import { determineRequestedModel, resolveModel, type DataClass, type ResolveResult } from './model-resolver';
import { allowanceCapForTenant, countedSpendForTenant } from './spend';

export async function resolveMetaCall(
  db: any,
  input: {
    tenant: { id: string; subscriptionStatus: string; subscriptionPlan?: string | null; modelPreference?: string | null; accessRestriction?: string | null };
    datasetId?: string | null;
    dataClass: DataClass;
    jobPreference?: string | null;
    estimatedCostUsd?: number | null;
  },
): Promise<{ resolution: ResolveResult; requestedModel: string | null; tierKey: string; planSnapshot: string | null; contributorConsentId: string | null }> {
  const allowlist = allowlistForTenant(input.tenant);
  const determined = determineRequestedModel({
    jobPreference: input.jobPreference ?? null,
    tenantPreference: input.tenant.modelPreference ?? null,
    tierDefault: allowlist.defaultModel,
  });
  const tierKey = tierKeyForTenant(input.tenant);
  const planSnapshot = input.tenant.subscriptionPlan ?? null;
  if (!determined) {
    return {
      resolution: { ok: false, rejectionCode: 'MODEL_NOT_ALLOWED_FOR_TIER', reason: 'rejected' },
      requestedModel: null, tierKey, planSnapshot, contributorConsentId: null,
    };
  }
  // (a) Grace-expired restriction: no Meta inference, status preserved.
  if (graceRestrictionActive(input.tenant)) {
    return {
      resolution: { ok: false, rejectionCode: 'GRACE_EXPIRED_UNVERIFIED', reason: 'rejected' },
      requestedModel: determined.requestedModel, tierKey, planSnapshot, contributorConsentId: null,
    };
  }
  // (b) Hard ceiling must be configured; missing/invalid fails closed.
  const ceiling = hardCeilingStatus();
  if (!ceiling.configured) {
    return {
      resolution: { ok: false, rejectionCode: 'MODEL_BUDGET_EXCEEDED', reason: 'rejected' },
      requestedModel: determined.requestedModel, tierKey, planSnapshot, contributorConsentId: null,
    };
  }
  // (c) Counted spend already at/over a cap, or unreadable: fail closed.
  let counted;
  try {
    counted = await countedSpendForTenant(db, input.tenant.id);
  } catch {
    return {
      resolution: { ok: false, rejectionCode: 'MODEL_BUDGET_EXCEEDED', reason: 'rejected' },
      requestedModel: determined.requestedModel, tierKey, planSnapshot, contributorConsentId: null,
    };
  }
  if (counted.countedDaily >= (ceiling.dailyUsd as number) || counted.countedTotal >= (ceiling.totalUsd as number)) {
    return {
      resolution: { ok: false, rejectionCode: 'MODEL_BUDGET_EXCEEDED', reason: 'rejected' },
      requestedModel: determined.requestedModel, tierKey, planSnapshot, contributorConsentId: null,
    };
  }
  const allowance = allowanceCapForTenant(input.tenant);
  if (allowance !== null && counted.countedTotal >= allowance.capUsd) {
    return {
      resolution: { ok: false, rejectionCode: 'MODEL_BUDGET_EXCEEDED', reason: 'rejected' },
      requestedModel: determined.requestedModel, tierKey, planSnapshot, contributorConsentId: null,
    };
  }
  // NOTE: allowance === null (legacy tier) skips the allowance check:
  // no legacy allowance is defined (BLOCKED input). The hard ceiling
  // above still applies, and the gap is recorded in the audit.
  const gate = entitlementGate(input.tenant.subscriptionStatus, 'meta');
  let eligible = false;
  let consented = false;
  let consentId: string | null = null;
  try {
    const elig = await db.contributorEligibility.findUnique({ where: { tenantId: input.tenant.id } });
    eligible = Boolean(elig?.eligible && !elig?.revokedAt);
  } catch { eligible = false; }
  if (input.datasetId) {
    try {
      const consent = await db.datasetContributorConsent.findUnique({ where: { datasetId: input.datasetId } });
      const expired = consent?.expiresAt ? consent.expiresAt < new Date() : false;
      consented = Boolean(consent?.consented && !consent?.revokedAt && !expired && consent?.tenantId === input.tenant.id);
      consentId = consented ? consent.id : null;
    } catch { consented = false; }
  }
  const resolution = resolveModel({
    requestedModel: determined.requestedModel,
    source: determined.source,
    dataClass: input.dataClass,
    entitlementAllowed: gate.allowed,
    allowlist,
    modality: 'text',
    contributorEligible: eligible,
    contributorConsented: consented,
    estimatedCostUsd: input.estimatedCostUsd ?? null,
    hardPerJobCapUsd: ceiling.perJobUsd,
  });
  return {
    resolution,
    requestedModel: determined.requestedModel,
    tierKey,
    planSnapshot,
    contributorConsentId: resolution.ok && determined.requestedModel.endsWith('-contributor') ? consentId : null,
  };
}
