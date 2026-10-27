# Security

## Threat model (Phase 1)

- Untrusted input: uploaded CSV/JSON/JSONL, URL imports, model outputs, knowledge capsules.
- Untrusted model output must never become code, SQL, shell, or a tool call without deterministic validation and an allowlist.
- Keys must never reach the browser, logs, repo, screenshots, or demo video.

## Controls implemented

- Server-side Meta calls only, Bearer key from environment, never committed (`.env` git-ignored, `.env.example` has no secrets).
- Zod validation on every API route.
- Ingest caps: 10 MB text, 10,000 rows per call, allowed formats CSV/JSON/JSONL only in the JSON ingest route.
- CSV formula injection: cells starting with `= + - @` tab or CR are prefixed with `'`.
- SSRF: only HTTPS, block localhost, private (10/8, 172.16/12, 192.168/16), loopback, link-local 169.254, metadata hosts. Redirect/DNS-rebinding defence is a Phase 2 hardening item for live URL fetching — the current ingest route does not fetch URLs; validateUrlForImport is provided and tested for the future fetch path.
- Composition gate at augment time and again at training export. Export is blocked with exact numerator/denominator on violation.
- Usage logging is metadata only (model, tokens, cost estimate), not private prompt bodies.
- Tenant in Phase 1 is a single demo tenant. Cross-tenant isolation is NOT yet implemented — do not put real customer data on the demo deployment. Multi-tenant auth is Phase 2 and must be completed before any production use.

## Pre-submit security scan

Run before every submission:
```
grep -R -E "MODEL_API_KEY=|LLM_|sk-[A-Za-z0-9]|Bearer [A-Za-z0-9]" --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git . || true
git status --short
```
Any hit must be removed and the key rotated before submitting.
