import { NextResponse } from 'next/server';
import { loadStore, compositionOf } from '@/lib/store';
import { compositionReport } from '@/lib/composition';
export const dynamic = 'force-dynamic';
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const s = loadStore();
  const ds = s.datasets.find((d) => d.id === id);
  if (!ds) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const comp = compositionOf(s, id);
  return NextResponse.json({ ...ds, composition: comp, compositionReport: compositionReport(comp) });
}
