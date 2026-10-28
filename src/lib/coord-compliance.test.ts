// Compliance-batch unit tests (2026-10-27 audit corrections).
// Pure logic + fake-transaction state machines. No network, no DB,
// no paid calls, no secrets. Database-level concurrency (FOR UPDATE
// serialization, SKIP LOCKED) is covered by the opt-in PostgreSQL
// integration file (db-integration.test.ts, NOT RUN without a DB);
// these tests prove the state machine that the SQL enforces.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  PLAN_ALLOWLIST, entitlementGate, assertJobRunnable, META_JOB_KINDS,
  checkConcurrency, checkIngestBatchSize, checkRecordQuota, checkProfessionalRecordQuota,
  PROFESSIONAL_RECORD_LIMIT_STAGING_TEST, graceRestrictionActive, recordGraceStart,
  applyGraceExpiry, clearGraceRestriction, graceHoursConfigured, GRACE_RESTRICTION_CODE,
} from './billing';
import { TIER_ALLOWLISTS, tierKeyForTenant, allowlistForTenant, hardCeilingStatus } from './tier-allowlist';
import { ceilingCheck } from './platform-settings';
import {
  verifiedTextPrice, estimateMaxCost, estimateMaxCostForPrompt, countedCost,
  allowanceCapForTenant, PROFESSIONAL_META_ALLOWANCE_USD_STAGING_TEST,
  META_CALL_MAX_OUTPUT_TOKENS, countedSpendForTenant, reserveSpend,
} from './spend';
import {
  claimUnpaidExportAuthorization, completeUnpaidExportAuthorization,
  releaseUnpaidExportAuthorization, authorizeUnpaidExportOut,
  EXPORT_OUT_CLAIM_TIMEOUT_MS, isClaimStale,
} from './unpaid-export';
import { mfaVerifiedFromClaims } from './cognito';
import { operatorMfaVerifiedFromClaims } from './operator-auth';
import { isUncertainMetaError } from './meta-workflows';

// ---- Fake transaction client for unpaid-export + spend helpers ----
function makeFakeDb() {
  const auths: any[] = [];
  const audits: any[] = [];
  const ledger: any[] = [];
  const reservations: any[] = [];
  const tenants = new Map<string, any>();
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: any[]) => {
      const sql = strings.join(' ');
      if (sql.includes("status = 'AVAILABLE'")) {
        const rows = auths.filter((a) => a.tenantId === values[0] && a.status === 'AVAILABLE')
          .sort((a, b) => a.createdAt - b.createdAt);
        return rows.slice(0, 1).map((a) => ({ id: a.id, boundaryAt: a.boundaryAt }));
      }
      if (sql.includes("status = 'CLAIMED'")) {
        const cutoff = values[1] as Date;
        const rows = auths.filter((a) => a.tenantId === values[0] && a.status === 'CLAIMED' && a.claimedAt < cutoff)
          .sort((a, b) => a.claimedAt - b.claimedAt);
        return rows.slice(0, 1).map((a) => ({ id: a.id, boundaryAt: a.boundaryAt }));
      }
      return []; // Tenant row lock (SELECT ... FOR UPDATE): no-op in fake
    },
    unpaidExportAuthorization: {
      findFirst: async ({ where }: any) => auths.find((a) => a.tenantId === where.tenantId && a.stripeEventId === where.stripeEventId) ?? null,
      create: async ({ data }: any) => { const row = { id: `auth-${auths.length + 1}`, createdAt: new Date(), ...data }; auths.push(row); return row; },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const a of auths) {
          if (a.id === where.id && (!where.status || a.status === where.status) && (!where.claimToken || a.claimToken === where.claimToken)) {
            Object.assign(a, data); count++;
          }
        }
        return { count };
      },
    },
    auditLog: { create: async ({ data }: any) => { audits.push(data); return data; } },
    usageLedger: {
      aggregate: async ({ where }: any) => {
        const rows = ledger.filter((l) => l.tenantId === where.tenantId && (!where.createdAt || l.createdAt >= where.createdAt.gte));
        return { _sum: { costUsd: rows.reduce((s, l) => s + l.costUsd, 0) } };
      },
    },
    spendReservation: {
      aggregate: async ({ where }: any) => {
        const rows = reservations.filter((r) => r.tenantId === where.tenantId
          && (!where.createdAt || r.createdAt >= where.createdAt.gte)
          && (!where.status || where.status.in.includes(r.status)));
        return { _sum: { maxCostUsd: rows.reduce((s, r) => s + r.maxCostUsd, 0) } };
      },
      findMany: async ({ where }: any) => reservations.filter((r) => r.tenantId === where.tenantId && r.status === where.status),
      create: async ({ data }: any) => {
        if (reservations.some((r) => r.requestKey === data.requestKey)) {
          const e: any = new Error('Unique constraint failed'); e.code = 'P2002'; throw e;
        }
        const row = { id: `res-${reservations.length + 1}`, createdAt: new Date(), ...data }; reservations.push(row); return row;
      },
      update: async ({ where, data }: any) => { const r = reservations.find((x) => x.id === where.id); Object.assign(r, data); return r; },
      findUnique: async ({ where }: any) => reservations.find((x) => x.id === where.id) ?? null,
      delete: async ({ where }: any) => { const i = reservations.findIndex((x) => x.id === where.id); reservations.splice(i, 1); },
    },
    tenant: {
      findUnique: async ({ where }: any) => tenants.get(where.id) ?? null,
    },
    $transaction: async (fn: any) => fn(tx),
  };
  return { tx, auths, audits, ledger, reservations, tenants };
}

