# ZeroDriveX Data Intelligence Platform

Meta Global AI Developer Hackathon 2026 — Startup track. Real-data-first data intelligence, provable source lineage, and governed synthetic augmentation, with Muse models only.

> **Status (2026-10-27, Phase 1):** a complete vertical slice is TESTED locally and on Oracle VPS free-vm-1: create → ingest CSV/JSON/JSONL → analyse → augment within the 30% cap → quality → gated JSONL/CSV export with manifest. Authentication/multi-tenant isolation, a separate worker with leases, PostgreSQL + Prisma, S3, Docker, and multimodal routes are PLANNED, not yet implemented — see [implementation-status.md](docs/implementation-status.md). Do not use the demo deployment for real customer data yet.

## Start

```bash
npm install
npm run dev        # http://localhost:3000
npm run typecheck
npm test           # 15 tests, incl. 10,000 authentic → 4,285 synthetic allowed, 4,286 rejected
npm run build
npm run start
```

The `/api/health` endpoint reports real store counts. It does not claim model health without a live probe.

## Demo in 2 minutes

1. Create a training dataset.
2. Ingest `examples/ecommerce-sample.csv` as AUTHENTIC_VERIFIED (7 rows).
3. Augment 3 — allowed (floor(3×7/7)=3). Augment 1 more — rejected, remaining 0.
4. Export JSONL — succeeds at exactly 70/30, with manifest, composition, and checksum.
5. Ingest the same sample as AUTHENTIC_UNVERIFIED in a second dataset and try to export — blocked (unknown > 0).

## 70/30 rule

Training-ready datasets: >=70% verified authentic and <=30% synthetic on the **final export**. Unknown provenance fails. This is a product policy and **does not guarantee prevention of model collapse**. Composition is computed from committed records, at augment time and again at export. Token-weighted composition is reported; it becomes a hard gate only with `STRICT_TOKEN_GATE=true`.

## Model split (read before sending private data)

- `muse-spark-1.3-contributor` — public/demo only, may be used for training, $0.10/$0.002/$0.20 per million tokens.
- `muse-spark-1.3` — private only, not used for training, $1.25/$0.15/$4.25 per million tokens.
- `muse-image-1.0` $0.01/image, `sam-3.1` segmentation, `muse-voice-transcribe-1.0` $0.18/hour — on demand, not yet routed in Phase 1.
- No Wonder by default ($4/$20 would burn the $150 grant).
- Full split: [docs/MODEL-SPLIT.md](docs/MODEL-SPLIT.md). Capabilities: [docs/model-capabilities.md](docs/model-capabilities.md). Security: [docs/security.md](docs/security.md). Compliance: [docs/hackathon-compliance.md](docs/hackathon-compliance.md).

## Development requirements

Read [AGENTS.md](AGENTS.md), [master build specification](docs/MASTER_BUILD_SPEC.md) and relevant [skills](.agents/skills). Do not put real customer data or Meta API keys in client code or this public repository. `MODEL_API_KEY` is server-side only, from environment, and must be verified with a live call before any Meta capability is marked verified.

## Oracle VPS deployment

On free-vm-1 (Ubuntu aarch64, via Tailscale): Node 22.20.0 in `~/node`, repo in `~/zdx-muse-data-platform`, production server on port 3000 (`npm run start`). No Docker yet — Docker Compose is Phase 2. See [docs/architecture.md](docs/architecture.md).
