# Reference audit

## What was audited

- This repo itself (AGENTS.md, Muse-prompt, MASTER_BUILD_SPEC.md, skills, capsules, skeleton UI, dataset-policy helper).
- Public hackathon event page and Meta Model API pricing/model information available 2026-10-27.
- No access was granted to the existing ZDX Data Synthesis production system, its source, its database, or its private capsules during this build.

## What was copied, reimplemented, or newly built

- Copied: nothing from the existing ZDX Data Synthesis production system. No production code, capsules, or customer data were copied.
- Reimplemented from the spec: the 70/30 composition helper was already in the repo (dataset-policy.ts); it was extended with token-weighted reporting, source-family counting, and max-synthetic calculation. All other Phase 1 code (store, ingest, Meta adapter, quality, API routes, UI) was newly written in this repo for the hackathon.
- Design reference only: the Muse-prompt and MASTER_BUILD_SPEC.md describe capabilities of the existing platform as a functional reference. Those descriptions are targets, not evidence that the referenced system was accessed or that its code was reused.

## Eligibility note

Before submission, re-check the Official Rules on pre-existing work, permitted SDKs, required model use, and submission evidence. If the rules bar any reused material, remove it and update this audit. Do not submit this audit as proof of compliance with rules that have not been re-read at submission time.
