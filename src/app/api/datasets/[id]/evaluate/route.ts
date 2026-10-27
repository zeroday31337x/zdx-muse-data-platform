import { NextResponse } from 'next/server';
import { loadStore, datasetRecords, compositionOf } from '@/lib/store';
import { evaluateRecords } from '@/lib/meta-workflows';
import { compositionReport } from '@/lib/composition';
export const dynamic = 'force-dynamic';
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const s = loadStore();
  if (!s.datasets.find((d) => d.id === id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const recs = datasetRecords(s, id);
  const result = await evaluateRecords(recs.map((r) => r.data), 'public');
  const comp = compositionOf(s, id);
  return NextResponse.json({ datasetId: id, evaluation: result, composition: comp, compositionReport: compositionReport(comp), caveat: 'The 30% ceiling is a governance policy, not a guarantee against model collapse.' });
}
