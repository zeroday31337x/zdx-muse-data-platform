// Branch 1 (Cognito + Stripe) regression tests. Pure functions only;
// no network, no DB, no secrets, no live billing, no paid Meta calls.
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  codeChallenge, buildAuthorizeUrl, verifyIdToken, exchangeCode,
  mfaVerifiedFromClaims, safeNext,
} from './cognito';
import { verifyWebhookSignature } from './stripe-client';
import {
  entitlementGate, applyStripeState, serverCheckoutIdempotencyKey,
  checkRecordQuota, checkIngestBatchSize, checkConcurrency, assertJobRunnable,
  FREE_TIER_LIMITS_PROPOSED,
} from './billing';
import {
  estimateMaxCost, newReservation, confirmReservation,
  markPendingReconciliation, settleAtMaximum, countedCost, retryRequestKey,
} from './spend';

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

describe('PKCE + authorize URL', () => {
  it('matches the RFC 7636 test vector', () => {
    expect(codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
  it('builds hosted-UI URLs per mode and rejects absolute next paths', () => {
    const cfg = { region: 'us-east-1', userPoolId: 'us-east-1_x', clientId: 'cid', domain: 'https://example.auth.us-east-1.amazoncognito.com', redirectUri: 'https://data.zerodrivex.com/api/auth/callback/cognito', issuer: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_x', adminGroup: 'zdx-data-admin' };
    const login = buildAuthorizeUrl(cfg, 'login', { state: 's', nonce: 'n', codeChallenge: 'c' });
    expect(login).toContain('/oauth2/authorize');
    expect(login).toContain('code_challenge_method=S256');
    expect(buildAuthorizeUrl(cfg, 'signup', { state: 's', nonce: 'n', codeChallenge: 'c' })).toContain('/signup');
    expect(buildAuthorizeUrl(cfg, 'forgot', { state: 's', nonce: 'n', codeChallenge: 'c' })).toContain('/forgotPassword');
    expect(safeNext('https://evil.example/')).toBe('/');
    expect(safeNext('//evil.example/')).toBe('/');
    expect(safeNext('/billing')).toBe('/billing');
  });
  it('MFA requires a second factor in amr; absent amr fails closed', () => {
    expect(mfaVerifiedFromClaims({ amr: ['pwd', 'otp'] })).toBe(true);
    expect(mfaVerifiedFromClaims({ amr: ['pwd'] })).toBe(false);
    expect(mfaVerifiedFromClaims({})).toBe(false);
  });
});

describe('ID token verification', () => {
  function makeToken(overrides: Record<string, unknown> = {}, headerOverrides: Record<string, unknown> = {}) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pubJwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
    pubJwk.kid = 'test-kid';
    const header = { alg: 'RS256', kid: 'test-kid', typ: 'JWT', ...headerOverrides };
    const payload = {
      iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_x',
      aud: 'cid', token_use: 'id', nonce: 'n',
      exp: Math.floor(Date.now() / 1000) + 600,
      sub: 'sub-123', email: 'a@test.local', ...overrides,
    };
    const h = b64url(Buffer.from(JSON.stringify(header)));
    const p = b64url(Buffer.from(JSON.stringify(payload)));
    const sig = crypto.sign('sha256', Buffer.from(`${h}.${p}`), privateKey);
    const token = `${h}.${p}.${b64url(sig)}`;
    const fetchFn = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ keys: [pubJwk] }) });
    return { token, fetchFn };
  }
  const base = { issuer: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_x', clientId: 'cid', nonce: 'n' };
  it('accepts a valid token', async () => {
    const { token, fetchFn } = makeToken();
    const claims = await verifyIdToken(token, { ...base, fetchFn });
    expect(claims.sub).toBe('sub-123');
    expect(claims.email).toBe('a@test.local');
  });
  it('rejects wrong audience, expired tokens, and nonce mismatch', async () => {
    const wrongAud = makeToken({ aud: 'other' });
    await expect(verifyIdToken(wrongAud.token, { ...base, fetchFn: wrongAud.fetchFn })).rejects.toThrow('INVALID_AUDIENCE');
    const expired = makeToken({ exp: Math.floor(Date.now() / 1000) - 10 });
    await expect(verifyIdToken(expired.token, { ...base, fetchFn: expired.fetchFn })).rejects.toThrow('TOKEN_EXPIRED');
    const nonceBad = makeToken({ nonce: 'wrong' });
    await expect(verifyIdToken(nonceBad.token, { ...base, fetchFn: nonceBad.fetchFn })).rejects.toThrow('NONCE_MISMATCH');
  });
  it('rejects a tampered payload', async () => {
    const { token, fetchFn } = makeToken();
    const parts = token.split('.');
    const tampered = `${parts[0]}.${b64url(Buffer.from(JSON.stringify({ sub: 'attacker' })))}.${parts[2]}`;
    await expect(verifyIdToken(tampered, { ...base, fetchFn })).rejects.toThrow('INVALID_SIGNATURE');
  });
  it('exchanges a code with a fake token endpoint and fails closed on error', async () => {
    const cfg = { region: 'us-east-1', userPoolId: 'us-east-1_x', clientId: 'cid', domain: 'https://example.auth.us-east-1.amazoncognito.com', redirectUri: 'https://cb', issuer: 'https://iss', adminGroup: 'g' };
    const okFetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ id_token: 'idtok', access_token: 'acctok' }) });
    await expect(exchangeCode(cfg, 'code', 'verifier', okFetch)).resolves.toEqual({ idToken: 'idtok', accessToken: 'acctok' });
    const badFetch = async () => ({ ok: false, status: 400, text: async () => '{}' });
    await expect(exchangeCode(cfg, 'code', 'verifier', badFetch)).rejects.toThrow('COGNITO_EXCHANGE_FAILED');
  });
});

