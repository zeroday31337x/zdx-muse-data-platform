# Integration harness contract — future implementation

The offline Q0 suite is deliberately dependency-free, has no secrets, and can execute before the service is ready.

Once the actual API is implemented, add **opt-in** integration suites rather than guessing nonexistent endpoints:

1. **Contract map:** derive route paths, JSON schemas, auth flows, job transitions and HTTP status from source. Maintain a checked-in OpenAPI document validated against runtime.
2. **Disposable environment:** isolated PostgreSQL, ephemeral object-store namespace, fake external Meta transport, seed fixtures that are entirely fabricated and explicitly labeled TEST_ONLY. Never run these against production.
3. **Tenant tests:** two independent accounts/organizations and roles, unknown authorization context, cross-tenant object URLs, direct record IDs, per-route deny checks.
4. **Failure injection:** fake provider transport supports success, malformed output, 401, 402, 403, 429+Retry-After, 5xx, timeout, cut stream, canceled requests; deterministic clock/lease mock supports stale job ownership.
5. **Actual provider smoke:** separate secrets-protected job under operator control, cost cap, strict allowlist, timeouts and redacted logs. CI without credentials should mark it NOT_RUN rather than falsely passed.
6. **Browser E2E:** use Playwright in a disposable staging environment for upload, source report, plan approval, progress, record review, quality report, policy violation, authorized export.
7. **Recovery tests:** simulate worker kill at each transaction boundary; assert no duplicate committed records and correct lease fencing on restart.
8. **Performance:** bounded representative uploads, p95 API latency, worker throughput, memory and disk consumption measured on 2 vCPU/12 GB Oracle ARM64 with 27 GB free disk baseline. Record what was actually measured.

Define provenance classification for generative labels, derivative records, and token-weighted units before accepting training-data compliance as verified. QA contract files are not the production source of truth; application must use transactionally enforced policies.
