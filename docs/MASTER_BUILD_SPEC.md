# ZDX Muse Data Platform — Master Build Specification
**Revision:** 2026-10-27  
**Status:** Implementation directive (not implementation evidence)  
**Repository:** zeroday31337x/zdx-muse-data-platform  
**Objective:** Rebuild and substantially improve ZDX Data Synthesis with Meta-powered data intelligence, real-data-first processing, provenance, and controlled synthetic augmentation.

## 0. Rules of engagement
- Develop as a new hackathon project; review actual competition rules on pre-existing code and code disclosure before copying proprietary implementation.
- Use Muse Code as the development environment and **only verified Meta models/endpoints for generative and semantic inference**. Do not assume any particular model or endpoint is accessible without account-backed tests.
- Preserve an independently useful data-processing path when inference is unavailable. No silent non-Meta inference fallback.
- Treat raw source material, retrieved content, and model outputs as untrusted.
- Treat this specification as desired behavior, not proof a capability is deployed.
- Respect legal source-data rights and customer privacy. No real tenant records, credentials, private capsules, or infrastructure details in public GitHub.
- Implement the mandatory invariants in root `AGENTS.md` and specialist skills.

## 1. Product positioning and use cases
**ZDX Muse Data Platform** ingests authorized authentic data, understands and improves it, creates high-quality training-ready datasets, and optionally augments them with strictly bounded synthetic contribution.

Priority use cases:
1. Enterprise data preparation: CSV/JSON/JSONL/Excel/document source ingest, normalize, deduplicate, enrich, validate, export.
2. AI training data: instruction/response, chat turns, tool trajectories, classification, extraction, RAG question/answer records with source references.
3. Commerce operations: process real licensed catalogs and transaction datasets, repair integrity defects, augment minority scenarios without representing invented purchases as historical facts.
4. Document intelligence: source-grounded entities, labels, summaries, and structured extraction with per-field evidence.
5. Multimodal: real media ingestion; verified Meta vision/audio/segmentation services for annotation; generated media explicitly synthetic.

Do **not** center the product demo on a wholly synthetic training corpus. Fully synthetic business simulations can live in a separately labeled test-fixture mode and do not qualify as compliant authentic training data.

## 2. Non-negotiable 70/30 governance
Training-ready dataset versions require >=70% VERIFIED_AUTHENTIC and <=30% SYNTHETIC contributions to the **final** dataset. UNKNOWN and unverified origin cannot satisfy the authentic requirement. Define `TRANSFORMED_DERIVED` and classification inheritance rigorously; cosmetic normalization is not new independent authentic evidence.

For record-based eligible datasets:
- `total = authentic + synthetic + unknown_or_unclassified`
- `authentic/total >= 0.70`, `synthetic/total <= 0.30`, and unknown must not pass as authentic. Under the stricter default, block export when unknown >0.
- If authentic A and synthetic S only, `S <= floor(3*A/7)`.
- Recheck constraints at preview, job admission, per-commit batch, version merge, and **every training-ready export**. Avoid concurrent racing batches violating the cap; enforce under transactional locks or serializable reconciliation.
- Track record-weighted and token-weighted composition for text training; use appropriate unit accounting for images/audio.
- Rewritten/generative field content, augmented examples, model-generated labels, copied rows and their lineage must follow a documented derivation policy; do not count duplicates as independent authentic observations.
- Surface source rights, provenance status, and composition charts in UI and export manifest. No claims that 30% prevents model collapse; evaluate drift and downstream performance.

## 3. Architecture
- TypeScript strict throughout.
- Next.js App Router + React + Tailwind for authenticated application shell; accessible forms and datasets explorer.
- Server-side API with Zod validation and explicit authn/authz.
- PostgreSQL + Prisma migrations for relational entities, metadata, job checkpoints, tenant isolation, and provenance graph.
- A **separate long-running Node worker** with database-backed durable queue (consider pg-boss after compatibility assessment), leases, idempotent batches, and checkpoint transactions.
- S3-compatible object storage for untrusted uploads, chunk artifacts, exports, media, and dataset snapshots. Encrypted private buckets, presigned upload/download with content limitations.
- SSE for progress (database remains authoritative); server-side cursor pagination for high-volume records; bounded async exports.
- Docker deployment, independently runnable web and worker processes, explicit config templates. No Vercel requirement; do not couple to existing ZDX inference or memory pools.
- Avoid Kubernetes, Kafka, and microservices without demonstrated need.

## 4. Functional modules
### A. Overview
Real counts only: datasets, active/failed jobs, committed records, validated counts, quality summaries, storage, model usage and cost. Empty, loading and error states.

