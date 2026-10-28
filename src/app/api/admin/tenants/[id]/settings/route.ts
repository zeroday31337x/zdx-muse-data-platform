/* eslint-disable @typescript-eslint/no-explicit-any */
// PATCH /api/admin/tenants/[id]/settings — operator tenant settings in
// v1: { name } ONLY. Entitlement, plan, and tier-allowlist keys are
// NEVER settable here (403 SETTING_LOCKED); unknown keys are 400.
// Tenant model-preference changes go through the tenant account route
// (tenant admin), not this operator route, preserving tenant autonomy.
import { NextResponse } from 'next/server';
import { dbConfigured, prisma } from '@/lib/db';
import { requireOperator, isOperatorResult, operatorAudit } from '@/lib/operator-auth';
export const dynamic = 'force-dynamic';
const LOCKED_TENANT_KEYS = new Set(['subscriptionStatus', 'subscriptionPlan', 'stripeCustomerId', 'stripeSubscriptionId', 'stripeSubscriptionStatus', 'stripePriceId', 'currentPeriodEnd', 'modelPreference']);
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireOperator(req);
  if (!isOperatorResult(s)) return s.response;
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 }); }
  for (const key of Object.keys(body ?? {})) {
    if (LOCKED_TENANT_KEYS.has(key)) return NextResponse.json({ error: 'SETTING_LOCKED' }, { status: 403 });
    if (key !== 'name') return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  }
  if (typeof body?.name !== 'string' || body.name.length === 0 || body.name.length > 200) {
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  }
  const db = prisma();
  const tenant = await db.tenant.findUnique({ where: { id } });
  if (!tenant) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const updated = await db.tenant.update({ where: { id }, data: { name: body.name } });
  await operatorAudit(db, { operatorId: s.operator.id, action: 'TENANT_SETTINGS_CHANGED', entity: `Tenant:${id}`, tenantId: id, details: { changed: ['name'] } });
  return NextResponse.json({ id: updated.id, name: updated.name });
}