describe('Stripe webhook signatures', () => {
  const secret = 'whsec_test';
  const body = '{"id":"evt_1","type":"invoice.paid"}';
  const t = 1700000000;
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  const header = `t=${t},v1=${sig}`;
  it('accepts a valid signature', () => {
    expect(verifyWebhookSignature(body, header, secret, 300, t)).toBe(true);
  });
  it('rejects wrong signatures, missing headers, and stale timestamps', () => {
    expect(verifyWebhookSignature(body, `t=${t},v1=deadbeef`, secret, 300, t)).toBe(false);
    expect(verifyWebhookSignature(body, null, secret, 300, t)).toBe(false);
    expect(verifyWebhookSignature(body, header, secret, 300, t + 10000)).toBe(false);
  });
});

describe('entitlement gate matrix', () => {
  it('restricted tenants: local work yes, export/Meta no', () => {
    expect(entitlementGate('restricted', 'create_dataset')).toEqual({ allowed: true });
    expect(entitlementGate('restricted', 'ingest')).toEqual({ allowed: true });
    expect(entitlementGate('restricted', 'export')).toEqual({ allowed: false, code: 'ENTITLEMENT_REQUIRED', status: 'restricted' });
    expect(entitlementGate('restricted', 'meta')).toEqual({ allowed: false, code: 'ENTITLEMENT_REQUIRED', status: 'restricted' });
    expect(entitlementGate('incomplete', 'export').allowed).toBe(false);
  });
  it('active/legacy/trialing allow everything; canceled is read-only + export-out', () => {
    for (const s of ['active', 'legacy', 'trialing']) {
      expect(entitlementGate(s, 'export')).toEqual({ allowed: true });
      expect(entitlementGate(s, 'meta')).toEqual({ allowed: true });
    }
    expect(entitlementGate('canceled', 'read')).toEqual({ allowed: true });
    expect(entitlementGate('canceled', 'export')).toEqual({ allowed: true, existingOnly: true });
    expect(entitlementGate('canceled', 'create_dataset').allowed).toBe(false);
    expect(entitlementGate('past_due', 'export')).toEqual({ allowed: true, existingOnly: true });
    expect(entitlementGate('past_due', 'meta').allowed).toBe(false);
    expect(entitlementGate('unpaid', 'ingest').allowed).toBe(false);
    expect(entitlementGate('paused', 'export').allowed).toBe(false);
  });
  it('unknown states fail closed to restricted-level access', () => {
    expect(entitlementGate('mystery', 'meta').allowed).toBe(false);
    expect(entitlementGate('mystery', 'read')).toEqual({ allowed: true });
  });
});