describe('superseded tier mapping (2026-10-27 correction)', () => {
  it('PLAN_ALLOWLIST has professional only; basic/premium/business/enterprise are unmapped', () => {
    expect(Object.keys(PLAN_ALLOWLIST)).toEqual(['professional']);
    expect(PLAN_ALLOWLIST.basic).toBeUndefined();
    expect(PLAN_ALLOWLIST.premium).toBeUndefined();
    expect(PLAN_ALLOWLIST.business).toBeUndefined();
    expect(PLAN_ALLOWLIST.enterprise).toBeUndefined();
  });
  it('TIER_ALLOWLISTS has professional, no basic; basic plan falls through to empty (never professional)', () => {
    expect(TIER_ALLOWLISTS.professional).toBeDefined();
    expect((TIER_ALLOWLISTS as any).basic).toBeUndefined();
    expect(tierKeyForTenant({ subscriptionPlan: 'basic', subscriptionStatus: 'active' })).toBe('none');
    expect(allowlistForTenant({ subscriptionPlan: 'basic', subscriptionStatus: 'active' }).text).toEqual([]);
  });
  it('restricted allowlist is EMPTY: Contributor pathway disabled under the $0 allowance', () => {
    expect(TIER_ALLOWLISTS.restricted.text).toEqual([]);
    expect(TIER_ALLOWLISTS.restricted.defaultModel).toBeNull();
  });
  it('professional record cap is 100,000 (staging-test); restricted limit stays BLOCKED, not set here', () => {
    expect(PROFESSIONAL_RECORD_LIMIT_STAGING_TEST).toBe(100_000);
    expect(checkProfessionalRecordQuota(99_999).ok).toBe(true);
    expect(checkProfessionalRecordQuota(100_000)).toEqual({ ok: false, code: 'QUOTA_EXCEEDED' });
  });
});

describe('hard ceiling fail-closed (C5)', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ['HARD_META_DAILY_CAP_USD', 'HARD_META_TOTAL_CAP_USD', 'HARD_META_PER_JOB_CAP_USD']) { saved[k] = process.env[k]; delete process.env[k]; }
  });
  afterEach(() => {
    for (const k of ['HARD_META_DAILY_CAP_USD', 'HARD_META_TOTAL_CAP_USD', 'HARD_META_PER_JOB_CAP_USD']) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  });
  it('unconfigured ceiling is NOT configured (no fallback to meta-budget caps)', () => {
    const s = hardCeilingStatus();
    expect(s.configured).toBe(false);
    expect(s.problems.length).toBeGreaterThan(0);
  });
  it('partially configured ceiling is NOT configured', () => {
    process.env.HARD_META_DAILY_CAP_USD = '20';
    expect(hardCeilingStatus().configured).toBe(false);
  });
  it('invalid values (zero, negative, NaN) are NOT configured', () => {
    process.env.HARD_META_DAILY_CAP_USD = '0';
    process.env.HARD_META_TOTAL_CAP_USD = '-5';
    process.env.HARD_META_PER_JOB_CAP_USD = 'abc';
    expect(hardCeilingStatus().configured).toBe(false);
  });
  it('all three valid positive values configure the ceiling', () => {
    process.env.HARD_META_DAILY_CAP_USD = '20';
    process.env.HARD_META_TOTAL_CAP_USD = '170';
    process.env.HARD_META_PER_JOB_CAP_USD = '2';
    const s = hardCeilingStatus();
    expect(s.configured).toBe(true);
    expect(s.dailyUsd).toBe(20); expect(s.totalUsd).toBe(170); expect(s.perJobUsd).toBe(2);
  });
  it('cap writes fail closed when the ceiling is unconfigured', () => {
    expect(ceilingCheck('metaDailyCapUsd', 5, null)).toBe('HARD_CEILING_NOT_CONFIGURED');
    expect(ceilingCheck('metaDailyCapUsd', 5, 2)).toBe('SETTING_ABOVE_HARD_CEILING');
    expect(ceilingCheck('metaDailyCapUsd', 1, 2)).toBeNull();
    expect(ceilingCheck('announcement', 'hi', null)).toBeNull();
  });
});

