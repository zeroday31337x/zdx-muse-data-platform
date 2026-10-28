import { NextResponse } from 'next/server';
import { loadStore, compositionOf } from '@/lib/store';
import { compositionReport } from '@/lib/composition';
import { dbConfigured, prisma } from '@/lib/db';
import { requireSession, isSessionResult, datasetForTenant, compositionDb } from '@/lib/authz';
import { entitlementGate } from '@/lib/billing';
export const dynamic = 'force-dynamic';
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (dbConfigured()) {
    const s = await requireSession(req);
    if (!isSessionResult(s)) return s.response;
    const ds = await datasetForTenant(id, s.user.tenantId);
    if (!ds) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    // Explicit read gate (see datasets list route for the rationale).
    const db = prisma();
    const tenant = await db.tenant.findUnique({ where: { id: s.user.tenantId } });
    if (!tenant) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    const readGate = entitlementGate(tenant.subscriptionStatus as string, 'read');
    if (!readGate.allowed) return NextResponse.json({ error: readGate.code, status: tenant.subscriptionStatus }, { status: 402 });
    const comp = await compositionDb(id);
    return NextResponse.json({ ...ds, composition: comp, compositionReport: compositionReport(comp) });
  }
  const s = loadStore();
  const ds = s.datasets.find((d) => d.id === id);
  if (!ds) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const comp = compositionOf(s, id);
  return NextResponse.json({ ...ds, composition: comp, compositionReport: compositionReport(comp) });
}
