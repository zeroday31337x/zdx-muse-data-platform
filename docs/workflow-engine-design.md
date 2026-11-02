# Workflow Engine — Design (v1 slice + full direction)

Status: DESIGN + ONE VERTICAL SLICE implemented on branch `workflow-engine-v1`
(local only — not merged, not deployed, not production-ready).
The slice is a sequential **curate → evaluate → export** chain. Everything
below marked FUTURE is designed but deliberately NOT implemented in v1.

## 1. Why a workflow engine, and what it is not

Today, model calls are single-shot, one endpoint at a time (analyze,
evaluate, schema each run one Meta call; augment is template-only).
A user hand-runs each step; there is no saved pipeline, no stage-to-stage
flow, no per-pipeline budget, and no pause/resume across steps.

A workflow is a **named, ordered list of stages over one dataset**, run as
one durable run with one tenant, one data class, and one spend ledger.
It is NOT a new inference path: every stage reuses the existing gates,
and model output stays untrusted data. It is also NOT a general DAG
engine in v1: stages run sequentially, in definition order, with no
branching, no fan-out, and no user-supplied code. Branching and parallel
stages are FUTURE and need their own threat review (a branch condition
computed from model output must never decide authorization or spending).

## 2. Definitions

### 2.1 WorkflowDefinition

```ts
type WorkflowStageKindV1 = 'curate' | 'evaluate' | 'export';
// FUTURE (rejected by the v1 validator): 'synthesize' | 'secure' | 'enrich'
type WorkflowDefinition = { stages: WorkflowStageKindV1[] };
```

v1 rule (enforced by `validateWorkflowDefinition` in
`src/lib/workflow-engine.ts`): the definition must be exactly
`['curate', 'evaluate', 'export']`, in that order, no duplicates, no
unknown stages. Partial chains and reordering are FUTURE: each stage
needs a declared input/output contract before it can be freely composed,
and that contract work is not in the slice.

Stage meanings (v1 implemented; FUTURE sketched):

- **curate** (v1): deterministic, read-only report over the dataset's
  records — completeness, uniqueness, missing fields, duplicate keys
  (reuses `qualityReport`). It does NOT mutate records. Repair/mutation
  stays behind the existing repair approval flow and is FUTURE as a
  workflow stage. Curate fails only on `EMPTY_DATASET`.
- **evaluate** (v1): the existing evaluation — deterministic checks plus
  the optional Meta judge (`evaluateRecords` in `src/lib/meta-workflows.ts`),
  through the full gate + reservation flow in §4. A gated or
  unconfigured Meta path yields a deterministic result labelled as such;
  that is a successful stage, not a failure.
- **export** (v1): the existing export gate, not file delivery. It runs
  `compositionReport` over committed DB records and blocks a training
  dataset that is not 70/30-compliant (`EXPORT_BLOCKED_NONCOMPLIANT`).
  File delivery itself remains the existing `/export` route. Making the
  workflow produce the file is FUTURE and must reuse that route's
  unpaid-export authorization logic, not duplicate it.
- **synthesize** (FUTURE): augment. Meta-backed augment is DISABLED
  pending separate Option A authorization. The workflow engine must NOT
  implement or enable it, and v1 contains no synthesize stage at all.
  When/if Option A is authorized, synthesis runs under the same gate +
  reservation flow, inside a DB transaction with `checkCompositionInTx`
  (§5), and a failed synthesis pauses the run — it never silently falls
  back to template records.
- **secure** (FUTURE): a stage that makes a dataset safe to use/share —
  PII/sensitive-field flagging, license and provenance verification, and
  data-class/tenant checks before synthesis or export. No PII-redaction
  code exists in the platform today; this stage is new work, not a
  rename of anything existing. Its exact scope (flag-only vs redact)
  needs a separate decision: redaction mutates records and therefore
  needs the repair-approval treatment.
- **enrich** (FUTURE): schema inference plus record-level enrichment
  (fill, normalize, categorize). Only exists in partial form today
  (schema inference, evaluate). Record-level enrichment must declare
  whether enriched fields count as derived or synthetic provenance
  BEFORE implementation, because that changes the 70/30 math.

### 2.2 WorkflowRun and stage runs

```ts
type WorkflowRunStatus = 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
type StageRunStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'PAUSED';
type StageRun = { kind, status, error: string | null, result: unknown };
type WorkflowRunState = {
  datasetId: string; tenantId: string;
  stages: StageRun[]; status: WorkflowRunStatus;
  currentStageIndex: number; error: string | null;
};
```

Rules (enforced by `advanceWorkflowRun`, unit-tested):

1. Stages execute strictly in order. A stage runs only after every
   earlier stage is COMPLETED.
2. **A failed stage pauses the run.** The run becomes PAUSED, the
   failed stage is marked PAUSED with its error, and no later stage
   executes — not even a "safe" one. There is no skip-on-failure and no
   silent downgrade (in particular, a failed synthesis must never
   degrade to template augment; that rule is stated here so the future
   synthesize stage inherits it).
