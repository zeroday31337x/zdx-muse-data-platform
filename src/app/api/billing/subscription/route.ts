import { NextResponse } from 'next/server';
import { dbConfigured, prisma } from '@/lib/db';
import { requireSession, isSessionResult } from '@/lib/authz';
export const dynamic = 'force-dynamic';

// GET /api/billing/subscription — any tenant member may read (a member
// must be able to see why they are gated). Safe shape only: NEVER
// secrets, webhook keys, full Stripe objects, price IDs, customer IDs,
// or other tenants' data.
export async function GET(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireSession(req);
  if (!isSessionResult(s)) return s.response;
  const db = prisma();
  const tenant = await db.tenant.findUnique({ where: { id: s.user.tenantId } });
  if (!tenant) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const status = tenant.subscriptionStatus as string;
  return NextResponse.json({
    status,
    plan: tenant.subscriptionPlan ?? null,
    currentPeriodEnd: tenant.currentPeriodEnd ?? null,
    hasCustomer: Boolean(tenant.stripeCustomerId),
    portalEligible: Boolean(tenant.stripeCustomerId),
    checkoutEligible: status !== 'active' && status !== 'trialing' && status !== 'past_due',
  });
}
