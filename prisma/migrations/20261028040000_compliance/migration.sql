-- Compliance batch (contract §11.9 / B10 unpaid export-out, B12 grace
-- restriction, C5 hard-ceiling enforcement in code). ADDITIVE ONLY.
-- NOT APPLIED to any server database by this commit; execution
-- requires the separate Gate 6A/6B review (this batch is sequenced
-- after 20261028010000 / 20261028020000 / 20261028030000) and a
-- per-migration Gate 6B/7B-style pre-execution review. No column is
-- dropped, renamed, or backfilled; new columns are nullable so old
-- code keeps reading/writing the table during a rolling deploy.
-- CreateTable UnpaidExportAuthorization
CREATE TABLE "UnpaidExportAuthorization" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "stripeEventId" TEXT NOT NULL,
    "boundaryAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "claimToken" TEXT,
    "claimedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnpaidExportAuthorization_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UnpaidExportAuthorization_tenantId_stripeEventId_key" ON "UnpaidExportAuthorization"("tenantId", "stripeEventId");
CREATE INDEX "UnpaidExportAuthorization_tenantId_status_idx" ON "UnpaidExportAuthorization"("tenantId", "status");
ALTER TABLE "UnpaidExportAuthorization" ADD CONSTRAINT "UnpaidExportAuthorization_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AlterTable Tenant: grace-restriction layer (nullable, no backfill).
ALTER TABLE "Tenant" ADD COLUMN "accessRestriction" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "accessRestrictedAt" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN "graceStartedAt" TIMESTAMP(3);
