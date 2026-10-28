/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { dbConfigured, prisma } from '@/lib/db';
import {
  getCognitoConfig, exchangeCode, verifyIdToken, readCookie,
  clearFlowCookie, publicOrigin, resolvePostLoginTarget,
} from '@/lib/cognito';
import { newSessionToken, sessionCookie } from '@/lib/auth';
import { clientIpFromHeaders, globalRegistrationTracker } from '@/lib/rate-limit';
export const dynamic = 'force-dynamic';

// GET /api/auth/callback/cognito?code&state — the exact registered
// callback. Verifies state (timing-safe), exchanges the code with the
// PKCE verifier (public client, NO secret), verifies the ID token,
// then provisions/links TRANSACTIONALLY and mints a standard DB
// Session row. Errors are generic 400s: no provider detail, no tokens
// in bodies or logs. Linking is by cognitoSub ONLY: an email match
// with a different sub → 409 LINK_CONFLICT for manual admin
// resolution, never auto-merge, never link by email alone.
function timingSafeEqualStr(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const cfg = getCognitoConfig();
  if (!cfg) return NextResponse.json({ error: 'COGNITO_NOT_CONFIGURED' }, { status: 503 });
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieHeader = req.headers.get('cookie');
  const stateCookie = readCookie(cookieHeader, 'zdx_cognito_state');
  const nonceCookie = readCookie(cookieHeader, 'zdx_cognito_nonce');
  const verifierCookie = readCookie(cookieHeader, 'zdx_cognito_verifier');
  const nextCookie = readCookie(cookieHeader, 'zdx_cognito_next');
  const clearCookies = () => {
    const res = NextResponse.json({ error: 'AUTHENTICATION_FAILED' }, { status: 400 });
    res.headers.append('Set-Cookie', clearFlowCookie('zdx_cognito_state'));
    res.headers.append('Set-Cookie', clearFlowCookie('zdx_cognito_nonce'));
    res.headers.append('Set-Cookie', clearFlowCookie('zdx_cognito_verifier'));
    res.headers.append('Set-Cookie', clearFlowCookie('zdx_cognito_next'));
    return res;
  };
  if (!code || !state || !stateCookie || !timingSafeEqualStr(state, stateCookie) || !verifierCookie) {
    return clearCookies();
  }
  let claims: Awaited<ReturnType<typeof verifyIdToken>>;
  try {
    const tokens = await exchangeCode(cfg, code, verifierCookie);
    claims = await verifyIdToken(tokens.idToken, {
      issuer: cfg.issuer,
      clientId: cfg.clientId,
      nonce: nonceCookie ?? undefined,
    });
  } catch {
    return clearCookies();
  }
  const db = prisma();
  const email = claims.email.toLowerCase();
  // Sub-link fast path + email-conflict guard (outside the tx so the
  // 409 does not roll back anything and never auto-merges).
  // bySub/byEmail are hoisted so the registration-rate check below can
  // tell a genuinely new registration (both null) from a login. If the
  // guard read itself fails, both stay null and the check below applies
  // conservatively; the transaction then resolves the actual state.
  let bySub: any = null;
  let byEmail: any = null;
  try {
    bySub = await db.user.findUnique({ where: { cognitoSub: claims.sub } });
    if (!bySub) {
      byEmail = await db.user.findUnique({ where: { email } });
      if (byEmail && byEmail.cognitoSub && byEmail.cognitoSub !== claims.sub) {
        await db.auditLog.create({
          data: {
            tenantId: byEmail.tenantId,
            actor: 'system:cognito-callback',
            action: 'LINK_CONFLICT',
            entity: `User:${byEmail.id}`,
            details: { email, reason: 'email matched an existing user with a different cognitoSub; manual admin resolution required' },
          },
        });
        const res = NextResponse.json({ error: 'LINK_CONFLICT' }, { status: 409 });
        res.headers.append('Set-Cookie', clearFlowCookie('zdx_cognito_state'));
        res.headers.append('Set-Cookie', clearFlowCookie('zdx_cognito_nonce'));
        res.headers.append('Set-Cookie', clearFlowCookie('zdx_cognito_verifier'));
        res.headers.append('Set-Cookie', clearFlowCookie('zdx_cognito_next'));
        return res;
      }
      if (byEmail && !byEmail.cognitoSub) {
        // Email matches a DB-only user with no sub: do NOT auto-link.
        // Same 409 path — a manual admin link (audited, out-of-band
        // sub verification) is the only way to join these accounts.
        await db.auditLog.create({
          data: {
            tenantId: byEmail.tenantId,
            actor: 'system:cognito-callback',
            action: 'LINK_CONFLICT',
            entity: `User:${byEmail.id}`,
            details: { email, reason: 'email matched an unlinked DB user; manual admin linking required' },
          },
        });
        const res = NextResponse.json({ error: 'LINK_CONFLICT' }, { status: 409 });
        res.headers.append('Set-Cookie', clearFlowCookie('zdx_cognito_state'));
        res.headers.append('Set-Cookie', clearFlowCookie('zdx_cognito_nonce'));
        res.headers.append('Set-Cookie', clearFlowCookie('zdx_cognito_verifier'));
        res.headers.append('Set-Cookie', clearFlowCookie('zdx_cognito_next'));
        return res;
      }
    }
  } catch (e) {
    if (e instanceof Response) throw e;
    // A DB failure here is not an auth failure to leak; fall through
    // to the transactional step, which will surface a generic error.
  }
  // Registration rate (B6, PROPOSED 3/IP/24h): only genuinely new
  // registrations are counted — existing-user logins are unaffected.
  // The denial is generic (no oracle for whether an email/IP is
  // already registered) and clears the flow cookies like other callback
  // failures. Attempts count whether or not provisioning then succeeds,
  // so failures cannot probe the limit. The counter is in-memory in v1
  // (single-process); a durable counter needs its own migration — see
  // src/lib/rate-limit.ts.
  if (!bySub && !byEmail) {
    const ip = clientIpFromHeaders(req);
    if (!globalRegistrationTracker.attempt(ip)) {
      const res = NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
      res.headers.append('Set-Cookie', clearFlowCookie('zdx_cognito_state'));
      res.headers.append('Set-Cookie', clearFlowCookie('zdx_cognito_nonce'));
      res.headers.append('Set-Cookie', clearFlowCookie('zdx_cognito_verifier'));
      res.headers.append('Set-Cookie', clearFlowCookie('zdx_cognito_next'));
      return res;
    }
  }
  // Transactional provisioning: new Tenant (restricted) + User
  // (member, Cognito-only) + Session in ONE transaction, plus audit
  // rows. Idempotent retry: a unique-constraint failure on sub/email
  // re-reads the already-provisioned user instead of duplicating.
  const { token, tokenHash } = newSessionToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  let userId: string;
  let tenantId: string;
  try {
    const result = await db.$transaction(async (tx: any) => {
      const existing = await tx.user.findUnique({ where: { cognitoSub: claims.sub }, include: { tenant: true } });
      if (existing) {
        const session = await tx.session.create({ data: { userId: existing.id, tokenHash, provider: 'cognito', expiresAt } });
        await tx.auditLog.create({
          data: { tenantId: existing.tenantId, actor: existing.email, action: 'auth.cognito-login', entity: `User:${existing.id}`, details: {} },
        });
        return { userId: existing.id, tenantId: existing.tenantId, sessionId: session.id };
      }
      const localPart = email.split('@')[0] || 'user';
      const tenant = await tx.tenant.create({ data: { name: localPart, subscriptionStatus: 'restricted' } });
      const user = await tx.user.create({
        data: { tenantId: tenant.id, email, passwordHash: null, authProvider: 'cognito', cognitoSub: claims.sub, role: 'member' },
      });
      const session = await tx.session.create({ data: { userId: user.id, tokenHash, provider: 'cognito', expiresAt } });
      await tx.auditLog.create({
        data: { tenantId: tenant.id, actor: email, action: 'auth.cognito-provision', entity: `User:${user.id}`, details: { provider: 'cognito' } },
      });
      return { userId: user.id, tenantId: tenant.id, sessionId: session.id };
    });
    userId = result.userId;
    tenantId = result.tenantId;
    void userId;
    void tenantId;
  } catch (e: any) {
    // Unique-violation race: two callbacks for the same sub racing.
    // Re-read the provisioned user; never create a second tenant.
    if (e?.code === 'P2002') {
      const retry = await db.user.findUnique({ where: { cognitoSub: claims.sub } });
      if (retry) {
        await db.session.create({ data: { userId: retry.id, tokenHash, provider: 'cognito', expiresAt } });
        // Redirect against the PUBLIC origin (from the registered
        // callback URI), never req url.origin: behind the proxy the
        // request origin can be the app's internal localhost:3000.
        // Forwarding is by verified ID-token group only; it never
        // changes the stored User.role or the provisioning rules above.
        const res = NextResponse.redirect(new URL(resolvePostLoginTarget(nextCookie, (claims.groups ?? []).includes(cfg.adminGroup)), publicOrigin(cfg.redirectUri, url.origin)).toString());
        res.headers.set('Set-Cookie', sessionCookie(token));
        res.headers.append('Set-Cookie', clearFlowCookie('zdx_cognito_state'));
        res.headers.append('Set-Cookie', clearFlowCookie('zdx_cognito_nonce'));
        res.headers.append('Set-Cookie', clearFlowCookie('zdx_cognito_verifier'));
        res.headers.append('Set-Cookie', clearFlowCookie('zdx_cognito_next'));
        return res;
      }
    }
    return clearCookies();
  }
  // Same public-origin + group-based forwarding as the retry path above.
  const res = NextResponse.redirect(new URL(resolvePostLoginTarget(nextCookie, (claims.groups ?? []).includes(cfg.adminGroup)), publicOrigin(cfg.redirectUri, url.origin)).toString());
  res.headers.set('Set-Cookie', sessionCookie(token));
  res.headers.append('Set-Cookie', clearFlowCookie('zdx_cognito_state'));
  res.headers.append('Set-Cookie', clearFlowCookie('zdx_cognito_nonce'));
  res.headers.append('Set-Cookie', clearFlowCookie('zdx_cognito_verifier'));
  res.headers.append('Set-Cookie', clearFlowCookie('zdx_cognito_next'));
  return res;
}
