// Tier specification — single source of truth for the commercial tier model.
//
// Hackathon scope: ONE restricted free tier + ONE professional paid tier.
// Business/Enterprise are addable later and are NOT defined here: there is
// no 'business' or 'enterprise' plan key anywhere in this module, and the
// resolver must reject such keys as unmapped rather than mapping them to
// professional.
//
// Value status discipline (standing rule: never finalize an unapproved
// value): every value that has not been approved by the platform owner is
// marked PROPOSED in its field, in code comments, and in API responses that
// surface it. The scratched book-studio prices ($49.99 Basic / $99.99
// Premium) appear nowhere in this module: 'basic' is unmapped and the
// professional price below is a NEW platform proposal, not the scratched
// $99.99 figure.
//
// Storage quota definition is PENDING (BLOCKED input): the module records
// the proposed byte values but marks the definition as pending, because it
// is not decided whether "storage" counts DB rows only, uploads, export
// artifacts, or backups. No enforcement may be claimed for storage until
// that definition is approved AND an enforcement mechanism exists. The
// upload-total ledger (totalUploadBytes, B4) is uploads only and must NOT
// be conflated with storage.
//
// Meta allowance interval is likewise unconfirmed (presumed monthly): the
// enforcement in spend.ts applies the $10 professional allowance ALL-TIME
// until the interval is confirmed — stricter than monthly, never looser.
//
// No subscription includes unlimited Meta inference: every tier here has an
// explicit allowance, concurrency cap, storage quota (proposed), and an
// exhaustion rule (hard stop, no automatic charges).
import { tierKeyForTenant } from './tier-allowlist';

/** Minimal tenant shape the tier key resolver reads (DB Tenant rows carry
 * subscriptionPlan + subscriptionStatus; see prisma/schema.prisma). */
export type TenantTierRow = { subscriptionPlan?: string | null; subscriptionStatus: string };

export type TierKey = 'restricted' | 'professional';

export interface TierSpec {
  key: TierKey;
  label: string;
  /** Deterministic (template/local) processing is available on both tiers. */
  deterministic: true;
  /** Meta-backed capabilities. augment:false on both: Meta-backed augment is
   * DISABLED pending separate Option A authorization; template augment is
   * deterministic work and is allowed on both tiers as local work. */
  meta: { analyze: boolean; evaluate: boolean; schema: boolean; augment: boolean };
  /** Contributor pathway: 'disabled' (restricted, $0 allowance leaves no
   * pathway) or 'gated' (professional: eligibility + dataset consent +
   * public data class, enforced in model-resolver/meta-gate). */
  contributor: 'disabled' | 'gated';
  /** Meta allowance in USD. Restricted $0. Professional $10 PROPOSED. */
  metaAllowanceUsd: number;
  metaAllowanceStatus: 'FREE' | 'PROPOSED';
  /** Interval of the allowance; unconfirmed, enforced all-time (see header). */
  metaAllowanceInterval: 'all-time-until-interval-confirmed' | 'none';
  /** Record cap per tenant. PROPOSED on both tiers (restricted 5,000 is the
   * pre-existing proposed safety value, NOT a finalized limit). */
  recordLimit: number;
  recordLimitStatus: 'PROPOSED';
  /** Storage quota in bytes. PROPOSED; definition pending (see header). */
  storageBytes: number;
  storageStatus: 'PROPOSED';
  storageDefinitionPending: true;
  /** Concurrent jobs. PROPOSED on both tiers. */
  concurrency: number;
  concurrencyStatus: 'PROPOSED';
  /** Export allowed (always 70/30-gated; restricted tenants cannot export). */
  export: boolean;
  /** Price in USD per month. Restricted $0 (free). Professional $99
   * PROPOSED — a value in code/docs only, NOT a Stripe price: no product
   * or price is created until cost runs set final pricing (pricing hold). */
  priceUsdPerMonth: number;
  priceStatus: 'FREE' | 'PROPOSED';
  /** What happens when the tier's Meta allowance is exhausted. */
  exhaustionRule: 'hard-stop-no-automatic-charges';
}

