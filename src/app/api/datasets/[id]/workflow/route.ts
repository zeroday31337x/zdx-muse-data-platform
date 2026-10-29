/* eslint-disable @typescript-eslint/no-explicit-any */
// Workflow runs (v1 slice): sequential curate -> evaluate -> export over
// one dataset. See docs/workflow-engine-design.md.
//
// Persistence is a Job row with kind 'workflow'. It is NEVER created as
// QUEUED: the worker tick fails unknown kinds with UNKNOWN_JOB_KIND,
// so v1 rows are created directly in RUNNING by this route (the v1
// executor) and carry no lease, which also keeps the worker's
// stale-lease reclamation from ever requeueing them. On a failed stage
// the row becomes PAUSED with its checkpoint preserved; resume retries
// the failed stage only. No Meta-backed synthesis exists here: the
// only Meta path is the evaluate judge, through the same gate +
// reservation flow as the standalone /evaluate route, and with no key
// configured it falls back to deterministic, labelled as such.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { dbConfigured, prisma } from '@/lib/db';
import { requireSession, isSessionResult, datasetForTenant, jobForTenant, compositionDb } from '@/lib/authz';
import { checkRequestRate } from '@/lib/rate-limit';
import {
  validateWorkflowDefinition,
  createWorkflowRun,
  advanceWorkflowRun,
  assertWorkflowTenant,
  curateRecords,
  exportGateCheck,
  type WorkflowRunState,
  type WorkflowStageKindV1,
  type StageOutcome,
} from '@/lib/workflow-engine';
import { evaluateRecords, evaluatePromptFor, isUncertainMetaError } from '@/lib/meta-workflows';
import { metaConfigured } from '@/lib/meta';
import { resolveMetaCall } from '@/lib/meta-gate';
import { hardCeilingStatus } from '@/lib/tier-allowlist';
import { allowanceCapForTenant, estimateMaxCostForPrompt, reserveSpend, confirmSpendReservation, pendingSpendReservation, releaseSpendReservation, META_CALL_MAX_OUTPUT_TOKENS } from '@/lib/spend';
export const dynamic = 'force-dynamic';

const postSchema = z.object({
  action: z.enum(['start', 'resume']).default('start'),
  runId: z.string().optional(),
  stages: z.array(z.string()).optional(),
});

/** Small, safe summary of a stage result for the Job checkpoint. */
function summarize(kind: WorkflowStageKindV1, result: unknown): unknown {
  const r = result as any;
  if (kind === 'curate') return r?.report ?? null;
  if (kind === 'evaluate') return r ? { source: r.source, model: r.model, issueCount: Array.isArray(r.issues) ? r.issues.length : 0, note: r.note } : null;
  if (kind === 'export') return r?.report ?? null;
  return null;
}

function checkpointOf(state: WorkflowRunState) {
  return {
    currentStageIndex: state.currentStageIndex,
    stages: state.stages.map((s) => ({ kind: s.kind, status: s.status, error: s.error, summary: summarize(s.kind, s.result) })),
  };
}

function presentRun(job: any) {
  const cp = (job.checkpoint ?? {}) as { currentStageIndex?: number; stages?: any[] };
  return {
    runId: job.id,
    datasetId: job.datasetId,
    tenantId: job.tenantId,
    status: job.status,
    total: job.total,
    committed: job.committed,
    error: job.error,
    stages: cp.stages ?? [],
    currentStageIndex: cp.currentStageIndex ?? 0,
  };
}