### B. Dataset Studio
Purpose/use-case/format entry; upload references; source preview; semantic analysis; generated schema proposal; user corrections; explicit immutable versioned plan approval; constrained generation options; budget, quota and quality configuration; preview; monitor; review; export.

Two modes:
- Guided autonomous: plain-language intent with inspectable proposed plan.
- Advanced: fields, relations, constraints, distributions, source mapping, policy, batch settings and evaluation gates.

### C. Source Intelligence
Inputs: CSV, JSON/JSONL, TXT, MD, safely parsed PDF/DOCX/XLSX, bounded archive extraction, authorized HTTPS imports, supported images/audio. Add video only when ingestion and provider support are verified.

Validate file signature, MIME, extension, size, decompression ratios, path traversal, upload quotas, malware policy and tenant object access. SSRF restrictions must block private/loopback/link-local/metadata hosts through redirects and DNS rebinding defenses.

Parse deterministically. Chunk with document boundaries; persist hashes, origin, license evidence, extractor version, references and confidence. Meta handles semantics: schema inference, topic/entity relations, ambiguity, contradictions, classification and transform suggestions. Extractor must not follow embedded instructions.

### D. Schema & Plan Architect
Meta creates a **proposal** for schema, source mappings, generation/augmentation targets, constraints, source gaps, evaluation rubric and resource cost. Deterministic code validates and freezes approved execution specs. Never permit model plans to execute arbitrary SQL/code or change permissions.

### E. Processing and controlled augmentation
Support cleaning, column normalization, deduplication, mapping, joins, type conversions, statistical profiling, pseudonymization, masking, extraction, classification and enrichment. Preserve lineage and track semantic additions.

Generate contextual augmentation only within the 30% cap for training sets. Code constructs IDs, arithmetic, foreign keys, temporal consistency and sampling. Meta supplies language/semantic content. Batch dynamically within token, time, rate and spend budgets. No hard-coded 200 record cap.

### F. Quality Lab
Deterministic gates: schema/type checks, required fields, uniqueness, referential integrity, financial equations, chronology and validation coverage. Statistical: distributions, class imbalance, diversity, anomaly rates, near duplicates and overlap/contamination detection. Semantic: source fidelity, factual consistency, intended label correctness and evaluation uncertainty. Privacy: memorization/leakage and sensitive data screening. For downstream training, hold out real evaluation sets and measure observed performance wherever feasible.

Model-based judge scores are estimates, not truth. Provide per-dimension results, failure samples, and meaningful denominators.

### G. Targeted repair
Classify failures, deterministically fix safe ones, use Meta for semantic fixes only when needed, validate again, audit versions and cost, quarantine unresolved records, bounded attempts. Never silently omit difficult records to inflate quality.

### H. Explorer/review
Cursor pagination, search/filter/sort, record details, provenance links, schema/validation flags, edits with audit trail, accept/reject/repair, bulk actions and dataset version comparison. Server-side authorization at every endpoint.

### I. Export
JSON/JSONL/CSV and validated Parquet if practical. Optional Hugging Face style layouts, chat/tool trace formats, provenance manifests, quality report, model usage, rights notice and checksums. Background streaming exports with signed expiring links. Final 70/30 composition gate enforced transactionally on immutable dataset version.

### J. Meta operations
One typed server adapter; verified model allowlist; authenticated connectivity probes; structured response validation; bounded timeouts; streaming; usage and latency accounting; provider cost and quota tracking; transient 429/5xx backoff with Retry-After; never retry auth/billing/config errors as transient. Track availability without fabricated success. Model IDs/endpoint URL must be verified from current official docs **and** live account capabilities before hardcoding. Keep Standard/non-training processing settings for proprietary content where offered and contractually appropriate.

### K. Optional multimodal
On a working baseline, add accessible Meta image/audio/segmentation capabilities for source labeling, transcription, annotation and controlled generated media. Gate each as unavailable until real provider-backed tests pass. Keep modalities separate from fake universal record-count semantics.

## 5. Durable state machine
Suggested statuses: DRAFT, ANALYZING, READY, QUEUED, RUNNING, VALIDATING, COMPLETED plus PAUSING, PAUSED, CANCELLING, CANCELLED, FAILED, PARTIAL, NEEDS_REVIEW.
- Use explicit transition table and immutable approved plan snapshots.
- Workers claim bounded leases with fencing tokens; refresh while active.
- Atomically persist accepted records, rejection outcomes, counters and checkpoints under stable job/batch/record unique constraints.
- Crash after model call may incur repeated provider spend, but must not double-commit records.
- Queue may deliver more than once; job runner must be idempotent.
- Reconnection recovers progress from database, never fabricated percentages.
- Pause, cancel, resume and retry paths must be tested around commit races and lease expiration.

