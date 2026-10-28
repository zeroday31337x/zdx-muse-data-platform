// Billing gates and Stripe lifecycle mapping (contract §1A, §3c, §3d).
// Rules that matter:
// - Entitlement is DERIVED from verified Stripe state only. Checkout
//   creation, redirects, and client claims NEVER set entitlement.
// - Stripe's verbatim status is stored separately from the derived
//   entitlement; the gate reads the derived state, and on disagreement
//   fails closed to the more restrictive side.
// - Unknown Stripe statuses fail closed to restricted-level access and
//   must be audit-logged as UNKNOWN_STRIPE_STATUS by the caller.
// - Production charging is DISABLED in this branch: billing routes
//   refuse unless STRIPE_MODE === 'test'. Enabling live billing needs
//   a separate production-billing approval, not an env flip alone.
// - Free-tier numbers below are PROPOSED ONLY (contract §3e, §11) —
//   they are VPS safety limits, not approved policy and not prices.
import crypto from 'node:crypto';

export type DerivedStatus =
  | 'legacy' | 'restricted' | 'trialing' | 'active' | 'past_due'
  | 'canceled' | 'unpaid' | 'paused' | 'incomplete' | 'incomplete_expired';

export const STRIPE_STATUSES = ['incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused'] as const;
export type StripeStatus = (typeof STRIPE_STATUSES)[number];

export function isStripeStatus(value: string | null | undefined): value is StripeStatus {
  return !!value && (STRIPE_STATUSES as readonly string[]).includes(value);
}

/** Plan allowlist: plan KEYS only, never client price IDs.
 * SUPERSEDED 2026-10-27: the $49.99 Basic / $99.99 Premium prices were
 * Justen's book-studio prices, VOID for this platform. There is NO
 * 'basic' or 'premium' plan key: 'basic' is an unmapped key and must
 * never silently map to 'professional'. The single commercial plan key
 * for the hackathon scope is 'professional' (PROPOSED-STAGING-TEST
 * $99/month, NOT production pricing, NOT an approved contract change).
 * Its Stripe test price ID is NOT supplied yet: it must come from env
 * STRIPE_PRICE_PROFESSIONAL (server-side only) before checkout can
 * run — until then checkout for 'professional' fails closed with
 * BILLING_NOT_CONFIGURED/price-missing, never with an invented ID.
 * ON HOLD 2026-10-27 (user decision): Stripe product creation and
 * price-setting wait until the platform is finished AND one or two
 * cost test runs have measured costs; final pricing is set from those
 * measurements. Price IDs are therefore DEFERRED (a deliberate wait),
 * not missing items to fill in now — and no Stripe product may be
 * created by this build in the meantime, test or live.
 * Business ($249, proposed) and Enterprise (Custom, proposed) have NO
 * plan key in this build and test as rejected until separately defined.
 */
export const PLAN_ALLOWLIST: Record<string, { label: string }> = {
  professional: { label: 'Professional (staging-test only)' },
};

