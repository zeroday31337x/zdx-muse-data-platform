/* eslint-disable @typescript-eslint/no-explicit-any */
// GET /api/admin/tenants/[id] — metadata-only tenant detail: identity,
// billing state (no customer/price IDs), user metadata, counts. Never
// dataset contents or record bodies.
import { NextResponse } from 'next/server';
import { dbConfigured, prisma } from '@/lib/db';
import { requireOperator, isOperatorResult } from '@/lib/operator-auth';
export const dynamic = 'force-dynamic';
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireOperator(_req);
  if (!isOperatorResult(s)) return s.response;
  const db = prisma();
  const t = await db.tenant.findUnique({ where: { id }, include: { users: true, _count: { select: { datasets: true, jobs: true, usage: true } } } });
  if (!t) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json({
    id: t.id, name: t.name, createdAt: t.createdAt,
    subscriptionStatus: t.subscriptionStatus, subscriptionPlan: t.subscriptionPlan,
    stripeSubscriptionStatus: t.stripeSubscriptionStatus, currentPeriodEnd: t.currentPeriodEnd,
    hasCustomer: Boolean(t.stripeCustomerId),
    users: (t.users as any[]).map((u: any) => ({ id: u.id, email: u.email, role: u.role, authProvider: u.authProvider, disabledAt: u.disabledAt, createdAt: u.createdAt })),
    datasetCount: t._count.datasets, jobCount: t._count.jobs, usageRowCount: t._count.usage,
  });
}
