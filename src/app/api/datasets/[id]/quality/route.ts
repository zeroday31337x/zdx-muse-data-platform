import { NextResponse } from 'next/server';
import { loadStore, datasetRecords, compositionOf } from '@/lib/store';
import { qualityReport } from '@/lib/quality';
import { compositionReport } from '@/lib/composition';
export const dynamic = 'force-dynamic';
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const s = loadStore();
  if (!s.datasets.find((d) => d.id === id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const recs = datasetRecords(s, id);
  const comp = compositionOf(s, id);
  return NextResponse.json({ quality: qualityReport(recs.map((r) => r.data)), composition: comp, compositionReport: compositionReport(comp), note: 'Quality is deterministic. Model judge scores are not claimed.' });
}
