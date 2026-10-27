import { NextResponse } from 'next/server';
import { z } from 'zod';
import { loadStore, saveStore, newId, compositionOf } from '@/lib/store';
import { dbConfigured, prisma } from '@/lib/db';
import { requireSession, isSessionResult, compositionDb } from '@/lib/authz';
import { compositionReport } from '@/lib/composition';
export const dynamic = 'force-dynamic';
const createSchema = z.object({ name: z.string().min(1).max(200), purpose: z.enum(['training', 'simulation']).default('training'), sourceName: z.string().max(200).default(''), sourceLicense: z.string().max(500).default('') });
export async function GET(req: Request) {
  if (dbConfigured()) {
    const s = await requireSession(req);
    if (!isSessionResult(s)) return s.response;
    const db = prisma();
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
    const ds = await db.dataset.create({ data: { tenantId: s.user.tenantId, name: parsed.data.name, purpose: parsed.data.purpose, sourceName: parsed.data.sourceName, sourceLicense: parsed.data.sourceLicense, sourceChecksum: '' } });
    return NextResponse.json(ds, { status: 201 });
  }
  const s = loadStore();
  const ds = { id: newId('ds'), name: parsed.data.name, purpose: parsed.data.purpose, tenant: 'demo-tenant', createdAt: new Date().toISOString(), sourceName: parsed.data.sourceName, sourceLicense: parsed.data.sourceLicense, sourceChecksum: '' };
  s.datasets.push(ds); saveStore(s);
  return NextResponse.json(ds, { status: 201 });
}
