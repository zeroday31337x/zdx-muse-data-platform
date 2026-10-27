// Prisma 7 client singleton. DATABASE_URL is required for Phase 2 routes.
// There is deliberately no file-store fallback here: if the database is
// not configured, the route fails clearly instead of silently writing
// to a different store that the export gate does not see.
//
// Prisma 7 requires a driver adapter at runtime. The client is generated
// into src/generated/prisma (see prisma/schema.prisma) and is loaded
// dynamically (any-typed) so typecheck passes before `prisma generate`
// runs. At runtime, if the client was not generated, prisma() throws a
// clear error instead of a cryptic import failure.
/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  var __zdxPrisma: any | undefined;
}

export function prisma(): any {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL_NOT_CONFIGURED');
  }
  if (!global.__zdxPrisma) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { PrismaClient } = require('../generated/prisma/client');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { PrismaPg } = require('@prisma/adapter-pg');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Pool } = require('pg');
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      const adapter = new PrismaPg(pool);
      global.__zdxPrisma = new PrismaClient({ adapter, log: ['error'] });
    } catch {
      throw new Error('PRISMA_CLIENT_NOT_GENERATED: run `npm run prisma:generate` first');
    }
  }
  return global.__zdxPrisma;
}

export function dbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}
