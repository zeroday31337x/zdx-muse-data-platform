---
name: durable-job-processing
description: Implement transactional, resumable data processing with worker leases and replay-safe checkpoints.
---
# Durable Job Processing
Use when designing queues, progress events, generation execution, pause/resume, retry, or exports.

Use a persistent state machine with validated transitions. Workers claim jobs with bounded leases; commit results, counters, and checkpoints transactionally. Prevent concurrent claims and stale worker commits.
Use stable job/batch/record keys with database uniqueness constraints and idempotent retry behavior.
Account for the ambiguous failure window where inference succeeds but the response is lost; replay may increase provider cost but must not duplicate persisted data.
Use bounded batches and concurrency, backpressure, cancellation checks, and explicit quota/budget exhaustion states.
Progress always derives from committed state. SSE is a projection, not the source of truth.
Test forced worker death, lease expiry, queue duplicate delivery, DB interruption, cancellation races, and export restart.
