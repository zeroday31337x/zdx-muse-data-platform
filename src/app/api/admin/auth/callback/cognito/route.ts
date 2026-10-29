/* eslint-disable @typescript-eslint/no-explicit-any */
// GET /api/admin/auth/callback/cognito — operator sign-in completion.
// Verifies state (timing-safe), exchanges the code (public client, PKCE,
// no secret), verifies the ID token, then: (1) the Cognito admin group
// must be present, (2) a PlatformOperator row must already exist for
// this cognitoSub — NO self-registration, the first operator is a
// separately approved bootstrap procedure — (3) a disabled operator
// gets 401, (4) the session records MFA only from the authenticated
// token's amr (operatorMfaVerifiedFromClaims); otherwise the session
// is MFA_PENDING. A tenant session is never consulted here.
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { dbConfigured, prisma } from '@/lib/db';
import { getCognitoConfig, exchangeCode, verifyIdToken, readCookie, clearFlowCookie, publicOrigin, resolvePostLoginTarget } from '@/lib/cognito';
import { OPERATOR_ADMIN_GROUP, mintOperatorSession, operatorSessionCookie, operatorMfaVerifiedFromClaims, operatorAudit } from '@/lib/operator-auth';
export const dynamic = 'force-dynamic';
function timingSafeEqualStr(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
  } catch { return false; }
}
export async function GET(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const cfg = getCognitoConfig();
  if (!cfg) return NextResponse.json({ error: 'COGNITO_NOT_CONFIGURED' }, { status: 503 });
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieHeader = req.headers.get('cookie');
  const stateCookie = readCookie(cookieHeader, 'zdx_op_state');
  const nonceCookie = readCookie(cookieHeader, 'zdx_op_nonce');
  const verifierCookie = readCookie(cookieHeader, 'zdx_op_verifier');
  const nextCookie = readCookie(cookieHeader, 'zdx_op_next');
  const fail = (status: number, error: string) => {
    const res = NextResponse.json({ error }, { status });
    res.headers.append('Set-Cookie', clearFlowCookie('zdx_op_state'));
    res.headers.append('Set-Cookie', clearFlowCookie('zdx_op_nonce'));
    res.headers.append('Set-Cookie', clearFlowCookie('zdx_op_verifier'));
    res.headers.append('Set-Cookie', clearFlowCookie('zdx_op_next'));
    return res;
  };
  if (!code || !state || !stateCookie || !timingSafeEqualStr(state, stateCookie) || !verifierCookie) {
    return fail(400, 'AUTHENTICATION_FAILED');
  }
  try {
    const tokens = await exchangeCode(cfg, code, verifierCookie);
    const claims = await verifyIdToken(tokens.idToken, { issuer: cfg.issuer, clientId: cfg.clientId, nonce: nonceCookie ?? undefined });
    const groups = (claims.groups ?? []) as string[];
    const db = prisma();
    const operator = await db.platformOperator.findUnique({ where: { cognitoSub: claims.sub } });
    if (!groups.includes(OPERATOR_ADMIN_GROUP) || !operator) {
      // Same generic response for "not in group" and "no operator row":
      // neither reveals which check failed.
      return fail(403, 'OPERATOR_NOT_AUTHORIZED');
    }
    if (operator.disabledAt) return fail(401, 'OPERATOR_DISABLED');
    const mfaVerified = operatorMfaVerifiedFromClaims(claims);
    const { raw } = await mintOperatorSession(operator.id, mfaVerified);
    await operatorAudit(db, { operatorId: operator.id, action: mfaVerified ? 'OPERATOR_LOGIN_MFA' : 'OPERATOR_LOGIN_MFA_PENDING', entity: `PlatformOperator:${operator.id}` });
    // Public origin, not req url.origin (same localhost:3000 trap as the
    // tenant callback). Operators default to /admin; a next value is
    // honored only if it is a real page path.
    const res = NextResponse.redirect(new URL(resolvePostLoginTarget(nextCookie, true), publicOrigin(cfg.redirectUri, url.origin)).toString());
    res.headers.append('Set-Cookie', operatorSessionCookie(raw));
    res.headers.append('Set-Cookie', clearFlowCookie('zdx_op_state'));
    res.headers.append('Set-Cookie', clearFlowCookie('zdx_op_nonce'));
    res.headers.append('Set-Cookie', clearFlowCookie('zdx_op_verifier'));
    res.headers.append('Set-Cookie', clearFlowCookie('zdx_op_next'));
    return res;
  } catch {
    return fail(400, 'AUTHENTICATION_FAILED');
  }
}
