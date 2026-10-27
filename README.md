# ZDX Muse Data Platform

Meta AI hackathon application foundation for real-data-first data intelligence, provable source lineage and governed synthetic augmentation.

> **Status:** repository bootstrapped. The UI shell and deterministic composition helper exist; authentication, persistence, workers, provider access, ingestion, quality lab and exports are **not implemented**.

## Start

```bash
npm install
npm run dev
npm run typecheck
npm test
```

Open http://localhost:3000. The unprotected `/api/health` endpoint reports bootstrap-only state and must not be used as provider or database readiness evidence.

## Development requirements

Read [AGENTS.md](AGENTS.md), [master build specification](docs/MASTER_BUILD_SPEC.md) and relevant [skills](.agents/skills). Do not use real customer data or Meta API keys in client code or this public repository. `MODEL_API_KEY` and API compatibility require authenticated verification.

## 70/30 rule

Training-ready datasets: >=70% verified authentic and <=30% synthetic on the final export. Unknown provenance fails. This is a product policy and **does not guarantee prevention of model collapse**. The in-memory helper is illustrative; a transactional database-enforced final export check is still required.
