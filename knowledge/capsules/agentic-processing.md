---
id: zdx-agentic-processing
version: 1.0.0
status: proposed
visibility: public
---
# Agentic Data Processing

Meta-powered agents may infer intent, suggest schemas, choose bounded processing plans, and propose record repairs. They must not control authorization, storage transactions, resource budgets, or execute arbitrary generated code.

A deterministic orchestrator validates each plan, executes through persistent workers, maintains resumable checkpoints, and exposes true progress from committed state.

Tools are narrowly scoped; source documents and model outputs are untrusted. Every autonomous action must be logged, budgeted, and attributable to a tenant and job.
