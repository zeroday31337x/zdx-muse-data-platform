# Model capabilities — verified vs claimed

Status as of 2026-10-27. Nothing below is marked VERIFIED_WITH_META unless a live call with the founder's dev.meta.ai account has actually succeeded and been recorded.

## Verification note (2026-10-27, Phase 2)

Model IDs, base URL `https://api.meta.ai/v1`, and the pricing table below are corroborated by multiple independent secondary summaries of Meta's published pricing (checked 2026-10-27). A direct read of the official dev.meta.ai pricing page was not obtained in this session, so pricing is NOT claimed as directly verified from the official page — it is corroborated, and must be re-checked against the official page and the founder's live account before submission. Endpoint shape (OpenAI-compatible Chat Completions, Bearer MODEL_API_KEY) is likewise corroborated, not live-verified. The adapter is built to fail clearly if the endpoint, model ID, or entitlement differs in practice.

## Allowlist (Meta Model API, https://api.meta.ai/v1)

| Model | Price (per million tokens, unless noted) | Data use | Rate limit |
|---|---|---|---|
| muse-spark-1.3 | $1.25 input / $0.15 cached / $4.25 output | Not used for training | 3000 RPM / 4M TPM |
| muse-spark-1.3-contributor | $0.10 input / $0.002 cached / $0.20 output | May be used for training | 100 RPM / 3M TPM |
| muse-image-1.0 | $0.01 per image | — | — |
| muse-voice-transcribe-1.0 | $0.18 per audio hour | — | — |
| sam-3.1 | Per image / video frame in Meta pricing | — | — |

Excluded by default: muse-wonder-1.0 ($4 / $20 per million tokens, no Contributor discount). Enable only with MUSE_ALLOW_WONDER=true and a logged cost approval.

## What is actually tested in this repo

- Adapter unit tests: allowlist, private-to-Contributor refusal, secret refusal, error classification — TESTED (fixtures, not a live call).
- Analyse route: if MODEL_API_KEY is absent, it returns deterministic analysis and says so explicitly. It does not fake a Meta result.
- Image, voice, and SAM routes: NOT implemented in Phase 1. They are in the allowlist and pricing table only. Do not claim them as working features until a live test passes.
- Live Meta smoke test: PLANNED, blocked on the $150 grant landing in Billing (expected ~29 Oct) and on the founder providing a server-side key for the deployment environment. Do not run live tests against the founder's card without that key and a Spend Limit notification in place.
