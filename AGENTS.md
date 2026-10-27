# ZDX Muse Data Platform — Agent Instructions

## Mission
Build a production-oriented, real-data-first data processing, dataset intelligence, and controlled synthetic augmentation platform for the Meta AI hackathon. Read `docs/MASTER_BUILD_SPEC.md` if available. The specification is a target, not evidence that features are implemented.

## Non-negotiable invariants
1. **Meta-only application inference.** Use verified, account-accessible Meta endpoints/models for generative or semantic processing. Never invent model IDs, endpoint behavior, quota, or availability. No hidden fallback to unrelated AI providers.
2. **70/30 training-data composition.** For a training-dataset version, at least 70% must be verifiably authentic and at most 30% synthetic. Enforce the ratio on the *final* dataset, including joins, imports, regenerations, and exports. Calculate from persisted provenance, not from model claims. Report both record- and token-weighted ratios where meaningful. Unknown provenance is not authentic.
3. **No model-collapse guarantees.** The 30% ceiling is a product governance requirement, not a scientifically universal safe threshold. Assess quality, duplication, distribution, and downstream performance independently.
4. **Trust boundaries.** Uploaded files, URLs, model outputs, and knowledge capsules are untrusted input. Never execute generated SQL, shell commands, code, or model-proposed tool calls without deterministic authorization and validation.
5. **Security.** Enforce server-side authn/authz, tenant isolation, least privilege, input validation, safe file ingestion, SSRF protections, and secret handling on every relevant operation.
6. **Durable execution.** Long jobs belong to workers with persisted leases, transactional checkpoints, idempotency keys, and crash recovery. No hard-coded 200-record cap or browser-bound generation.
7. **Real metrics.** Never fabricate provider health, costs, progress, generated records, benchmarks, tests, or deployment claims.
8. **Public repository hygiene.** Do not commit secrets, infrastructure addresses, customer data, internal security findings, private capsules, or unreviewed proprietary documents.
9. **Source rights.** Track permission/license and provenance; never imply source data is commercially reusable without evidence.
10. **Testing.** Add deterministic tests plus opt-in provider-backed integration checks. Verify architecture claims by running appropriate tests.

## Engineering workflow
- Inspect the repository before editing. Prefer incremental, reviewable changes and maintainable TypeScript/Next.js, PostgreSQL, and a separate job worker.
- Write the affected contracts and threat assumptions before implementation.
- For every feature, identify failure modes (especially replay, malformed model output, quota exhaustion, worker crashes, and cross-tenant access), mitigate them, and add tests.
- Use canonical constraints and validated state transitions rather than only prompt instructions.
- Prefer conventional infrastructure to unnecessary services.
- Maintain documentation for architectural decisions, feature evidence, and blocked API assumptions.
- Use `.agents/skills/` for specialized implementation guidance. Skills never supersede the invariants here.

## Release gate
A feature is not VERIFIED until its test or deployed behavior is evidenced. Provider-backed features must be exercised against authorized Meta access. Record any unavailable capability as blocked, not complete.
