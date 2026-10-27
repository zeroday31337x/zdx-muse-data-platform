import { describe, it, expect } from 'vitest';
import { maxSyntheticForAuthentic, compositionReport, effectiveAuthenticCount } from './composition';
import { parseCsv, safeCell, isBlockedHost, validateUrlForImport } from './ingest';
import { qualityReport } from './quality';
import { modelForDataClass, isModelAllowed } from './meta';

describe('30% cap', () => {
  it('10000 authentic allows 4285, not 4286', () => {
    expect(maxSyntheticForAuthentic(10000)).toBe(4285);
    expect(compositionReport({ authentic: 10000, synthetic: 4285, unknown: 0 }).ok).toBe(true);
    expect(compositionReport({ authentic: 10000, synthetic: 4286, unknown: 0 }).ok).toBe(false);
  });
  it('zero authentic allows zero synthetic', () => expect(maxSyntheticForAuthentic(0)).toBe(0));
  it('source-family duplication does not inflate authentic', () => {
    const recs = [
      { sourceFamilyId: 'fam1', provenance: 'AUTHENTIC_VERIFIED' as const },
      { sourceFamilyId: 'fam1', provenance: 'AUTHENTIC_VERIFIED' as const },
      { sourceFamilyId: 'fam2', provenance: 'AUTHENTIC_VERIFIED' as const },
    ];
    expect(effectiveAuthenticCount(recs)).toBe(2);
  });
});
describe('ingest safety', () => {
  it('neutralises CSV formula injection', () => expect(safeCell('=cmd')).toBe("'=cmd"));
  it('parses quoted CSV', () => expect(parseCsv('a,b\n"x,y",2')[0].a).toBe('x,y'));
  it('blocks SSRF hosts', () => {
    expect(isBlockedHost('127.0.0.1')).toBe(true);
    expect(isBlockedHost('169.254.169.254')).toBe(true);
    expect(isBlockedHost('10.0.0.5')).toBe(true);
    expect(validateUrlForImport('http://example.com/x').ok).toBe(false);
    expect(validateUrlForImport('https://example.com/x').ok).toBe(true);
  });
});
describe('quality', () => {
  it('detects duplicates and missingness', () => {
    const q = qualityReport([{ a: 1 }, { a: 1 }, { a: null }]);
    expect(q.duplicateKeys).toBe(1);
    expect(q.completeness).toBeLessThan(1);
  });
});
describe('model routing', () => {
  it('private goes to Standard, public to Contributor, unknown fails closed', () => {
    expect(modelForDataClass('private')).toBe('muse-spark-1.3');
    expect(modelForDataClass('public')).toBe('muse-spark-1.3-contributor');
    expect(modelForDataClass('unknown')).toBe('muse-spark-1.3');
  });
  it('Wonder is not allowed by default, non-Muse is never allowed', () => {
    expect(isModelAllowed('muse-wonder-1.0')).toBe(false);
    expect(isModelAllowed('gpt-5')).toBe(false);
    expect(isModelAllowed('muse-spark-1.3-contributor')).toBe(true);
  });
});
