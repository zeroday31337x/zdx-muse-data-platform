// Platform workflow engine (v1 slice) — pure state machine + deterministic
// stage helpers. No Prisma, no fetch, no secrets: unit-testable without a
// database or a Meta key. See docs/workflow-engine-design.md.
//
// v1 chain is exactly ['curate', 'evaluate', 'export'], sequential.
// A failed stage PAUSES the run; later stages never execute; resume
// retries the failed stage only. Nothing here calls Meta: the evaluate
// stage's Meta path lives in the API route, which reuses the existing
// gate + reservation flow and injects its result through the executor.
import { z } from 'zod';
import { qualityReport, type QualityReport } from './quality';
import { compositionReport } from './composition';

/** Canonical v1 stage order. Any other order is rejected by the validator. */
export const WORKFLOW_STAGE_ORDER_V1 = ['curate', 'evaluate', 'export'] as const;
export type WorkflowStageKindV1 = (typeof WORKFLOW_STAGE_ORDER_V1)[number];

/** Designed but NOT implemented in v1 (see design doc §2.1 for why each waits). */
export const FUTURE_STAGE_KINDS = ['synthesize', 'secure', 'enrich'] as const;

const stageSchema = z.enum(['curate', 'evaluate', 'export', 'synthesize', 'secure', 'enrich']);
const definitionSchema = z.object({ stages: z.array(stageSchema).min(1) });

/**
 * v1 definition rule: exactly the canonical chain, in order, no
 * duplicates, no future stages. Partial chains and reordering are a
 * later extension (each stage needs a declared input/output contract).
 */
export function validateWorkflowDefinition(input: unknown):
  | { ok: true; stages: WorkflowStageKindV1[] }
  | { ok: false; error: string } {
  const parsed = definitionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID_WORKFLOW_DEFINITION' };
  const stages = parsed.data.stages;
  for (const s of stages) {
    if ((FUTURE_STAGE_KINDS as readonly string[]).includes(s)) {
      return { ok: false, error: `STAGE_NOT_IN_V1:${s}` };
    }
  }
  const expected = [...WORKFLOW_STAGE_ORDER_V1];
  if (stages.length !== expected.length || stages.some((s, i) => s !== expected[i])) {
    return { ok: false, error: 'WORKFLOW_STAGE_ORDER_V1_REQUIRED' };
  }
  return { ok: true, stages: stages as WorkflowStageKindV1[] };
}

export type WorkflowRunStatus = 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
export type StageRunStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'PAUSED';
export type StageRun = {
  kind: WorkflowStageKindV1;
  status: StageRunStatus;
  error: string | null;
  result: unknown;
};

export type WorkflowRunState = {
  datasetId: string;
  tenantId: string;
  stages: StageRun[];
  status: WorkflowRunStatus;
  currentStageIndex: number;
  error: string | null;
};

export function createWorkflowRun(
  datasetId: string,
  tenantId: string,
  stages: WorkflowStageKindV1[],
): WorkflowRunState {
  return {
    datasetId,
    tenantId,
    stages: stages.map((kind) => ({ kind, status: 'PENDING' as StageRunStatus, error: null, result: null })),
    status: 'RUNNING',
    currentStageIndex: 0,
    error: null,
  };
}

/** Tenant isolation guard: a run belongs to exactly one tenant. */
export function canAccessWorkflow(sessionTenantId: string, runTenantId: string): boolean {
  return sessionTenantId === runTenantId;
}

export function assertWorkflowTenant(sessionTenantId: string, runTenantId: string): void {
  if (!canAccessWorkflow(sessionTenantId, runTenantId)) {
    throw new Error('WORKFLOW_TENANT_MISMATCH');
  }
}

export type StageOutcome = { ok: true; result?: unknown } | { ok: false; error: string };
export type StageExecutor = (kind: WorkflowStageKindV1) => Promise<StageOutcome>;

/**
 * Advance a run through its stages, in order, from the current index.
 * COMPLETED stages are skipped (resume). On the first failing stage
 * (ok:false or a throw) the stage and the run become PAUSED and no
 * later stage executes. COMPLETED/CANCELLED runs are never re-executed.
 */
export async function advanceWorkflowRun(
  state: WorkflowRunState,
  execute: StageExecutor,
): Promise<{ state: WorkflowRunState; executed: WorkflowStageKindV1[] }> {
  if (state.status === 'COMPLETED' || state.status === 'CANCELLED') {
    return { state, executed: [] };
  }
  const executed: WorkflowStageKindV1[] = [];
  const stages = state.stages.map((s) => ({ ...s }));
  let idx = state.currentStageIndex;
  let status: WorkflowRunStatus = 'RUNNING';
  let error: string | null = null;
  while (idx < stages.length) {
    if (stages[idx].status === 'COMPLETED') {
      idx++;
      continue;
    }
    stages[idx] = { ...stages[idx], status: 'RUNNING', error: null };
    let outcome: StageOutcome;
    try {
      outcome = await execute(stages[idx].kind);
    } catch (e) {
      outcome = { ok: false, error: e instanceof Error ? e.message : 'STAGE_ERROR' };
    }
    if (!outcome.ok) {
      stages[idx] = { ...stages[idx], status: 'PAUSED', error: outcome.error };
      status = 'PAUSED';
      error = outcome.error;
      break;
    }
    stages[idx] = { ...stages[idx], status: 'COMPLETED', error: null, result: outcome.result ?? null };
    executed.push(stages[idx].kind);
    idx++;
  }
  if (status !== 'PAUSED' && idx >= stages.length) {
    status = 'COMPLETED';
  }
  return { state: { ...state, stages, status, currentStageIndex: idx, error }, executed };
}

export function cancelWorkflowRun(state: WorkflowRunState): WorkflowRunState {
  if (state.status === 'COMPLETED' || state.status === 'CANCELLED') return state;
  return { ...state, status: 'CANCELLED', error: state.error };
}

/**
 * Curate stage (v1): deterministic, read-only report. It never mutates
 * records. It fails only on an empty dataset, so a run never reaches a
 * Meta call with nothing to evaluate.
 */
export function curateRecords(records: Record<string, unknown>[]):
  | { ok: true; report: QualityReport }
  | { ok: false; error: string } {
  if (records.length === 0) return { ok: false, error: 'EMPTY_DATASET' };
  const report = qualityReport(records);
  return { ok: true, report };
}

export type CompositionCounts = {
  authentic: number;
  synthetic: number;
  unknown: number;
  authenticTokens?: number;
  syntheticTokens?: number;
};

/**
 * Export stage gate (v1): the same rule as the /export route — a
 * training dataset must be 70/30-compliant (record-weighted, unknown =
 * 0); anything else is blocked. This checks the gate only; file
 * delivery stays with the /export route.
 */
export function exportGateCheck(composition: CompositionCounts, purpose: string):
  | { ok: true; report: ReturnType<typeof compositionReport> }
  | { ok: false; error: string; report: ReturnType<typeof compositionReport> } {
  const report = compositionReport(composition);
  if (purpose === 'training' && !report.strictOk) {
    return { ok: false, error: 'EXPORT_BLOCKED_NONCOMPLIANT', report };
  }
  return { ok: true, report };
}
