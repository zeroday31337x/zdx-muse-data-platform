# Quality methodology

Quality is deterministic first. Model judge scores, if ever added, are estimates, not truth.

## Deterministic measures (implemented)

- Completeness: non-empty fields / total fields.
- Uniqueness: unique record keys / total records (record keys are content hashes in Phase 1, so exact duplicates are already de-duplicated on ingest; synthetic variants with distinct identifiers are distinct).
- Missing fields: per-field counts.
- Composition: record-weighted and token-weighted, with the 70/30 gate.
- Duplicate / near-duplicate detection: exact-key duplicates only in Phase 1. Near-duplicate / embedding similarity is a Phase 2 item and is not claimed.

## Not claimed

- No downstream model accuracy, no contamination proof, no memorisation guarantee, no drift score with a verified baseline. Those require held-out evaluation sets and a trained downstream model, which are out of Phase 1 scope.
- Repair: targeted repair is not yet implemented. Quality failures are reported with failing samples and remediation actions (add verified data, remove synthetic, fix source), not silently fixed by dropping records.

## How to read a quality report

A report with completeness 1.0 and uniqueness 1.0 does not mean the dataset is "good" for training. It means it passed structural checks. Check composition, source licences, class balance (by inspecting records), and held-out evaluation before any training claim.
