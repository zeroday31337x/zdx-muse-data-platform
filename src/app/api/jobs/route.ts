import { NextResponse } from 'next/server';
import { loadStore } from '@/lib/store';
import { dbConfigured, prisma } from '@/lib/db';
import { requireSession, isSessionResult } from '@/lib/authz';
import { entitlementGate } from '@/lib/billing';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  if (dbConfigured()) {
    const s = await requireSession(req);
    if (!isSessionResult(s)) return s.response;
    const db = prisma();
    // Explicit read gate (see datasets list route for the rationale).
    const tenant = await db.tenant.findUnique({ where: { id: s.user.tenantId } });
    if (!tenant) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    const readGate = entitlementGate(tenant.subscriptionStatus as string, 'read');
    if (!readGate.allowed) return NextResponse.json({ error: readGate.code, status: tenant.subscriptionStatus }, { status: 402 });
    const jobs = await db.job.findMany({ where: { tenantId: s.user.tenantId }, orderBy: { createdAt: 'desc' }, take: 50 });
    return NextResponse.json(jobs);
  }
  const s = loadStore(); return NextResponse.json(s.jobs.slice(-50).reverse());
}
