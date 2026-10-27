# Model Split — Muse Only, $150 Budget

**Platform rule, in one sentence:** The platform uses only Muse models on the Meta Model API, and the model is chosen by data sensitivity first, cost second — never the other way round.

This document is the single source of truth for that split. If code, AGENTS.md, SKILL.md, or a demo contradicts it, this document wins and the code must be fixed.

## 1. The models

| Job | Model ID | When to use it |
|---|---|---|
| Default text, reasoning, agents, coding, chat, capsule work | `muse-spark-1.3-contributor` | Public, demo, test, and hackathon data only |
| Private / sensitive text and reasoning | `muse-spark-1.3` | Any private, proprietary, or user-confidential data |
| Image generation / editing, only on demand | `muse-image-1.0` | When a feature explicitly needs a new image |
| Segmentation, boxes and masks | `sam-3.1` | When a feature explicitly needs segmentation |
| Speech-to-text, only on demand | `muse-voice-transcribe-1.0` | When a feature explicitly needs transcription |

Base URL for all of the above: `https://api.meta.ai/v1`
Auth: Bearer `MODEL_API_KEY`, server-side only. Never in browser code, never in the repo.

**Excluded by default:**
- `muse-wonder-1.0` — frontier pricing ($4 / $20 per million input/output tokens in published pricing) would burn the $150 grant in a handful of heavy runs, and it has no Contributor discount. Use only if explicitly approved for one single task, with its cost logged first.
- Any non-Muse provider — the platform constraint is Muse only.
- Any open-weight / self-hosted model for platform runtime in the hackathon build — it breaks the Muse-only rule for this submission, even if the weights are Meta's.

## 2. The split, made unmistakable

### Contributor — `muse-spark-1.3-contributor`

- Price: $0.10 input / $0.002 cached input / $0.20 output per million tokens.
- Rate limit: 100 requests/min, 3,000,000 tokens/min per team.
- Data use: Meta may use prompts and completions to improve its products / train future models. That is the price of the discount.
- Use for: public demo data, synthetic data, open-source code, published docs, hackathon test prompts, knowledge-capsule ingestion of public material, bulk summarisation of non-sensitive material.
- Never use for: private user data, proprietary startup code, unreleased plans, credentials, secrets, personal data, anything under NDA, anything a user has not explicitly consented to share for training.

### Standard — `muse-spark-1.3`

- Price: $1.25 input / $0.15 cached input / $4.25 output per million tokens.
- Rate limit: 3,000 requests/min, 4,000,000 tokens/min per team.
- Data use: labelled "not used to improve our products" — Standard does not train on your prompts. Note carefully: "not used for training" is not a promise of zero retention, logging, or abuse monitoring. Read Meta's current data terms before sending highly sensitive material through either tier.
- Use for: private capsules, user data, proprietary code, internal documents, production-path requests, and any request where the user has not consented to training use.
- Max reasoning mode is Standard-tier only. If a task truly needs max reasoning, it must be Standard, and its cost must be approved in advance.

### The decision rule (apply in order)

1. Is the input or capsule private, proprietary, personal, or under NDA? → Standard.
2. Has the user explicitly consented to training use for this exact data? If no → Standard.
3. Otherwise → Contributor.

If in doubt, choose Standard. Cost is recoverable; a training disclosure is not.

## 3. Knowledge capsules and the split

A knowledge capsule is a unit of memory the platform retrieves *before* it acts. Capsules must be classified at write time, not at call time:

- **PUBLIC capsule** — published / demo / synthetic content → Contributor allowed.
- **INTERNAL capsule** — team demo material with no secrets → Contributor allowed, only if no private data slipped in.
- **PRIVATE capsule** — user data, proprietary work, unreleased plans → Standard only, and the capsule itself must be marked `data_class=private`.
- **SECRET capsule** — credentials, keys, tokens, personal identifiers → never sent to any model. Redact or refuse. Secrets live in environment variables / a secrets manager, never in a capsule.

Routing code must read `data_class` from the capsule and select the model from that field. It must not guess from the prompt text, and it must not default to Contributor when the class is missing. Missing class = Standard, and log a warning.

Suggested environment variables:

```
MUSE_MODEL_DEFAULT=muse-spark-1.3-contributor
MUSE_MODEL_PRIVATE=muse-spark-1.3
MUSE_MODEL_IMAGE=muse-image-1.0
MUSE_MODEL_SEGMENT=sam-3.1
MUSE_MODEL_TRANSCRIBE=muse-voice-transcribe-1.0
MODEL_API_KEY=<server-side only, never committed>
```

## 4. Budget math for $150 (+ $20 interim)

On a typical 3:1 input-to-output mix:

- Contributor blended: (3 × $0.10 + $0.20) / 4 = **$0.125 per million tokens**
  - $150 ≈ 1,200 million tokens
  - $20 interim ≈ 160 million tokens
- Standard blended: (3 × $1.25 + $4.25) / 4 = **$2.00 per million tokens**
  - $150 ≈ 75 million tokens

That is why the default is Contributor for bulk work and Standard is rationed. It is not a reason to push private data to Contributor to save money.

Other meters that are *not* token price:
- Web search grounding: $2.50 per 1,000 queries, on top of tokens. Off by default. Enable only when a task explicitly requires live search.
- Muse Image: $0.01 per image. Generate on demand, cache results, do not regenerate the same image in a loop.
- SAM 3.1: priced per image / video frame in Meta's pricing. Use only when segmentation is the feature.
- Voice Transcribe: $0.18 per audio hour.

Cost controls, mandatory:
- Set the Spend Limit notification in dev.meta.ai Billing. Interim cap: $20 until the $150 grant shows under "free credits" in Billing. After the grant lands, set the notification to $150 and re-check daily.
- Cache repeated capsule context. Cached Contributor input is $0.002 per million vs $0.10 uncached — a 50× difference on repeated context.
- Log every call's model ID, data class, input/output token counts, and cost estimate. Do not log full private prompt content in that log.
- Stop and review at 50%, 80%, and 100% of budget. No silent overrun into card billing.

## 5. User-facing disclosure (copy this wording into the UI)

> **How your data is handled**
>
> This platform uses only Muse models on the Meta Model API.
>
> - **Public / demo requests** use `muse-spark-1.3-contributor`. Meta may use those prompts and completions to improve its products.
> - **Private requests** use `muse-spark-1.3` (Standard). Standard is not used to improve Meta's products.
> - Private data is never sent to the Contributor tier. If you are unsure whether your data is private, treat it as private.
>
> Your API key is never shown in the browser and is never stored in the public repo.

Show the model ID actually used for each request in the UI or debug panel, so a judge or reviewer can verify the split without trusting a claim in a README.

## 6. Common failure modes that lose points or get you disqualified

- Sending private code to Contributor "just for this one cheap call."
- Hard-coding a model ID in one file while AGENTS.md says another.
- Committing `MODEL_API_KEY`, an `LLM_` key, or a `.env` file to the repo.
- Calling the API from browser JavaScript, exposing the key.
- Generating images / running web search in a loop with no cache or cap.
- Using a non-Muse model "just for embeddings" or "just for a fallback." That breaks the Muse-only constraint for this platform.
- Submitting a demo video that shows a real API key, private data, or another person's code.

Fix any of these before submission, even if the demo still "works" with them in place. A working demo with a leaked key or a misrouted private capsule is a security failure, not a success.
