// GET /api/admin/auth/mfa-setup — start operator TOTP enrollment.
// MFA_PENDING sessions only (plus the guard's 401s). Returns the
// shared secret for manual authenticator entry; the Cognito associate
// session, when Cognito returns one, is never returned to the client
// — it travels back in a short-lived httpOnly enrollment cookie for
// the verify step. When Cognito returns no session (plain
// authenticated-user associate), verify runs from the access token
// alone and the attempts cookie marks setup as done.
import { NextResponse } from 'next/server';
import { dbConfigured, prisma } from '@/lib/db';
import { getCognitoConfig, readCookie } from '@/lib/cognito';
import { requireOperator, isOperatorResult, operatorAudit } from '@/lib/operator-auth';
import {
  ENROLLMENT_ACCESS_COOKIE,
  associateSoftwareToken,
  enrollmentAssociateCookie,
  enrollmentAttemptsCookie,
  clearEnrollmentCookies,
  cognitoTypeOf,
  cognitoDetailsOf,
} from '@/lib/operator-mfa-enrollment';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const cfg = getCognitoConfig();
  if (!cfg) return NextResponse.json({ error: 'COGNITO_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireOperator(req, { allowMfaPending: true });
  if (!isOperatorResult(s)) return s.response;
  if (s.session.mfaVerifiedAt) return NextResponse.json({ error: 'ALREADY_VERIFIED' }, { status: 409 });
  const accessToken = readCookie(req.headers.get('cookie'), ENROLLMENT_ACCESS_COOKIE);
  if (!accessToken) {
    // No enrollment cookie: the sign-in predates enrollment support,
    // the cookie expired (1h), or the operator never came through a
    // fresh operator sign-in. Re-sign-in mints a fresh one.
    const res = NextResponse.json({ error: 'SETUP_SESSION_EXPIRED' }, { status: 401 });
    for (const c of clearEnrollmentCookies()) res.headers.append('Set-Cookie', c);
    return res;
  }
  try {
    const { secretCode, session } = await associateSoftwareToken(cfg.region, accessToken);
    // A cookie that cannot hold the associate session must fail
    // loudly here, not silently drop it and fail at verify time.
    // The length is audited (a number, never the session itself) so
    // an oversize session is distinguishable from a Cognito error.
    // A missing session is NOT a failure: Cognito returns SecretCode
    // alone for a plain authenticated-user associate, and verify
    // runs from the access token alone in that case.
    if (session !== null) {
      const encodedSessionLength = encodeURIComponent(session).length;
      if (encodedSessionLength > 3800) {
        try {
          await operatorAudit(prisma(), { operatorId: s.operator.id, action: 'OPERATOR_MFA_SETUP_SESSION_TOO_LONG', entity: `PlatformOperator:${s.operator.id}`, details: { encodedLength: encodedSessionLength } });
        } catch { /* audit is best-effort; the error response still returns */ }
        return NextResponse.json({ error: 'MFA_SETUP_FAILED' }, { status: 502 });
      }
    }
    const res = NextResponse.json({ secretCode, account: s.operator.email, issuer: 'ZeroDriveX' });
    if (session !== null) res.headers.append('Set-Cookie', enrollmentAssociateCookie(session));
    res.headers.append('Set-Cookie', enrollmentAttemptsCookie(0));
    const db = prisma();
    await operatorAudit(db, { operatorId: s.operator.id, action: 'OPERATOR_MFA_SETUP_STARTED', entity: `PlatformOperator:${s.operator.id}` });
    return res;
  } catch (e) {
    if (e instanceof Error && e.message === 'COGNITO_NOT_AUTHORIZED') {
      // Cognito rejected the enrollment token (most often: the sign-in
      // token lacks aws.cognito.signin.user.admin). This used to reuse
      // the 401 SETUP_SESSION_EXPIRED response, so a token rejection
      // looked exactly like an expired sign-in — the mask that hid
      // this failure. It now gets its own 403, its own audit row
      // (boolean fact, no token content), and its own page state.
      try {
        await operatorAudit(prisma(), { operatorId: s.operator.id, action: 'OPERATOR_MFA_SETUP_REJECTED', entity: `PlatformOperator:${s.operator.id}` });
      } catch { /* audit is best-effort; the error response still returns */ }
      const res = NextResponse.json({ error: 'MFA_SETUP_NOT_AUTHORIZED' }, { status: 403 });
      for (const c of clearEnrollmentCookies()) res.headers.append('Set-Cookie', c);
      return res;
    }
    // Any other associate failure: audit the KIND plus safe shape
    // metadata (status, body length, response key NAMES — never
    // token/secret content or bodies) so the cause is observable
    // instead of collapsing into a bare 502.
    try {
      await operatorAudit(prisma(), { operatorId: s.operator.id, action: 'OPERATOR_MFA_SETUP_FAILED', entity: `PlatformOperator:${s.operator.id}`, details: { kind: cognitoTypeOf(e) ?? 'UNKNOWN', ...(cognitoDetailsOf(e) ?? {}) } });
    } catch { /* audit is best-effort; the error response still returns */ }
    return NextResponse.json({ error: 'MFA_SETUP_FAILED' }, { status: 502 });
  }
}
