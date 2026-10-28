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
// Aggregation note (no schema change in this phase): counts AND token
// sums come from a single groupBy aggregation. The old full-record load
// for token counts (findMany over every record) is NOT used here.
// If an index/migration is needed to make groupBy fast at scale, it is
// an integration dependency for the coordinator's migration review,
// not applied here.
import { maxSyntheticForAuthentic } from './composition';

// tx is intentionally any-typed: PrismaClient is generated at build time
// (prisma generate), and typing it here would break typecheck before
// generation. The runtime transaction object is a Prisma transaction.
/* eslint-disable @typescript-eslint/no-explicit-any */
export type CompositionGroups = {
  authentic: number;
  synthetic: number;
  unknown: number;
  total: number;
  authenticTokens: number;
  syntheticTokens: number;
};

/** Pure mapping from groupBy rows to composition counts. Unit-tested. */
export function mapCompositionGroups(
  groups: { provenance: string; count: number; tokens: number }[],
): CompositionGroups {
  let authentic = 0;
  let synthetic = 0;
  let unknown = 0;
  let derived = 0;
  let authenticTokens = 0;
  let syntheticTokens = 0;
  for (const g of groups) {
    if (g.provenance === 'AUTHENTIC_VERIFIED') {
      authentic += g.count;
      authenticTokens += g.tokens;
    } else if (g.provenance === 'SYNTHETIC' || g.provenance === 'AI_AUGMENTED') {
      synthetic += g.count;
      syntheticTokens += g.tokens;
    } else if (g.provenance === 'UNKNOWN' || g.provenance === 'AUTHENTIC_UNVERIFIED') {
      unknown += g.count;
    } else if (g.provenance === 'DERIVED_SOURCE_PRESERVING') {
      derived += g.count;
    }
  }
  return { authentic, synthetic, unknown, total: authentic + synthetic + unknown + derived, authenticTokens, syntheticTokens };
}

export async function checkCompositionInTx(tx: any, datasetId: string, additionalSynthetic: number) {
  await tx.$executeRaw`SELECT id FROM "Dataset" WHERE id = ${datasetId} FOR UPDATE`;
  const groups = await tx.record.groupBy({
    by: ['provenance'],
    where: { datasetId },
    _count: { _all: true },
    _sum: { tokens: true },
  });
  const mapped = mapCompositionGroups(
    groups.map((c: any) => ({ provenance: String(c.provenance), count: Number(c._count._all), tokens: Number(c._sum?.tokens ?? 0) })),
  );
  const allowed = maxSyntheticForAuthentic(mapped.authentic);
  const recordOk = additionalSynthetic <= Math.max(0, allowed - mapped.synthetic) && mapped.unknown === 0;
  // Strict token gate: additional synthetic rows are assumed to carry
  // the current average synthetic token size; if that would push the
  // token fraction over 30%, the batch is refused. Disabled by default.
  const strictToken = process.env.STRICT_TOKEN_GATE === 'true';
  let tokenOk = true;
  if (strictToken && mapped.synthetic > 0) {
    const avgSyntheticTokens = mapped.syntheticTokens / mapped.synthetic;
    const projectedSyntheticTokens = mapped.syntheticTokens + additionalSynthetic * avgSyntheticTokens;
    const projectedTotal = mapped.authenticTokens + projectedSyntheticTokens;
    tokenOk = projectedTotal === 0 || projectedSyntheticTokens / projectedTotal <= 0.30;
  }
  return {
    ...mapped,
    allowed,
    remaining: Math.max(0, allowed - mapped.synthetic),
    ok: recordOk && tokenOk,
    tokenGateOk: tokenOk,
    strictTokenGateEnabled: strictToken,
  };
}

/**
 * Aggregated composition for one dataset, without loading any record
 * rows into application memory. One groupBy query, not a full scan
 * followed by an in-memory loop. The Prisma query itself is DB-gated
 * (staging validation on an isolated DB); the mapping is unit-tested.
 */
export async function compositionAggregated(db: any, datasetId: string): Promise<CompositionGroups> {
  const groups = await db.record.groupBy({
    by: ['provenance'],
    where: { datasetId },
    _count: { _all: true },
    _sum: { tokens: true },
  });
  return mapCompositionGroups(
    groups.map((c: any) => ({ provenance: String(c.provenance), count: Number(c._count._all), tokens: Number(c._sum?.tokens ?? 0) })),
  );
}
