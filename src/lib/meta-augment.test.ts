import { describe, it, expect } from 'vitest';
import {
  META_AUGMENT_GENERATOR,
  META_AUGMENT_MAX_RECORDS,
  assertMetaAugmentCount,
  buildAugmentPrompt,
  parseGeneratedRows,
  rewriteGeneratedRowIds,
} from './meta-augment';

describe('meta-augment helpers', () => {
  it('labels the Meta generator distinctly from the template generator', () => {
    expect(META_AUGMENT_GENERATOR).toBe('meta');
    expect(META_AUGMENT_GENERATOR).not.toBe('template-demo');
  });

  it('bounds the per-job record count in code', () => {
    expect(assertMetaAugmentCount(10)).toEqual({ ok: true });
    expect(assertMetaAugmentCount(META_AUGMENT_MAX_RECORDS)).toEqual({ ok: true });
    expect(assertMetaAugmentCount(META_AUGMENT_MAX_RECORDS + 1)).toEqual({ ok: false, error: 'META_AUGMENT_COUNT_EXCEEDS_PER_JOB_BOUND' });
    expect(assertMetaAugmentCount(0)).toEqual({ ok: false, error: 'INVALID_REQUEST' });
  });

  it('builds a prompt that demands exactly N JSON rows with the example fields', () => {
    const prompt = buildAugmentPrompt(
      [{ order_id: 'A1', item: 'book', price: 9.99 }, { order_id: 'A2', item: 'pen', price: 1.5 }],
      10,
    );
    expect(prompt).toContain('exactly 10');
    expect(prompt).toContain('order_id');
    expect(prompt).toContain('item');
    expect(prompt).toContain('price');
    expect(prompt).toContain('JSON array');
  });

  it('accepts a valid JSON array of exactly the requested count', () => {
    const out = parseGeneratedRows('[{"order_id":"X1","item":"cup","price":3},{"order_id":"X2","item":"plate","price":5}]', 2);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.rows).toHaveLength(2);
  });

  it('accepts code-fenced JSON', () => {
    const out = parseGeneratedRows('```json\n[{"a":1}]\n```', 1);
    expect(out.ok).toBe(true);
  });

  it('rejects a count mismatch without persisting anything (caller fails the job)', () => {
    expect(parseGeneratedRows('[{"a":1}]', 2)).toEqual({ ok: false, error: 'META_AUGMENT_COUNT_MISMATCH' });
  });

  it('rejects non-array output, nested values, and empty rows', () => {
    expect(parseGeneratedRows('{"a":1}', 1)).toEqual({ ok: false, error: 'META_AUGMENT_INVALID_OUTPUT' });
    expect(parseGeneratedRows('[{"a":{"nested":1}}]', 1)).toEqual({ ok: false, error: 'META_AUGMENT_INVALID_OUTPUT' });
    expect(parseGeneratedRows('[{}]', 1)).toEqual({ ok: false, error: 'META_AUGMENT_INVALID_OUTPUT' });
    expect(parseGeneratedRows('not json', 1)).toEqual({ ok: false, error: 'META_AUGMENT_INVALID_OUTPUT' });
    expect(parseGeneratedRows(null, 1)).toEqual({ ok: false, error: 'META_AUGMENT_EMPTY_RESPONSE' });
  });

  it('rewrites the first ID-like field to a synthetic identifier', () => {
    expect(rewriteGeneratedRowIds({ order_id: 'A1', item: 'book' }, 3)).toEqual({ order_id: 'SYN-A1-3', item: 'book' });
    expect(rewriteGeneratedRowIds({ id: 'x', order_id: 'y' }, 0)).toEqual({ id: 'x', order_id: 'SYN-y-0' });
    expect(rewriteGeneratedRowIds({ item: 'book' }, 0)).toEqual({ item: 'book' });
  });
});