function rebuildState(job: any): WorkflowRunState | null {
  const payload = (job.payload ?? {}) as { definition?: unknown };
  const def = validateWorkflowDefinition(payload.definition);
  if (!def.ok) return null;
  const cp = (job.checkpoint ?? {}) as { currentStageIndex?: number; stages?: any[] };
  if (typeof cp.currentStageIndex !== 'number' || !Array.isArray(cp.stages)) return null;
  const savedStages = cp.stages ?? [];
  const stages = def.stages.map((kind, i) => {
    const saved = savedStages[i];
    const status = saved?.kind === kind && ['PENDING', 'RUNNING', 'COMPLETED', 'PAUSED'].includes(saved.status) ? saved.status : 'PENDING';
    return { kind, status, error: saved?.error ?? null, result: saved?.summary ?? null };
  });
  return {
    datasetId: job.datasetId,
    tenantId: job.tenantId,
    stages,
    status: 'PAUSED',
    currentStageIndex: cp.currentStageIndex,
    error: job.error ?? null,
  };
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  if (!dbConfigured()) {
    return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED', note: 'Workflow runs need the PostgreSQL store for run state; demo-file workflows are not supported.' }, { status: 503 });
  }
  const s = await requireSession(req);
  if (!isSessionResult(s)) return s.response;
  const ds = await datasetForTenant(id, s.user.tenantId);
  if (!ds) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const db = prisma();
  const tenant = await db.tenant.findUnique({ where: { id: s.user.tenantId } });
  if (!tenant) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  if (checkRequestRate(req, s.user.tenantId).limited) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });

  let state: WorkflowRunState;
  let job: any;
  if (parsed.data.action === 'resume') {
    if (!parsed.data.runId) return NextResponse.json({ error: 'INVALID_REQUEST', message: 'runId is required to resume' }, { status: 400 });
    job = await jobForTenant(parsed.data.runId, s.user.tenantId);
    if (!job || job.kind !== 'workflow' || job.datasetId !== id) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    if (job.status !== 'PAUSED') return NextResponse.json({ error: 'WORKFLOW_NOT_PAUSED', status: job.status }, { status: 409 });
    const rebuilt = rebuildState(job);
    if (!rebuilt) return NextResponse.json({ error: 'WORKFLOW_STATE_CORRUPT' }, { status: 409 });
    assertWorkflowTenant(s.user.tenantId, rebuilt.tenantId);
    state = rebuilt;
    await db.job.update({ where: { id: job.id }, data: { status: 'RUNNING', error: null } });
  } else {
    const def = validateWorkflowDefinition({ stages: parsed.data.stages ?? ['curate', 'evaluate', 'export'] });
    if (!def.ok) return NextResponse.json({ error: def.error }, { status: 400 });
    state = createWorkflowRun(id, s.user.tenantId, def.stages);
    // Created directly in RUNNING, never QUEUED (see header comment).
    job = await db.job.create({
      data: {
        datasetId: id,
        tenantId: s.user.tenantId,
        kind: 'workflow',
        status: 'RUNNING',
        total: def.stages.length,
        committed: 0,
        payload: { definition: { stages: def.stages }, version: 'workflow-engine-v1' },
        checkpoint: checkpointOf(state),
      },
    });
  }

  const recs = await db.record.findMany({ where: { datasetId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const comp = await compositionDb(id);
  const recordData = recs.map((r: any) => r.data as Record<string, unknown>);
  const dataClass = comp.unknown > 0 || comp.synthetic > 0 ? 'private' : 'public';

  // Evaluate executor: the standalone /evaluate route's gate +
  // reservation + settlement flow, with purpose 'workflow-evaluate'.
  // A gated or unconfigured Meta path yields a deterministic result
  // labelled as such; that is a successful stage, not a failure.
  const runEvaluate = async (): Promise<StageOutcome> => {
    const gate = await resolveMetaCall(db, { tenant, datasetId: id, dataClass });
    let metaAllowed = gate.resolution.ok;
    let reservation: { reservationId: string } | null = null;
    let resolvedModel: string | null = gate.resolution.ok ? gate.resolution.model : null;
    if (metaAllowed && metaConfigured() && resolvedModel) {
      const ceiling = hardCeilingStatus();
      const allowance = allowanceCapForTenant(tenant);
      const maxCost = estimateMaxCostForPrompt(evaluatePromptFor(recordData), resolvedModel);
      if (maxCost === null || !ceiling.configured) {
        metaAllowed = false;
      } else {
        const requestKey = `workflow-evaluate:${s.user.tenantId}:${id}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
        const res = await reserveSpend(db, {
          tenantId: s.user.tenantId, requestKey, model: resolvedModel, maxCostUsd: maxCost,
          caps: { perJobUsd: ceiling.perJobUsd, dailyUsd: ceiling.dailyUsd, totalUsd: ceiling.totalUsd, allowanceUsd: allowance?.capUsd ?? null },
        });
        if (!res.ok) metaAllowed = false;
        else reservation = res;
      }
    }
    const result = await evaluateRecords(recordData, dataClass, {
      metaAllowed,
      modelOverride: metaAllowed && resolvedModel ? resolvedModel : undefined,
      maxOutputTokens: META_CALL_MAX_OUTPUT_TOKENS,
    });
    if (reservation && resolvedModel) {
      if (result.usage && result.estimatedCostUsd !== null) {
        const usage = result.usage;
        const cost = result.estimatedCostUsd;
        await db.$transaction(async (tx: any) => {
          await confirmSpendReservation(tx, (reservation as { reservationId: string }).reservationId, cost);
          await tx.usageLedger.create({ data: { tenantId: s.user.tenantId, model: resolvedModel, purpose: 'workflow-evaluate', promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, costUsd: cost, datasetId: id, dataClass, planSnapshot: gate.planSnapshot, contributorConsentId: gate.contributorConsentId } });
        });
      } else if (isUncertainMetaError(result.metaError)) {
        await pendingSpendReservation(db, reservation.reservationId);
      } else {
        await releaseSpendReservation(db, reservation.reservationId);
      }
    }
    return { ok: true, result };
  };

  const executors: Record<WorkflowStageKindV1, () => Promise<StageOutcome>> = {
    curate: async () => {
      const r = curateRecords(recordData);
      return r.ok ? { ok: true, result: { report: r.report } } : { ok: false, error: r.error };
    },
    evaluate: runEvaluate,
    export: async () => {
      const gate = exportGateCheck(comp, (ds as any).purpose ?? 'training');
      return gate.ok ? { ok: true, result: { report: gate.report } } : { ok: false, error: gate.error };
    },
  };

  const { state: advanced } = await advanceWorkflowRun(state, async (kind) => executors[kind]());
  const committed = advanced.stages.filter((st) => st.status === 'COMPLETED').length;
  const updated = await db.job.update({
    where: { id: job.id },
    data: { status: advanced.status, committed, error: advanced.error, checkpoint: checkpointOf(advanced) },
  });
  return NextResponse.json({
    ...presentRun(updated),
    note: 'v1 export stage runs the export gate and composition report only; file delivery remains the existing /export route.',
  });
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!dbConfigured()) return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  const s = await requireSession(req);
  if (!isSessionResult(s)) return s.response;
  const url = new URL(req.url);
  const runId = url.searchParams.get('runId');
  if (!runId) return NextResponse.json({ error: 'INVALID_REQUEST', message: 'runId query param is required' }, { status: 400 });
  const job = await jobForTenant(runId, s.user.tenantId);
  if (!job || job.kind !== 'workflow' || job.datasetId !== id) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  assertWorkflowTenant(s.user.tenantId, job.tenantId);
  return NextResponse.json(presentRun(job));
}
