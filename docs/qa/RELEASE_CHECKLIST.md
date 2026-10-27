# Submission release gate — evidence required

All boxes are intentionally unchecked. A documented result needs date, Git SHA, environment, test command, artifacts, and reviewer sign-off.

## Eligibility and licensing
- [ ] Obtain, read, and retain official accepted hackathon rules and waiver; verify exact deadline, AI development requirements, existing code rules, prize/tax conditions.
- [ ] Confirm repository license, dependency SBOM and notices, ownership/permission for reused source, model and data processing terms.
- [ ] EULA/Terms, privacy policy, data-processing documentation, contact details, retention/deletion behavior match actual running service.
- [ ] Submission artifacts/demo claims match measured platform behavior.

## Technical assurance
- [ ] Q0 offline QA fixture tests passed.
- [ ] Q1 lint, typecheck, unit and static security scans passed.
- [ ] Q2 isolated database migrations, schema and tenant isolation passed.
- [ ] Q3 durable worker replay and crash recovery passed.
- [ ] Q4 real Meta model smoke call succeeded with authorized credentials and recorded model ID/quota.
- [ ] Q5 staging source-to-export browser journey passed.
- [ ] Q6 threat-model testing, restore drill, ARM64 deploy and 12 GB/2 vCPU capacity tests passed.
- [ ] 70/30 ceiling is enforced transactionally in backend and rechecked at export (not just in frontend/agent prompts).
- [ ] Provenance and user source-license constraints audited.
- [ ] Model outputs and cost estimates cannot be mistaken for verified truth.
- [ ] GitHub commit equals deployed commit; health report verified.
- [ ] Clean-room rebuild and demo submission reproducible.
