/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { dbConfigured, prisma } from '@/lib/db';
import { verifyWebhookSignature, retrieveSubscription } from '@/lib/stripe-client';
import { applyStripeState, PLAN_ALLOWLIST, priceIdForPlan, recordGraceStart, clearGraceRestriction } from '@/lib/billing';
import { authorizeUnpaidExportOut } from '@/lib/unpaid-export';
export const dynamic = 'force-dynamic';

// POST /api/webhooks/stripe — Stripe-signed ONLY. A zdx_session cookie
// must never authorize it. The RAW body is read and verified BEFORE
// any JSON parsing. Missing header / signature failure → 400
// INVALID_SIGNATURE, no state change. Verified events are deduped via
// StripeEvent.stripeEventId, then RECONCILED against the authoritative
// Stripe subscription object: the fetched state wins over the event
// snapshot and over any local timestamp. If reconciliation fails, the
// event is stored unprocessed, entitlement is NOT changed, and a 5xx
// is returned so Stripe retries. Checkout creation or a redirect
// NEVER sets entitlement — only this path does.
const HANDLED_TYPES = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
]);

function planKeyForPriceId(priceId: string | null): string | null {
  if (!priceId) return null;
  for (const key of Object.keys(PLAN_ALLOWLIST)) {
    if (priceIdForPlan(key) === priceId) return key;
  }
  return null;
}