describe('per-tenant allowance (staging-test)', () => {
  it('professional $10, restricted $0, legacy undefined (BLOCKED), unmapped $0', () => {
    expect(PROFESSIONAL_META_ALLOWANCE_USD_STAGING_TEST).toBe(10);
    expect(allowanceCapForTenant({ subscriptionPlan: 'professional', subscriptionStatus: 'active' })?.capUsd).toBe(10);
    expect(allowanceCapForTenant({ subscriptionPlan: null, subscriptionStatus: 'restricted' })?.capUsd).toBe(0);
    expect(allowanceCapForTenant({ subscriptionPlan: null, subscriptionStatus: 'legacy' })).toBeNull();
    expect(allowanceCapForTenant({ subscriptionPlan: null, subscriptionStatus: 'past_due' })?.capUsd).toBe(0);
  });
  it('max-cost estimate uses the 4096 output bound and verified text prices only', () => {
    expect(META_CALL_MAX_OUTPUT_TOKENS).toBe(4096);
    expect(verifiedTextPrice('muse-spark-1.3-contributor')).toEqual({ input: 0.1, output: 0.2 });
    expect(verifiedTextPrice('sam-3.1')).toBeNull();
    expect(verifiedTextPrice('muse-image-1.0')).toBeNull();
    // 8-char prompt -> ceil(8/4)*2 = 4 input tokens; (4*0.1 + 4096*0.2)/1e6
    expect(estimateMaxCostForPrompt('12345678', 'muse-spark-1.3-contributor')).toBeCloseTo((4 * 0.1 + 4096 * 0.2) / 1_000_000, 10);
    expect(estimateMaxCostForPrompt('x', 'sam-3.1')).toBeNull();
    expect(estimateMaxCost('muse-spark-1.3', 1000, 1000)).toBeCloseTo((1000 * 1.25 + 1000 * 4.25) / 1_000_000, 10);
  });
});

