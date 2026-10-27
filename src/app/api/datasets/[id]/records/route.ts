import { NextResponse } from 'next/server';
import { loadStore, datasetRecords } from '@/lib/store';
export const dynamic = 'force-dynamic';
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 20)));
  const cursor = url.searchParams.get('cursor');
  const s = loadStore();
  const recs = datasetRecords(s, id);
  let start = 0;
  if (cursor) { const idx = recs.findIndex((r) => r.id === cursor); start = idx >= 0 ? idx + 1 : 0; }
  const page = recs.slice(start, start + limit);
  const nextCursor = start + limit < recs.length ? page[page.length - 1]?.id ?? null : null;
  return NextResponse.json({ total: recs.length, records: page, nextCursor });
}
