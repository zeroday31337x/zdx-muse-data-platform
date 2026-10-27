// Transactional composition enforcement for PostgreSQL.
// This is the hard gate, not application logic alone:
// 1. Lock the dataset row (FOR UPDATE) so concurrent augment requests
//    serialise on the same dataset.
// 2. Count committed authentic / synthetic / unknown in the same
//    transaction.
// 3. Insert synthetic rows only if the final count still passes.
// 4. Roll back the whole batch on violation — no partial over-cap commit.
// Token-weighted composition is reported in the same transaction and
// becomes a hard gate only with STRICT_TOKEN_GATE=true.
import { maxSyntheticForAuthentic } from './composition';

// tx is intentionally any-typed: PrismaClient is generated at build time
// (prisma generate), and typing it here would break typecheck before
// generation. The runtime transaction object is a Prisma transaction.
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function checkCompositionInTx(tx: any, datasetId: string, additionalSynthetic: number) {
  await tx.$executeRaw`SELECT id FROM "Dataset" WHERE id = ${datasetId} FOR UPDATE`;
  const counts = await tx.record.groupBy({ by: ['provenance'], where: { datasetId }, _count: { _all: true } });
  const by: Map<string, number> = new Map(counts.map((c: any) => [String(c.provenance), Number(c._count._all)] as [string, number]));
  const authentic: number = by.get('AUTHENTIC_VERIFIED') ?? 0;
  const synthetic: number = (by.get('SYNTHETIC') ?? 0) + (by.get('AI_AUGMENTED') ?? 0);
  const unknown: number = (by.get('UNKNOWN') ?? 0) + (by.get('AUTHENTIC_UNVERIFIED') ?? 0);
  const allowed = maxSyntheticForAuthentic(authentic);
  const ok = additionalSynthetic <= Math.max(0, allowed - synthetic) && unknown === 0;
  return { authentic, synthetic, unknown, allowed, remaining: Math.max(0, allowed - synthetic), ok };
}
