// Compliance-fix tests (contract rows B2, B4, B6, B9, B16, C1).
// Pure-logic coverage only. Route/DB behaviour is NOT covered here and
// is NOT upgraded to PASS on the basis of these tests; the DB-integration
// tests for the same behaviours remain NOT RUN without a real database.
import { describe, it, expect } from 'vitest';
import { RateLimiter, FREE_TIER_LIMITS_PROPOSED } from './billing';
import {
  clientIpFromHeaders, checkTenantRateLimit, checkIpRateLimit,
  checkRequestRate, RegistrationAttemptTracker,
} from './rate-limit';
import { checkUploadBytes, checkTotalUploadBytes, enforceTotalUpload, totalUploadLimitForTenant } from './upload-quota';
import {
  RECONCILIATION_RETRY_DELAYS_SEC_PROPOSED, delayForReconciliationAttempt,
  nextReconciliationRetryAt, isReconciliationRetryDue,
} from './reconciliation-retry';
import { ERROR_TABLE, httpStatusForErrorCode } from './error-table';
import { assertContentLength } from './api-validation';

function fakeReq(headers: Record<string, string>): Request {
  return new Request('https://example.test/api/x', { headers });
}

describe('B2 request rate — wiring helpers', () => {
  it('allows the proposed tenant limit then blocks', () => {
    const limiter = new RateLimiter();
    const now = Date.now();
    for (let i = 0; i < FREE_TIER_LIMITS_PROPOSED.requestsPerMinutePerTenant; i++) {
      expect(checkTenantRateLimit('t1', now, limiter)).toBe(true);
    }
    expect(checkTenantRateLimit('t1', now, limiter)).toBe(false);
    // A different tenant is unaffected.
    expect(checkTenantRateLimit('t2', now, limiter)).toBe(true);
  });
  it('allows the proposed IP limit then blocks', () => {
    const limiter = new RateLimiter();
    const now = Date.now();
    for (let i = 0; i < FREE_TIER_LIMITS_PROPOSED.requestsPerMinutePerIp; i++) {
      expect(checkIpRateLimit('203.0.113.9', now, limiter)).toBe(true);
    }
    expect(checkIpRateLimit('203.0.113.9', now, limiter)).toBe(false);
  });
  it('combined check prefers the tenant scope and falls back to IP for anonymous calls', () => {
    const limiter = new RateLimiter();
    const now = Date.now();
    const req = fakeReq({ 'x-forwarded-for': '203.0.113.9' });
    for (let i = 0; i < FREE_TIER_LIMITS_PROPOSED.requestsPerMinutePerTenant; i++) {
      expect(checkRequestRate(req, 't1', now, limiter)).toEqual({ limited: false });
    }
    expect(checkRequestRate(req, 't1', now, limiter)).toEqual({ limited: true, scope: 'tenant' });
    const anon = new RateLimiter();
    for (let i = 0; i < FREE_TIER_LIMITS_PROPOSED.requestsPerMinutePerIp; i++) {
      expect(checkRequestRate(req, null, now, anon)).toEqual({ limited: false });
    }
    expect(checkRequestRate(req, null, now, anon)).toEqual({ limited: true, scope: 'ip' });
  });
  it('reads the first x-forwarded-for entry and degrades to unknown', () => {
    expect(clientIpFromHeaders(fakeReq({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }))).toBe('203.0.113.9');
    expect(clientIpFromHeaders(fakeReq({}))).toBe('unknown');
  });
});

describe('B6 registration rate — IP tracker', () => {
  it('allows 3 registrations per IP per 24h then blocks, and the window expires', () => {
    const tracker = new RegistrationAttemptTracker();
    const now = Date.now();
    expect(tracker.attempt('203.0.113.9', now)).toBe(true);
    expect(tracker.attempt('203.0.113.9', now)).toBe(true);
    expect(tracker.attempt('203.0.113.9', now)).toBe(true);
    expect(tracker.attempt('203.0.113.9', now)).toBe(false);
    expect(tracker.count('203.0.113.9', now)).toBe(3);
    // Another IP is unaffected.
    expect(tracker.attempt('198.51.100.7', now)).toBe(true);
    // After 24h the window clears.
    expect(tracker.attempt('203.0.113.9', now + 24 * 60 * 60 * 1000 + 1)).toBe(true);
  });
});

