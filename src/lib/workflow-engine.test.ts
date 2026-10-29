import { describe, it, expect } from 'vitest';
import {
  validateWorkflowDefinition,
  createWorkflowRun,
  advanceWorkflowRun,
  cancelWorkflowRun,
  canAccessWorkflow,
  assertWorkflowTenant,
  curateRecords,
  exportGateCheck,
  type WorkflowStageKindV1,
  type StageOutcome,
} from './workflow-engine';
import { evaluateRecords } from './meta-workflows';
import { metaConfigured } from './meta';

const CHAIN = ['curate', 'evaluate', 'export'] as const;

describe('workflow definition validation (v1)', () => {
  it('accepts exactly curate -> evaluate -> export', () => {
    const r = validateWorkflowDefinition({ stages: [...CHAIN] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.stages).toEqual([...CHAIN]);
  });
  it('rejects wrong order, duplicates, empty, and unknown stages', () => {
    expect(validateWorkflowDefinition({ stages: ['evaluate', 'curate', 'export'] }).ok).toBe(false);
    expect(validateWorkflowDefinition({ stages: ['curate', 'export', 'evaluate'] }).ok).toBe(false);
    expect(validateWorkflowDefinition({ stages: ['curate', 'curate', 'export'] }).ok).toBe(false);
    expect(validateWorkflowDefinition({ stages: [] }).ok).toBe(false);
    expect(validateWorkflowDefinition({ stages: ['curate', 'evaluate', 'nope'] }).ok).toBe(false);
    expect(validateWorkflowDefinition({}).ok).toBe(false);
  });
  it('rejects future stages (synthesize/secure/enrich are designed, not in v1)', () => {
    for (const future of ['synthesize', 'secure', 'enrich']) {
      const r = validateWorkflowDefinition({ stages: ['curate', 'evaluate', future] });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain('STAGE_NOT_IN_V1');
    }
  });
});

describe('workflow run ordering and pause/resume', () => {
  it('executes stages strictly in order and completes', async () => {
    const seen: WorkflowStageKindV1[] = [];
    const state = createWorkflowRun('ds-1', 'tenant-1', [...CHAIN]);
    const { state: done, executed } = await advanceWorkflowRun(state, async (kind) => {
      seen.push(kind);
      return { ok: true, result: kind };
    });
    expect(seen).toEqual([...CHAIN]);
    expect(executed).toEqual([...CHAIN]);
    expect(done.status).toBe('COMPLETED');
    expect(done.currentStageIndex).toBe(3);
    expect(done.stages.every((s) => s.status === 'COMPLETED')).toBe(true);
  });

  it('a failed stage pauses the run and later stages never execute; resume retries only the failed stage', async () => {
    const seen: WorkflowStageKindV1[] = [];
    let evaluateShouldFail = true;
    const exec = async (kind: WorkflowStageKindV1): Promise<StageOutcome> => {
      seen.push(kind);
      if (kind === 'evaluate' && evaluateShouldFail) return { ok: false, error: 'EVALUATE_BOOM' };
      return { ok: true, result: kind };
    };
    const start = createWorkflowRun('ds-1', 'tenant-1', [...CHAIN]);
    const first = await advanceWorkflowRun(start, exec);
    expect(first.state.status).toBe('PAUSED');
    expect(first.state.error).toBe('EVALUATE_BOOM');
    expect(first.state.currentStageIndex).toBe(1);
    expect(first.state.stages[1].status).toBe('PAUSED');
    expect(seen).toEqual(['curate', 'evaluate']); // export never ran
    // Resume: curate is skipped (already COMPLETED), evaluate retried, export runs.
    evaluateShouldFail = false;
    seen.length = 0;
    const second = await advanceWorkflowRun(first.state, exec);
    expect(second.state.status).toBe('COMPLETED');
    expect(seen).toEqual(['evaluate', 'export']);
    expect(second.executed).toEqual(['evaluate', 'export']);
  });

  it('a throwing executor pauses the run instead of crashing the advance', async () => {
    const start = createWorkflowRun('ds-1', 'tenant-1', [...CHAIN]);
    const { state } = await advanceWorkflowRun(start, async (kind) => {
      if (kind === 'curate') throw new Error('CURATE_THROW');
      return { ok: true };
    });
    expect(state.status).toBe('PAUSED');
    expect(state.error).toBe('CURATE_THROW');
    expect(state.currentStageIndex).toBe(0);
  });

  it('COMPLETED and CANCELLED runs never re-execute', async () => {
    let calls = 0;
    const start = createWorkflowRun('ds-1', 'tenant-1', [...CHAIN]);
    const done = await advanceWorkflowRun(start, async () => { calls++; return { ok: true }; });
    expect(done.state.status).toBe('COMPLETED');
    const again = await advanceWorkflowRun(done.state, async () => { calls++; return { ok: true }; });
    expect(again.executed).toEqual([]);
    expect(calls).toBe(3);
    const cancelled = cancelWorkflowRun(done.state);
    // Cancelling a COMPLETED run is a no-op; cancelling a PAUSED run is terminal.
    expect(cancelled.status).toBe('COMPLETED');
    const paused = createWorkflowRun('ds-1', 'tenant-1', [...CHAIN]);
    const pausedState = { ...paused, status: 'PAUSED' as const, currentStageIndex: 1 };
    const cancelledPaused = cancelWorkflowRun(pausedState);
    expect(cancelledPaused.status).toBe('CANCELLED');
    const afterCancel = await advanceWorkflowRun(cancelledPaused, async () => { calls++; return { ok: true }; });
    expect(afterCancel.executed).toEqual([]);
  });
});

describe('curate stage (deterministic, read-only)', () => {
  it('fails on an empty dataset so no Meta call is reached with nothing to evaluate', () => {
    expect(curateRecords([])).toEqual({ ok: false, error: 'EMPTY_DATASET' });
  });
  it('reports duplicates and missing fields without mutating records', () => {
    const records = [{ a: 1, b: 'x' }, { a: 1, b: 'x' }, { a: 2, b: '' }];
    const r = curateRecords(records);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.report.total).toBe(3);
      expect(r.report.duplicateKeys).toBe(1);
      expect(r.report.missingFields.b).toBe(1);
    }
    expect(records).toHaveLength(3);
  });
});

