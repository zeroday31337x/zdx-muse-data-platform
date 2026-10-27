/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { loadStore, datasetRecords } from '@/lib/store';
import { inferSchema } from '@/lib/meta-workflows';
import { prisma, dbConfigured } from '@/lib/db';
import { requireSession, isSessionResult, datasetForTenant } from '@/lib/authz';
export const dynamic = 'force-dynamic';
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (dbConfigured()) {
    const s = await requireSession(req);
    if (!isSessionResult(s)) return s.response;
    const ds = await datasetForTenant(id, s.user.tenantId);
    if (!ds) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    const db = prisma();
    const recs = await db.record.findMany({ where: { datasetId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 1000 });
    const result = await inferSchema(recs.map((r: any) => r.data as Record<string, unknown>), 'public');
    try { await db.schemaProposal.create({ data: { datasetId: id, fields: result.fields, model: result.model } }); } catch { /* proposal persistence is secondary to the result */ }
    return NextResponse.json({ datasetId: id, ...result, reviewRequired: true, note: `${result.note} Schema proposals require human review before use.` });
  }
  const s = loadStore();
  const ds = s.datasets.find((d) => d.id === id);
  if (!ds) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const recs = datasetRecords(s, id).map((r) => r.data);
  const result = await inferSchema(recs, 'public');
  return NextResponse.json({ datasetId: id, ...result, reviewRequired: true, note: `${result.note} Schema proposals require human review before use.` });
}
