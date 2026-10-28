// GET /api/admin/auth/operator — full-MFA operator profile (metadata
// only). MFA_PENDING sessions get 403 MFA_REQUIRED via the guard.
import { NextResponse } from 'next/server';
import { dbConfigured } from '@/lib/db';
import { requireOperator, isOperatorResult } from '@/lib/operator-auth';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireOperator(req);
  if (!isOperatorResult(s)) return s.response;
  return NextResponse.json({ id: s.operator.id, email: s.operator.email, mfaVerifiedAt: s.session.mfaVerifiedAt, sessionExpiresAt: s.session.expiresAt });
}
