import { NextResponse } from 'next/server';
import { loadStore, datasetRecords } from '@/lib/store';
import { inferSchema } from '@/lib/meta-workflows';
import { prisma, dbConfigured } from '@/lib/db';
export const dynamic = 'force-dynamic';
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const s = loadStore();
  const ds = s.datasets.find((d) => d.id === id);
  if (!ds && !dbConfigured()) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const recs = ds ? datasetRecords(s, id).map((r) => r.data) : [];
  const dataClass = ds ? 'public' : 'public';
  const result = await inferSchema(recs, dataClass);
  if (dbConfigured() && ds) {
    try {
      const db = prisma();
      const dbDs = await db.dataset.findFirst({ where: { id } });
      if (dbDs) await db.schemaProposal.create({ data: { datasetId: id, fields: result.fields, model: result.model } });
    } catch { /* proposal persistence is secondary to the result */ }
  }
  return NextResponse.json({ datasetId: id, ...result, reviewRequired: true, note: `${result.note} Schema proposals require human review before use.` });
}