3. Resume continues at the failed stage. COMPLETED stages are skipped,
   never re-executed (idempotency at the stage level; record-level
   idempotency still comes from `recordKey` uniqueness when a future
   stage writes records).
4. COMPLETED and CANCELLED runs never re-execute: `advanceWorkflowRun`
   on them is a no-op returning the unchanged state.
5. The run is tenant-bound at creation and on every later access:
   `assertWorkflowTenant` rejects any session tenant != run tenant.
   The API layer additionally loads the dataset/job through
   `datasetForTenant` / `jobForTenant`, which return 404 cross-tenant.

## 3. Persistence: reuse the durable Job machinery, with one trap

A workflow run is persisted as a `Job` row with `kind: 'workflow'`:

- `payload`: `{ definition, version: 'workflow-engine-v1' }`.
- `checkpoint`: `{ currentStageIndex, stages: [{ kind, status, error }] }`
  plus small per-stage summaries (quality report, evaluate source/model/
  issue count, export composition report). Full stage outputs are NOT
  stored in the checkpoint; evaluation text stays in the response.
- `committed`: number of COMPLETED stages. `total`: stage count.
- `status`: `RUNNING` while executing, `PAUSED` on a failed stage,
  `COMPLETED` on success, `CANCELLED` on cancel.

**The trap (read before touching this):** the worker tick
(`src/app/api/worker/run/route.ts`) claims every `QUEUED` job and fails
unknown kinds with `UNKNOWN_JOB_KIND`. A workflow row must therefore
NEVER be `QUEUED`. v1 rows are created directly in `RUNNING` by the
workflow route itself, which is also the v1 executor, and they carry no
lease (`leaseOwner`/`leaseExpiresAt` NULL) so the worker's stale-lease
reclamation (`RUNNING` + expired lease → `QUEUED`) can never requeue
them. This is deliberate and load-bearing.

**v1 execution limit, stated plainly:** stages execute inside the API
request that starts/resumes the run, with state persisted after each
stage, so a crash leaves a resumable PAUSED/RUNNING row. That is
acceptable for the slice's bounded stages (curate/evaluate/export-gate
over already-loaded records — the same profile as the existing export
route), but it is NOT the worker-tick execution the platform's durable
contract describes. Full worker integration is the next step and must:
add a `workflow` branch to the worker tick that revalidates entitlement
via `assertJobRunnable`, sets a real lease, advances one stage per
tick, and persists via the lease-guarded `updateCheckpoint` /
`finishJob` helpers — never by unguarded updates. Until that lands, do
not describe workflow runs as worker-executed.

Because runs are `Job` rows, they already appear in the existing
tenant-scoped jobs view (`/api/jobs` filters by session tenant). v1
adds no UI.

## 4. How each stage reuses the existing Meta gates

No new gate is invented. For any stage that may call Meta, the order is
exactly the order the existing evaluate route uses:

1. `resolveMetaCall` (`src/lib/meta-gate.ts`) — fail-closed, in order:
   grace-expired restriction → hard ceiling unconfigured → counted
   spend at/over a cap or unreadable → entitlement gate → eligibility/
   consent → model resolution. A rejection returns a code, never a
   substitute model.
2. Spend reservation (`src/lib/spend.ts` `reserveSpend`) capped by the
   hard ceiling + tenant allowance, keyed by a fresh request key
   (`workflow-evaluate:<tenant>:<dataset>:<random>`). Max cost comes
   from `estimateMaxCostForPrompt` on the exact prompt sent; if the
   price is unknown or the ceiling is unconfigured, Meta is disabled
   for that stage (deterministic result, labelled).
3. The Meta call itself (`evaluateRecords`), with bounded retries for
   transient failures only (`withMetaRetry`, max 3, `meta-budget.ts`).
4. Settlement, following `WorkflowMetaInfo`:
   usage present → confirm at actual cost + `UsageLedger` row
   (`purpose: 'workflow-evaluate'`, model = resolved model, data class,
   plan snapshot, Contributor consent id when applicable);
   uncertain error (TIMEOUT / NETWORK_ERROR / PROVIDER_5XX) → reservation
   PENDING, never $0; any other failure → release.
5. Output validation: Zod schemas in `meta-workflows.ts`. Invalid or
   unparseable output falls back to the deterministic result and is
   labelled as such; usage/cost from the failed call is still settled
   (the call ran).

With no key configured (`metaConfigured()` false), step 2 is skipped
and the stage returns the deterministic result labelled
"Meta not configured" — no Meta call is attempted, and the test
`workflow-engine.test.ts` proves this without network or DB.

Per-workflow spend caps (a budget for the whole run, not just one call)
are FUTURE: v1 settles per stage exactly like the standalone routes.
A run-level cap must be a reservation held across stages, which needs
the worker-tick execution in §3 first; otherwise a crash between stages
could strand the reservation.

