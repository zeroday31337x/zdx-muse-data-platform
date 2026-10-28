/* eslint-disable @typescript-eslint/no-explicit-any */
// POST /api/admin/auth/logout — explicit invalidation: delete the
// operator session row, then clear the cookie. Works for MFA_PENDING
// sessions too (a pending session must be revocable).
import { NextResponse } from 'next/server';
import { dbConfigured, prisma } from '@/lib/db';
import { requireOperator, isOperatorResult, clearOperatorSessionCookie, hashOperatorToken } from '@/lib/operator-auth';
import { readCookie } from '@/lib/cognito';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireOperator(req, { allowMfaPending: true });
  if (!isOperatorResult(s)) return s.response;
  const db = prisma();
  const raw = readCookie(req.headers.get('cookie'), 'zdx_operator_session');
  if (raw) {
    try { await db.platformOperatorSession.delete({ where: { tokenHash: hashOperatorToken(raw) } }); } catch { /* already gone */ }
  }
  const res = NextResponse.json({ ok: true });
  res.headers.append('Set-Cookie', clearOperatorSessionCookie());
  return res;
}