describe('three-way counted spend + atomic reservation (fake tx)', () => {
  it('counted spend: ledger confirmed only; reserved/pending at max; settled at settled', async () => {
    const { tx, ledger, reservations } = makeFakeDb();
    ledger.push({ tenantId: 't1', costUsd: 1.5, createdAt: new Date() });
    reservations.push({ tenantId: 't1', status: 'RESERVED', maxCostUsd: 2, createdAt: new Date() });
    reservations.push({ tenantId: 't1', status: 'PENDING_RECONCILIATION', maxCostUsd: 3, createdAt: new Date() });
    reservations.push({ tenantId: 't1', status: 'SETTLED_AT_MAXIMUM', maxCostUsd: 4, settledCostUsd: 4, createdAt: new Date() });
    reservations.push({ tenantId: 't1', status: 'CONFIRMED', maxCostUsd: 9, confirmedCostUsd: 1.5, createdAt: new Date() });
    const c = await countedSpendForTenant(tx, 't1');
    expect(c.confirmedTotal).toBe(1.5);
    expect(c.countedTotal).toBe(1.5 + 2 + 3 + 4); // confirmed reservation NOT double-counted
  });
  it('reservation enforces per-job, daily, total, and allowance caps; duplicate key rejected', async () => {
    const { tx } = makeFakeDb();
    // Caps are checked in order per-job → daily → total → allowance,
    // so each cap gets an isolated case (a $9.50 call must not trip
    // the per-job cap before the allowance check is reached).
    const wideCaps = { perJobUsd: 20, dailyUsd: 20, totalUsd: 170, allowanceUsd: 10 };
    const r1 = await reserveSpend(tx, { tenantId: 't1', requestKey: 'k1', model: 'muse-spark-1.3', maxCostUsd: 1, caps: wideCaps });
    expect(r1.ok).toBe(true);
    // Second reservation sees the first in counted spend: 1 + 9.5 > 10 allowance.
    const r2 = await reserveSpend(tx, { tenantId: 't1', requestKey: 'k2', model: 'muse-spark-1.3', maxCostUsd: 9.5, caps: wideCaps });
    expect(r2).toEqual({ ok: false, code: 'MODEL_BUDGET_EXCEEDED', detail: 'tenant allowance' });
    const r3 = await reserveSpend(tx, { tenantId: 't1', requestKey: 'k3', model: 'muse-spark-1.3', maxCostUsd: 2.5, caps: { perJobUsd: 2, dailyUsd: 20, totalUsd: 170, allowanceUsd: 170 } });
    expect(r3).toEqual({ ok: false, code: 'MODEL_BUDGET_EXCEEDED', detail: 'per-job cap' });
    const r4 = await reserveSpend(tx, { tenantId: 't1', requestKey: 'k4', model: 'muse-spark-1.3', maxCostUsd: 1, caps: { perJobUsd: 20, dailyUsd: 1.5, totalUsd: 170, allowanceUsd: 170 } });
    expect(r4).toEqual({ ok: false, code: 'MODEL_BUDGET_EXCEEDED', detail: 'daily hard ceiling' });
    const dup = await reserveSpend(tx, { tenantId: 't1', requestKey: 'k1', model: 'muse-spark-1.3', maxCostUsd: 0.5, caps: wideCaps });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.code).toBe('DUPLICATE_REQUEST_KEY');
  });
  it('countedCost by status', () => {
    const base = { requestKey: 'k', tenantId: 't', jobId: null, model: 'm' };
    expect(countedCost({ ...base, maxCostUsd: 5, confirmedCostUsd: null, settledCostUsd: null, status: 'RESERVED' })).toBe(5);
    expect(countedCost({ ...base, maxCostUsd: 5, confirmedCostUsd: null, settledCostUsd: null, status: 'PENDING_RECONCILIATION' })).toBe(5);
    expect(countedCost({ ...base, maxCostUsd: 5, confirmedCostUsd: 1.2, settledCostUsd: null, status: 'CONFIRMED' })).toBe(1.2);
    expect(countedCost({ ...base, maxCostUsd: 5, confirmedCostUsd: null, settledCostUsd: 5, status: 'SETTLED_AT_MAXIMUM' })).toBe(5);
  });
  it('uncertain error classification: timeout/network/5xx pending, everything else releasable', () => {
    expect(isUncertainMetaError('TIMEOUT')).toBe(true);
    expect(isUncertainMetaError('NETWORK_ERROR')).toBe(true);
    expect(isUncertainMetaError('PROVIDER_5XX:500')).toBe(true);
    expect(isUncertainMetaError('INVALID_REQUEST:400')).toBe(false);
    expect(isUncertainMetaError('AUTH_OR_ENTITLEMENT:401')).toBe(false);
    expect(isUncertainMetaError(null)).toBe(false);
  });
});

