import { NextResponse } from 'next/server';
import { z } from 'zod';
import { loadStore, saveStore, newId, recordKeyFor, estimateTokens } from '@/lib/store';
import { parseCsv, parseJsonl, sha256, MAX_UPLOAD_BYTES } from '@/lib/ingest';
import { dbConfigured, prisma } from '@/lib/db';
import { requireSession, isSessionResult, datasetForTenant } from '@/lib/authz';
export const dynamic = 'force-dynamic';
const schema = z.object({
  format: z.enum(['csv', 'json', 'jsonl']),
  text: z.string().min(1).max(MAX_UPLOAD_BYTES),
  provenance: z.enum(['AUTHENTIC_VERIFIED', 'AUTHENTIC_UNVERIFIED', 'SYNTHETIC', 'UNKNOWN']).default('AUTHENTIC_UNVERIFIED'),
  sourceName: z.string().max(200).default(''),
  sourceLicense: z.string().max(500).default(''),
  sourceFamilyId: z.string().max(100).optional(),
});
function parseRows(format: string, text: string) {
  if (format === 'csv') return parseCsv(text);
  if (format === 'jsonl') return parseJsonl(text);
  const j = JSON.parse(text); if (!Array.isArray(j)) throw new Error('JSON must be an array'); return j as Record<string, unknown>[];
}
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_REQUEST', details: parsed.error.flatten() }, { status: 400 });
  if (dbConfigured()) {
    const s = await requireSession(req);
    if (!isSessionResult(s)) return s.response;
    const ds = await datasetForTenant(id, s.user.tenantId);
    if (!ds) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    let rows: Record<string, unknown>[];
    try { rows = parseRows(parsed.data.format, parsed.data.text); } catch (e) { return NextResponse.json({ error: 'PARSE_ERROR', message: e instanceof Error ? e.message : 'parse failed' }, { status: 400 }); }
    if (rows.length === 0) return NextResponse.json({ error: 'EMPTY_SOURCE' }, { status: 400 });
    if (rows.length > 10000) return NextResponse.json({ error: 'TOO_MANY_ROWS', message: 'Ingest cap is 10,000 rows per API call; use a worker ingest job for larger sources.' }, { status: 400 });
    const db = prisma();
    const checksum = sha256(parsed.data.text);
    const sourceId = checksum.slice(0, 16);
    let inserted = 0;
    // Chunked createMany with skipDuplicates: unique (datasetId, recordKey)
    // makes re-ingest idempotent, and committed counts only new rows.
    for (let off = 0; off < rows.length; off += 1000) {
      const chunk = rows.slice(off, off + 1000).map((row, i) => ({
        datasetId: id, recordKey: recordKeyFor(id, row, off + i), data: row,
        provenance: parsed.data.provenance as never, sourceId, sourceFamilyId: parsed.data.sourceFamilyId ?? null, tokens: estimateTokens(row),
      }));
      const r = await db.record.createMany({ data: chunk, skipDuplicates: true });
      inserted += r.count;
    }
    await db.dataset.update({ where: { id }, data: { sourceChecksum: checksum, ...(parsed.data.sourceName ? { sourceName: parsed.data.sourceName } : {}), ...(parsed.data.sourceLicense ? { sourceLicense: parsed.data.sourceLicense } : {}) } });
    const job = await db.job.create({ data: { datasetId: id, tenantId: s.user.tenantId, kind: 'ingest', status: 'COMPLETED', total: rows.length, committed: inserted } });
    return NextResponse.json({ datasetId: id, jobId: job.id, committed: inserted, skippedDuplicates: rows.length - inserted, total: rows.length, checksum });
  }
  const s = loadStore();
  const ds = s.datasets.find((d) => d.id === id);
  if (!ds) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  let rows: Record<string, unknown>[] = [];
  try { rows = parseRows(parsed.data.format, parsed.data.text); } catch (e) { return NextResponse.json({ error: 'PARSE_ERROR', message: e instanceof Error ? e.message : 'parse failed' }, { status: 400 }); }
  if (rows.length === 0) return NextResponse.json({ error: 'EMPTY_SOURCE' }, { status: 400 });
  if (rows.length > 10000) return NextResponse.json({ error: 'TOO_MANY_ROWS', message: 'Demo ingest cap is 10,000 rows per call' }, { status: 400 });
  const job = { id: newId('job'), datasetId: id, kind: 'ingest', status: 'COMPLETED', committed: 0, total: rows.length, error: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  s.jobs.push(job);
  let committed = 0; let skippedDuplicates = 0;
  const checksum = sha256(parsed.data.text);
  ds.sourceChecksum = checksum;
  if (parsed.data.sourceName) ds.sourceName = parsed.data.sourceName;
  if (parsed.data.sourceLicense) ds.sourceLicense = parsed.data.sourceLicense;
  for (const row of rows) {
    const key = recordKeyFor(id, row, committed);
    if (s.records.some((r) => r.datasetId === id && r.recordKey === key)) { skippedDuplicates++; continue; }
    s.records.push({ id: newId('rec'), datasetId: id, recordKey: key, data: row, provenance: parsed.data.provenance, sourceId: checksum.slice(0, 16), sourceFamilyId: parsed.data.sourceFamilyId ?? null, tokens: estimateTokens(row), createdAt: new Date().toISOString() });
    committed++;
  }
  job.committed = committed; job.updatedAt = new Date().toISOString();
  saveStore(s);
  return NextResponse.json({ datasetId: id, jobId: job.id, committed, skippedDuplicates, total: rows.length, checksum });
}
