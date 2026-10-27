export type Composition = Readonly<{ authentic: number; synthetic: number; unknown: number }>;
export function validateTrainingComposition(c: Composition): {ok:boolean; reasons:string[]; total:number; syntheticFraction:number|null; authenticFraction:number|null} {
  for(const [key,value] of Object.entries(c)) {
    if(!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid composition count: '+key);
  }
  const total=c.authentic+c.synthetic+c.unknown;
  if(!Number.isSafeInteger(total)) throw new Error('Composition total is unsafe');
  const reasons:string[]=[];
  if(total===0) reasons.push('EMPTY_DATASET');
  if(c.unknown>0) reasons.push('UNKNOWN_PROVENANCE');
  // Compare integer products to avoid floating-point boundary errors.
  if(c.authentic*10 < total*7) reasons.push('AUTHENTIC_BELOW_70_PERCENT');
  if(c.synthetic*10 > total*3) reasons.push('SYNTHETIC_OVER_30_PERCENT');
  return {ok:reasons.length===0,reasons,total,authenticFraction:total?c.authentic/total:null,syntheticFraction:total?c.synthetic/total:null};
}
