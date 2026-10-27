import { validateTrainingComposition } from './dataset-policy';

export type Provenance = 'AUTHENTIC_VERIFIED' | 'AUTHENTIC_UNVERIFIED' | 'DERIVED_SOURCE_PRESERVING' | 'AI_AUGMENTED' | 'SYNTHETIC' | 'UNKNOWN';

export function maxSyntheticForAuthentic(authentic: number): number {
  if (authentic <= 0) return 0;
  return Math.floor((3 * authentic) / 7);
}

export type CompositionInput = {
  authentic: number;
  synthetic: number;
  unknown: number;
  authenticTokens?: number;
  syntheticTokens?: number;
};

/** Full composition report: record-weighted (hard gate) + token-weighted (reported). */
export function compositionReport(c: CompositionInput) {
  const base = validateTrainingComposition({ authentic: c.authentic, synthetic: c.synthetic, unknown: c.unknown });
  const totalTokens = (c.authenticTokens ?? 0) + (c.syntheticTokens ?? 0);
  const tokenSyntheticFraction = totalTokens > 0 ? (c.syntheticTokens ?? 0) / totalTokens : null;
  const tokenAuthenticFraction = totalTokens > 0 ? (c.authenticTokens ?? 0) / totalTokens : null;
  // Default hard gate is record-weighted, per the spec: token-weighted is
  // reported, and becomes a hard gate only when STRICT_TOKEN_GATE=true.
  // Otherwise a record-compliant 70/30 dataset with longer synthetic rows
  // would be blocked for a token artefact, which is not the default rule.
  const strictToken = process.env.STRICT_TOKEN_GATE === 'true';
  return {
    ...base,
    maxSyntheticAllowed: maxSyntheticForAuthentic(c.authentic),
    remainingSyntheticAllowance: Math.max(0, maxSyntheticForAuthentic(c.authentic) - c.synthetic),
    tokenSyntheticFraction,
    tokenAuthenticFraction,
    tokenGateOk: tokenSyntheticFraction === null ? true : tokenSyntheticFraction <= 0.30,
    strictOk: base.ok && (!strictToken || tokenSyntheticFraction === null || tokenSyntheticFraction <= 0.30),
    strictTokenGateEnabled: strictToken,
  };
}

/** Source-family counting: duplicated/paraphrased rows from one source family count once. */
export function effectiveAuthenticCount(records: { sourceFamilyId?: string | null; provenance: Provenance }[]): number {
  const families = new Set<string>();
  let count = 0;
  for (const r of records) {
    if (r.provenance !== 'AUTHENTIC_VERIFIED') continue;
    if (r.sourceFamilyId) {
      if (families.has(r.sourceFamilyId)) continue;
      families.add(r.sourceFamilyId);
    }
    count += 1;
  }
  return count;
}
