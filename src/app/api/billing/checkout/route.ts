/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { dbConfigured, prisma } from '@/lib/db';
import { requireSession, isSessionResult } from '@/lib/authz';
import { PLAN_ALLOWLIST, priceIdForPlan, billingConfigured, serverCheckoutIdempotencyKey } from '@/lib/billing';
import { checkRequestRate } from '@/lib/rate-limit';
import { createStripeCustomer, createCheckoutSession } from '@/lib/stripe-client';
export const dynamic = 'force-dynamic';

// POST /api/billing/checkout — tenant-admin only. Body {priceKey}
// ONLY: no tenantId, no priceId, no client success/cancel URLs
// (open-redirect risk); URLs are server-derived from APP_URL + fixed
// paths. Checkout creation NEVER sets entitlement: entitlement follows
// only a verified webhook + reconciliation (see webhook route).
const schema = z.object({ priceKey: z.string().min(1) });

export async function POST(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireSession(req);
  if (!isSessionResult(s)) return s.response;
  if (s.user.role !== 'admin') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  const priceKey = parsed.data.priceKey;
  if (!PLAN_ALLOWLIST[priceKey]) return NextResponse.json({ error: 'INVALID_PRICE' }, { status: 400 });
  const db = prisma();
  const tenant = await db.tenant.findUnique({ where: { id: s.user.tenantId } });
  if (!tenant) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  // Request rate (B2, PROPOSED values): billing routes are exempt from
  // the entitlement gate (§2.1), but not from rate limiting.
  if (checkRequestRate(req, s.user.tenantId).limited) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
  if (tenant.subscriptionStatus === 'active' || tenant.subscriptionStatus === 'trialing') {
    return NextResponse.json({ error: 'SUBSCRIPTION_ALREADY_ACTIVE' }, { status: 409 });
  }
  if (tenant.subscriptionStatus === 'past_due') {
    return NextResponse.json({ error: 'USE_PORTAL_TO_RESOLVE_PAST_DUE' }, { status: 409 });
  }
  if (!billingConfigured()) return NextResponse.json({ error: 'BILLING_NOT_CONFIGURED' }, { status: 503 });
  const priceId = priceIdForPlan(priceKey);
  if (!priceId) return NextResponse.json({ error: 'BILLING_NOT_CONFIGURED' }, { status: 503 });
  // Concurrency-safe customer ensure: lock the Tenant row so two
  // concurrent checkouts cannot create two Stripe customers.
  let customerId: string | null = tenant.stripeCustomerId ?? null;
  try {
    const ensured = await db.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenant.id} FOR UPDATE`;
      const fresh = await tx.tenant.findUnique({ where: { id: tenant.id } });
      if (fresh?.stripeCustomerId) return fresh.stripeCustomerId as string;
      const created = await createStripeCustomer(s.user.email, tenant.id);
      await tx.tenant.update({ where: { id: tenant.id }, data: { stripeCustomerId: created.id } });
      return created.id;
    });
    customerId = ensured;
  } catch {
    return NextResponse.json({ error: 'STRIPE_UNAVAILABLE' }, { status: 503 });
  }
  const appUrl = (process.env.APP_URL || new URL(req.url).origin).replace(/\/$/, '');
  try {
    const session = await createCheckoutSession(
      customerId as string,
      priceId,
      `${appUrl}/billing/success`,
      `${appUrl}/billing/cancel`,
      { idempotencyKey: serverCheckoutIdempotencyKey(tenant.id, priceKey) },
    );
    // Response carries the hosted Checkout URL only — never the full
    // session object, never a secret. Entitlement is unchanged here.
    return NextResponse.json({ url: session.url });
  } catch {
    return NextResponse.json({ error: 'STRIPE_UNAVAILABLE' }, { status: 503 });
  }
}
