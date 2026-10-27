import { NextResponse } from 'next/server';
import { loadStore, datasetRecords } from '@/lib/store';
import { dbConfigured, prisma } from '@/lib/db';
import { requireSession, isSessionResult, datasetForTenant } from '@/lib/authz';
export const dynamic = 'force-dynamic';
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 20)));
  if (dbConfigured()) {
    const s = await requireSession(req);
    if (!isSessionResult(s)) return s.response;
    const ds = await datasetForTenant(id, s.user.tenantId);
    if (!ds) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    const db = prisma();
    const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0);
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
