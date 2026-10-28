// Tier specification tests (pure, no DB): restricted + professional only.
// Business/Enterprise are NOT built: their plan keys must resolve to no
// commercial spec. The scratched book-studio prices ($49.99 / $99.99) must
// appear in no spec.
import { describe, it, expect } from 'vitest';
import {
  RESTRICTED_SPEC,
  PROFESSIONAL_SPEC,
  tierSpecForTenant,
  recordCapForTenant,
  storageQuotaForTenant,
  concurrencyCapForTenant,
} from './tier-spec';
import { FREE_TIER_LIMITS_PROPOSED, PROFESSIONAL_RECORD_LIMIT_STAGING_TEST } from './billing';
import { allowanceCapForTenant } from './spend';
import { tierKeyForTenant } from './tier-allowlist';

const restrictedTenant = { subscriptionPlan: null, subscriptionStatus: 'restricted' };
const professionalTenant = { subscriptionPlan: 'professional', subscriptionStatus: 'active' };
const basicTenant = { subscriptionPlan: 'basic', subscriptionStatus: 'active' };
const businessTenant = { subscriptionPlan: 'business', subscriptionStatus: 'active' };
const enterpriseTenant = { subscriptionPlan: 'enterprise', subscriptionStatus: 'active' };
const legacyTenant = { subscriptionPlan: null, subscriptionStatus: 'legacy' };

describe('restricted spec (free tier)', () => {
  it('allows deterministic work only, no Meta, no Contributor, no export', () => {
    expect(RESTRICTED_SPEC.deterministic).toBe(true);
    expect(RESTRICTED_SPEC.meta).toEqual({ analyze: false, evaluate: false, schema: false, augment: false });
    expect(RESTRICTED_SPEC.contributor).toBe('disabled');
    expect(RESTRICTED_SPEC.export).toBe(false);
  });
  it('has a $0 Meta allowance and a hard-stop exhaustion rule', () => {
    expect(RESTRICTED_SPEC.metaAllowanceUsd).toBe(0);
    expect(RESTRICTED_SPEC.metaAllowanceStatus).toBe('FREE');
    expect(RESTRICTED_SPEC.exhaustionRule).toBe('hard-stop-no-automatic-charges');
  });
  it('carries PROPOSED record/storage/concurrency values, never finalized', () => {
    expect(RESTRICTED_SPEC.recordLimit).toBe(5000);
    expect(RESTRICTED_SPEC.recordLimitStatus).toBe('PROPOSED');
    expect(RESTRICTED_SPEC.storageBytes).toBe(250 * 1024 * 1024);
    expect(RESTRICTED_SPEC.storageStatus).toBe('PROPOSED');
    expect(RESTRICTED_SPEC.storageDefinitionPending).toBe(true);
    expect(RESTRICTED_SPEC.concurrency).toBe(1);
    expect(RESTRICTED_SPEC.concurrencyStatus).toBe('PROPOSED');
    expect(RESTRICTED_SPEC.priceUsdPerMonth).toBe(0);
    expect(RESTRICTED_SPEC.priceStatus).toBe('FREE');
  });
  it('matches the pre-existing proposed safety constants (drift guard)', () => {
    expect(RESTRICTED_SPEC.recordLimit).toBe(FREE_TIER_LIMITS_PROPOSED.recordsPerTenant);
    expect(RESTRICTED_SPEC.concurrency).toBe(FREE_TIER_LIMITS_PROPOSED.concurrentJobsRestricted);
  });
});

