// POST /api/admin/auth/mfa-setup/verify — finish operator TOTP
// enrollment. Body: { code } (6 digits). Cognito verifies the code;
// only a Cognito SUCCESS marks this operator session MFA-verified,
// after which the console opens without another sign-in round-trip.
// Verify attempts are capped per enrollment (best-effort counter
// cookie — see operator-mfa-enrollment for its limits); exhaustion
// clears the enrollment cookies and the operator signs in again.
import { NextResponse } from 'next/server';
import { dbConfigured, prisma } from '@/lib/db';
import { getCognitoConfig, readCookie } from '@/lib/cognito';
import { requireOperator, isOperatorResult, operatorAudit } from '@/lib/operator-auth';
import {
  ENROLLMENT_ACCESS_COOKIE,
  ENROLLMENT_ASSOCIATE_COOKIE,
  ENROLLMENT_ATTEMPTS_COOKIE,
  isValidTotpCode,
  verifySoftwareToken,
  enableSoftwareTokenMfa,
  parseEnrollmentAttempts,
  enrollmentAttemptsCookie,
  clearEnrollmentCookies,
  cognitoTypeOf,
  cognitoDetailsOf,
  MAX_VERIFY_ATTEMPTS,
} from '@/lib/operator-mfa-enrollment';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const cfg = getCognitoConfig();
  if (!cfg) return NextResponse.json({ error: 'COGNITO_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireOperator(req, { allowMfaPending: true });
  if (!isOperatorResult(s)) return s.response;
  if (s.session.mfaVerifiedAt) return NextResponse.json({ error: 'ALREADY_VERIFIED' }, { status: 409 });
  const body = (await req.json().catch(() => ({}))) as { code?: unknown };
  if (!isValidTotpCode(body.code)) return NextResponse.json({ error: 'INVALID_CODE' }, { status: 400 });
  const cookieHeader = req.headers.get('cookie');
  const accessToken = readCookie(cookieHeader, ENROLLMENT_ACCESS_COOKIE);
  const associateSession = readCookie(cookieHeader, ENROLLMENT_ASSOCIATE_COOKIE);
  // The attempts cookie is set by a successful setup GET, so its
  // presence marks setup as done even when Cognito returned no
  // associate session (verify then runs from the access token alone).
  const attemptsRaw = readCookie(cookieHeader, ENROLLMENT_ATTEMPTS_COOKIE);
  const attempts = parseEnrollmentAttempts(attemptsRaw);
  const clearAll = (res: NextResponse) => {
    for (const c of clearEnrollmentCookies()) res.headers.append('Set-Cookie', c);
    return res;
  };
  if (!accessToken) return clearAll(NextResponse.json({ error: 'SETUP_SESSION_EXPIRED' }, { status: 401 }));
  if (!associateSession && attemptsRaw === null) return NextResponse.json({ error: 'SETUP_NOT_STARTED' }, { status: 400 });
  if (attempts >= MAX_VERIFY_ATTEMPTS) {
    return clearAll(NextResponse.json({ error: 'VERIFY_ATTEMPTS_EXHAUSTED' }, { status: 429 }));
  }
  try {
    const ok = await verifySoftwareToken(cfg.region, accessToken, associateSession, body.code);
    if (!ok) {
      const next = attempts + 1;
      if (next >= MAX_VERIFY_ATTEMPTS) {
        return clearAll(NextResponse.json({ error: 'VERIFY_ATTEMPTS_EXHAUSTED' }, { status: 429 }));
      }
      const res = NextResponse.json({ error: 'INVALID_CODE' }, { status: 400 });
      res.headers.append('Set-Cookie', enrollmentAttemptsCookie(next));
      return res;
    }
    await enableSoftwareTokenMfa(cfg.region, accessToken);
    const db = prisma();
    await db.platformOperatorSession.update({ where: { id: s.session.id }, data: { mfaVerifiedAt: new Date() } });
    await operatorAudit(db, { operatorId: s.operator.id, action: 'OPERATOR_MFA_ENROLLED', entity: `PlatformOperator:${s.operator.id}` });
    return clearAll(NextResponse.json({ ok: true, mfaVerified: true }));
  } catch (e) {
    // Verify failures were previously unaudited, so whether Cognito
    // was even reached was unobservable. Audit the kind + safe shape
    // metadata (never token/secret content) before responding.
    try {
      await operatorAudit(prisma(), { operatorId: s.operator.id, action: 'OPERATOR_MFA_VERIFY_FAILED', entity: `PlatformOperator:${s.operator.id}`, details: { kind: cognitoTypeOf(e) ?? 'UNKNOWN', ...(cognitoDetailsOf(e) ?? {}) } });
    } catch { /* audit is best-effort; the error response still returns */ }
    if (e instanceof Error && e.message === 'COGNITO_NOT_AUTHORIZED') {
      return clearAll(NextResponse.json({ error: 'SETUP_SESSION_EXPIRED' }, { status: 401 }));
    }
    return NextResponse.json({ error: 'MFA_VERIFY_FAILED' }, { status: 502 });
  }
}
