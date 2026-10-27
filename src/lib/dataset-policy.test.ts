import { describe,it,expect } from 'vitest';
import { validateTrainingComposition as check } from './dataset-policy';
describe('training composition governance',()=>{
  it('accepts exactly 70/30',()=>expect(check({authentic:70,synthetic:30,unknown:0}).ok).toBe(true));
  it('rejects over 30%',()=>expect(check({authentic:69,synthetic:31,unknown:0}).ok).toBe(false));
  it('rejects unverified sources',()=>expect(check({authentic:70,synthetic:20,unknown:10}).ok).toBe(false));
  it('rejects empty datasets',()=>expect(check({authentic:0,synthetic:0,unknown:0}).ok).toBe(false));
  it('enforces 10 authentic max 4 synthetic',()=>{expect(check({authentic:10,synthetic:4,unknown:0}).ok).toBe(true); expect(check({authentic:10,synthetic:5,unknown:0}).ok).toBe(false)});
  it('rejects unsafe counts',()=>expect(()=>check({authentic:-1,synthetic:0,unknown:0})).toThrow());
});