describe('Stripe state application', () => {
  it('cancel_at_period_end does not cancel immediately; deleted cancels', () => {
    expect(applyStripeState({ subscriptionStatus: 'active' }, { status: 'active', cancelAtPeriodEnd: true })?.derived).toBe('active');
    expect(applyStripeState({ subscriptionStatus: 'active' }, { status: 'canceled' })?.derived).toBe('canceled');
    expect(applyStripeState({ subscriptionStatus: 'legacy' }, { status: 'past_due' })?.derived).toBe('past_due');
  });
  it('unknown Stripe statuses return null (caller audits, changes nothing)', () => {
    expect(applyStripeState({ subscriptionStatus: 'active' }, { status: 'future_status' })).toBeNull();
  });
  it('server idempotency keys are deterministic per tenant + plan', () => {
    const a = serverCheckoutIdempotencyKey('t1', 'basic');
    expect(a).toBe(serverCheckoutIdempotencyKey('t1', 'basic'));
    expect(a).not.toBe(serverCheckoutIdempotencyKey('t2', 'basic'));
    expect(a).not.toBe(serverCheckoutIdempotencyKey('t1', 'premium'));
  });
});

describe('free-tier limits (PROPOSED)', () => {
  it('enforces record quota, batch cap, and concurrency caps', () => {
    expect(checkRecordQuota(FREE_TIER_LIMITS_PROPOSED.recordsPerTenant, true)).toEqual({ ok: false, code: 'QUOTA_EXCEEDED' });
    expect(checkRecordQuota(10, true)).toEqual({ ok: true });
    expect(checkRecordQuota(999999, false)).toEqual({ ok: true });
    expect(checkIngestBatchSize(FREE_TIER_LIMITS_PROPOSED.ingestBatchRestricted + 1, true)).toEqual({ ok: false, code: 'BATCH_TOO_LARGE' });
    expect(checkConcurrency(1, true)).toEqual({ ok: false, code: 'CONCURRENCY_LIMIT' });
    expect(checkConcurrency(1, false)).toEqual({ ok: true });
  });
  it('canceled tenants pause jobs at claim time; others run', () => {
    expect(assertJobRunnable({ subscriptionStatus: 'canceled' }, { kind: 'ingest' })).toEqual({ ok: false, reason: 'ENTITLEMENT_REVOKED' });
    expect(assertJobRunnable({ subscriptionStatus: 'active' }, { kind: 'ingest' })).toEqual({ ok: true });
  });
});

describe('spend reservations (three-way accounting)', () => {
  it('computes conservative max cost from verified text prices only', () => {
    expect(estimateMaxCost('muse-spark-1.3', 1_000_000, 1_000_000)).toBeCloseTo(5.5);
    expect(estimateMaxCost('sam-3.1', 100, 100)).toBeNull();
    expect(estimateMaxCost('muse-wonder-1.0', 100, 100)).toBeNull();
  });
  it('timeout keeps the reservation counted; settlement is never confirmed usage', () => {
    const res = newReservation({ requestKey: 'req-1', tenantId: 't1', model: 'muse-spark-1.3', maxCostUsd: 5.5 });
    expect(countedCost(res)).toBe(5.5);
    const pending = markPendingReconciliation(res);
    expect(pending.status).toBe('PENDING_RECONCILIATION');
    expect(countedCost(pending)).toBe(5.5);
    const settled = settleAtMaximum(pending);
    expect(settled.status).toBe('SETTLED_AT_MAXIMUM');
    expect(settled.settledCostUsd).toBe(5.5);
    expect(settled.confirmedCostUsd).toBeNull();
    const confirmed = confirmReservation(res, 1.25);
    expect(confirmed.status).toBe('CONFIRMED');
    expect(countedCost(confirmed)).toBe(1.25);
    expect(retryRequestKey('req-1')).toBe('req-1');
  });
});

describe('schema contract (branch 1)', () => {
  const schema = fs.readFileSync(`${process.cwd()}/prisma/schema.prisma`, 'utf8');
  it('contains the contract §1 models and fields', () => {
    for (const needle of [
      'enum SubscriptionStatus', 'model TenantInvitation', 'model StripeEvent', 'model SpendReservation',
      'stripeCustomerId', 'stripeSubscriptionId', 'subscriptionStatus', 'stripeSubscriptionStatus',
      'subscriptionPlan', 'stripePriceId', 'currentPeriodEnd', 'lastStripeEventAt',
      'authProvider', 'cognitoSub', 'disabledAt', 'provider', 'refreshTokenHash', 'tokenHash',
    ]) {
      expect(schema).toContain(needle);
    }
    expect(schema).not.toContain('passwordHash String\n');
  });
});