describe('unpaid export-out state machine (fake tx)', () => {
  it('one authorization per transition event; claim → complete → no second export', async () => {
    const { tx, auths, audits } = makeFakeDb();
    const boundary = new Date('2026-10-20T00:00:00Z');
    expect(await authorizeUnpaidExportOut(tx, { tenantId: 't1', stripeEventId: 'evt-1', boundaryAt: boundary, actor: 'stripe:evt-1' })).toEqual({ created: true });
    expect(await authorizeUnpaidExportOut(tx, { tenantId: 't1', stripeEventId: 'evt-1', boundaryAt: boundary, actor: 'stripe:evt-1' })).toEqual({ created: false });
    expect(auths.length).toBe(1);
    expect(audits.some((a) => a.action === 'UNPAID_EXPORT_AUTHORIZED')).toBe(true);
    const claim = await claimUnpaidExportAuthorization(tx, 't1', new Date('2026-10-27T00:00:00Z'));
    expect(claim).not.toBeNull();
    expect(claim!.boundaryAt).toEqual(boundary);
    // Concurrent second claim while the first is CLAIMED (fresh) → null.
    expect(await claimUnpaidExportAuthorization(tx, 't1', new Date('2026-10-27T00:01:00Z'))).toBeNull();
    // Wrong token cannot complete.
    expect(await completeUnpaidExportAuthorization(tx, claim!.id, 'wrong-token')).toBe(false);
    expect(await completeUnpaidExportAuthorization(tx, claim!.id, claim!.claimToken)).toBe(true);
    // Completed: no further claim, ever.
    expect(await claimUnpaidExportAuthorization(tx, 't1', new Date('2026-10-27T01:00:00Z'))).toBeNull();
  });
  it('interrupted (stale) claim can be reclaimed; fresh claim cannot', async () => {
    const { tx } = makeFakeDb();
    await authorizeUnpaidExportOut(tx, { tenantId: 't1', stripeEventId: 'evt-9', boundaryAt: new Date(), actor: 'stripe:evt-9' });
    const t0 = new Date('2026-10-27T00:00:00Z');
    const claim = await claimUnpaidExportAuthorization(tx, 't1', t0);
    expect(claim).not.toBeNull();
    // 30 minutes later: still fresh, no reclaim.
    expect(await claimUnpaidExportAuthorization(tx, 't1', new Date(t0.getTime() + 30 * 60 * 1000))).toBeNull();
    // Past the 1h timeout: reclaim with a NEW token; old token is dead.
    const reclaimed = await claimUnpaidExportAuthorization(tx, 't1', new Date(t0.getTime() + EXPORT_OUT_CLAIM_TIMEOUT_MS + 1000));
    expect(reclaimed).not.toBeNull();
    expect(reclaimed!.reclaimed).toBe(true);
    expect(reclaimed!.claimToken).not.toBe(claim!.claimToken);
    expect(await completeUnpaidExportAuthorization(tx, claim!.id, claim!.claimToken)).toBe(false);
    expect(await completeUnpaidExportAuthorization(tx, reclaimed!.id, reclaimed!.claimToken)).toBe(true);
  });
  it('release returns a claim to AVAILABLE after a generation failure', async () => {
    const { tx } = makeFakeDb();
    await authorizeUnpaidExportOut(tx, { tenantId: 't1', stripeEventId: 'evt-2', boundaryAt: new Date(), actor: 'stripe:evt-2' });
    const claim = await claimUnpaidExportAuthorization(tx, 't1');
    expect(await releaseUnpaidExportAuthorization(tx, claim!.id, claim!.claimToken)).toBe(true);
    const again = await claimUnpaidExportAuthorization(tx, 't1');
    expect(again).not.toBeNull();
    expect(isClaimStale(new Date(Date.now() - EXPORT_OUT_CLAIM_TIMEOUT_MS - 1), new Date())).toBe(true);
    expect(isClaimStale(new Date(), new Date())).toBe(false);
  });
});

describe('grace restriction pure helpers', () => {
  const saved = process.env.GRACE_HOURS;
  beforeEach(() => { delete process.env.GRACE_HOURS; });
  afterEach(() => { if (saved === undefined) delete process.env.GRACE_HOURS; else process.env.GRACE_HOURS = saved; });
  it('grace window is env-driven only; unset means no expiry', () => {
    expect(graceHoursConfigured()).toBeNull();
    process.env.GRACE_HOURS = '72';
    expect(graceHoursConfigured()).toBe(72);
    process.env.GRACE_HOURS = 'abc';
    expect(graceHoursConfigured()).toBeNull();
    process.env.GRACE_HOURS = '0';
    expect(graceHoursConfigured()).toBeNull();
  });
  it('expiry only after the window; restriction is a separate field, never a status rewrite', () => {
    const started = new Date('2026-10-20T00:00:00Z');
    expect(applyGraceExpiry({ graceStartedAt: started }, 72, new Date('2026-10-22T00:00:00Z'))).toBeNull();
    const expired = applyGraceExpiry({ graceStartedAt: started }, 72, new Date('2026-10-23T00:00:01Z'));
    expect(expired?.accessRestriction).toBe(GRACE_RESTRICTION_CODE);
    expect(graceRestrictionActive({ accessRestriction: GRACE_RESTRICTION_CODE })).toBe(true);
    expect(graceRestrictionActive({ accessRestriction: null })).toBe(false);
    expect(clearGraceRestriction()).toEqual({ accessRestriction: null, accessRestrictedAt: null, graceStartedAt: null });
    expect(recordGraceStart({ graceStartedAt: null }, new Date('2026-10-27T00:00:00Z'))).toEqual({ graceStartedAt: new Date('2026-10-27T00:00:00Z') });
    expect(recordGraceStart({ graceStartedAt: started })).toEqual({ graceStartedAt: started });
  });
});

