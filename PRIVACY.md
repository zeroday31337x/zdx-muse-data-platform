# Privacy Policy — ZDX Muse Data Platform (draft, not legal advice)

This draft must be reviewed by qualified counsel before any public launch or handling of real customer data. It does not replace the hackathon Official Rules, Meta's terms, or applicable privacy law.

## What the platform does

- Processes datasets the user uploads or imports, with provenance and composition tracking.
- Uses Meta Muse models for semantic analysis, schema inference, evaluation, and (when enabled) controlled synthesis.
- Stores datasets, records, jobs, usage metadata, and audit logs in PostgreSQL on the deployment infrastructure.

## Data classes and model routing

- **Public/demo data:** may be sent to `muse-spark-1.3-contributor`, where Meta may use prompts and completions to improve its products. This is opt-in by data class, never implicit for private data.
- **Private/proprietary data:** sent only to `muse-spark-1.3` (Standard), which Meta does not use for training, per Meta's published terms.
- **Secret data:** never sent to any model. The adapter refuses secret-class calls.
- **Keys and secrets:** server-side only, never in the browser, repo, logs, or demo video.

## What is logged

Usage metadata only: model ID, token counts, cost estimates, job status, and audit actions. Prompt bodies and full record bodies are not stored in audit logs.

## Retention and deletion

- Datasets and records are retained until the tenant deletes them. Deletion must remove the dataset and its records from the database; exported files the user downloaded are outside the platform's control.
- Session tokens expire after 7 days. Audit logs are retained for security review and are not used for advertising.

## Tenant isolation

Each tenant's datasets, records, jobs, and usage are scoped by tenantId in every database query. Cross-tenant access is rejected, not merely hidden in the UI.

## Contact and changes

Platform owner: ZeroDriveX. Contact details, governing law, and the effective date must be filled in before publication. Changes to this policy must be versioned and dated.
