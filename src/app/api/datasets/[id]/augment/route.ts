/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { loadStore, saveStore, newId, estimateTokens, datasetRecords, compositionOf } from '@/lib/store';
import { compositionReport, maxSyntheticForAuthentic } from '@/lib/composition';
import { dbConfigured, prisma } from '@/lib/db';
import { requireSession, isSessionResult, datasetForTenant, compositionDb } from '@/lib/authz';
import { checkCompositionInTx } from '@/lib/composition-db';
import { entitlementGate, checkConcurrency, graceRestrictionActive } from '@/lib/billing';
import { recordCapForTenant } from '@/lib/tier-spec';
import { ensureGraceRestriction } from '@/lib/grace';
import { checkRequestRate } from '@/lib/rate-limit';
export const dynamic = 'force-dynamic';
const schema = z.object({ count: z.number().int().min(1).max(10000) });
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
    // Compliance correction: the augment route previously had NO
    // entitlement gate and NO concurrency check, so a canceled /
    // unpaid / paused tenant could create template augment jobs
    // synchronously (the worker claim path never saw them, because
    // the route completes inline). Entitlement (402) and grace
    // restriction (402) are now enforced here, before any work, and
    // creation-time concurrency (429) counts QUEUED + RUNNING jobs
    // against the PROPOSED safety caps (1 restricted / 2 entitled).
    // Approved per-tier concurrency caps are a BLOCKED input.
    let tenant = await db.tenant.findUnique({ where: { id: s.user.tenantId } });
    if (!tenant) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    const gate = entitlementGate(tenant.subscriptionStatus as string, 'augment_template');
    if (!gate.allowed) return NextResponse.json({ error: gate.code, status: tenant.subscriptionStatus }, { status: 402 });
    tenant = await ensureGraceRestriction(db, tenant);
    if (graceRestrictionActive(tenant)) {
      return NextResponse.json({ error: 'ENTITLEMENT_REQUIRED', status: tenant.subscriptionStatus, restriction: 'GRACE_EXPIRED_UNVERIFIED' }, { status: 402 });
    }
    // Request rate (B2, PROPOSED values): 401 → 404 → 402 → 429 order.
    if (checkRequestRate(req, s.user.tenantId).limited) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
    const restricted = tenant.subscriptionStatus === 'restricted' || tenant.subscriptionStatus === 'incomplete' || tenant.subscriptionStatus === 'incomplete_expired';
    const activeJobs = await db.job.count({ where: { tenantId: tenant.id, status: { in: ['QUEUED', 'RUNNING'] } } });
    if (!checkConcurrency(activeJobs, restricted).ok) {
      return NextResponse.json({ error: 'CONCURRENCY_LIMIT', activeJobs }, { status: 429 });
    }
    // Pre-check (fast fail) — the transaction below re-checks under
    // the dataset lock, so concurrent requests cannot both pass.
    if (ds.purpose === 'training') {
      const comp0 = await compositionDb(id);
      const allowed0 = maxSyntheticForAuthentic(comp0.authentic);
      if (parsed.data.count > allowed0 - comp0.synthetic) {
        return NextResponse.json({ error: 'SYNTHETIC_CAP_EXCEEDED', authentic: comp0.authentic, synthetic: comp0.synthetic, allowed: allowed0, requested: parsed.data.count, remaining: Math.max(0, allowed0 - comp0.synthetic) }, { status: 409 });
      }
      if (comp0.authentic === 0) return NextResponse.json({ error: 'NO_AUTHENTIC_RECORDS', message: 'Augmentation requires verified authentic records to stay within the 30% cap.' }, { status: 409 });
    }
    // Record-cap pre-check (tier spec, PROPOSED values): the tenant's
    // total after this augment must stay within the cap. Previously this
    // route had NO record-cap check at all, so synthetic records could
    // push a tenant past its tier cap. The pre-check is re-verified
    // inside the transaction below (a cap change or concurrent augment
    // between the two checks must not let the tenant overshoot). The
    // count is tenant-wide: caps are per tenant, not per dataset.
    const cap = recordCapForTenant(tenant);
    if (cap !== null) {
      const tenantTotal = await db.record.count({ where: { dataset: { tenantId: s.user.tenantId } } });
      if (tenantTotal + parsed.data.count > cap) {
        return NextResponse.json({ error: 'QUOTA_EXCEEDED', recordLimit: cap, recordLimitStatus: 'PROPOSED', tenantTotal }, { status: 409 });
      }
    }
    const job = await db.job.create({ data: { datasetId: id, tenantId: s.user.tenantId, kind: 'augment', status: 'QUEUED', total: parsed.data.count, payload: { count: parsed.data.count } } });
    // Run the augment transaction (same gate + createMany as the worker).
    try {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const result = await db.$transaction(async (tx: any) => {
        const check = await checkCompositionInTx(tx, id, parsed.data.count);
        if (!check.ok) throw new Error('SYNTHETIC_CAP_EXCEEDED');
        // In-transaction record-cap re-check (tier spec, PROPOSED values):
        // the pre-check above can race concurrent augments, so the cap is
        // re-verified here, tenant-wide, before any insert.
        const txCap = recordCapForTenant(tenant);
        if (txCap !== null) {
          const totalNow = await tx.record.count({ where: { dataset: { tenantId: s.user.tenantId } } });
          if (totalNow + parsed.data.count > txCap) throw new Error('QUOTA_EXCEEDED');
        }
        const authentic = await tx.record.findMany({ where: { datasetId: id, provenance: 'AUTHENTIC_VERIFIED' }, take: parsed.data.count });
        const rows = [];
        for (let i = 0; i < parsed.data.count; i++) {
          const base = authentic[i % authentic.length];
          if (!base) break;
          const data = { ...(base.data as Record<string, unknown>) };
          for (const f of ['order_id', 'id', 'record_id']) if (data[f] !== undefined) { data[f] = `SYN-${String(data[f])}-${i}`; break; }
          rows.push({ datasetId: id, recordKey: `${base.recordKey}-syn-${job.id}-${i}`, data, provenance: 'SYNTHETIC', sourceId: base.sourceId, sourceFamilyId: base.sourceFamilyId, tokens: estimateTokens(data) });
        }
        const inserted = rows.length > 0 ? await tx.record.createMany({ data: rows, skipDuplicates: true }) : { count: 0 };
        await tx.job.update({ where: { id: job.id }, data: { committed: inserted.count, status: 'COMPLETED' } });
        return inserted.count;
      }, { timeout: 60000 });
      const comp = await compositionDb(id);
      return NextResponse.json({ jobId: job.id, committed: result, status: 'COMPLETED', composition: comp, compositionReport: compositionReport(comp), generator: 'template-demo', note: 'Synthetic records are template variations, labelled SYNTHETIC. Meta-backed augment is DISABLED pending separate Option A authorization; this route always returns template records.' });
    } catch (e) {
      await db.job.update({ where: { id: job.id }, data: { status: 'FAILED', error: e instanceof Error ? e.message : 'WORKER_ERROR' } });
      if (e instanceof Error && e.message === 'SYNTHETIC_CAP_EXCEEDED') {
        const comp = await compositionDb(id);
        return NextResponse.json({ error: 'SYNTHETIC_CAP_EXCEEDED', jobId: job.id, authentic: comp.authentic, synthetic: comp.synthetic, allowed: maxSyntheticForAuthentic(comp.authentic), requested: parsed.data.count, remaining: Math.max(0, maxSyntheticForAuthentic(comp.authentic) - comp.synthetic) }, { status: 409 });
      }
      if (e instanceof Error && e.message === 'QUOTA_EXCEEDED') {
        const comp = await compositionDb(id);
        return NextResponse.json({ error: 'QUOTA_EXCEEDED', jobId: job.id, recordLimitStatus: 'PROPOSED', composition: comp }, { status: 409 });
      }
      return NextResponse.json({ error: 'AUGMENT_FAILED', jobId: job.id, message: e instanceof Error ? e.message : 'failed' }, { status: 500 });
    }
  }
  const s = loadStore();
  const ds = s.datasets.find((d) => d.id === id);
  if (!ds) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  if (ds.purpose === 'training') {
    const comp = compositionOf(s, id);
    const allowed = maxSyntheticForAuthentic(comp.authentic);
    if (parsed.data.count > allowed - comp.synthetic) {
      return NextResponse.json({ error: 'SYNTHETIC_CAP_EXCEEDED', authentic: comp.authentic, synthetic: comp.synthetic, allowed, requested: parsed.data.count, remaining: Math.max(0, allowed - comp.synthetic) }, { status: 409 });
    }
  }
  const recs = datasetRecords(s, id).filter((r) => r.provenance === 'AUTHENTIC_VERIFIED');
  if (recs.length === 0) return NextResponse.json({ error: 'NO_AUTHENTIC_RECORDS', message: 'Augmentation requires verified authentic records to stay within the 30% cap.' }, { status: 409 });
  const job = { id: newId('job'), datasetId: id, kind: 'augment', status: 'COMPLETED', committed: 0, total: parsed.data.count, error: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  s.jobs.push(job);
  let committed = 0;
  for (let i = 0; i < parsed.data.count; i++) {
    const base = recs[i % recs.length];
    const data = { ...base.data };
    for (const idField of ['order_id', 'id', 'record_id', 'transaction_id']) {
      if (data[idField] !== undefined && data[idField] !== null) { data[idField] = `SYN-${String(data[idField])}-${i}`; break; }
    }
    const key = `${base.recordKey}-syn${i}`;
    if (s.records.some((r) => r.datasetId === id && r.recordKey === key)) continue;
    s.records.push({ id: newId('rec'), datasetId: id, recordKey: key, data, provenance: 'SYNTHETIC', sourceId: base.sourceId, sourceFamilyId: base.sourceFamilyId, tokens: estimateTokens(data), createdAt: new Date().toISOString(), meta: { syntheticVariantOf: base.id, syntheticIndex: i, generator: 'template-demo' } });
    committed++;
  }
  job.committed = committed; job.updatedAt = new Date().toISOString();
  saveStore(s);
  const comp = compositionOf(s, id);
  return NextResponse.json({ committed, composition: comp, compositionReport: compositionReport(comp), generator: 'template-demo', note: 'Synthetic records are template variations, labelled SYNTHETIC. Meta-backed augment is DISABLED pending separate Option A authorization; this route always returns template records.' });
}
