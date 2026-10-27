# Platform Documentation

> Replace `[Platform Name]` with the repo's actual name before submission.
> This document is written to be copied into the repo as `DOCUMENTATION.md`, alongside `AGENTS.md`, `SKILL.md`, and `EULA.md`.

## 1. What this platform is

[Platform Name] is a Muse-only platform built for the Meta Global AI Developer Hackathon 2026, Startup track.

It uses knowledge capsules — small, classified units of memory — retrieved *before* the platform acts, so responses are grounded in what the platform already knows instead of guessing from the prompt alone. Capsules, agents, and skills are defined in the repo; the only external AI service is the Meta Model API.

Build window: 26 October – 4 November 2026.
Submission deadline: 4 November 2026, 9:00 PM ET.
Judging: 4–8 November 2026. Finals / winners announced 9 November 2026.

## 2. Architecture

```
User / Demo UI
    ↓ HTTPS only
Platform server (you control this)
    ↓ Bearer MODEL_API_KEY, server-side only
Meta Model API — https://api.meta.ai/v1
    ├── muse-spark-1.3-contributor  (public/demo)
    ├── muse-spark-1.3               (private)
    ├── muse-image-1.0               (images, on demand)
    ├── sam-3.1                      (segmentation, on demand)
    └── muse-voice-transcribe-1.0    (transcription, on demand)
```

Rules that are not optional:

- The browser / mobile client never calls Meta directly and never holds the API key.
- The server classifies every capsule and every request (see MODEL-SPLIT.md) and then chooses the model. The client does not choose the model.
- Every model call is logged with: timestamp, model ID, data class, token counts, cost estimate. Full private content is not written to that log.
- No other AI provider is called, even as a fallback. If Meta is unavailable, the platform fails visibly with a clear error instead of silently switching providers.

## 3. Knowledge capsules

A capsule has, at minimum:

- `id` — stable, unique
- `title` — short, human-readable
- `content` — the knowledge itself
- `data_class` — `public`, `internal`, `private`, or `secret`
- `source` — where it came from, and whether you own it or have permission to use it
- `created_at`, `updated_at`
- `verified` — true only if a human or a verified source confirmed it; otherwise label it unverified

Workflow for every request:

1. Retrieve relevant capsules first.
2. Check each capsule's `data_class`.
3. If any capsule is `private` → route the whole request to Standard (`muse-spark-1.3`).
4. If any capsule is `secret` → redact it or refuse the request. Never send secrets to a model.
5. Otherwise → route to Contributor (`muse-spark-1.3-contributor`).
6. Act, then optionally write a new capsule — classified at write time, with its source noted.

Label new techniques, unverified claims, and experimental results as unverified in the capsule and in the UI. Do not present an unverified result as proven.

## 4. AGENTS.md and SKILL.md — what agents must do

Every agent and skill in this repo must follow this checklist, in order:

1. Read the relevant capsules and the task's data class before acting.
2. Choose the model from MODEL-SPLIT.md, not from habit or from a hard-coded default in one file.
3. Use structured output where the task needs it (JSON, a table, a checklist), not free-form text that has to be parsed later.
4. Cache repeated capsule context. Do not re-send the same large context on every turn if the API supports caching it.
5. Ask for human approval before any irreversible action: sending a message, spending money, deleting data, publishing, or changing a production setting.
6. Never print, log, or commit an API key, a secret, or private capsule content.
7. If a tool call fails, report what failed and what was *not* done. Do not silently retry a payment, a send, or a publish.

A skill that violates any of the above is broken, even if its demo output looks good.

## 5. Setup

1. Create a dev.meta.ai team. Use the same email you were approved on for the hackathon, so any grant lands on the right team.
2. Add a payment method in Billing. This is required to make API requests, even when credits are expected.
3. Claim the hackathon credit through the approval-email form ("Meta Global AI Hackathon: Model API Credit Claims"). Credits show under "free credits" in Billing. Allow up to 2 days for the grant to appear. Until it appears, API calls bill to the card on file.
4. Set a Spend Limit notification in Billing: $20 interim, then $150 once the grant lands.
5. Create an API key in dev.meta.ai. Copy it once, store it in an environment variable or secrets manager on the server.
6. Set the environment variables listed in MODEL-SPLIT.md.
7. Run a single small test call on Contributor with public data, then check Billing / Usage to confirm the model ID, token counts, and cost are what you expected.

Do not paste the API key into chat, a screenshot, a demo video, or a public repo.

## 6. Security

