import { NextResponse } from 'next/server';
import { z } from 'zod';
import { loadStore, saveStore, newId, recordKeyFor, estimateTokens } from '@/lib/store';
import { parseCsv, parseJsonl, sha256, MAX_UPLOAD_BYTES } from '@/lib/ingest';
import { dbConfigured, prisma } from '@/lib/db';
import { requireSession, isSessionResult, datasetForTenant } from '@/lib/authz';
import { entitlementGate, checkIngestBatchSize, graceRestrictionActive } from '@/lib/billing';
import { ensureGraceRestriction } from '@/lib/grace';
import { recordCapForTenant } from '@/lib/tier-spec';
import { assertContentLength } from '@/lib/api-validation';
import { checkRequestRate } from '@/lib/rate-limit';
import { checkUploadBytes, enforceTotalUpload } from '@/lib/upload-quota';
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
  // Bounded request size before parsing: a declared Content-Length
  // over the upload cap is rejected with 413 FILE_TOO_LARGE without
  // loading the body (contract B4/B13).
  const tooLarge = assertContentLength(req, MAX_UPLOAD_BYTES + 4096);
  if (tooLarge) return NextResponse.json({ error: tooLarge }, { status: tooLarge === 'FILE_TOO_LARGE' ? 413 : 400 });
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_REQUEST', details: parsed.error.flatten() }, { status: 400 });
  // Actual-byte per-file check (B4): a declared Content-Length may be
  // absent (chunked bodies) and zod's string .max() counts characters,
  // not bytes — so the parsed text is measured in UTF-8 bytes here.
  const byteCheck = checkUploadBytes(parsed.data.text, MAX_UPLOAD_BYTES);
  if (!byteCheck.ok) return NextResponse.json({ error: byteCheck.code }, { status: 413 });
  if (dbConfigured()) {
    const s = await requireSession(req);
    if (!isSessionResult(s)) return s.response;
    const ds = await datasetForTenant(id, s.user.tenantId);
    if (!ds) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    const db = prisma();
    let tenant = await db.tenant.findUnique({ where: { id: s.user.tenantId } });
    if (!tenant) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    const gate = entitlementGate(tenant.subscriptionStatus as string, 'ingest');
    if (!gate.allowed) return NextResponse.json({ error: gate.code, status: tenant.subscriptionStatus }, { status: 402 });
    tenant = await ensureGraceRestriction(db, tenant);
    if (graceRestrictionActive(tenant)) {
      return NextResponse.json({ error: 'ENTITLEMENT_REQUIRED', status: tenant.subscriptionStatus, restriction: 'GRACE_EXPIRED_UNVERIFIED' }, { status: 402 });
    }
    const restricted = tenant.subscriptionStatus === 'restricted' || tenant.subscriptionStatus === 'incomplete' || tenant.subscriptionStatus === 'incomplete_expired';
    // Request rate (B2, PROPOSED values): 401 → 404 → 402 → 429 order.
    const rate = checkRequestRate(req, s.user.tenantId);
    if (rate.limited) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
    let rows: Record<string, unknown>[];
    try { rows = parseRows(parsed.data.format, parsed.data.text); } catch (e) { return NextResponse.json({ error: 'PARSE_ERROR', message: e instanceof Error ? e.message : 'parse failed' }, { status: 400 }); }
    if (rows.length === 0) return NextResponse.json({ error: 'EMPTY_SOURCE' }, { status: 400 });
    if (rows.length > 10000) return NextResponse.json({ error: 'TOO_MANY_ROWS', message: 'Ingest cap is 10,000 rows per API call; use a worker ingest job for larger sources.' }, { status: 400 });
    const batchCheck = checkIngestBatchSize(rows.length, restricted);
    if (!batchCheck.ok) return NextResponse.json({ error: batchCheck.code }, { status: 409 });
    // Record cap (tier spec, PROPOSED values): the tenant's total AFTER
    // this ingest must stay within the cap. The previous check compared
    // only the pre-ingest total to the cap, so a tenant just under the
    // cap could overshoot by up to one call. The restricted 5,000 is the
    // proposed safety value from the tier spec, not a finalized limit.
    // Duplicates count toward the cap: the check runs before dedup,
    // fail-closed (a re-ingest at the cap is rejected even if every row
    // would dedup to zero).
    const cap = recordCapForTenant(tenant);
    const existingCount = await db.record.count({ where: { dataset: { tenantId: s.user.tenantId } } });
    if (cap !== null && existingCount + rows.length > cap) {
      return NextResponse.json({ error: 'QUOTA_EXCEEDED', recordLimit: cap, recordLimitStatus: 'PROPOSED', existingCount, incoming: rows.length }, { status: 409 });
    }
    // Per-tenant TOTAL upload enforcement (B4, PROPOSED 50 MB for
    // restricted tenants). The hook reads Tenant.totalUploadBytes, added
    // to the schema by migration 20261028050000_upload_ledger (FILE ONLY,
    // UNAPPLIED): once applied, the hook reports enforced:true and the
    // 413 path below is live for totals. Until it is applied, the hook
    // reports enforced:false and ingest proceeds (rolling-deploy safety
    // net). The ledger is incremented after successful insert below, for
    // restricted tenants only. See src/lib/upload-quota.ts. No total is
    // invented for entitled tenants (the contract row specifies none).
    const totalUpload = enforceTotalUpload(tenant, byteCheck.bytes, restricted);
    if (totalUpload.enforced && !totalUpload.ok) return NextResponse.json({ error: totalUpload.code }, { status: 413 });
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
    // B4 ledger increment (restricted tenants only): record the actual
    // UTF-8 bytes just uploaded against the tenant total, so the
    // pre-insert check above enforces a real cumulative total once the
    // 20261028050000_upload_ledger migration is applied. Uploaded bytes
    // (byteCheck.bytes), not stored bytes: re-uploaded duplicate rows
    // count again, because the row is a total of uploads. Post-insert,
    // not same-transaction: this route's chunked inserts are not wrapped
    // in a transaction today, so a crash between insert and increment can
    // under-count (fail-open for quota, never a false reject), and
    // concurrent ingests can each pass the pre-insert check and overshoot
    // the total. Both are recorded for the staging DB-concurrency
    // validation; the check itself rejects (413) before any write once
    // the migration is applied. If this update throws, the ingest fails
    // (fail closed); a client retry re-inserts 0 rows (skipDuplicates)
    // and increments once. Entitled tenants have no total in the contract
    // row, so their uploads are not accumulated.
    if (restricted) {
      await db.tenant.update({ where: { id: s.user.tenantId }, data: { totalUploadBytes: { increment: byteCheck.bytes } } });
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
