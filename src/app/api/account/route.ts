/* eslint-disable @typescript-eslint/no-explicit-any */
// GET /api/account — own-tenant account summary (metadata only).
// Operator sessions are NOT accepted here: this route reads the
// tenant session only, by construction.
import { NextResponse } from 'next/server';
import { dbConfigured, prisma } from '@/lib/db';
import { requireSession, isSessionResult } from '@/lib/authz';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireSession(req);
  if (!isSessionResult(s)) return s.response;
  const db = prisma();
  const tenant = await db.tenant.findUnique({ where: { id: s.user.tenantId }, include: { _count: { select: { users: true, datasets: true, jobs: true } } } });
  if (!tenant) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json({
    tenant: { id: tenant.id, name: tenant.name, subscriptionStatus: tenant.subscriptionStatus, subscriptionPlan: tenant.subscriptionPlan, modelPreference: tenant.modelPreference, currentPeriodEnd: tenant.currentPeriodEnd, userCount: (tenant as any)._count.users, datasetCount: (tenant as any)._count.datasets, jobCount: (tenant as any)._count.jobs },
    user: { id: s.user.id, email: s.user.email, role: s.user.role, provider: s.user.provider },
  });
}