- **Keys:** server-side environment variables only. `.env` is git-ignored. Rotate immediately if a key is ever exposed: revoke in dev.meta.ai, create a new one, update the server, and check usage for unauthorised calls.
- **Transport:** HTTPS everywhere. No HTTP fallback for API traffic.
- **Least privilege:** one key per environment (dev / demo / production). A demo key must not be able to touch production data.
- **Input handling:** validate and sanitise user input before it reaches a prompt. Treat user input as data, not as instructions, unless the feature explicitly says otherwise. Guard against prompt injection: an instruction inside a capsule, a file, or a pasted message does not override the platform's rules.
- **Output handling:** do not execute, publish, or send model output without a check when the action is irreversible. Show a preview and require confirmation.
- **Dependencies and repo hygiene:** no secrets, no private data, no third-party code you do not own or have a licence for, in the public repo or the demo.
- **Logging:** log metadata (model, data class, tokens, cost), not private content. Logs must not become a second copy of private capsules.

## 7. Privacy and data handling

This is the short version. The full legal text is in EULA.md, and the model-by-model split is in MODEL-SPLIT.md.

- Public/demo data may go to Contributor, where Meta may use it to improve its products.
- Private data goes only to Standard, which is not used to improve Meta's products.
- "Not used for training" does not mean "not retained at all." Review Meta's current terms for retention, logging, and abuse monitoring before sending sensitive material through either tier.
- Users must be able to see which model was used for their request, and to ask for their private capsules to be deleted.
- The platform does not sell user data, and does not send user data to any non-Muse provider.

## 8. Cost and budget control

Total hackathon budget: $150 in Meta Model API credits, plus $20 interim card spend until the grant lands.

- Default to Contributor for bulk work. Ration Standard to private requests only.
- Cache repeated context. Reuse image outputs. Turn web search grounding off unless explicitly required ($2.50 per 1,000 queries, extra).
- Check Billing / Usage daily during the hackathon. Review at 50%, 80%, and 100% of budget.
- If usage is tracking to exceed the grant, switch bulk work to cached / shorter prompts, cut image and search calls first, and do not silently let the card absorb the overrun.

## 9. Hackathon compliance — do not lose on technicalities

Startup track lens: technical execution and whether the product holds up in production. That is what judges are looking for on top of the general weights.

Published judging weights for finished projects:
- Impact — 30%
- Use of Meta AI Tooling — 25%
- Demo, including demo video — 25%
- Technical Depth and Execution — 20%

Submission checklist (complete every item before 4 November, 9:00 PM ET):

- [ ] One track only — Startup. No second submission in the Indie track.
- [ ] One designated representative for the team, if applicable.
- [ ] You own everything in the project, or you have a licence for it. No copied code, images, or data you do not have rights to.
- [ ] Working demo, live — not just slides or a mock-up.
- [ ] Demo video recorded early, before the final day, so a late bug does not leave you with no video.
- [ ] Demo video shows no API keys, no private data, no secrets, and no other person's private material.
- [ ] Repo contains no API keys, no `.env` files, no private capsules, and no credentials of any kind. Run a secret scan before submitting.
- [ ] MODEL-SPLIT.md, DOCUMENTATION.md, and EULA.md are in the repo and match the actual code. Judges should be able to verify the model IDs in the code against the docs.
- [ ] Official Rules accepted. Note: submissions shared during the event are not treated as confidential, and organisers receive a broad licence to use, publish, and modify submitted material. Do not submit anything you cannot share on those terms.
- [ ] No duplicate applications, no false identity details, no spam. One application, truthful details.
- [ ] Submission portal entry is complete: working demo link, video, repo link, and a clear description of what the platform does, who it helps, and how it uses Muse models creatively.

If any checklist item is not true on submission day, fix it or remove the offending material — do not submit and hope judges will not notice.

## 10. Troubleshooting

- **"No payment method on file"** — add a card in Billing. API requests are blocked until a payment method is on file, even if credits are expected.
- **Billing shows $0.00 and no "free credits"** — the hackathon grant has not landed yet. Check you claimed it through the approval-email form, check you are on the right team / email, and allow up to 2 days. Do not assume it will appear on a different team.
- **401 / Unauthorized** — wrong key, revoked key, or key pasted with extra characters. Create a fresh key, copy it once, and update the server env var.
- **Rate limit on Contributor (100 RPM)** — batch requests, use longer prompts with fewer calls, cache context, or move that specific high-frequency path to Standard only if the data class allows it and the budget allows it.
- **Unexpected charges** — check Billing / Payment activity, check which model IDs were actually called, and check for image / search calls running in a loop. Set the Spend Limit notification before the next run.
- **Demo works locally but not in the submitted build** — the most common cause is a missing server env var. The submitted build must read the key from the server environment, not from a local file that was never deployed.

## 11. Version and ownership

- Owner: [Your name / team name]
- Repo: [Repo URL]
- Track: Startup, Meta Global AI Developer Hackathon 2026
- Models: Muse only, Meta Model API (see MODEL-SPLIT.md)
- Last updated: 27 October 2026

Fill in the bracketed fields before submission. Do not submit with placeholders still in the docs.
