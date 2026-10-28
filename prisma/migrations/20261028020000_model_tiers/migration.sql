-- Model tiers (revised admin spec §2). ADDITIVE ONLY: no table
-- dropped, no column dropped. This is the single combined Job
-- change-set (Checkpoint 3): Job gains requested/resolved model
-- fields here, not in a second migration. NOT APPLIED to any server
-- database by this commit; execution requires the separate Gate 7A
-- integrated review + Gate 7B per-migration review.
-- AlterTable Tenant: model default (a choice, never an allowlist)
ALTER TABLE "Tenant" ADD COLUMN "modelPreference" TEXT;

-- CreateTable ContributorEligibility (auditable grant/revoke record;
-- the source of truth — no Tenant boolean cache is added)
CREATE TABLE "ContributorEligibility" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "eligible" BOOLEAN NOT NULL DEFAULT false,
    "grantedBy" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "revokedBy" TEXT,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ContributorEligibility_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContributorEligibility_tenantId_key" ON "ContributorEligibility"("tenantId");
CREATE INDEX "ContributorEligibility_tenantId_idx" ON "ContributorEligibility"("tenantId");

-- AddForeignKey
ALTER TABLE "ContributorEligibility" ADD CONSTRAINT "ContributorEligibility_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable DatasetContributorConsent
CREATE TABLE "DatasetContributorConsent" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "consented" BOOLEAN NOT NULL DEFAULT false,
    "consentedBy" TEXT NOT NULL,
    "consentedAt" TIMESTAMP(3),
    "scope" TEXT NOT NULL DEFAULT 'public-demo-only',
    "expiresAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "DatasetContributorConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DatasetContributorConsent_datasetId_key" ON "DatasetContributorConsent"("datasetId");
CREATE INDEX "DatasetContributorConsent_tenantId_datasetId_idx" ON "DatasetContributorConsent"("tenantId", "datasetId");

-- AddForeignKey
ALTER TABLE "DatasetContributorConsent" ADD CONSTRAINT "DatasetContributorConsent_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable Job: model resolution record (revised reason set)
ALTER TABLE "Job" ADD COLUMN "requestedModel" TEXT,
ADD COLUMN "resolvedModel" TEXT,
ADD COLUMN "modelResolutionReason" TEXT,
ADD COLUMN "modelRejectionCode" TEXT,
ADD COLUMN "dataClass" TEXT;

-- AlterTable UsageLedger: audit linkage fields (confirmed cost only;
-- see SpendReservation for reservations)
ALTER TABLE "UsageLedger" ADD COLUMN "jobId" TEXT,
ADD COLUMN "datasetId" TEXT,
ADD COLUMN "dataClass" TEXT,
ADD COLUMN "planSnapshot" TEXT,
ADD COLUMN "contributorConsentId" TEXT;