## 5. 70/30 enforcement around synthesis (and at export in v1)

Composition is always computed from persisted provenance, never from
model claims:

- Record categories mirror the export route exactly:
  authentic = `AUTHENTIC_VERIFIED`; synthetic = `SYNTHETIC` +
  `AI_AUGMENTED`; unknown = `UNKNOWN` + `AUTHENTIC_UNVERIFIED`;
  `DERIVED_SOURCE_PRESERVING` counts in the total but neither side.
- The hard gate is record-weighted (`validateTrainingComposition`):
  authentic ≥ 70% and synthetic ≤ 30% (integer-product comparison, no
  float boundary errors) and unknown = 0. Token-weighted fractions are
  reported; they become a hard gate only under `STRICT_TOKEN_GATE`.
- In v1, the export stage applies this gate and blocks a noncompliant
  training dataset (`EXPORT_BLOCKED_NONCOMPLIANT`, HTTP 409 semantics
  in the route response, run PAUSED). Simulation-purpose datasets are
  not blocked, matching the export route.
- For the FUTURE synthesize stage, the gate must additionally run
  BEFORE writing: `checkCompositionInTx` inside the same transaction
  as the insert (the augment worker's pattern), so concurrent jobs
  cannot jointly breach the cap, and synthetic `recordKey`s must be
  unique per job (`<base>-syn-<jobId>-<i>`) for replay idempotency.
  A post-synthesis re-check is required before the run may proceed to
  export; a breach pauses the run and must not be "fixed" by rewriting
  provenance.

## 6. Failure modes considered

| Failure | Mitigation in v1 (or FUTURE) |
|---|---|
| Stage throws / gate blocks export | Run PAUSES with the error; later stages never run; resume retries the failed stage only. |
| Cross-tenant access | `datasetForTenant`/`jobForTenant` (404) + `assertWorkflowTenant` on every access; tested. |
| Worker claims a workflow row | Never `QUEUED`, no lease (§3). FUTURE worker branch must use lease guards. |
| Meta call fails transiently | `withMetaRetry` (3 attempts); uncertain errors leave the reservation PENDING, never $0. |
| Malformed model output | Zod validation → deterministic fallback, labelled; usage still settled. |
| Paused evaluate leaves a reservation | Accepted, documented: a resume creates a fresh reservation; the old one stays PENDING for reconciliation, exactly like a failed standalone evaluate call. |
| Crash mid-run | State persisted per stage in `checkpoint`; resume continues from the failed/current stage. |
| Empty dataset | Curate fails `EMPTY_DATASET` → run PAUSES before any Meta call. |
| Model output tries to change quotas/auth/composition | Impossible by construction: stage results are reports; quotas, auth, and composition are computed deterministically from DB rows, never from model text. |
| Unpaid / restricted tenant | The evaluate stage reuses the same entitlement gate as the standalone routes; the export stage reuses the export gate's 402 semantics via the route's tenant check. Per-tier workflow availability (e.g. restricted = deterministic only) is already the gate's behavior, not a new rule. |

## 7. What the slice deliberately leaves out, and why

- **Synthesize / secure / enrich stages** — synthesize needs Option A
  authorization; secure needs a PII-scope decision (flag-only vs
  redact, and redaction needs repair approval); enrich needs a
  provenance ruling for enriched fields. Each is a decision, not just
  code, so none is smuggled into the slice.
- **Worker-tick execution** — needs a worker-branch change plus lease
  discipline; the API-driven v1 is honest about its limit (§3).
- **Run-level spend caps, branching, parallel stages, file delivery
  from the export stage, UI builder** — all FUTURE, each listed with
  its prerequisite above rather than half-built.
- **Demo-mode (file store) workflows** — the file store has no Job
  persistence for run state, so the route returns 503
  `DATABASE_NOT_CONFIGURED` there, matching the export route's stance
  that demo data is never an entitled export.

## 8. Evidence (v1)

- `src/lib/workflow-engine.test.ts`: deterministic vitest cases —
  definition validation (order, unknown/future stages, duplicates,
  empty), stage ordering, failed-stage pause + resume, 70/30 gate at
  export (over-cap, unknown-provenance, compliant, simulation purpose),
  tenant isolation (guard + cross-tenant resume rejection), and no
  Meta call when unconfigured (`evaluateRecords` returns deterministic
  with null usage and no network).
- Route: `POST /api/datasets/[id]/workflow` (start/resume),
  `GET /api/datasets/[id]/workflow?runId=…` (state). No UI change:
  runs surface in the existing tenant-scoped jobs view.
- NOT verified in v1: any live Meta call, worker-tick execution,
  production behavior. Those need staging validation and, for Meta,
  the standing rule that no paid call runs without separate
  authorization — v1 makes zero paid calls.
