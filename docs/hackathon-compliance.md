# Hackathon compliance

Event: Meta Global AI Developer Hackathon 2026, Startup track.
Organisers: Meta and Cerebral Valley.
Build window: 26 Oct – 4 Nov 2026. Submissions due 4 Nov 2026, 9:00 PM ET. Judging 4–8 Nov, finals 9 Nov.

## What was verified, and what was not

- Verified from the public event page (read 2026-10-27): virtual, worldwide, free to enter if selected, max 20,000 accepted applicants, two tracks (indie, startup), Muse Spark series, Muse Image and SAM 3.1 via Meta Model API, plus Muse Code.
- Verified from the waiver (read 2026-10-27): selected participants receive $150 in Meta Model API credits, valid for a 10-day development window, and must review the Credit Terms before claiming. The public event page itself does not state that amount — do not cite the public page as the source for $150.
- Credit claim route found by the founder in an approval email: Google Form "Meta Global AI Hackathon: Model API Credit Claims". Credits show under "free credits" in Billing, expected within 2 days. Until they land, API calls bill to the card on file. Set a Spend Limit notification in Billing.
- Judging weights verified from the linked Cerebral Valley waiver (read 2026-10-27, waiver dated Oct 25, 2026): Impact 30%, Use of Meta AI Tooling 25%, Demo 25%, Technical Depth and Execution 20%.
- Ownership / licence verified from the waiver (read 2026-10-27): entrants retain IP ownership but grant organisers a perpetual, irrevocable, worldwide, royalty-free, non-exclusive licence to use/exploit the submission, including in marketing. Waiver also includes liability release, indemnification, recording consent; participants must be 18/age of majority; exclusions for sanctioned countries and Meta/Cerebral Valley employees, contractors, interns, government-affiliated individuals and household members.

## Compliance rules for this repo

- One track only: Startup. No second Indie submission.
- One application, truthful details. No duplicate applications, false identity, or spam.
- Muse models only for generative/semantic AI. No OpenAI, Anthropic, Google, Groq, OpenRouter, Nebius, Ollama, or other non-Meta inference in operational workflows.
- No secrets, private capsules, customer data, or internal infrastructure details in this public repo.
- No claim that the 30% synthetic ceiling prevents model collapse. It is a product governance policy.
- Demo video must show no API keys, private data, or other people's private material.
- Official Rules must be accepted and re-read before submission. If this document conflicts with the Official Rules, the Official Rules win.

## Prize breakdown (waiver, read 2026-10-27)

- Total pool $1,000,000. Startup track total $550,000: 1st $250,000, 2nd $150,000, 3rd $75,000, 4th $50,000, 5th $25,000. Indie track $400,000, plus up to $50,000 optional bonuses.
- Startup eligibility (waiver): open to technical founders building a product; the startup representative must be an active employee of the startup and duly authorised to receive notices and prize payment on its behalf. One track per project.
- No explicit submission artifact checklist was found on the event page or in the waiver (demo quality is referenced, but no video/repo/deck list). Do not invent one; the submission portal is Cerebral Valley's.

## 2026-10-27 release status (staging-validated, not yet production-promoted)

- Tenant isolation is enforced in DB mode: every protected route requires an authenticated session and scopes resources to the session tenant, returning 404 for other tenants' resources. The worker endpoint requires a separate WORKER_SECRET and never accepts a browser session.
- Worker lifecycle: CANCELLING jobs are finalised to CANCELLED by the worker tick (or immediately for QUEUED/PAUSED jobs), multi-batch ingest requeues atomically instead of waiting for the 5-minute lease expiry, and lease-guarded updates reject stale workers with 409 STALE_LEASE.
- Live Meta inference is still NOT verified: no MODEL_API_KEY exists in this environment and no paid call has ever been made. Deterministic results are always labelled deterministic. Multimodal ingestion is NOT operational (no verified endpoint functions; /api/multimodal returns 503, never a simulated result).
- Muse Code remains the primary development agent; Muse's role is recorded in commit messages and docs for hackathon compliance.
