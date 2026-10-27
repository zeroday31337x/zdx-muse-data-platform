/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { loadStore, datasetRecords, compositionOf } from '@/lib/store';
import { qualityReport } from '@/lib/quality';
import { compositionReport } from '@/lib/composition';
import { dbConfigured, prisma } from '@/lib/db';
import { requireSession, isSessionResult, datasetForTenant, compositionDb } from '@/lib/authz';
export const dynamic = 'force-dynamic';
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (dbConfigured()) {
    const s = await requireSession(req);
    if (!isSessionResult(s)) return s.response;
    const ds = await datasetForTenant(id, s.user.tenantId);
    if (!ds) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    const db = prisma();
    const recs = await db.record.findMany({ where: { datasetId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const comp = await compositionDb(id);
    return NextResponse.json({ quality: qualityReport(recs.map((r: any) => r.data as Record<string, unknown>)), composition: comp, compositionReport: compositionReport(comp), note: 'Quality is deterministic. Model judge scores are not claimed.' });
  }
  const s = loadStore();
  if (!s.datasets.find((d) => d.id === id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const recs = datasetRecords(s, id);
  const comp = compositionOf(s, id);
  return NextResponse.json({ quality: qualityReport(recs.map((r: any) => r.data)), composition: comp, compositionReport: compositionReport(comp), note: 'Quality is deterministic. Model judge scores are not claimed.' });
}
