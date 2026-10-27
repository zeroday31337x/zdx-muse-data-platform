import { NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'node:crypto';
import { loadStore, datasetRecords, compositionOf } from '@/lib/store';
import { compositionReport } from '@/lib/composition';
import { safeCell } from '@/lib/ingest';
export const dynamic = 'force-dynamic';
const schema = z.object({ format: z.enum(['jsonl', 'csv']).default('jsonl') });
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  const s = loadStore();
  const ds = s.datasets.find((d) => d.id === id);
  if (!ds) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const recs = datasetRecords(s, id);
  const comp = compositionOf(s, id);
  const report = compositionReport(comp);
  if (ds.purpose === 'training' && !report.strictOk) {
    return NextResponse.json({ error: 'EXPORT_BLOCKED_NONCOMPLIANT', composition: comp, report, message: 'Training export blocked: final dataset must be >=70% verified authentic and <=30% synthetic, with unknown = 0. Remove synthetic records, add verified authentic records, or export as simulation.' }, { status: 409 });
  }
  const manifest = {
    dataset: ds, composition: comp, compositionReport: report,
    label: ds.purpose === 'simulation' ? '100% synthetic simulation / test fixture — NOT compliant training data' : 'Training-ready export, 70/30 governed',
    caveat: 'The 30% ceiling is a product governance policy, not a guarantee against model collapse.',
    recordCount: recs.length, exportedAt: new Date().toISOString(),
    checksum: crypto.createHash('sha256').update(JSON.stringify(recs.map((r) => r.data))).digest('hex'),
  };
  let content: string; let contentType: string;
  if (parsed.data.format === 'csv') {
    const fields = [...new Set(recs.flatMap((r) => Object.keys(r.data)))];
    const lines = [fields.join(',')];
    for (const r of recs) lines.push(fields.map((f) => { const v = String(r.data[f] ?? ''); const esc = safeCell(v).replace(/"/g, '""'); return `"${esc}"`; }).join(','));
    content = lines.join('\n'); contentType = 'text/csv';
  } else {
    content = recs.map((r) => JSON.stringify({ ...r.data, _provenance: r.provenance, _sourceId: r.sourceId })).join('\n'); contentType = 'application/x-ndjson';
  }
  return new NextResponse(JSON.stringify({ manifest, content }), { headers: { 'Content-Type': 'application/json', 'X-Export-Format': parsed.data.format, 'X-Content-Type': contentType } });
}
