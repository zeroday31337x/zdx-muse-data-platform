import { NextResponse } from 'next/server';
import { loadStore, datasetRecords } from '@/lib/store';
import { parsePagination } from '@/lib/api-validation';
import { dbConfigured, prisma } from '@/lib/db';
import { requireSession, isSessionResult, datasetForTenant } from '@/lib/authz';
import { entitlementGate } from '@/lib/billing';
export const dynamic = 'force-dynamic';
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  // Old code: Number('abc') => NaN propagated into Prisma take/skip
  // and failed with a 500. parsePagination clamps and defaults safely.
  const { limit, offset } = parsePagination(url.searchParams);
  if (dbConfigured()) {
    const s = await requireSession(req);
    if (!isSessionResult(s)) return s.response;
    const ds = await datasetForTenant(id, s.user.tenantId);
    if (!ds) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    const db = prisma();
    // Explicit read gate (see datasets list route for the rationale).
    const tenant = await db.tenant.findUnique({ where: { id: s.user.tenantId } });
    if (!tenant) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    const readGate = entitlementGate(tenant.subscriptionStatus as string, 'read');
    if (!readGate.allowed) return NextResponse.json({ error: readGate.code, status: tenant.subscriptionStatus }, { status: 402 });
    const total = await db.record.count({ where: { datasetId: id } });
    const records = await db.record.findMany({ where: { datasetId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: limit, skip: offset });
    return NextResponse.json({ total, records, nextOffset: offset + limit < total ? offset + limit : null });
  }
  const cursor = url.searchParams.get('cursor');
  const s = loadStore();
  const recs = datasetRecords(s, id);
  let start = 0;
  if (cursor) { const idx = recs.findIndex((r) => r.id === cursor); start = idx >= 0 ? idx + 1 : 0; }
  const page = recs.slice(start, start + limit);
  const nextCursor = start + limit < recs.length ? page[page.length - 1]?.id ?? null : null;
  return NextResponse.json({ total: recs.length, records: page, nextCursor });
}
