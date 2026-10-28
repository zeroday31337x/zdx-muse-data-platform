/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'node:crypto';
import { compositionReport } from '@/lib/composition';
import { safeCell } from '@/lib/ingest';
import { dbConfigured, prisma } from '@/lib/db';
import { requireSession, isSessionResult, datasetForTenant, compositionDb } from '@/lib/authz';
import { entitlementGate, graceRestrictionActive } from '@/lib/billing';
import { ensureGraceRestriction } from '@/lib/grace';
import { claimUnpaidExportAuthorization, completeUnpaidExportAuthorization, releaseUnpaidExportAuthorization } from '@/lib/unpaid-export';
import { checkRequestRate } from '@/lib/rate-limit';
export const dynamic = 'force-dynamic';

/** Subset composition over already-loaded records, mirroring compositionDb categories exactly. */
function subsetComposition(recs: any[]): { authentic: number; synthetic: number; unknown: number; total: number; authenticTokens: number; syntheticTokens: number } {
  let authentic = 0; let synthetic = 0; let unknown = 0; let derived = 0; let authenticTokens = 0; let syntheticTokens = 0;
  for (const r of recs) {
    if (r.provenance === 'AUTHENTIC_VERIFIED') { authentic++; authenticTokens += r.tokens ?? 0; }
    else if (r.provenance === 'SYNTHETIC' || r.provenance === 'AI_AUGMENTED') { synthetic++; syntheticTokens += r.tokens ?? 0; }
    else if (r.provenance === 'UNKNOWN' || r.provenance === 'AUTHENTIC_UNVERIFIED') unknown++;
    else if (r.provenance === 'DERIVED_SOURCE_PRESERVING') derived++;
    else unknown++;
  }
  return { authentic, synthetic, unknown, total: authentic + synthetic + unknown + derived, authenticTokens, syntheticTokens };
}
const schema = z.object({ format: z.enum(['jsonl', 'csv']).default('jsonl') });
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  if (dbConfigured()) {
    const s = await requireSession(req);
    if (!isSessionResult(s)) return s.response;
    const ds = await datasetForTenant(id, s.user.tenantId);
    if (!ds) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    const db = prisma();
    let tenant = await db.tenant.findUnique({ where: { id: s.user.tenantId } });
    if (!tenant) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    const gate = entitlementGate(tenant.subscriptionStatus as string, 'export');
    if (!gate.allowed) return NextResponse.json({ error: gate.code, status: tenant.subscriptionStatus }, { status: 402 });
    // Grace-expired restriction blocks export for every status: the
    // tenant is read-only until authoritative reconciliation succeeds.
    // (Lazy expiry enforcement remains; the app-side reconciliation
    // retry schedule now runs on worker ticks — see
    // src/lib/reconciliation-retry.ts — it does not replace this check.)
    tenant = await ensureGraceRestriction(db, tenant);
    if (graceRestrictionActive(tenant)) {
      return NextResponse.json({ error: 'ENTITLEMENT_REQUIRED', status: tenant.subscriptionStatus, restriction: 'GRACE_EXPIRED_UNVERIFIED' }, { status: 402 });
    }
    // Request rate (B2, PROPOSED values): 401 → 404 → 402 → 429 order.
    if (checkRequestRate(req, s.user.tenantId).limited) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
    // Unpaid export-out (contract §11.9(a) / B10): exactly ONE export
    // over the pre-transition snapshot. The claim is atomic (FOR
    // UPDATE inside a transaction); the snapshot boundary is enforced
    // at the QUERY level (createdAt <= boundaryAt), and 70/30 is
    // computed on the eligible subset only — never on the full dataset.
    let exportOutClaim: { id: string; claimToken: string; boundaryAt: Date } | null = null;
    if (tenant.subscriptionStatus === 'unpaid') {
      exportOutClaim = await db.$transaction(async (tx: any) => claimUnpaidExportAuthorization(tx, tenant.id));
      if (!exportOutClaim) {
        const inProgress = await db.unpaidExportAuthorization.findFirst({ where: { tenantId: tenant.id, status: 'CLAIMED' } });
        return NextResponse.json({ error: 'ENTITLEMENT_REQUIRED', status: 'unpaid', exportOut: inProgress ? 'claimed' : 'consumed' }, { status: 402 });
      }
    }
    let recs: any[];
    let comp: { authentic: number; synthetic: number; unknown: number; total: number; authenticTokens: number; syntheticTokens: number };
    try {
      if (exportOutClaim) {
        recs = await db.record.findMany({ where: { datasetId: id, createdAt: { lte: exportOutClaim.boundaryAt } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
        comp = subsetComposition(recs);
      } else {
        recs = await db.record.findMany({ where: { datasetId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
        comp = await compositionDb(id);
      }
    } catch (e) {
      if (exportOutClaim) {
        await db.$transaction(async (tx: any) => {
          await releaseUnpaidExportAuthorization(tx, exportOutClaim.id, exportOutClaim.claimToken);
          await tx.auditLog.create({ data: { tenantId: tenant.id, actor: `user:${s.user.id}`, action: 'UNPAID_EXPORT_FAILED', entity: `UnpaidExportAuthorization:${exportOutClaim.id}`, details: { reason: 'record-load-failed' } } });
        });
      }
      throw e;
    }
    const report = compositionReport(comp);
    if (ds.purpose === 'training' && !report.strictOk) {
      // A blocked training export is NOT a successful export-out: the
      // claim is released so the tenant's one export is not consumed
      // by a refusal (70/30 refusal is not a delivery).
      if (exportOutClaim) {
        await db.$transaction(async (tx: any) => {
          await releaseUnpaidExportAuthorization(tx, exportOutClaim.id, exportOutClaim.claimToken);
          await tx.auditLog.create({ data: { tenantId: tenant.id, actor: `user:${s.user.id}`, action: 'UNPAID_EXPORT_FAILED', entity: `UnpaidExportAuthorization:${exportOutClaim.id}`, details: { reason: 'training-export-blocked-noncompliant' } } });
        });
      }
      return NextResponse.json({ error: 'EXPORT_BLOCKED_NONCOMPLIANT', composition: comp, report, message: 'Training export blocked: final dataset must be >=70% verified authentic and <=30% synthetic, with unknown = 0. Remove synthetic records, add verified authentic records, or export as simulation.' }, { status: 409 });
    }
    const manifest = {
      dataset: ds, composition: comp, compositionReport: report,
      exportScope: gate.existingOnly ? 'existing_only' : 'full',
      exportOut: exportOutClaim ? { authorizationId: exportOutClaim.id, boundaryAt: exportOutClaim.boundaryAt.toISOString() } : undefined,
      label: ds.purpose === 'simulation' ? '100% synthetic simulation / test fixture — NOT compliant training data' : 'Training-ready export, 70/30 governed',
      caveat: 'The 30% ceiling is a product governance policy, not a guarantee against model collapse.',
      recordCount: recs.length, exportedAt: new Date().toISOString(),
      checksum: crypto.createHash('sha256').update(JSON.stringify(recs.map((r: any) => r.data))).digest('hex'),
    };
    let content: string; let contentType: string;
    if (parsed.data.format === 'csv') {
      const fields: string[] = [...new Set<string>(recs.flatMap((r: any): string[] => Object.keys(r.data as Record<string, unknown>)))];
      const lines = [fields.join(',')];
      for (const r of recs as any[]) { const d = r.data as Record<string, unknown>; lines.push(fields.map((f: string) => { const v = String(d[f] ?? ''); const esc = safeCell(v).replace(/"/g, '""'); return `"${esc}"`; }).join(',')); }
      content = lines.join('\n'); contentType = 'text/csv';
    } else {
      content = recs.map((r: any) => JSON.stringify({ ...(r.data as Record<string, unknown>), _provenance: r.provenance, _sourceId: r.sourceId })).join('\n'); contentType = 'application/x-ndjson';
    }
    // Delivery point: completing the authorization marks the one
    // export-out as used. Completion happens BEFORE the response is
    // returned, so a completed authorization always corresponds to a
    // generated export; a transport failure after this point is
    // conservatively counted as delivery (the strict one-successful-
    // export reading). If completion itself fails, the claim is
    // released so a retry remains possible.
    if (exportOutClaim) {
      const completed = await db.$transaction(async (tx: any) => {
        const ok = await completeUnpaidExportAuthorization(tx, exportOutClaim.id, exportOutClaim.claimToken);
        if (ok) {
          await tx.auditLog.create({ data: { tenantId: tenant.id, actor: `user:${s.user.id}`, action: 'UNPAID_EXPORT_COMPLETED', entity: `UnpaidExportAuthorization:${exportOutClaim.id}`, details: { datasetId: id, format: parsed.data.format, recordCount: recs.length, boundaryAt: exportOutClaim.boundaryAt.toISOString() } } });
        }
        return ok;
      });
      if (!completed) {
        await db.$transaction(async (tx: any) => releaseUnpaidExportAuthorization(tx, exportOutClaim.id, exportOutClaim.claimToken));
        return NextResponse.json({ error: 'EXPORT_FAILED', message: 'Export-out completion failed; the export was not consumed. Retry.' }, { status: 500 });
      }
    }
    return new NextResponse(JSON.stringify({ manifest, content }), { headers: { 'Content-Type': 'application/json', 'X-Export-Format': parsed.data.format, 'X-Content-Type': contentType } });
  }
  // Demo mode has no DB: per the shared contract (item 9), export without
  // a DB yields 503, not a demo-file export. Demo data must never be
  // presented as an entitled export.
  return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED', note: 'Export requires the PostgreSQL store; demo-file export is not an entitled export.' }, { status: 503 });
}