export const RESTRICTED_SPEC: TierSpec = {
  key: 'restricted',
  label: 'Restricted (free)',
  deterministic: true,
  meta: { analyze: false, evaluate: false, schema: false, augment: false },
  contributor: 'disabled',
  metaAllowanceUsd: 0,
  metaAllowanceStatus: 'FREE',
  metaAllowanceInterval: 'none',
  recordLimit: 5000,
  recordLimitStatus: 'PROPOSED',
  storageBytes: 250 * 1024 * 1024,
  storageStatus: 'PROPOSED',
  storageDefinitionPending: true,
  concurrency: 1,
  concurrencyStatus: 'PROPOSED',
  export: false,
  priceUsdPerMonth: 0,
  priceStatus: 'FREE',
  exhaustionRule: 'hard-stop-no-automatic-charges',
};

export const PROFESSIONAL_SPEC: TierSpec = {
  key: 'professional',
  label: 'Professional (staging-test only)',
  deterministic: true,
  meta: { analyze: true, evaluate: true, schema: true, augment: false },
  contributor: 'gated',
  metaAllowanceUsd: 10,
  metaAllowanceStatus: 'PROPOSED',
  metaAllowanceInterval: 'all-time-until-interval-confirmed',
  recordLimit: 100000,
  recordLimitStatus: 'PROPOSED',
  storageBytes: 5 * 1024 * 1024 * 1024,
  storageStatus: 'PROPOSED',
  storageDefinitionPending: true,
  concurrency: 2,
  concurrencyStatus: 'PROPOSED',
  export: true,
  priceUsdPerMonth: 99,
  priceStatus: 'PROPOSED',
  exhaustionRule: 'hard-stop-no-automatic-charges',
};

/**
 * Commercial tier spec for a tenant row, or null when the tenant has no
 * commercial tier. 'legacy' (pre-billing snapshot), 'none' (unmapped keys
 * including 'basic'), and null tenants all yield null: legacy is NOT a
 * commercial tier and unmapped keys must never silently map to
 * professional. Callers that need a cap from a null spec must fail closed
 * (no Meta, no export) — never treat null as unlimited.
 */
export function tierSpecForTenant(tenant: TenantTierRow | null): TierSpec | null {
  // tierKeyForTenant itself is null-unsafe (it dereferences the row), so
  // null is handled here, not passed through.
  if (!tenant) return null;
  const key = tierKeyForTenant(tenant);
  if (key === 'restricted') return RESTRICTED_SPEC;
  if (key === 'professional') return PROFESSIONAL_SPEC;
  return null;
}

/** Record cap for a tenant, or null when no commercial tier applies (the
 * caller must then apply the entitlement gate's decision, not a cap). */
export function recordCapForTenant(tenant: TenantTierRow | null): number | null {
  const spec = tierSpecForTenant(tenant);
  return spec ? spec.recordLimit : null;
}

/**
 * Storage quota for a tenant. The byte value is PROPOSED and the definition
 * is PENDING — this is a specification record, not an enforcement claim.
 * No route enforces storage today; see the header.
 */
export function storageQuotaForTenant(tenant: TenantTierRow | null): { bytes: number; status: 'PROPOSED'; definitionPending: true } | null {
  const spec = tierSpecForTenant(tenant);
  if (!spec) return null;
  return { bytes: spec.storageBytes, status: 'PROPOSED', definitionPending: true };
}

/** Concurrency cap for a tenant (PROPOSED values), or null when no
 * commercial tier applies. */
export function concurrencyCapForTenant(tenant: TenantTierRow | null): number | null {
  const spec = tierSpecForTenant(tenant);
  return spec ? spec.concurrency : null;
}
