/* eslint-disable @typescript-eslint/no-explicit-any */
// POST /api/admin/billing/portal { tenantId } — operator generates a
// tenant Portal URL (the tenant's own admin uses it). No customer →
// 409 NO_BILLING_CUSTOMER. Response {url} only. Dual-audited.
import { NextResponse } from 'next/server';
import { dbConfigured, prisma } from '@/lib/db';
import { requireOperator, isOperatorResult, operatorAudit } from '@/lib/operator-auth';
import { createPortalSession } from '@/lib/stripe-client';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireOperator(req);
  if (!isOperatorResult(s)) return s.response;
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 }); }
  if (typeof body?.tenantId !== 'string') return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  const db = prisma();
  const tenant = await db.tenant.findUnique({ where: { id: body.tenantId } });
  if (!tenant) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  if (!tenant.stripeCustomerId) return NextResponse.json({ error: 'NO_BILLING_CUSTOMER' }, { status: 409 });
  const appUrl = (process.env.APP_URL || new URL(req.url).origin).replace(/\/$/, '');
  try {
    const session = await createPortalSession(tenant.stripeCustomerId, `${appUrl}/billing`);
    await operatorAudit(db, { operatorId: s.operator.id, action: 'BILLING_PORTAL_CREATED', entity: `Tenant:${tenant.id}`, tenantId: tenant.id });
    return NextResponse.json({ url: session.url });
  } catch { return NextResponse.json({ error: 'STRIPE_UNAVAILABLE' }, { status: 503 }); }
}
