/* eslint-disable @typescript-eslint/no-explicit-any */
// POST /api/admin/billing/reconcile { tenantId } — operator-triggered
// reconciliation: fetch the AUTHORITATIVE subscription from Stripe
// and apply THAT state (same rule as the webhook). Stripe unconfigured
// → 503 BILLING_NOT_CONFIGURED; fetch failure → 503
// STRIPE_UNAVAILABLE with NO state change (never a downgrade or
// upgrade on an outage). Dual-audited with ENTITLEMENT_CHANGED only
// when the derived entitlement actually changed.
import { NextResponse } from 'next/server';
import { dbConfigured, prisma } from '@/lib/db';
import { requireOperator, isOperatorResult, operatorAudit } from '@/lib/operator-auth';
import { billingConfigured, applyStripeState, PLAN_ALLOWLIST, priceIdForPlan, clearGraceRestriction } from '@/lib/billing';
import { retrieveSubscription } from '@/lib/stripe-client';
import { authorizeUnpaidExportOut } from '@/lib/unpaid-export';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireOperator(req);
  if (!isOperatorResult(s)) return s.response;
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 }); }
  if (typeof body?.tenantId !== 'string') return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  if (!billingConfigured()) return NextResponse.json({ error: 'BILLING_NOT_CONFIGURED' }, { status: 503 });
  const db = prisma();
  const tenant = await db.tenant.findUnique({ where: { id: body.tenantId } });
  if (!tenant) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  if (!tenant.stripeSubscriptionId) return NextResponse.json({ error: 'NO_BILLING_SUBSCRIPTION' }, { status: 409 });
  let sub: any;
  try { sub = await retrieveSubscription(tenant.stripeSubscriptionId); } catch {
    return NextResponse.json({ error: 'STRIPE_UNAVAILABLE' }, { status: 503 });
  }
  const before = tenant.subscriptionStatus;
  // Same mapping as the webhook route: fetched state wins; unknown
  // verbatim status → audit + no change (fail closed).
  const mapped = applyStripeState({ subscriptionStatus: tenant.subscriptionStatus as string }, sub);
  if (!mapped) {
    await operatorAudit(db, { operatorId: s.operator.id, action: 'UNKNOWN_STRIPE_STATUS', entity: `Tenant:${tenant.id}`, tenantId: tenant.id, details: { stripeStatus: sub.status, via: 'operator-reconcile' } });
    return NextResponse.json({ received: true, ignored: true, reason: 'unknown_status' });
  }
  let planKey: string | null = tenant.subscriptionPlan ?? null;
  if (sub.priceId) {
    for (const key of Object.keys(PLAN_ALLOWLIST)) {
      if (priceIdForPlan(key) === sub.priceId) { planKey = key; break; }
    }
  }
  const entitlementChanged = before !== mapped.derived;
  await db.$transaction(async (tx: any) => {
    // Successful authoritative reconciliation clears any grace
    // restriction (same rule as the webhook path).
    await tx.tenant.update({ where: { id: tenant.id }, data: { stripeSubscriptionStatus: mapped.stripeStatus, subscriptionStatus: mapped.derived, subscriptionPlan: planKey, stripePriceId: sub.priceId, currentPeriodEnd: sub.currentPeriodEnd, lastStripeEventAt: new Date(), ...clearGraceRestriction() } });
    await tx.platformAuditLog.create({ data: { actor: `platform-operator:${s.operator.id}`, action: 'SUBSCRIPTION_TRANSITION', entity: `Tenant:${tenant.id}`, tenantId: tenant.id, details: { from: before, to: mapped.derived, via: 'operator-reconcile' } } });
    await tx.auditLog.create({ data: { tenantId: tenant.id, actor: `platform-operator:${s.operator.id}`, action: 'SUBSCRIPTION_TRANSITION', entity: `Tenant:${tenant.id}`, details: { from: before, to: mapped.derived, via: 'operator-reconcile' } } });
    if (entitlementChanged) {
      await tx.platformAuditLog.create({ data: { actor: `platform-operator:${s.operator.id}`, action: 'ENTITLEMENT_CHANGED', entity: `Tenant:${tenant.id}`, tenantId: tenant.id, details: { from: before, to: mapped.derived } } });
      await tx.auditLog.create({ data: { tenantId: tenant.id, actor: `platform-operator:${s.operator.id}`, action: 'ENTITLEMENT_CHANGED', entity: `Tenant:${tenant.id}`, details: { from: before, to: mapped.derived } } });
      // Verified transition INTO 'unpaid' via operator reconcile:
      // same one-time export-out authorization as the webhook path.
      // The event id is synthetic (operator-reconcile) but still
      // unique per (tenant, transition) via the authorization's
      // (tenantId, stripeEventId) uniqueness + the changed check.
      if (mapped.derived === 'unpaid') {
        await authorizeUnpaidExportOut(tx, { tenantId: tenant.id, stripeEventId: `operator-reconcile:${tenant.id}:${Date.now()}`, boundaryAt: new Date(), actor: `platform-operator:${s.operator.id}` });
      }
    }
  });
  return NextResponse.json({ tenantId: tenant.id, subscriptionStatus: mapped.derived, entitlementChanged });
}
