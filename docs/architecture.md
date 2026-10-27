# Architecture

## System

```
Browser UI (no API key, no direct Meta calls)
  ↓ HTTPS, JSON
Next.js server routes (Zod validation, tenant = demo-tenant in Phase 1)
  ↓ file store in data/store.json (Phase 1 vertical slice)
  ↓ Meta adapter (server-side only, MODEL_API_KEY env var)
Meta Model API — https://api.meta.ai/v1
```

Phase 1 deliberately uses a file store, not PostgreSQL + Prisma, to deliver a complete tested vertical slice before the Nov 4 deadline. The spec's PostgreSQL + Prisma + separate worker + S3 design is Phase 2, and is recorded as such in implementation-status.md — it is not claimed as implemented.

## Key decisions

- **Composition is computed from committed records, never from a frontend counter.** `src/lib/composition.ts` + `src/lib/dataset-policy.ts` enforce record-weighted 70/30, with token-weighted reporting. Token gate is opt-in via `STRICT_TOKEN_GATE=true`.
- **Idempotency:** ingest record keys are content hashes; augment keys are source-key + synthetic index. Replay does not duplicate committed rows under the same key.
- **Jobs:** persisted in the store with kind, status, committed/total, error. Phase 1 jobs complete synchronously for bounded batches (≤10,000 rows ingest, ≤1,000 augment). A separate worker process, leases, and SSE are Phase 2 — the UI does not claim a background worker yet.
- **Model routing:** `src/lib/meta.ts` allowlists Muse models only, fails closed on private data to Contributor, and classifies errors (auth, billing, rate limit, 5xx, invalid request) instead of retrying blindly.
- **Security:** server-side keys only, SSRF host blocklist, CSV formula neutralisation, size caps, Zod validation, no generated SQL/shell execution.

## What is not yet built

PostgreSQL + Prisma migrations, managed auth + multi-tenant isolation beyond demo-tenant, separate worker with leases, S3 object storage, Parquet / Hugging Face exports, multimodal image/audio/SAM workflows (gated until live-tested), and a production Docker deployment. See implementation-status.md for the honest list.
