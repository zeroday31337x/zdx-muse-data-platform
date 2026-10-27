---
id: zdx-real-data-governance
version: 1.0.0
status: proposed
visibility: public
---
# Real-Data-First Training Governance

Training-ready dataset versions require at least 70% verifiably authentic and no more than 30% synthetic contribution, measured against final output. This is a ZDX policy, not a universal scientific safe threshold for model collapse.

Unknown provenance must remain unknown. Track transform ancestry, copies, model-generated labels, augmentation, and record/token weighting. Recalculate proportions on merges and exports.

Compositional compliance cannot replace benchmark-based validation: inspect duplication, quality, statistical drift, source leakage, and downstream training impact.
