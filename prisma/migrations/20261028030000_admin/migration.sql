-- Admin / model-tier (revised spec §2). ADDITIVE ONLY. NOT APPLIED
-- to any server database by this commit; execution requires the
-- separate Gate 7A integrated review + Gate 7B per-migration review.
-- CreateTable PlatformOperator
CREATE TABLE "PlatformOperator" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "cognitoSub" TEXT NOT NULL,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformOperator_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlatformOperator_email_key" ON "PlatformOperator"("email");
CREATE UNIQUE INDEX "PlatformOperator_cognitoSub_key" ON "PlatformOperator"("cognitoSub");

-- CreateTable PlatformOperatorSession
CREATE TABLE "PlatformOperatorSession" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "mfaVerifiedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformOperatorSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlatformOperatorSession_tokenHash_key" ON "PlatformOperatorSession"("tokenHash");
CREATE INDEX "PlatformOperatorSession_operatorId_idx" ON "PlatformOperatorSession"("operatorId");
ALTER TABLE "PlatformOperatorSession" ADD CONSTRAINT "PlatformOperatorSession_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "PlatformOperator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable PlatformSetting
CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable PlatformSettingVersion (append-only by policy: no route updates/deletes rows)
CREATE TABLE "PlatformSettingVersion" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB,
    "changedBy" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "PlatformSettingVersion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PlatformSettingVersion_key_changedAt_idx" ON "PlatformSettingVersion"("key", "changedAt");

-- CreateTable PlatformAuditLog (append-only by policy: no delete route)
CREATE TABLE "PlatformAuditLog" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "tenantId" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PlatformAuditLog_tenantId_createdAt_idx" ON "PlatformAuditLog"("tenantId", "createdAt");
