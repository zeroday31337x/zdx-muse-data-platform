-- Admin-console-v1: durable Cognito admin-group flag on tenant users,
-- refreshed from the verified ID token at each Cognito login. Routing
-- hint only; /api/admin/* authorization still requires a separate
-- operator session (see docs/coord-admin.md).
ALTER TABLE "User" ADD COLUMN "cognitoAdmin" BOOLEAN NOT NULL DEFAULT false;
