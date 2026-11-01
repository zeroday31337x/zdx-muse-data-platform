// POST /api/admin/auth/mfa-setup/verify — finish operator TOTP
// enrollment. Body: { code } (6 digits). Cognito verifies the code;
// only a Cognito SUCCESS marks this operator session MFA-verified,
// after which the console opens without another sign-in round-trip.
// Verify attempts are capped per enrollment entry so a 6-digit code
// cannot be guessed at leisure; exhaustion deletes the entry and the
// operator signs in again for a fresh enrollment.
import { NextResponse } from 'next/server';
import { dbConfigured, prisma } from '@/lib/db';
import { getCognitoConfig, readCookie } from '@/lib/cognito';
import { requireOperator, isOperatorResult, hashOperatorToken, OPERATOR_COOKIE, operatorAudit } from '@/lib/operator-auth';
import {
  getEnrollmentEntry,
  deleteEnrollmentEntry,
  isValidTotpCode,
  verifySoftwareToken,
  enableSoftwareTokenMfa,
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
  const raw = readCookie(req.headers.get('cookie'), OPERATOR_COOKIE);
  const hash = raw ? hashOperatorToken(raw) : null;
  const entry = hash ? getEnrollmentEntry(hash) : undefined;
  if (!entry || !hash) return NextResponse.json({ error: 'SETUP_SESSION_EXPIRED' }, { status: 401 });
  if (!entry.associateSession) return NextResponse.json({ error: 'SETUP_NOT_STARTED' }, { status: 400 });
  if (entry.attempts >= MAX_VERIFY_ATTEMPTS) {
    deleteEnrollmentEntry(hash);
    return NextResponse.json({ error: 'VERIFY_ATTEMPTS_EXHAUSTED' }, { status: 429 });
  }
  entry.attempts += 1;
  try {
    const ok = await verifySoftwareToken(cfg.region, entry.accessToken, entry.associateSession, body.code);
    if (!ok) {
      if (entry.attempts >= MAX_VERIFY_ATTEMPTS) {
        deleteEnrollmentEntry(hash);
        return NextResponse.json({ error: 'VERIFY_ATTEMPTS_EXHAUSTED' }, { status: 429 });
      }
      return NextResponse.json({ error: 'INVALID_CODE' }, { status: 400 });
    }
    await enableSoftwareTokenMfa(cfg.region, entry.accessToken);
    const db = prisma();
    await db.platformOperatorSession.update({ where: { id: s.session.id }, data: { mfaVerifiedAt: new Date() } });
    deleteEnrollmentEntry(hash);
    await operatorAudit(db, { operatorId: s.operator.id, action: 'OPERATOR_MFA_ENROLLED', entity: `PlatformOperator:${s.operator.id}` });
    return NextResponse.json({ ok: true, mfaVerified: true });
  } catch (e) {
    if (e instanceof Error && e.message === 'COGNITO_NOT_AUTHORIZED') {
      deleteEnrollmentEntry(hash);
      return NextResponse.json({ error: 'SETUP_SESSION_EXPIRED' }, { status: 401 });
    }
    return NextResponse.json({ error: 'MFA_VERIFY_FAILED' }, { status: 502 });
  }
}