describe('B4 upload limits', () => {
  it('per-file: Content-Length over the cap is FILE_TOO_LARGE (not REQUEST_TOO_LARGE)', () => {
    const req = fakeReq({ 'content-length': String(10 * 1024 * 1024 + 1) });
    expect(assertContentLength(req, 10 * 1024 * 1024)).toBe('FILE_TOO_LARGE');
    expect(assertContentLength(fakeReq({ 'content-length': '100' }), 10 * 1024 * 1024)).toBe(null);
    expect(assertContentLength(fakeReq({}), 10 * 1024 * 1024)).toBe(null);
  });
  it('per-file: actual UTF-8 bytes are checked, not characters', () => {
    // 2-byte characters: 6 chars, 12 bytes — over a 10-byte cap.
    const over = checkUploadBytes('é'.repeat(6), 10);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.code).toBe('FILE_TOO_LARGE');
    expect(checkUploadBytes('hello', 10).ok).toBe(true);
  });
  it('total: restricted tenant total is enforced by the pure checker; entitled has no cap', () => {
    expect(totalUploadLimitForTenant(true)).toBe(50 * 1024 * 1024);
    expect(totalUploadLimitForTenant(false)).toBe(null);
    expect(checkTotalUploadBytes(40 * 1024 * 1024, 11 * 1024 * 1024, 50 * 1024 * 1024).ok).toBe(false);
    expect(checkTotalUploadBytes(40 * 1024 * 1024, 10 * 1024 * 1024, 50 * 1024 * 1024).ok).toBe(true);
  });
  it('total: hook reports the missing ledger instead of mistaking it for zero usage', () => {
    // NOTE (B4 fix): this null/missing case is RETAINED deliberately. It
    // now occurs only for pre-migration reads (rolling-deploy safety net):
    // once migration 20261028050000_upload_ledger is applied, Prisma
    // returns 0 (NOT NULL DEFAULT 0), never null — see the enforced-state
    // test below. No expectation here changed because the hook's null
    // behaviour itself did not change.
    const missing = enforceTotalUpload({}, 1024, true);
    expect(missing).toEqual({ enforced: false, reason: 'TOTAL_UPLOAD_LEDGER_MISSING' });
    expect(enforceTotalUpload({ totalUploadBytes: 49 * 1024 * 1024 }, 2 * 1024 * 1024, true)).toEqual({ enforced: true, ok: false, code: 'FILE_TOO_LARGE' });
    expect(enforceTotalUpload({ totalUploadBytes: 1024 }, 1024, true)).toEqual({ enforced: true, ok: true });
    // Entitled tenants are not total-capped (no cap is invented for them).
    expect(enforceTotalUpload({}, 1024, false)).toEqual({ enforced: true, ok: true });
  });
  it('total: boundary — exactly at the proposed 50 MB total passes, one byte over fails', () => {
    const MB = 1024 * 1024;
    expect(enforceTotalUpload({ totalUploadBytes: 50 * MB - 1024 }, 1024, true)).toEqual({ enforced: true, ok: true });
    expect(enforceTotalUpload({ totalUploadBytes: 50 * MB - 1023 }, 1024, true)).toEqual({ enforced: true, ok: false, code: 'FILE_TOO_LARGE' });
    expect(enforceTotalUpload({ totalUploadBytes: 50 * MB }, 1, true)).toEqual({ enforced: true, ok: false, code: 'FILE_TOO_LARGE' });
  });
  it('total: hook is enforced once the ledger column exists (0 is a real ledger value, not missing)', () => {
    // After migration 20261028050000_upload_ledger, Prisma returns 0 for
    // every tenant (NOT NULL DEFAULT 0) — so enforced:true, unlike the
    // pre-migration null/missing case in the test above, which is kept
    // only as the rolling-deploy safety net.
    expect(enforceTotalUpload({ totalUploadBytes: 0 }, 1024, true)).toEqual({ enforced: true, ok: true });
    expect(enforceTotalUpload({ totalUploadBytes: null }, 1024, true)).toEqual({ enforced: false, reason: 'TOTAL_UPLOAD_LEDGER_MISSING' });
  });
  it('total: declared length and actual bytes are counted consistently with the per-file path', () => {
    // Declared Content-Length is a pre-parse guard only; the total counts
    // actual UTF-8 bytes of uploaded text (byteCheck.bytes in the ingest
    // route), the same measure as the per-file actual-byte check. A body
    // that declares a small length but carries multibyte text is still
    // caught by the actual-byte check: 60 'é' chars are 120 bytes, not 60.
    expect(assertContentLength(fakeReq({ 'content-length': '100' }), 10 * 1024 * 1024)).toBe(null);
    const actual = checkUploadBytes('é'.repeat(60), 100);
    expect(actual.ok).toBe(false);
    if (!actual.ok) {
      expect(actual.code).toBe('FILE_TOO_LARGE');
      expect(actual.bytes).toBe(120);
    }
    // And the total checker uses those same actual bytes.
    expect(checkTotalUploadBytes(0, 120, 50 * 1024 * 1024).ok).toBe(true);
    // NOTE: the route-level ledger increment itself (ingest route,
    // DB path) has no unit test here — it needs a real database and is
    // covered by the DB-integration behaviour, NOT RUN without one.
  });
});

