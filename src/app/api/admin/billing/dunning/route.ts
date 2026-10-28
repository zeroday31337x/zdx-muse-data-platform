/* eslint-disable @typescript-eslint/no-explicit-any */
// GET /api/admin/billing/dunning — tenants in past_due/unpaid (metadata
// only: status, period end, days past due). Dunning action itself is
// Stripe-side + the tenant portal; this route is the review list, not
// a payment action. No customer/price IDs are exposed.
import { NextResponse } from 'next/server';
import { dbConfigured, prisma } from '@/lib/db';
import { requireOperator, isOperatorResult } from '@/lib/operator-auth';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireOperator(req);
  if (!isOperatorResult(s)) return s.response;
  const db = prisma();
  const tenants = await db.tenant.findMany({ where: { subscriptionStatus: { in: ['past_due', 'unpaid'] } }, take: 200, orderBy: { updatedAt: 'desc' } });
  const now = Date.now();
  return NextResponse.json({ dunning: (tenants as any[]).map((t: any) => ({ tenantId: t.id, name: t.name, subscriptionStatus: t.subscriptionStatus, stripeSubscriptionStatus: t.stripeSubscriptionStatus, currentPeriodEnd: t.currentPeriodEnd, daysPastPeriodEnd: t.currentPeriodEnd ? Math.max(0, Math.floor((now - new Date(t.currentPeriodEnd).getTime()) / 86400000)) : null })) });
}