describe('strict MFA agreement (tenant helper == operator helper)', () => {
  const strict = ['otp', 'sms', 'webauthn', 'mfa', 'software_token_mfa', 'phone_number_mfa'];
  it.each(strict)('amr %s verifies in BOTH helpers', (m) => {
    expect(mfaVerifiedFromClaims({ amr: ['pwd', m] })).toBe(true);
    expect(operatorMfaVerifiedFromClaims({ amr: ['pwd', m] })).toBe(true);
  });
  it('absent, pwd-only, and unknown amr values verify in NEITHER helper', () => {
    for (const amr of [[], ['pwd'], ['face'], ['pop'], ['kba'], ['pwd', 'face'], undefined]) {
      expect(mfaVerifiedFromClaims({ amr: amr as any })).toBe(false);
      expect(operatorMfaVerifiedFromClaims({ amr: amr as any })).toBe(false);
    }
  });
});

describe('entitlement, concurrency, and worker revalidation gates', () => {
  it('unpaid: export existing-only, everything else denied; paused: export denied; restricted: export denied', () => {
    expect(entitlementGate('unpaid', 'export')).toEqual({ allowed: true, existingOnly: true });
    expect(entitlementGate('unpaid', 'ingest').allowed).toBe(false);
    expect(entitlementGate('unpaid', 'augment_template').allowed).toBe(false);
    expect(entitlementGate('unpaid', 'meta').allowed).toBe(false);
    expect(entitlementGate('paused', 'export').allowed).toBe(false);
    expect(entitlementGate('paused', 'read').allowed).toBe(true);
    expect(entitlementGate('restricted', 'export').allowed).toBe(false);
    expect(entitlementGate('canceled', 'export')).toEqual({ allowed: true, existingOnly: true });
    expect(entitlementGate('canceled', 'augment_template').allowed).toBe(false);
  });
  it('ingest batch: restricted over 1,000 → BATCH_TOO_LARGE; entitled has no batch cap here', () => {
    expect(checkIngestBatchSize(1000, true).ok).toBe(true);
    expect(checkIngestBatchSize(1001, true)).toEqual({ ok: false, code: 'BATCH_TOO_LARGE' });
    expect(checkIngestBatchSize(10000, false).ok).toBe(true);
  });
  it('record quota: restricted at 5,000 safety cap; concurrency caps 1 restricted / 2 entitled (PROPOSED)', () => {
    expect(checkRecordQuota(5000, true)).toEqual({ ok: false, code: 'QUOTA_EXCEEDED' });
    expect(checkRecordQuota(4999, true).ok).toBe(true);
    expect(checkConcurrency(0, true).ok).toBe(true);
    expect(checkConcurrency(1, true)).toEqual({ ok: false, code: 'CONCURRENCY_LIMIT' });
    expect(checkConcurrency(1, false).ok).toBe(true);
    expect(checkConcurrency(2, false)).toEqual({ ok: false, code: 'CONCURRENCY_LIMIT' });
  });
  it('assertJobRunnable: canceled pauses; grace pauses all kinds; meta kinds pause (not implemented); normal work runs', () => {
    expect(assertJobRunnable({ subscriptionStatus: 'canceled' }, { kind: 'ingest' })).toEqual({ ok: false, reason: 'ENTITLEMENT_REVOKED' });
    expect(assertJobRunnable({ subscriptionStatus: 'active', accessRestriction: GRACE_RESTRICTION_CODE }, { kind: 'ingest' })).toEqual({ ok: false, reason: GRACE_RESTRICTION_CODE });
    expect(assertJobRunnable({ subscriptionStatus: 'active' }, { kind: 'ingest' })).toEqual({ ok: true });
    for (const kind of META_JOB_KINDS) {
      expect(assertJobRunnable({ subscriptionStatus: 'active' }, { kind })).toEqual({ ok: false, reason: 'META_JOB_KIND_NOT_IMPLEMENTED' });
    }
    expect(assertJobRunnable({ subscriptionStatus: 'restricted' }, { kind: 'meta-analyze' })).toEqual({ ok: false, reason: 'ENTITLEMENT_REVOKED' });
  });
});
