---
id: zdx-quality-drift
version: 1.0.0
status: proposed
visibility: public
---
# Quality, Contamination, and Drift

A useful dataset requires more than syntactically valid records. Evaluate integrity constraints, missingness, duplicates, class coverage, distribution divergence, train/test contamination, source overlap, factual consistency, and performance on held-out tasks where possible.

Separate deterministic measurements from probabilistic model judgments. Report evaluator assumptions, sample sizes, limitations, and confidence instead of collapsing everything into one misleading quality score.

Failures should trigger targeted, audited repair with bounded retry limits—not wholesale reruns or silent dropping of hard records.
