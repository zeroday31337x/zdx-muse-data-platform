import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSession, isSessionResult, jobForTenant } from '@/lib/authz';
import { entitlementGate, graceRestrictionActive } from '@/lib/billing';
import { ensureGraceRestriction } from '@/lib/grace';
import { requestResume } from '@/lib/worker';
export const dynamic = 'force-dynamic';
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireSession(req);
  if (!isSessionResult(s)) return s.response;
  const { id } = await ctx.params;
  const job = await jobForTenant(id, s.user.tenantId);
  if (!job) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  // Resume restarts work: it is gated as new work (denied for
  // canceled/unpaid/paused tenants and under grace expiry), like ingest.
  // Pause/cancel stay owner-allowed: they only reduce work. (A resumed
  // job is still revalidated at worker claim time.)
  const db = prisma();
  const tenant = await db.tenant.findUnique({ where: { id: s.user.tenantId } });
  if (!tenant) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const gate = entitlementGate(tenant.subscriptionStatus as string, 'worker_ingest');
  if (!gate.allowed) return NextResponse.json({ error: gate.code, status: tenant.subscriptionStatus }, { status: 402 });
  const graceTenant = await ensureGraceRestriction(db, tenant);
  if (graceRestrictionActive(graceTenant)) return NextResponse.json({ error: 'ENTITLEMENT_REQUIRED', status: tenant.subscriptionStatus, restriction: 'GRACE_EXPIRED_UNVERIFIED' }, { status: 402 });
  const r = await requestResume(id, s.user.tenantId);
  if (!r.ok && r.error === 'NOT_FOUND') return NextResponse.json(r, { status: 404 });
  return NextResponse.json(r, { status: r.ok ? 200 : 409 });
}
