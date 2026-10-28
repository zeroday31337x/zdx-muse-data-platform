// Branch 2 (model-tier amendment, revised) unit tests — pure resolver,
// tier allowlist, requested-model determination, schema contract.
// No network, no DB, no paid calls.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { resolveModel, determineRequestedModel, isContributorModel } from './model-resolver';
import { TIER_ALLOWLISTS, EMPTY_ALLOWLIST, tierKeyForTenant, allowlistForTenant } from './tier-allowlist';

const base = {
  entitlementAllowed: true,
  // Compliance correction 2026-10-27: 'basic' is scratched (void);
  // the resolver fixture uses the 'professional' allowlist (same
  // Standard + Contributor text shape, staging-test only).
  allowlist: TIER_ALLOWLISTS.professional,
  dataClass: 'public' as const,
  source: 'platform-default' as const,
};

describe('model resolver: explicit rejection, no silent substitution', () => {
  it('secret data is refused for any model', () => {
    const r = resolveModel({ ...base, requestedModel: 'muse-spark-1.3', dataClass: 'secret' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejectionCode).toBe('MODEL_PROHIBITED_FOR_DATA_CLASS');
    expect((r as { model?: string }).model).toBeUndefined();
  });
  it('Contributor + private data is rejected, never switched to Standard', () => {
    const r = resolveModel({ ...base, requestedModel: 'muse-spark-1.3-contributor', dataClass: 'private', contributorEligible: true, contributorConsented: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejectionCode).toBe('MODEL_PROHIBITED_FOR_DATA_CLASS');
    expect((r as { model?: string }).model).toBeUndefined();
  });
  it('Contributor without eligibility is rejected', () => {
    const r = resolveModel({ ...base, requestedModel: 'muse-spark-1.3-contributor', contributorEligible: false, contributorConsented: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejectionCode).toBe('MODEL_NOT_ELIGIBLE_CONTRIBUTOR');
  });
  it('Contributor with eligibility but without dataset consent is rejected', () => {
    const r = resolveModel({ ...base, requestedModel: 'muse-spark-1.3-contributor', contributorEligible: true, contributorConsented: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejectionCode).toBe('MODEL_NOT_ELIGIBLE_CONTRIBUTOR');
  });
  it('Contributor with eligibility + consent + public data resolves to itself', () => {
    const r = resolveModel({ ...base, requestedModel: 'muse-spark-1.3-contributor', contributorEligible: true, contributorConsented: true });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.model).toBe('muse-spark-1.3-contributor'); expect(r.reason).toBe('platform-default'); }
  });
  it('Standard is allowed for private data (data class does not force Contributor)', () => {
    const r = resolveModel({ ...base, requestedModel: 'muse-spark-1.3', dataClass: 'private' });
    expect(r.ok).toBe(true);
  });
  it('Standard is outside the restricted tier allowlist', () => {
    const r = resolveModel({ ...base, requestedModel: 'muse-spark-1.3', allowlist: TIER_ALLOWLISTS.restricted, dataClass: 'private' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejectionCode).toBe('MODEL_NOT_ALLOWED_FOR_TIER');
  });
  it('Wonder is always disabled in this branch', () => {
    const r = resolveModel({ ...base, requestedModel: 'muse-wonder-1.0' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejectionCode).toBe('MODEL_DISABLED_WONDER');
  });
  it('image modality is price-unverified, never $0', () => {
    const r = resolveModel({ ...base, requestedModel: 'muse-image-1.0', modality: 'image' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejectionCode).toBe('MODEL_PRICE_UNVERIFIED');
  });
  it('unknown text model is outside the allowlist', () => {
    const r = resolveModel({ ...base, requestedModel: 'muse-spark-99.9' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejectionCode).toBe('MODEL_NOT_ALLOWED_FOR_TIER');
  });
  it('entitlement denial blocks before any model logic', () => {
    const r = resolveModel({ ...base, requestedModel: 'muse-spark-1.3', entitlementAllowed: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejectionCode).toBe('MODEL_ENTITLEMENT_REQUIRED');
  });
  it('estimated cost above the per-job cap is refused before the call', () => {
    // Compliance correction: the professional fixture has NO per-job
    // cap (BLOCKED input), so this behaviour is tested against the
    // legacy allowlist, which retains the PROPOSED $2.00 cap.
    const legacyBase = { ...base, allowlist: TIER_ALLOWLISTS.legacy };
    const r = resolveModel({ ...legacyBase, requestedModel: 'muse-spark-1.3', estimatedCostUsd: 3.0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejectionCode).toBe('MODEL_BUDGET_EXCEEDED');
    const ok = resolveModel({ ...legacyBase, requestedModel: 'muse-spark-1.3', estimatedCostUsd: 1.0 });
    expect(ok.ok).toBe(true);
  });
  it('the hard ceiling binds below the per-job cap (lowest wins)', () => {
    const r = resolveModel({ ...base, requestedModel: 'muse-spark-1.3', estimatedCostUsd: 1.0, hardPerJobCapUsd: 0.5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejectionCode).toBe('MODEL_BUDGET_EXCEEDED');
  });
  it('rejected results carry reason "rejected" and no model', () => {
    const r = resolveModel({ ...base, requestedModel: 'muse-spark-1.3', dataClass: 'secret' });
    expect(r.reason).toBe('rejected');
    expect((r as { model?: string }).model).toBeUndefined();
  });
});

describe('requested-model determination (revised §10.4)', () => {
  it('job preference wins over tenant preference and tier default', () => {
    expect(determineRequestedModel({ jobPreference: 'muse-spark-1.3', tenantPreference: 'muse-spark-1.3-contributor', tierDefault: 'muse-spark-1.3' })).toEqual({ requestedModel: 'muse-spark-1.3', source: 'job-preference' });
  });
  it('tenant preference wins over tier default', () => {
    expect(determineRequestedModel({ tenantPreference: 'muse-spark-1.3-contributor', tierDefault: 'muse-spark-1.3' })).toEqual({ requestedModel: 'muse-spark-1.3-contributor', source: 'tenant-preference' });
  });
  it('tier default is recorded as requestedModel when nothing else is set', () => {
    expect(determineRequestedModel({ tierDefault: 'muse-spark-1.3' })).toEqual({ requestedModel: 'muse-spark-1.3', source: 'platform-default' });
  });
  it('nothing set and no tier default yields null (caller rejects)', () => {
    expect(determineRequestedModel({})).toBeNull();
  });
});

describe('tier allowlist', () => {
  it('plan key wins; legacy/restricted fall back by status; past_due gets empty', () => {
    expect(tierKeyForTenant({ subscriptionPlan: 'professional', subscriptionStatus: 'active' })).toBe('professional');
    // Scratched 'basic' is unmapped: it must NOT silently map to
    // 'professional'. An active tenant carrying plan 'basic' falls
    // through to the status fallback ('none' → EMPTY: no Meta).
    expect(tierKeyForTenant({ subscriptionPlan: 'basic', subscriptionStatus: 'active' })).toBe('none');
    expect(allowlistForTenant({ subscriptionPlan: 'basic', subscriptionStatus: 'active' })).toEqual(EMPTY_ALLOWLIST);
    expect(tierKeyForTenant({ subscriptionPlan: null, subscriptionStatus: 'legacy' })).toBe('legacy');
    expect(tierKeyForTenant({ subscriptionPlan: null, subscriptionStatus: 'restricted' })).toBe('restricted');
    expect(tierKeyForTenant({ subscriptionPlan: null, subscriptionStatus: 'past_due' })).toBe('none');
    expect(allowlistForTenant({ subscriptionPlan: null, subscriptionStatus: 'past_due' })).toEqual(EMPTY_ALLOWLIST);
  });
  it('no allowlist value contains an unverified-price model', () => {
    for (const a of Object.values(TIER_ALLOWLISTS)) {
      expect(a.image).toEqual([]);
      expect(a.voice).toEqual([]);
      expect(a.sam).toEqual([]);
      expect(a.wonder).toBe(false);
    }
  });
  it('contributor detection is by suffix', () => {
    expect(isContributorModel('muse-spark-1.3-contributor')).toBe(true);
    expect(isContributorModel('muse-spark-1.3')).toBe(false);
  });
});

describe('schema contract (branch 2)', () => {
  const schema = fs.readFileSync(path.join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
  it('declares ContributorEligibility and DatasetContributorConsent models', () => {
    expect(schema).toContain('model ContributorEligibility');
    expect(schema).toContain('model DatasetContributorConsent');
  });
  it('Tenant has modelPreference and NO boolean contributorEligible cache', () => {
    expect(schema).toContain('modelPreference');
    expect(schema).not.toContain('contributorEligible  Boolean');
  });
  it('Job has the revised model-resolution fields', () => {
    for (const f of ['requestedModel', 'resolvedModel', 'modelResolutionReason', 'modelRejectionCode', 'dataClass']) {
      expect(schema).toContain(f);
    }
  });
  it('UsageLedger has audit linkage fields and keeps confirmed-only costUsd', () => {
    expect(schema).toContain('contributorConsentId');
    expect(schema).toContain('planSnapshot');
    expect(schema).toContain('datasetId');
  });
});
