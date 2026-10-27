---
name: dataset-synthesis
description: Implement controlled synthetic augmentation with enforceable 70/30 training-data provenance accounting.
---
# Dataset Synthesis
Use for generation plans, records, batches, preview, augmentation, and export gates.

- The dataset's designated purpose determines policy: training-ready versions require >=70% verified authentic and <=30% synthetic *in final output*.
- Treat unknown-provenance records separately; unknown is never counted as authentic.
- Enforce ratio transactionally as accepted records change, then recompute before every export.
- For authentic count A, maximal additional synthetic count S satisfies S/(A+S)<=0.30; equivalently S<=floor(3*A/7) when no other records exist.
- Count AI-generated labels, semantic rewrites, derivatives, and generated fields according to an explicitly documented provenance unit/policy; do not mislabel transformations.
- Report per-record composition and token-weighted composition for text training datasets.
- Distinguish training-ready data from fully synthetic test fixtures; do not advertise fixture-only datasets as compliant training corpora.
- Generate deterministic IDs, financial arithmetic, distributions, and relationships in code; reserve Meta models for semantics.
- Use bounded batches, stable idempotency keys, unique constraints, and persisted batch progress.
- Verify count, schema, uniqueness, relationships, usage budget, and data quality before release.

Acceptance: imports and merges cannot launder synthetic data into authentic; overflow batches are rejected; exported manifests match committed rows.
