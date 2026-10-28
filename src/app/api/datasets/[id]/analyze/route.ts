/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { loadStore, datasetRecords, compositionOf } from '@/lib/store';
import { callMetaChat, metaConfigured } from '@/lib/meta';
import { qualityReport } from '@/lib/quality';
import { dbConfigured, prisma } from '@/lib/db';
import { requireSession, isSessionResult, datasetForTenant, compositionDb } from '@/lib/authz';
import { checkRequestRate } from '@/lib/rate-limit';
import { resolveMetaCall } from '@/lib/meta-gate';
import { hardCeilingStatus } from '@/lib/tier-allowlist';
import { allowanceCapForTenant, estimateMaxCostForPrompt, reserveSpend, confirmSpendReservation, pendingSpendReservation, releaseSpendReservation, META_CALL_MAX_OUTPUT_TOKENS } from '@/lib/spend';
export const dynamic = 'force-dynamic';
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (dbConfigured()) {
    const s = await requireSession(req);
    if (!isSessionResult(s)) return s.response;
    const ds = await datasetForTenant(id, s.user.tenantId);
    if (!ds) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    const db = prisma();
    const tenant = await db.tenant.findUnique({ where: { id: s.user.tenantId } });
    if (!tenant) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    // Request rate (B2, PROPOSED values): 401 → 404 → 429 order (the
    // model-tier gate below returns deterministic results on rejection
    // rather than a 402, so the rate check sits before it).
    if (checkRequestRate(req, s.user.tenantId).limited) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
    const recs = await db.record.findMany({ where: { datasetId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const dataRows = recs.map((r: any) => r.data as Record<string, unknown>);
    const comp = await compositionDb(id);
    const q = qualityReport(dataRows);
    const fields = new Set<string>(); dataRows.forEach((r: Record<string, unknown>) => Object.keys(r).forEach((k: string) => fields.add(k)));
    const deterministic = {
      source: 'deterministic',
      recordCount: recs.length,
      fields: [...fields],
      composition: comp,
      quality: q,
      summary: recs.length === 0 ? 'No records yet.' : `Dataset has ${recs.length} records across ${fields.size} fields. Completeness ${(q.completeness * 100).toFixed(1)}%, uniqueness ${(q.uniqueness * 100).toFixed(1)}%.`,
    };
    const dataClass = comp.unknown > 0 || comp.synthetic > 0 ? 'private' : 'public';
    // Model-tier gate (revised §3.2): entitlement, data class, tier
    // allowlist, Contributor eligibility/consent, price, budget — in
    // that order. A rejection returns a deterministic result; it NEVER
    // substitutes a different model.
    const gate = await resolveMetaCall(db, { tenant, datasetId: id, dataClass });
    if (!gate.resolution.ok) {
      return NextResponse.json({ ...deterministic, meta: null, metaGate: gate.resolution.rejectionCode, requestedModel: gate.requestedModel, modelResolutionReason: 'rejected', note: 'Meta call rejected by the model-tier gate; deterministic analysis only, not a Meta model result.' });
    }
    if (!metaConfigured()) {
      return NextResponse.json({ ...deterministic, meta: null, note: 'Meta not configured: analysis is deterministic only, not a Meta model result.' });
    }
    const model = gate.resolution.model;
    const sample = JSON.stringify(dataRows.slice(0, 3)).slice(0, 4000);
    const prompt = `Analyse this dataset sample for schema, field types, and risks. Return concise JSON-like text, no invented counts beyond the sample. Sample: ${sample}`;
    // Atomic spend reservation (contract C5 + three-way accounting):
    // the call runs only under a reservation capped by the hard
    // ceiling + the tenant allowance. The request is bounded
    // (max_tokens), so its maximum cost is finite and checkable.
    const ceiling = hardCeilingStatus();
    const allowance = allowanceCapForTenant(tenant);
    const maxCost = estimateMaxCostForPrompt(prompt, model);
    if (maxCost === null || !ceiling.configured) {
      return NextResponse.json({ ...deterministic, meta: null, metaGate: 'MODEL_BUDGET_EXCEEDED', requestedModel: gate.requestedModel, modelResolutionReason: 'rejected', note: 'Meta call rejected: cost cannot be bounded or the hard ceiling is not configured; deterministic analysis only.' });
    }
    const requestKey = `analyze:${s.user.tenantId}:${id}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
    const reservation = await reserveSpend(db, {
      tenantId: s.user.tenantId, requestKey, model, maxCostUsd: maxCost,
      caps: { perJobUsd: ceiling.perJobUsd, dailyUsd: ceiling.dailyUsd, totalUsd: ceiling.totalUsd, allowanceUsd: allowance?.capUsd ?? null },
    });
    if (!reservation.ok) {
      return NextResponse.json({ ...deterministic, meta: null, metaGate: reservation.code, requestedModel: gate.requestedModel, modelResolutionReason: 'rejected', note: 'Meta call rejected by the spend reservation; deterministic analysis only.' });
    }
    const result = await callMetaChat({ model, dataClass, messages: [{ role: 'user', content: prompt }], maxOutputTokens: META_CALL_MAX_OUTPUT_TOKENS });
    if (!result.ok) {
      // Timeout / network / 5xx: outcome uncertain → PENDING (never
      // released as $0). Any other failure proves non-processing →
      // release. The error kind, not the failure itself, decides.
      if (result.error === 'TIMEOUT' || result.error === 'NETWORK_ERROR' || (result.error ?? '').startsWith('PROVIDER_5XX')) {
        await pendingSpendReservation(db, reservation.reservationId);
      } else {
        await releaseSpendReservation(db, reservation.reservationId);
      }
      return NextResponse.json({ ...deterministic, meta: { error: result.error, model }, note: 'Meta call failed; deterministic analysis only.' });
    }
    // UsageLedger: metadata only (model, tokens, cost, tenant) — never data.
    // For a Meta-backed call, model here must equal Job.resolvedModel
    // semantics: it IS the resolved model, which equals requestedModel.
    // Reservation confirmation + ledger write happen in one transaction.
    await db.$transaction(async (tx: any) => {
      await confirmSpendReservation(tx, reservation.reservationId, result.estimatedCostUsd);
      await tx.usageLedger.create({ data: { tenantId: s.user.tenantId, model, purpose: 'analyze', promptTokens: result.usage.prompt_tokens, completionTokens: result.usage.completion_tokens, costUsd: result.estimatedCostUsd, datasetId: id, dataClass, planSnapshot: gate.planSnapshot, contributorConsentId: gate.contributorConsentId } });
    });
    return NextResponse.json({ ...deterministic, meta: { model, requestedModel: gate.requestedModel, resolvedModel: model, modelResolutionReason: gate.resolution.reason, dataClass, content: result.content, usage: result.usage, estimatedCostUsd: result.estimatedCostUsd } });
  }
  const s = loadStore();
  const ds = s.datasets.find((d) => d.id === id);
  if (!ds) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const recs = datasetRecords(s, id);
  const comp = compositionOf(s, id);
  const q = qualityReport(recs.map((r: any) => r.data));
  const fields = new Set<string>(); recs.forEach((r) => Object.keys(r.data).forEach((k) => fields.add(k)));
  const deterministic = {
    source: 'deterministic',
    recordCount: recs.length,
    fields: [...fields],
    composition: comp,
    quality: q,
    summary: recs.length === 0 ? 'No records yet.' : `Dataset has ${recs.length} records across ${fields.size} fields. Completeness ${(q.completeness * 100).toFixed(1)}%, uniqueness ${(q.uniqueness * 100).toFixed(1)}%.`,
  };
  // Demo mode (no DB): deterministic analysis only. File-store demo data
  // has no tenant, no entitlement, no consent, and no budget, so no Meta
  // call may run here — previously this branch called Meta (including
  // Contributor for public demo data) with no entitlement, allowlist,
  // consent, budget, ceiling, or reservation check. The DB path above is
  // the only Meta path, and it is gated by resolveMetaCall. Tier
  // enforcement cannot be claimed in demo mode.
  return NextResponse.json({ ...deterministic, meta: null, note: 'Demo mode: deterministic analysis only. Meta inference requires the DB-configured path with tier gates.' });
}
