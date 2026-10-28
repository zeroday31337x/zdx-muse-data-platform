/* eslint-disable @typescript-eslint/no-explicit-any */
// GET /api/admin/tenants — metadata-only tenant list. No dataset
// contents, no record bodies, no secrets, no price/customer IDs.
import { NextResponse } from 'next/server';
import { dbConfigured, prisma } from '@/lib/db';
import { requireOperator, isOperatorResult } from '@/lib/operator-auth';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireOperator(req);
  if (!isOperatorResult(s)) return s.response;
  const db = prisma();
  const tenants = await db.tenant.findMany({ take: 200, orderBy: { createdAt: 'desc' }, include: { _count: { select: { users: true, datasets: true, jobs: true } } } });
  return NextResponse.json({ tenants: tenants.map((t: any) => ({ id: t.id, name: t.name, subscriptionStatus: t.subscriptionStatus, subscriptionPlan: t.subscriptionPlan, stripeSubscriptionStatus: t.stripeSubscriptionStatus, currentPeriodEnd: t.currentPeriodEnd, createdAt: t.createdAt, userCount: t._count.users, datasetCount: t._count.datasets, jobCount: t._count.jobs })) });
}