describe('B9 reconciliation retry schedule', () => {
  it('delays are 1m, 5m, 30m, then hourly (PROPOSED values)', () => {
    expect([...RECONCILIATION_RETRY_DELAYS_SEC_PROPOSED]).toEqual([60, 300, 1800, 3600]);
    expect(delayForReconciliationAttempt(0)).toBe(60);
    expect(delayForReconciliationAttempt(1)).toBe(300);
    expect(delayForReconciliationAttempt(2)).toBe(1800);
    expect(delayForReconciliationAttempt(3)).toBe(3600);
    expect(delayForReconciliationAttempt(4)).toBe(3600);
    expect(delayForReconciliationAttempt(99)).toBe(3600);
  });
  it('due computation advances from the last attempt, not from grace start', () => {
    const graceStart = new Date('2026-10-27T00:00:00Z');
    const first = new Date('2026-10-27T00:01:00Z');
    // No retry yet: due at grace start + 60s.
    expect(isReconciliationRetryDue(graceStart, 0, null, new Date('2026-10-27T00:00:59Z'))).toBe(false);
    expect(isReconciliationRetryDue(graceStart, 0, null, new Date('2026-10-27T00:01:00Z'))).toBe(true);
    // After attempt 0 at 00:01, attempt 1 is due at 00:01 + 300s, not at grace start + 300s.
    expect(nextReconciliationRetryAt(graceStart, 1, first)).toEqual(new Date('2026-10-27T00:06:00Z'));
    expect(isReconciliationRetryDue(graceStart, 1, first, new Date('2026-10-27T00:05:59Z'))).toBe(false);
    expect(isReconciliationRetryDue(graceStart, 1, first, new Date('2026-10-27T00:06:00Z'))).toBe(true);
  });
});

describe('C1 consolidated error table', () => {
  it('contains every draft §2.1 code with its proposed HTTP status', () => {
    const expected: Record<string, number> = {
      INVALID_PRICE: 400, INVALID_REQUEST: 400, INVALID_SIGNATURE: 400,
      AUTHENTICATION_FAILED: 400, UNAUTHENTICATED: 401, ENTITLEMENT_REQUIRED: 402,
      FORBIDDEN: 403, MFA_REQUIRED: 403, NOT_FOUND: 404, LINK_CONFLICT: 409,
      INVITATION_TENANT_MISMATCH: 409, SUBSCRIPTION_ALREADY_ACTIVE: 409,
      USE_PORTAL_TO_RESOLVE_PAST_DUE: 409, NO_BILLING_CUSTOMER: 409,
      QUOTA_EXCEEDED: 409, CONCURRENCY_LIMIT: 429, BATCH_TOO_LARGE: 409,
      SYNTHETIC_CAP_EXCEEDED: 409, MODEL_BUDGET_EXCEEDED: 409,
      INVITATION_EXPIRED: 410, RATE_LIMITED: 429, FILE_TOO_LARGE: 413,
      DATABASE_NOT_CONFIGURED: 503, COGNITO_NOT_CONFIGURED: 503,
      BILLING_NOT_CONFIGURED: 503, STRIPE_UNAVAILABLE: 503,
    };
    for (const [code, status] of Object.entries(expected)) {
      expect(ERROR_TABLE[code], `missing table entry for ${code}`).toBeDefined();
      expect(httpStatusForErrorCode(code)).toBe(status);
    }
  });
  it('marks the budget mapping PROPOSED pending the unsigned C2 decision', () => {
    expect(ERROR_TABLE.MODEL_BUDGET_EXCEEDED.status).toBe('PROPOSED (pending C2 decision)');
  });
  it('records the grace restriction as a non-HTTP concept, not a status code', () => {
    expect(ERROR_TABLE.GRACE_EXPIRED_UNVERIFIED.httpStatus).toBe(null);
  });
  it('uses FILE_TOO_LARGE (413) for upload size, never REQUEST_TOO_LARGE', () => {
    expect(ERROR_TABLE.FILE_TOO_LARGE.httpStatus).toBe(413);
    expect(ERROR_TABLE.REQUEST_TOO_LARGE).toBeUndefined();
  });
});
