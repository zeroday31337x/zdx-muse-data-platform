---
name: data-provenance
description: Preserve authentic, synthetic, transformed, and unknown lineage across dataset versions and exports.
---
# Data Provenance
Use for schemas, lineage, manifests, and composition measurement.

Maintain immutable origin identifiers, source rights, source checksums, transformation type, model invocation IDs where applicable, version history, and classifications: AUTHENTIC_VERIFIED, SYNTHETIC, TRANSFORMED_DERIVED, UNKNOWN.

Provenance is not a prediction of whether content looks real. A classifier may flag suspected synthetic records but cannot prove authenticity. Keep ambiguous records UNKNOWN until evidence justifies a change.

Maintain per-record and per-dataset-unit ancestry. Derived and merged outputs inherit risk and source constraints; deduplicate by genuine source lineage instead of counting copied rows as independent observations.

Export manifests with composition methodology, counts, token-weighted ratios where meaningful, licensing caveats, model/version provenance, quality metrics, and source references. Keep private data out of public manifests.

Test merge/import laundering, version rollback, deletion, repeated derivations, and unauthorized cross-tenant lineage access.