export function priceIdForPlan(planKey: string): string | null {
  const envName = `STRIPE_PRICE_${planKey.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  return process.env[envName] || null;
}

export function stripeTestConfigured(): boolean {
  return process.env.STRIPE_MODE === 'test' && Boolean(process.env.STRIPE_SECRET_KEY);
}

export function billingConfigured(): boolean {
  return stripeTestConfigured();
}

/** Server-generated deterministic idempotency key (tenant + plan). */
export function serverCheckoutIdempotencyKey(tenantId: string, priceKey: string): string {
  return crypto.createHash('sha256').update(`checkout:${tenantId}:${priceKey}`).digest('hex');
}

export type BillingAction =
  | 'create_dataset' | 'ingest' | 'read' | 'meta' | 'augment_template'
  | 'augment_meta' | 'export' | 'worker_meta' | 'worker_ingest';

export type GateResult =
  | { allowed: true; existingOnly?: boolean }
  | { allowed: false; code: 'ENTITLEMENT_REQUIRED'; status: string; existingOnly?: boolean };

/**
 * Entitlement gate (contract §3d + §1A). Order of checks in routes:
 * 401 (session) → 404 (tenant/resource) → this gate (402) → 409/429/413
 * (limits/business rules, incl. 70/30). `existingOnly` on export means
 * portability/export-out of existing data only; the caller still runs
 * the 70/30 gate for training exports.
 */
export function entitlementGate(derived: string, action: BillingAction): GateResult {
  const deny = (status: string): GateResult => ({ allowed: false, code: 'ENTITLEMENT_REQUIRED', status });
  switch (derived) {
    case 'legacy':
    case 'trialing':
    case 'active':
      return { allowed: true };
    case 'restricted':
    case 'incomplete':
    case 'incomplete_expired':
      // Restricted-level local access: no export, no Meta.
      if (action === 'export' || action === 'meta' || action === 'augment_meta' || action === 'worker_meta') return deny(derived);
      return { allowed: true };
    case 'past_due':
      // Dunning, not terminal: local work continues; Meta stops; export
      // is existing-data portability only (subject to 70/30).
      if (action === 'meta' || action === 'augment_meta' || action === 'worker_meta') return deny(derived);
      if (action === 'export') return { allowed: true, existingOnly: true };
      return { allowed: true };
    case 'canceled':
      // Read-only + export-out of existing compliant data only.
      if (action === 'read') return { allowed: true };
      if (action === 'export') return { allowed: true, existingOnly: true };
      return deny(derived);
    case 'unpaid':
      // Export-out of pre-transition data only; no new work.
      if (action === 'read') return { allowed: true };
      if (action === 'export') return { allowed: true, existingOnly: true };
      return deny(derived);
    case 'paused':
      // Read-only existing data only (no export, no new work).
      if (action === 'read') return { allowed: true };
      return deny(derived);
    default:
      // Unknown derived state: fail closed to restricted-level access.
      if (action === 'export' || action === 'meta' || action === 'augment_meta' || action === 'worker_meta') return deny('restricted');
      return { allowed: true };
  }
}

/**
 * Map a RECONCILED Stripe subscription object to derived entitlement.
 * cancel_at_period_end does NOT cancel immediately: status stays
 * `active` until the subsequent deleted event moves it to `canceled`.
 * Returns null for an unknown verbatim status (caller must audit-log
 * UNKNOWN_STRIPE_STATUS and change nothing).
 */
export function applyStripeState(
  current: { subscriptionStatus: string },
  fetched: { status: string; id?: string; priceId?: string | null; currentPeriodEnd?: Date | null; cancelAtPeriodEnd?: boolean },
): { derived: DerivedStatus; stripeStatus: string } | null {
  if (!isStripeStatus(fetched.status)) return null;
  const derived = fetched.status as DerivedStatus;
  void current;
  return { derived, stripeStatus: fetched.status };
}

/**
 * Grace-restriction layer (contract §11.9 / B12 revision reading).
 * accessRestriction is a SEPARATE entitlement restriction: it NEVER
 * overwrites the last verified Stripe status. Grace expiry is driven
 * ONLY by the server env GRACE_HOURS when set; when unset, no expiry
 * runs and the snapshot is preserved indefinitely (interim behaviour
 * pending the B8 duration decision — the 72h proposal is NOT silently
 * finalized by code). Setting GRACE_HOURS is an operator action that
 * still requires the B8 written approval before staging use.
 */
export const GRACE_RESTRICTION_CODE = 'GRACE_EXPIRED_UNVERIFIED';

export function graceHoursConfigured(): number | null {
  const raw = process.env.GRACE_HOURS;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function graceRestrictionActive(tenant: { accessRestriction?: string | null }): boolean {
  return tenant.accessRestriction === GRACE_RESTRICTION_CODE;
}

/** Pure grace bookkeeping: start grace on reconciliation failure. */
export function recordGraceStart(
  tenant: { graceStartedAt?: Date | null },
  now = new Date(),
): { graceStartedAt: Date } {
  return { graceStartedAt: tenant.graceStartedAt ?? now };
}

/** Pure grace bookkeeping: expire grace after the configured window. */
export function applyGraceExpiry(
  tenant: { graceStartedAt?: Date | null },
  graceHours: number,
  now = new Date(),
): { accessRestriction: string; accessRestrictedAt: Date } | null {
  if (!tenant.graceStartedAt) return null;
  const started = new Date(tenant.graceStartedAt).getTime();
  if (now.getTime() - started < graceHours * 60 * 60 * 1000) return null;
  return { accessRestriction: GRACE_RESTRICTION_CODE, accessRestrictedAt: now };
}

/** Pure grace bookkeeping: clear restriction on successful reconciliation. */
export function clearGraceRestriction(): { accessRestriction: null; accessRestrictedAt: null; graceStartedAt: null } {
  return { accessRestriction: null, accessRestrictedAt: null, graceStartedAt: null };
}

/** Reserved future Meta-backed worker job kinds (Option A, not yet built). */
export const META_JOB_KINDS = new Set(['meta', 'meta-analyze', 'meta-evaluate', 'meta-schema', 'meta-augment']);

/** Worker claim-time revalidation (contract §3d double-gate).
 * Grace-expired restriction pauses ALL kinds (read-only semantics:
 * no new work runs while billing verification has lapsed past grace).
 * OPTION A HOOK (exact location): when a Meta-backed job kind is
 * introduced, its eligibility + budget revalidation MUST happen in
 * src/app/api/worker/run/route.ts immediately after claimNextJob and
 * this assertJobRunnable call, before any Meta call — by resolving via
 * resolveMetaCall (or its worker equivalent) with the job's persisted
 * tenant/dataset/dataClass/requestedModel, then creating an atomic
 * SpendReservation before the call and confirming/marking-pending
 * after it. A rejection pauses the job with its checkpoint preserved
 * (never FAILED for entitlement/budget reasons, never run). Until
 * that dispatch exists, Meta kinds pause here and never execute.
 */
export function assertJobRunnable(
  tenant: { subscriptionStatus: string; accessRestriction?: string | null },
  job: { kind: string },
): { ok: true } | { ok: false; reason: string } {
  const derived = tenant.subscriptionStatus;
  if (derived === 'canceled') {
    // Canceled = read-only: no new jobs; queued jobs pause, not run.
    return { ok: false, reason: 'ENTITLEMENT_REVOKED' };
  }
  if (graceRestrictionActive(tenant)) {
    return { ok: false, reason: GRACE_RESTRICTION_CODE };
  }
  if (META_JOB_KINDS.has(job.kind)) {
    // No Meta job kind is implemented yet: any such job pauses rather
    // than running. When Option A lands, the worker route revalidates
    // eligibility + budget at claim time (see hook note above) and
    // only then dispatches; until that lands, pause is fail-closed.
    const gate = entitlementGate(derived, 'worker_meta');
    if (!gate.allowed) return { ok: false, reason: 'ENTITLEMENT_REVOKED' };
    return { ok: false, reason: 'META_JOB_KIND_NOT_IMPLEMENTED' };
  }
  return { ok: true };
}

// ---- Free-tier / VPS safety limits — ALL PROPOSED, NOT APPROVED ----
// Contract §3e / §11: these numbers are proposals only. They are
// enforced server-side as safety limits, never presented as a plan.
export const FREE_TIER_LIMITS_PROPOSED = {
  recordsPerTenant: 5000,
  requestsPerMinutePerTenant: 120,
  requestsPerMinutePerIp: 300,
  concurrentJobsRestricted: 1,
  concurrentJobsEntitled: 2,
  fileBytes: 10 * 1024 * 1024,
  totalUploadBytes: 50 * 1024 * 1024,
  ingestBatchRestricted: 1000,
  registrationsPerIpPerDay: 3,
  // Grace window (contract §3g) — PROPOSED, NOT APPROVED.
  graceHours: 72,
} as const;

export function checkRecordQuota(recordCount: number, restricted: boolean): { ok: true } | { ok: false; code: string } {
  if (restricted && recordCount >= FREE_TIER_LIMITS_PROPOSED.recordsPerTenant) return { ok: false, code: 'QUOTA_EXCEEDED' };
  return { ok: true };
}

/**
 * Professional record cap (PROPOSED-STAGING-TEST, not production
 * policy, not an approved contract change): 100,000 records per
 * tenant. Enforced at ingest time for professional tenants only.
 * NOTE: 100k is NOT verified capacity — the export path loads all
 * records via a single findMany (no streaming), which is the known
 * bottleneck; an empirical isolated-staging capacity test (ingest
 * 100k → quality → export 100k + concurrent tenants) is required
 * before 100k is advertised as a limit. The restricted record limit
 * is a BLOCKED input (the 5,000 above is an unapproved VPS safety
 * value, not the tier's record limit) and is not set here.
 */
export const PROFESSIONAL_RECORD_LIMIT_STAGING_TEST = 100_000;

export function checkProfessionalRecordQuota(recordCount: number): { ok: true } | { ok: false; code: string } {
  if (recordCount >= PROFESSIONAL_RECORD_LIMIT_STAGING_TEST) return { ok: false, code: 'QUOTA_EXCEEDED' };
  return { ok: true };
}

export function checkIngestBatchSize(rowCount: number, restricted: boolean): { ok: true } | { ok: false; code: string } {
  if (restricted && rowCount > FREE_TIER_LIMITS_PROPOSED.ingestBatchRestricted) return { ok: false, code: 'BATCH_TOO_LARGE' };
  return { ok: true };
}

export function checkConcurrency(activeJobs: number, restricted: boolean): { ok: true } | { ok: false; code: string } {
  const cap = restricted ? FREE_TIER_LIMITS_PROPOSED.concurrentJobsRestricted : FREE_TIER_LIMITS_PROPOSED.concurrentJobsEntitled;
  if (activeJobs >= cap) return { ok: false, code: 'CONCURRENCY_LIMIT' };
  return { ok: true };
}

/** In-memory fixed-window rate counter (single-process v1; per-process only). */
export class RateLimiter {
  private hits = new Map<string, { count: number; windowStart: number }>();
  constructor(private windowMs = 60_000) {}
  hit(key: string, limit: number, now = Date.now()): boolean {
    const entry = this.hits.get(key);
    if (!entry || now - entry.windowStart >= this.windowMs) {
      this.hits.set(key, { count: 1, windowStart: now });
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  }
}

export const globalRateLimiter = new RateLimiter();
