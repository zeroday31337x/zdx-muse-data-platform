/* eslint-disable @typescript-eslint/no-explicit-any */
// PATCH /api/account/tenant/settings { name } — tenant-admin own
// tenant settings. Entitlement/plan/allowlist keys are NEVER settable
// here (403 SETTING_LOCKED); unknown keys are 400. Audited.
import { NextResponse } from 'next/server';
import { dbConfigured, prisma } from '@/lib/db';
import { requireSession, isSessionResult } from '@/lib/authz';
export const dynamic = 'force-dynamic';
const LOCKED_KEYS = new Set(['subscriptionStatus', 'subscriptionPlan', 'stripeCustomerId', 'stripeSubscriptionId', 'stripeSubscriptionStatus', 'stripePriceId', 'currentPeriodEnd', 'modelPreference']);
export async function PATCH(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireSession(req);
  if (!isSessionResult(s)) return s.response;
  if (s.user.role !== 'admin') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 }); }
  for (const key of Object.keys(body ?? {})) {
    if (LOCKED_KEYS.has(key)) return NextResponse.json({ error: 'SETTING_LOCKED' }, { status: 403 });
    if (key !== 'name') return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  }
  if (typeof body?.name !== 'string' || body.name.length === 0 || body.name.length > 200) {
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  }
  const db = prisma();
  const updated = await db.tenant.update({ where: { id: s.user.tenantId }, data: { name: body.name } });
  await db.auditLog.create({ data: { tenantId: s.user.tenantId, actor: `user:${s.user.id}`, action: 'TENANT_SETTINGS_CHANGED', entity: `Tenant:${s.user.tenantId}`, details: { changed: ['name'] } } });
  return NextResponse.json({ id: updated.id, name: updated.name });
}