describe('export stage 70/30 gate', () => {
  it('blocks a training dataset over the 30% synthetic ceiling', () => {
    const r = exportGateCheck({ authentic: 7000, synthetic: 4000, unknown: 0 }, 'training');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('EXPORT_BLOCKED_NONCOMPLIANT');
  });
  it('blocks a training dataset with any unknown provenance', () => {
    const r = exportGateCheck({ authentic: 9000, synthetic: 1000, unknown: 1 }, 'training');
    expect(r.ok).toBe(false);
  });
  it('passes a compliant training dataset at exactly the boundary', () => {
    // 7000 authentic -> max synthetic floor(3*7000/7) = 3000.
    const r = exportGateCheck({ authentic: 7000, synthetic: 3000, unknown: 0 }, 'training');
    expect(r.ok).toBe(true);
  });
  it('does not block simulation-purpose datasets (mirrors the /export route)', () => {
    const r = exportGateCheck({ authentic: 0, synthetic: 100, unknown: 0 }, 'simulation');
    expect(r.ok).toBe(true);
  });
  it('a blocked export stage pauses the run instead of completing it', async () => {
    const state = createWorkflowRun('ds-1', 'tenant-1', [...CHAIN]);
    const { state: done } = await advanceWorkflowRun(state, async (kind) => {
      if (kind === 'export') {
        const gate = exportGateCheck({ authentic: 7000, synthetic: 4000, unknown: 0 }, 'training');
        return gate.ok ? { ok: true } : { ok: false, error: 'EXPORT_BLOCKED_NONCOMPLIANT' };
      }
      return { ok: true };
    });
    expect(done.status).toBe('PAUSED');
    expect(done.error).toBe('EXPORT_BLOCKED_NONCOMPLIANT');
    expect(done.stages[2].status).toBe('PAUSED');
  });
});

describe('tenant isolation', () => {
  it('allows the owning tenant and denies any other tenant', () => {
    expect(canAccessWorkflow('tenant-1', 'tenant-1')).toBe(true);
    expect(canAccessWorkflow('tenant-2', 'tenant-1')).toBe(false);
    expect(() => assertWorkflowTenant('tenant-2', 'tenant-1')).toThrow('WORKFLOW_TENANT_MISMATCH');
    expect(() => assertWorkflowTenant('tenant-1', 'tenant-1')).not.toThrow();
  });
  it('a run created for one tenant cannot be advanced under another tenant', async () => {
    const state = createWorkflowRun('ds-1', 'tenant-1', [...CHAIN]);
    expect(() => assertWorkflowTenant('tenant-2', state.tenantId)).toThrow('WORKFLOW_TENANT_MISMATCH');
    // The guard runs before advanceWorkflowRun in the route; the engine
    // itself never sees a cross-tenant state, so no stage executes.
    let calls = 0;
    try {
      assertWorkflowTenant('tenant-2', state.tenantId);
      await advanceWorkflowRun(state, async () => { calls++; return { ok: true }; });
    } catch { /* guard rejected: expected */ }
    expect(calls).toBe(0);
  });
});

describe('no Meta call when unconfigured', () => {
  it('evaluateRecords falls back to deterministic, labelled, with null usage and no network', async () => {
    const saved = process.env.MODEL_API_KEY;
    delete process.env.MODEL_API_KEY;
    try {
      expect(metaConfigured()).toBe(false);
      const r = await evaluateRecords([{ a: 1 }, { a: 1 }], 'public', {});
      expect(r.source).toBe('deterministic');
      expect(r.model).toBe(null);
      expect(r.usage).toBe(null);
      expect(r.estimatedCostUsd).toBe(null);
      expect(r.issues).toContain('Duplicate record');
    } finally {
      if (saved !== undefined) process.env.MODEL_API_KEY = saved;
      else delete process.env.MODEL_API_KEY;
    }
  });
});
