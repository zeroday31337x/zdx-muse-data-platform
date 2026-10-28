/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { loadStore, datasetRecords, compositionOf } from '@/lib/store';
import { evaluateRecords, evaluatePromptFor, isUncertainMetaError } from '@/lib/meta-workflows';
import { metaConfigured } from '@/lib/meta';
import { compositionReport } from '@/lib/composition';
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
    // Request rate (B2, PROPOSED values): 401 → 404 → 429 order.
    if (checkRequestRate(req, s.user.tenantId).limited) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
    const recs = await db.record.findMany({ where: { datasetId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const comp = await compositionDb(id);
    const dataClass = comp.unknown > 0 || comp.synthetic > 0 ? 'private' : 'public';
    const gate = await resolveMetaCall(db, { tenant, datasetId: id, dataClass });
    const resolvedModel = gate.resolution.ok ? gate.resolution.model : null;
    // Atomic spend reservation (same contract as analyze): the Meta
    // judge runs only under a reservation capped by the hard ceiling
    // + the tenant allowance; settlement follows the workflow result
    // (usage present → confirm at actual cost + UsageLedger row;
    // uncertain error → PENDING, never $0; other failure → release).
    let metaAllowed = gate.resolution.ok;
    let metaGateCode: string | undefined = gate.resolution.ok ? undefined : gate.resolution.rejectionCode;
    let reservation: { reservationId: string } | null = null;
    if (metaAllowed && metaConfigured() && resolvedModel) {
      const ceiling = hardCeilingStatus();
      const allowance = allowanceCapForTenant(tenant);
      const maxCost = estimateMaxCostForPrompt(evaluatePromptFor(recs.map((r: any) => r.data as Record<string, unknown>)), resolvedModel);
      if (maxCost === null || !ceiling.configured) {
        metaAllowed = false; metaGateCode = 'MODEL_BUDGET_EXCEEDED';
      } else {
        const requestKey = `evaluate:${s.user.tenantId}:${id}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
        const res = await reserveSpend(db, {
          tenantId: s.user.tenantId, requestKey, model: resolvedModel, maxCostUsd: maxCost,
          caps: { perJobUsd: ceiling.perJobUsd, dailyUsd: ceiling.dailyUsd, totalUsd: ceiling.totalUsd, allowanceUsd: allowance?.capUsd ?? null },
        });
        if (!res.ok) { metaAllowed = false; metaGateCode = res.code; }
        else reservation = res;
      }
    }
    const result = await evaluateRecords(recs.map((r: any) => r.data as Record<string, unknown>), dataClass, { metaAllowed, modelOverride: metaAllowed ? (resolvedModel as string) : undefined, maxOutputTokens: META_CALL_MAX_OUTPUT_TOKENS });
    if (reservation && resolvedModel) {
      if (result.usage && result.estimatedCostUsd !== null) {
        const usage = result.usage;
        const cost = result.estimatedCostUsd;
        await db.$transaction(async (tx: any) => {
          await confirmSpendReservation(tx, (reservation as { reservationId: string }).reservationId, cost);
          await tx.usageLedger.create({ data: { tenantId: s.user.tenantId, model: resolvedModel, purpose: 'evaluate', promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, costUsd: cost, datasetId: id, dataClass, planSnapshot: gate.planSnapshot, contributorConsentId: gate.contributorConsentId } });
        });
      } else if (isUncertainMetaError(result.metaError)) {
        await pendingSpendReservation(db, reservation.reservationId);
      } else {
        await releaseSpendReservation(db, reservation.reservationId);
      }
    }
    return NextResponse.json({ datasetId: id, evaluation: result, composition: comp, compositionReport: compositionReport(comp), metaGate: metaGateCode, requestedModel: gate.requestedModel, modelResolutionReason: metaAllowed ? gate.resolution.reason : 'rejected', caveat: 'The 30% ceiling is a governance policy, not a guarantee against model collapse.' });
  }
  const s = loadStore();
  if (!s.datasets.find((d) => d.id === id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const recs = datasetRecords(s, id);
  // Demo mode (no DB): deterministic evaluation only. evaluateRecords
  // calls Meta whenever configured unless metaAllowed is false; file-store
  // demo data has no tenant, no entitlement, and no budget, so Meta is
  // explicitly disabled here. The DB path above is the only Meta path.
  const result = await evaluateRecords(recs.map((r: any) => r.data), 'public', { metaAllowed: false });
  const comp = compositionOf(s, id);
  return NextResponse.json({ datasetId: id, evaluation: result, composition: comp, compositionReport: compositionReport(comp), caveat: 'The 30% ceiling is a governance policy, not a guarantee against model collapse.' });
}