describe('professional spec (paid tier)', () => {
  it('allows deterministic work + Meta analyze/evaluate/schema, never Meta augment', () => {
    expect(PROFESSIONAL_SPEC.deterministic).toBe(true);
    expect(PROFESSIONAL_SPEC.meta).toEqual({ analyze: true, evaluate: true, schema: true, augment: false });
    expect(PROFESSIONAL_SPEC.export).toBe(true);
  });
  it('gates Contributor (eligibility + consent enforced by the resolver, not here)', () => {
    expect(PROFESSIONAL_SPEC.contributor).toBe('gated');
  });
  it('has a $10 PROPOSED Meta allowance with a hard-stop rule and unconfirmed interval', () => {
    expect(PROFESSIONAL_SPEC.metaAllowanceUsd).toBe(10);
    expect(PROFESSIONAL_SPEC.metaAllowanceStatus).toBe('PROPOSED');
    expect(PROFESSIONAL_SPEC.metaAllowanceInterval).toBe('all-time-until-interval-confirmed');
    expect(PROFESSIONAL_SPEC.exhaustionRule).toBe('hard-stop-no-automatic-charges');
  });
  it('matches the spend-layer allowance (drift guard)', () => {
    expect(allowanceCapForTenant(professionalTenant)?.capUsd).toBe(PROFESSIONAL_SPEC.metaAllowanceUsd);
    expect(allowanceCapForTenant(restrictedTenant)?.capUsd).toBe(0);
  });
  it('carries PROPOSED record/storage/concurrency values, never finalized', () => {
    expect(PROFESSIONAL_SPEC.recordLimit).toBe(100000);
    expect(PROFESSIONAL_SPEC.recordLimitStatus).toBe('PROPOSED');
    expect(PROFESSIONAL_SPEC.recordLimit).toBe(PROFESSIONAL_RECORD_LIMIT_STAGING_TEST);
    expect(PROFESSIONAL_SPEC.storageBytes).toBe(5 * 1024 * 1024 * 1024);
    expect(PROFESSIONAL_SPEC.storageStatus).toBe('PROPOSED');
    expect(PROFESSIONAL_SPEC.storageDefinitionPending).toBe(true);
    expect(PROFESSIONAL_SPEC.concurrency).toBe(2);
    expect(PROFESSIONAL_SPEC.concurrencyStatus).toBe('PROPOSED');
  });
  it('prices at the NEW $99/month proposal — never the scratched $49.99/$99.99', () => {
    expect(PROFESSIONAL_SPEC.priceUsdPerMonth).toBe(99);
    expect(PROFESSIONAL_SPEC.priceUsdPerMonth).not.toBe(99.99);
    expect(PROFESSIONAL_SPEC.priceUsdPerMonth).not.toBe(49.99);
    expect(PROFESSIONAL_SPEC.priceStatus).toBe('PROPOSED');
  });
});

describe('tierSpecForTenant mapping', () => {
  it('maps restricted and professional tenants to their specs', () => {
    expect(tierSpecForTenant(restrictedTenant)?.key).toBe('restricted');
    expect(tierSpecForTenant(professionalTenant)?.key).toBe('professional');
  });
  it('never silently maps basic to professional', () => {
    expect(tierKeyForTenant(basicTenant)).not.toBe('professional');
    expect(tierSpecForTenant(basicTenant)).toBeNull();
  });
  it('does not build Business or Enterprise tiers', () => {
    expect(tierSpecForTenant(businessTenant)).toBeNull();
    expect(tierSpecForTenant(enterpriseTenant)).toBeNull();
  });
  it('treats legacy as a pre-billing snapshot, not a commercial tier', () => {
    expect(tierSpecForTenant(legacyTenant)).toBeNull();
    expect(tierSpecForTenant(null)).toBeNull();
  });
});

describe('cap helpers', () => {
  it('record caps follow the spec; unmapped/legacy/null yield null (no commercial cap)', () => {
    expect(recordCapForTenant(restrictedTenant)).toBe(5000);
    expect(recordCapForTenant(professionalTenant)).toBe(100000);
    expect(recordCapForTenant(basicTenant)).toBeNull();
    expect(recordCapForTenant(legacyTenant)).toBeNull();
    expect(recordCapForTenant(null)).toBeNull();
  });
  it('storage quotas are PROPOSED with the definition pending, never enforced claims', () => {
    expect(storageQuotaForTenant(restrictedTenant)).toEqual({ bytes: 250 * 1024 * 1024, status: 'PROPOSED', definitionPending: true });
    expect(storageQuotaForTenant(professionalTenant)).toEqual({ bytes: 5 * 1024 * 1024 * 1024, status: 'PROPOSED', definitionPending: true });
    expect(storageQuotaForTenant(basicTenant)).toBeNull();
  });
  it('concurrency caps are PROPOSED and tier-specific', () => {
    expect(concurrencyCapForTenant(restrictedTenant)).toBe(1);
    expect(concurrencyCapForTenant(professionalTenant)).toBe(2);
    expect(concurrencyCapForTenant(basicTenant)).toBeNull();
  });
  it('no spec promises unlimited Meta inference', () => {
    for (const spec of [RESTRICTED_SPEC, PROFESSIONAL_SPEC]) {
      expect(Number.isFinite(spec.metaAllowanceUsd)).toBe(true);
      expect(spec.exhaustionRule).toBe('hard-stop-no-automatic-charges');
    }
  });
});
