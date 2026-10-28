import { NextResponse } from 'next/server';
import { z } from 'zod';
import { loadStore, saveStore, newId, compositionOf } from '@/lib/store';
import { dbConfigured, prisma } from '@/lib/db';
import { requireSession, isSessionResult, compositionDb } from '@/lib/authz';
import { entitlementGate, graceRestrictionActive } from '@/lib/billing';
import { ensureGraceRestriction } from '@/lib/grace';
import { checkRequestRate } from '@/lib/rate-limit';
import { compositionReport } from '@/lib/composition';
export const dynamic = 'force-dynamic';
const createSchema = z.object({ name: z.string().min(1).max(200), purpose: z.enum(['training', 'simulation']).default('training'), sourceName: z.string().max(200).default(''), sourceLicense: z.string().max(500).default('') });
export async function GET(req: Request) {
  if (dbConfigured()) {
    const s = await requireSession(req);
    if (!isSessionResult(s)) return s.response;
    // Request rate (B2, PROPOSED values): after 401, before DB work.
    if (checkRequestRate(req, s.user.tenantId).limited) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
    const db = prisma();
    // Explicit read gate: entitlementGate('read') currently allows every
    // status (including canceled/unpaid/paused), so this changes no
    // behaviour today — but the gate is now consulted on the read path, so
    // a future read restriction takes effect without a route change.
    const tenant = await db.tenant.findUnique({ where: { id: s.user.tenantId } });
    if (!tenant) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    const readGate = entitlementGate(tenant.subscriptionStatus as string, 'read');
    if (!readGate.allowed) return NextResponse.json({ error: readGate.code, status: tenant.subscriptionStatus }, { status: 402 });
    const datasets = await db.dataset.findMany({ where: { tenantId: s.user.tenantId }, orderBy: { createdAt: 'desc' } });
    const out = [];
    for (const d of datasets) {
      const comp = await compositionDb(d.id);
      out.push({ ...d, composition: comp, compositionReport: compositionReport(comp) });
    }
    return NextResponse.json(out);
  }
  const s = loadStore();
  return NextResponse.json(s.datasets.map((d) => ({ ...d, composition: compositionOf(s, d.id) })));
}
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_REQUEST', details: parsed.error.flatten() }, { status: 400 });
  if (dbConfigured()) {
    const s = await requireSession(req);
    if (!isSessionResult(s)) return s.response;
    const db = prisma();
    const tenant = await db.tenant.findUnique({ where: { id: s.user.tenantId } });
    if (!tenant) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    const gate = entitlementGate(tenant.subscriptionStatus as string, 'create_dataset');
    if (!gate.allowed) return NextResponse.json({ error: gate.code, status: tenant.subscriptionStatus }, { status: 402 });
    // Grace-expired restriction (B13): an active tenant under grace expiry
    // is read-only until authoritative reconciliation succeeds; dataset
    // creation is new work and is blocked like ingest/augment/export.
    const graceTenant = await ensureGraceRestriction(db, tenant);
    if (graceRestrictionActive(graceTenant)) return NextResponse.json({ error: 'ENTITLEMENT_REQUIRED', status: tenant.subscriptionStatus, restriction: 'GRACE_EXPIRED_UNVERIFIED' }, { status: 402 });
    // Request rate (B2, PROPOSED values): 401 → 404 → 402 → 429 order.
    if (checkRequestRate(req, s.user.tenantId).limited) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
    const ds = await db.dataset.create({ data: { tenantId: s.user.tenantId, name: parsed.data.name, purpose: parsed.data.purpose, sourceName: parsed.data.sourceName, sourceLicense: parsed.data.sourceLicense, sourceChecksum: '' } });
    return NextResponse.json(ds, { status: 201 });
  }
  const s = loadStore();
  const ds = { id: newId('ds'), name: parsed.data.name, purpose: parsed.data.purpose, tenant: 'demo-tenant', createdAt: new Date().toISOString(), sourceName: parsed.data.sourceName, sourceLicense: parsed.data.sourceLicense, sourceChecksum: '' };
  s.datasets.push(ds); saveStore(s);
  return NextResponse.json(ds, { status: 201 });
}
