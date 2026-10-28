import { NextResponse } from 'next/server';
import { dbConfigured, prisma } from '@/lib/db';
import { requireSession, isSessionResult } from '@/lib/authz';
import { billingConfigured } from '@/lib/billing';
import { createPortalSession } from '@/lib/stripe-client';
export const dynamic = 'force-dynamic';

// POST /api/billing/portal — tenant-admin only. Return URL is
// server-derived from APP_URL + a fixed billing path. No customer →
// 409 NO_BILLING_CUSTOMER (complete Checkout first).
export async function POST(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireSession(req);
  if (!isSessionResult(s)) return s.response;
  if (s.user.role !== 'admin') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const db = prisma();
  const tenant = await db.tenant.findUnique({ where: { id: s.user.tenantId } });
  if (!tenant) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  if (!tenant.stripeCustomerId) return NextResponse.json({ error: 'NO_BILLING_CUSTOMER' }, { status: 409 });
  if (!billingConfigured()) return NextResponse.json({ error: 'BILLING_NOT_CONFIGURED' }, { status: 503 });
  const appUrl = (process.env.APP_URL || new URL(req.url).origin).replace(/\/$/, '');
  try {
    const session = await createPortalSession(tenant.stripeCustomerId, `${appUrl}/billing`);
    return NextResponse.json({ url: session.url });
  } catch {
    return NextResponse.json({ error: 'STRIPE_UNAVAILABLE' }, { status: 503 });
  }
}