## 6. Persistence model
At minimum: users, organizations, memberships, projects, datasets, versions, schemas, sources/files/chunks, source-rights evidence, records, lineage edges, transformation steps, plans, jobs, batches/checkpoints/leases, validation outputs, repairs, model invocations/cost ledger, exports, audit events.
Use tenant-scoped keys/queries, indexes for large record scans, JSONB for flexible payload only, and object store for large bodies. No unbounded blobs in transactional job state.

## 7. Security
Every mutation and read is authenticated and tenant-authorized. Defend file processing, downloads and URL imports; prevent prompt injection and unsafe model tool execution. Use rate limits and quotas; secrets from managed environment only. No credentials in browser, logs, repo, sample files or screenshots. Minimize sensitive model requests and retention. Log event metadata, not raw sensitive documents. Implement anti-CSRF/session protections where applicable. Audit administrative actions and data exports. Confirm dependency licensing and data permissions.

## 8. UX
Professional application shell: Overview, Dataset Studio, Sources, Jobs, Quality Lab, Explorer, Exports, Models, Settings. Expose stage-by-stage workflow Sources → Understanding → Schema → Planning → Processing/Augmentation → Validation → Repair → Export, with user approvals at important irreversible transitions.

Show committed vs requested counts, provenance breakdown, source gaps, acceptance/rejection, true progress, quota consumption, cost estimation and recoverable errors. Design keyboard-accessible responsive interfaces and avoid giant browser-loaded datasets.

## 9. API design
Versioned authenticated operations for dataset CRUD, upload start/complete, analysis, schema/plans, preview, jobs pause/resume/cancel, SSE, record listing/review/repair, metrics, exports and model operations. Zod request/response validation, cursor pagination and consistent typed errors. Idempotency keys for mutating retryable operations. Version contract changes.

## 10. Delivery milestones
0. Verify hackathon rules; inspect existing ZDX system read-only; establish baseline inventory, new repository and authenticated Meta smoke call. Record accessible models and cost/quota.
1. Vertical slice: source ingest → deterministic parse → Meta analysis → plan approval → transform/augment within cap → validation → persisted records → JSONL export.
2. Reliability: real queue/worker, leases, checkpoint recovery, repeat-safe persistence, pause/resume/cancel, usage/budget controls, SSE.
3. Commercial differentiation: relational integrity, document provenance, quality and targeted repair, governed versioned exports and Explorer.
4. Optional multimodal verified provider capabilities and deeper advanced UX.
5. Deployment verification, hardening, CI, benchmarks, documented demo and submission package.

Timebox aggressively for the November 4 hackathon deadline. Cut optional breadth before sacrificing end-to-end correctness.

## 11. Mandatory test scenarios
- Authorized ingest and export; hostile archive, SSRF/redirect, CSV formulas, incorrect MIME, cross-tenant ID leakage.
- 70/30 boundary at 0, 1, 30%, >30%, unknown provenance, merges, derived duplicates, regen and concurrent batch commits.
- No authentic corpus → training-ready export blocked; synthetic-only fixture mode remains clearly segregated.
- Model malformed JSON, provider 401/403/402/429/5xx, timeouts, quota exhaustion, partial streaming response.
- 10k+ bounded test records (without assuming Meta quota supports AI generation of them all), real pagination and export checksum.
- Kill/restart worker after batch commit, before commit, mid-call; ensure correct resume and no duplicate records.
- Invalid relationships, bad financial totals, quality repair failure, privacy and provenance checks.
- Genuine provider-backed happy-path smoke test in opt-in CI/controlled runtime; never claim mocked calls prove integration.

## 12. Acceptance criteria
One real authorized source file can be uploaded, analyzed by an accessible Meta model, mapped to a reviewed schema, processed into a validated, auditable training-ready dataset (within applicable composition limits), and exported with provenance report. Job survives worker interruption without duplicate persisted rows. Cross-tenant access is rejected. Metrics and health claims reflect actual running infrastructure. Tests and deployment results are recorded, not asserted.

## 13. Project conduct
Keep `docs/implementation-status.md` with PLANNED/IMPLEMENTED/TESTED/DEPLOYED/VERIFIED states and evidence links. Review architecture, cost and safety before each milestone. Commit incremental reviewable changes, run type-check/lint/tests, do not silently change provider, do not copy private registry capsules. The original ZDX production service is reference-only unless separate authorization permits safe integration.
