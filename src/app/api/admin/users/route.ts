/* eslint-disable @typescript-eslint/no-explicit-any */
// GET /api/admin/users — cross-tenant user metadata list (identity +
// role + disablement only; never passwords, hashes, or tokens).
import { NextResponse } from 'next/server';
import { dbConfigured, prisma } from '@/lib/db';
import { requireOperator, isOperatorResult } from '@/lib/operator-auth';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireOperator(req);
  if (!isOperatorResult(s)) return s.response;
  const url = new URL(req.url);
  const tenantId = url.searchParams.get('tenantId') ?? undefined;
  const db = prisma();
  const users = await db.user.findMany({ where: tenantId ? { tenantId } : undefined, take: 200, orderBy: { createdAt: 'desc' } });
  return NextResponse.json({ users: (users as any[]).map((u: any) => ({ id: u.id, email: u.email, tenantId: u.tenantId, role: u.role, authProvider: u.authProvider, disabledAt: u.disabledAt, createdAt: u.createdAt })) });
}
