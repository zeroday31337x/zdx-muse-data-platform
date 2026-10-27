---
name: security-review
description: Review tenant isolation, trust boundaries, uploads, secrets, and model tool permissions before merging.
---
# Security Review
Use for architecture review, new API routes, model tools, upload paths, and release gates.

Verify authentication and tenant-scoped authorization at every read and mutation; cross-tenant IDs must fail closed.
Review input schemas, upload limits, content sniffing, SSRF and private network restrictions, path handling, output encoding, CSV injection, signed download scopes, and token/cost quotas.
Model-produced plans, SQL, code, tools, and file contents are untrusted. Enforce policy in deterministic code and explicitly allowlist tools.
Use least-privilege credentials and no browser-exposed secrets. No real customer data or internal infrastructure artifacts in this public repository.
Review audit logs for sensitive content leakage and logs for proper redaction.
Require negative authorization tests and adversarial input fixtures.
