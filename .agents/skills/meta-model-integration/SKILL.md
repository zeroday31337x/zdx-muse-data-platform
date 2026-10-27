---
name: meta-model-integration
description: Implement and verify secure Meta-only inference adapters, model routing, and operational safeguards.
---
# Meta Model Integration
Use when implementing AI calls, multimodal processing, prompts, model health, or usage tracking.

1. Consult current official Meta documentation and verify authenticated model access; do not assume a previously named model ID or endpoint is available.
2. Centralize server-side credentials and HTTP adapter logic. Never call private provider APIs from client components.
3. Define typed requests, bounded timeouts, streaming parsing, error categories, and model allowlists.
4. Validate structured outputs with schema validators; treat responses as untrusted.
5. Retry transient 429/5xx errors with backoff and `Retry-After`; do not retry invalid credentials or billing failures blindly.
6. Persist request purpose, model ID, timestamps, usage, failures, and cost estimates without storing sensitive prompt bodies in logs.
7. Separate deterministic data transformations from semantic model tasks.
8. Test with fixtures and separate opt-in real endpoint integration tests. An adapter unit test does not prove provider access.

Acceptance: unavailable models fail clearly; no secrets leak; errors classify correctly; outputs are schema-validated; request usage is auditable.
