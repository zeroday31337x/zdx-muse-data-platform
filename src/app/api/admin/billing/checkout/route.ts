/* eslint-disable @typescript-eslint/no-explicit-any */
// POST /api/admin/billing/checkout { tenantId, priceKey } — operator
// generates a tenant Checkout URL (the tenant's own admin completes
// it). The operator NEVER completes checkout as the tenant and never
// mints a tenant session. Guards mirror /api/billing/checkout
// (already-active 409, past_due 409, server idempotency key, server
// URLs, response {url} only, entitlement unchanged). Dual-audited.
import { NextResponse } from 'next/server';
import { dbConfigured, prisma } from '@/lib/db';
import { requireOperator, isOperatorResult, operatorAudit } from '@/lib/operator-auth';
import { PLAN_ALLOWLIST, priceIdForPlan, billingConfigured, serverCheckoutIdempotencyKey } from '@/lib/billing';
import { createStripeCustomer, createCheckoutSession } from '@/lib/stripe-client';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireOperator(req);
  if (!isOperatorResult(s)) return s.response;
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 }); }
  if (typeof body?.tenantId !== 'string' || typeof body?.priceKey !== 'string' || !PLAN_ALLOWLIST[body.priceKey]) {
    return NextResponse.json({ error: body?.priceKey && !PLAN_ALLOWLIST[body.priceKey] ? 'INVALID_PRICE' : 'INVALID_REQUEST' }, { status: 400 });
  }
  const db = prisma();
  const tenant = await db.tenant.findUnique({ where: { id: body.tenantId } });
  if (!tenant) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  if (tenant.subscriptionStatus === 'active' || tenant.subscriptionStatus === 'trialing') return NextResponse.json({ error: 'SUBSCRIPTION_ALREADY_ACTIVE' }, { status: 409 });
  if (tenant.subscriptionStatus === 'past_due') return NextResponse.json({ error: 'USE_PORTAL_TO_RESOLVE_PAST_DUE' }, { status: 409 });
  if (!billingConfigured()) return NextResponse.json({ error: 'BILLING_NOT_CONFIGURED' }, { status: 503 });
  const priceId = priceIdForPlan(body.priceKey);
  if (!priceId) return NextResponse.json({ error: 'BILLING_NOT_CONFIGURED' }, { status: 503 });
  let customerId: string | null = tenant.stripeCustomerId ?? null;
  try {
    const ensured = await db.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenant.id} FOR UPDATE`;
      const fresh = await tx.tenant.findUnique({ where: { id: tenant.id } });
      if (fresh?.stripeCustomerId) return fresh.stripeCustomerId as string;
      const admin = await tx.user.findFirst({ where: { tenantId: tenant.id, role: 'admin' } });
      const created = await createStripeCustomer(admin?.email ?? tenant.name, tenant.id);
      await tx.tenant.update({ where: { id: tenant.id }, data: { stripeCustomerId: created.id } });
      return created.id;
    });
    customerId = ensured;
  } catch { return NextResponse.json({ error: 'STRIPE_UNAVAILABLE' }, { status: 503 }); }
  const appUrl = (process.env.APP_URL || new URL(req.url).origin).replace(/\/$/, '');
  try {
    const session = await createCheckoutSession(customerId as string, priceId, `${appUrl}/billing/success`, `${appUrl}/billing/cancel`, { idempotencyKey: serverCheckoutIdempotencyKey(tenant.id, body.priceKey) });
    await operatorAudit(db, { operatorId: s.operator.id, action: 'BILLING_CHECKOUT_CREATED', entity: `Tenant:${tenant.id}`, tenantId: tenant.id, details: { priceKey: body.priceKey } });
    return NextResponse.json({ url: session.url });
  } catch { return NextResponse.json({ error: 'STRIPE_UNAVAILABLE' }, { status: 503 }); }
}
