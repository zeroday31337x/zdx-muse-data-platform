// GET /api/admin/auth/mfa-status — the ONLY operator route (plus the
// MFA redirect) an MFA_PENDING session may call. Returns the MFA state
// of the caller's own operator session; no tenant data, no tokens.
import { NextResponse } from 'next/server';
import { dbConfigured } from '@/lib/db';
import { requireOperator, isOperatorResult } from '@/lib/operator-auth';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireOperator(req, { allowMfaPending: true });
  if (!isOperatorResult(s)) return s.response;
  return NextResponse.json({ operatorId: s.operator.id, email: s.operator.email, mfaVerified: Boolean(s.session.mfaVerifiedAt), mfaVerifiedAt: s.session.mfaVerifiedAt });
}
