# Data composition policy — 70/30, enforced

## Rule

For a training-ready dataset version, on the FINAL exported dataset:
- At least 70% VERIFIED_AUTHENTIC
- At most 30% SYNTHETIC
- Unknown / unverified = 0 for a compliant export

If A = verified authentic examples and S = synthetic examples, then:
- S / (A + S) ≤ 0.30
- S ≤ floor(3 × A / 7)
- Example: A = 10,000 → S ≤ 4,285. A = 7 → S ≤ 3.

## Classifications

- AUTHENTIC_VERIFIED — source identity + licence/permission evidence recorded.
- AUTHENTIC_UNVERIFIED — source present, evidence not yet recorded. Counts as unknown for export.
- DERIVED_SOURCE_PRESERVING — cleaning, reformatting, type normalisation with traceability. Does not create new independent authentic evidence.
- AI_AUGMENTED — model-generated labels, rewrites, or substantive fields. Counts toward synthetic for the hard ceiling.
- SYNTHETIC — entirely generated examples. Counts toward synthetic.
- UNKNOWN — no provenance. Never counts as authentic.

## Enforcement points

1. Augment time: request is rejected with exact remaining allowance if it would exceed the cap.
2. Export time: training export is blocked (409) with numerator/denominator if the final composition fails.
3. Token-weighted composition is reported alongside record-weighted. It becomes a hard gate only with STRICT_TOKEN_GATE=true.
4. Source-family counting: duplicated/paraphrased rows from one source family do not multiply the authentic quota (see effectiveAuthenticCount).
5. Simulation mode: datasets with purpose=simulation are labelled "100% synthetic simulation / test fixture — NOT compliant training data" and must never be presented as training-ready.

## Caveat (must appear in reports and exports)

The 30% ceiling is a product governance policy, not a scientifically established guarantee against model collapse. Quality, drift, contamination, leakage, and downstream evaluation must be assessed independently.
