/* eslint-disable @typescript-eslint/no-explicit-any */
// GET /api/account/users — own-tenant user metadata (identity, role,
// disablement). Never passwords, hashes, or tokens.
import { NextResponse } from 'next/server';
import { dbConfigured, prisma } from '@/lib/db';
import { requireSession, isSessionResult } from '@/lib/authz';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireSession(req);
  if (!isSessionResult(s)) return s.response;
  const db = prisma();
  const users = await db.user.findMany({ where: { tenantId: s.user.tenantId }, take: 200, orderBy: { createdAt: 'asc' } });
  return NextResponse.json({ users: (users as any[]).map((u: any) => ({ id: u.id, email: u.email, role: u.role, authProvider: u.authProvider, disabledAt: u.disabledAt, createdAt: u.createdAt })) });
}