export async function POST(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'BILLING_NOT_CONFIGURED' }, { status: 503 });
  const rawBody = await req.text();
  const signature = req.headers.get('stripe-signature');
  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'INVALID_SIGNATURE' }, { status: 400 });
  }
  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  }
  const eventId = typeof event?.id === 'string' ? event.id : null;
  const eventType = typeof event?.type === 'string' ? event.type : null;
  if (!eventId || !eventType) return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  const db = prisma();
  // Dedup first: a processed event is never re-applied.
  const existing = await db.stripeEvent.findUnique({ where: { stripeEventId: eventId } });
  if (existing?.processedAt) return NextResponse.json({ received: true, duplicate: true });
  // Test/live guard: a livemode event in test mode is stored with no
  // state change (and vice versa once live is ever enabled).
  const testMode = process.env.STRIPE_MODE === 'test';
  if ((testMode && event.livemode === true) || (!testMode && event.livemode === false)) {
    if (!existing) {
      await db.stripeEvent.create({ data: { stripeEventId: eventId, tenantId: null, type: eventType, processedAt: new Date() } });
    } else {
      await db.stripeEvent.update({ where: { id: existing.id }, data: { processedAt: new Date() } });
    }
    return NextResponse.json({ received: true, ignored: true, reason: 'livemode_mismatch' });
  }
  if (!HANDLED_TYPES.has(eventType)) {
    if (!existing) {
      await db.stripeEvent.create({ data: { stripeEventId: eventId, tenantId: null, type: eventType, processedAt: new Date() } });
    } else {
      await db.stripeEvent.update({ where: { id: existing.id }, data: { processedAt: new Date() } });
    }
    return NextResponse.json({ received: true, ignored: true });
  }
  const obj = (event.data?.object ?? {}) as Record<string, unknown>;
  // Tenant resolution ONLY from verified Stripe data: customer lookup
  // first, then event metadata. Mismatch → store, apply nothing, audit.
  let tenant: any = null;
  const metadataTenantId = (obj.metadata as Record<string, unknown> | undefined)?.tenantId;
  if (typeof obj.customer === 'string') {
    tenant = await db.tenant.findFirst({ where: { stripeCustomerId: obj.customer } });
  }
  if (!tenant && typeof metadataTenantId === 'string') {
    tenant = await db.tenant.findUnique({ where: { id: metadataTenantId } });
  }
  if (tenant && typeof metadataTenantId === 'string' && metadataTenantId !== tenant.id) {
    if (!existing) {
      await db.stripeEvent.create({ data: { stripeEventId: eventId, tenantId: tenant.id, type: eventType, processedAt: new Date() } });
    }
    await db.auditLog.create({
      data: { tenantId: tenant.id, actor: `stripe:${eventId}`, action: 'STRIPE_TENANT_MISMATCH', entity: `Tenant:${tenant.id}`, details: { eventType } },
    });
    return NextResponse.json({ received: true, ignored: true, reason: 'tenant_mismatch' });
  }
  if (!tenant) {
    if (!existing) {
      await db.stripeEvent.create({ data: { stripeEventId: eventId, tenantId: null, type: eventType, processedAt: new Date() } });
    }
    return NextResponse.json({ received: true, ignored: true, reason: 'unresolvable_tenant' });
  }
  // Subscription id for reconciliation.
  let subscriptionId: string | null = null;
  if (eventType.startsWith('customer.subscription.') && typeof obj.id === 'string') subscriptionId = obj.id;
  else if (typeof obj.subscription === 'string') subscriptionId = obj.subscription;
  if (!subscriptionId) {
    // No subscription to reconcile (e.g. non-subscription checkout):
    // acknowledge without changing entitlement.
    if (!existing) {
      await db.stripeEvent.create({ data: { stripeEventId: eventId, tenantId: tenant.id, type: eventType, processedAt: new Date() } });
    }
    return NextResponse.json({ received: true, ignored: true, reason: 'no_subscription' });
  }
  // Reconciliation: the fetched object wins. On fetch failure the
  // event stays unprocessed and entitlement is unchanged; 5xx makes
  // Stripe retry.
  let fetched: Awaited<ReturnType<typeof retrieveSubscription>>;
  try {
    fetched = await retrieveSubscription(subscriptionId);
  } catch {
    if (!existing) {
      await db.stripeEvent.create({ data: { stripeEventId: eventId, tenantId: tenant.id, type: eventType } });
    }
    // Reconciliation failure starts (not expires) grace: the snapshot
    // is preserved; expiry is evaluated lazily by grace.ts once
    // GRACE_HOURS is configured. Best-effort: never masks the 5xx.
    try {
      const grace = recordGraceStart(tenant);
      if (!tenant.graceStartedAt) await db.tenant.update({ where: { id: tenant.id }, data: grace });
    } catch { /* grace bookkeeping must not mask RECONCILIATION_FAILED */ }
    return NextResponse.json({ error: 'RECONCILIATION_FAILED' }, { status: 500 });
  }
  // Customer ownership check on the fetched object.
  if (fetched.customer && tenant.stripeCustomerId && fetched.customer !== tenant.stripeCustomerId) {
    if (!existing) {
      await db.stripeEvent.create({ data: { stripeEventId: eventId, tenantId: tenant.id, type: eventType, processedAt: new Date() } });
    }
    await db.auditLog.create({
      data: { tenantId: tenant.id, actor: `stripe:${eventId}`, action: 'STRIPE_TENANT_MISMATCH', entity: `Tenant:${tenant.id}`, details: { eventType } },
    });
    return NextResponse.json({ received: true, ignored: true, reason: 'tenant_mismatch' });
  }
  const mapped = applyStripeState({ subscriptionStatus: tenant.subscriptionStatus as string }, fetched);
  if (!mapped) {
    // Unknown Stripe status: fail closed, audit, change nothing.
    if (!existing) {
      await db.stripeEvent.create({ data: { stripeEventId: eventId, tenantId: tenant.id, type: eventType, processedAt: new Date() } });
    } else {
      await db.stripeEvent.update({ where: { id: existing.id }, data: { processedAt: new Date() } });
    }
    await db.auditLog.create({
      data: { tenantId: tenant.id, actor: `stripe:${eventId}`, action: 'UNKNOWN_STRIPE_STATUS', entity: `Tenant:${tenant.id}`, details: { eventType, stripeStatus: fetched.status } },
    });
    return NextResponse.json({ received: true, ignored: true, reason: 'unknown_status' });
  }
  const planKey = planKeyForPriceId(fetched.priceId) ?? tenant.subscriptionPlan ?? null;
  const now = new Date();
  const oldDerived = tenant.subscriptionStatus as string;
  const oldVerbatim = (tenant.stripeSubscriptionStatus as string | null) ?? null;
  await db.$transaction(async (tx: any) => {
    await tx.tenant.update({
      where: { id: tenant.id },
      data: {
        stripeSubscriptionId: fetched.id,
        stripeSubscriptionStatus: mapped.stripeStatus,
        stripePriceId: fetched.priceId,
        currentPeriodEnd: fetched.currentPeriodEnd,
        subscriptionStatus: mapped.derived,
        subscriptionPlan: planKey,
        lastStripeEventAt: now,
        // Successful authoritative reconciliation clears any grace
        // restriction (and its start marker) — the restriction never
        // overwrote the verified status, so clearing it restores the
        // derived status's normal access without a status rewrite.
        ...clearGraceRestriction(),
      },
    });
    if (tenant.graceStartedAt || tenant.accessRestriction) {
      await tx.auditLog.create({
        data: { tenantId: tenant.id, actor: `stripe:${eventId}`, action: 'GRACE_RESTRICTION_CLEARED', entity: `Tenant:${tenant.id}`, details: { source: `webhook:${eventId}` } },
      });
    }
    if (existing) {
      await tx.stripeEvent.update({ where: { id: existing.id }, data: { processedAt: now } });
    } else {
      await tx.stripeEvent.create({ data: { stripeEventId: eventId, tenantId: tenant.id, type: eventType, processedAt: now } });
    }
    await tx.auditLog.create({
      data: {
        tenantId: tenant.id,
        actor: `stripe:${eventId}`,
        action: 'SUBSCRIPTION_TRANSITION',
        entity: `Tenant:${tenant.id}`,
        details: { eventType, oldVerbatim, newVerbatim: mapped.stripeStatus, oldPlan: tenant.subscriptionPlan ?? null, newPlan: planKey },
      },
    });
    if (oldDerived !== mapped.derived) {
      await tx.auditLog.create({
        data: {
          tenantId: tenant.id,
          actor: `stripe:${eventId}`,
          action: 'ENTITLEMENT_CHANGED',
          entity: `Tenant:${tenant.id}`,
          details: { oldStatus: oldDerived, newStatus: mapped.derived, source: `webhook:${eventId}`, stripeStatus: mapped.stripeStatus },
        },
      });
      // Verified transition INTO 'unpaid': create exactly one
      // export-out authorization for this transition event, with the
      // snapshot boundary at the transition time (contract §11.9(a)).
      // Idempotent per (tenantId, stripeEventId) — a duplicate
      // delivery creates nothing (dedup above also guards this).
      if (mapped.derived === 'unpaid') {
        await authorizeUnpaidExportOut(tx, { tenantId: tenant.id, stripeEventId: eventId, boundaryAt: now, actor: `stripe:${eventId}` });
      }
    }
  });
  return NextResponse.json({ received: true });
}
