// Prisma 7 project configuration. The database connection URL for CLI
// operations (generate, migrate) lives here; the runtime client uses the
// same DATABASE_URL through the pg driver adapter in src/lib/db.ts.
// See https://pris.ly/d/config-datasource
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
