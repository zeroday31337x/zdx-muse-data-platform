// GET /api/admin/auth/mfa-setup — start operator TOTP enrollment.
// MFA_PENDING sessions only (plus the guard's 401s). Returns the
// shared secret for manual authenticator entry; the Cognito associate
// session itself is never returned to the client — it stays in the
// server-side enrollment entry until the verify step.
import { NextResponse } from 'next/server';
import { dbConfigured, prisma } from '@/lib/db';
import { getCognitoConfig, readCookie } from '@/lib/cognito';
import { requireOperator, isOperatorResult, hashOperatorToken, OPERATOR_COOKIE, operatorAudit } from '@/lib/operator-auth';
import { getEnrollmentEntry, setEnrollmentAssociateSession, associateSoftwareToken } from '@/lib/operator-mfa-enrollment';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const cfg = getCognitoConfig();
  if (!cfg) return NextResponse.json({ error: 'COGNITO_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireOperator(req, { allowMfaPending: true });
  if (!isOperatorResult(s)) return s.response;
  if (s.session.mfaVerifiedAt) return NextResponse.json({ error: 'ALREADY_VERIFIED' }, { status: 409 });
  const raw = readCookie(req.headers.get('cookie'), OPERATOR_COOKIE);
  const entry = raw ? getEnrollmentEntry(hashOperatorToken(raw)) : undefined;
  if (!entry) {
    // No live enrollment entry: the sign-in's access token expired,
    // was used up, or the server restarted. Re-sign-in mints a fresh one.
    return NextResponse.json({ error: 'SETUP_SESSION_EXPIRED' }, { status: 401 });
  }
  try {
    const { secretCode, session } = await associateSoftwareToken(cfg.region, entry.accessToken);
    setEnrollmentAssociateSession(hashOperatorToken(raw as string), session);
    const db = prisma();
    await operatorAudit(db, { operatorId: s.operator.id, action: 'OPERATOR_MFA_SETUP_STARTED', entity: `PlatformOperator:${s.operator.id}` });
    return NextResponse.json({ secretCode, account: s.operator.email, issuer: 'ZeroDriveX' });
  } catch (e) {
    if (e instanceof Error && e.message === 'COGNITO_NOT_AUTHORIZED') {
      return NextResponse.json({ error: 'SETUP_SESSION_EXPIRED' }, { status: 401 });
    }
    return NextResponse.json({ error: 'MFA_SETUP_FAILED' }, { status: 502 });
  }
}
