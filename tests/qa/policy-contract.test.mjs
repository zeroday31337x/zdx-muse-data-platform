import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const contracts=JSON.parse(readFileSync(new URL('./contracts.json',import.meta.url),'utf8'));
function valid({authentic,synthetic,unknown}) {
  const counts=[authentic,synthetic,unknown];
  if(!counts.every(n=>Number.isSafeInteger(n)&&n>=0)) throw new RangeError('Invalid count');
  const total=authentic+synthetic+unknown;
  if(!Number.isSafeInteger(total)) throw new RangeError('Unsafe total');
  const {authenticMinimumBasisPoints:a,syntheticMaximumBasisPoints:s,unknownAllowed}=contracts.trainingPolicy;
  return total>0 && (unknownAllowed||unknown===0) && authentic*10000>=total*a && synthetic*10000<=total*s;
}
test('contract is well formed',()=>{
 assert.equal(contracts.schemaVersion,1);
 assert.equal(contracts.trainingPolicy.authenticMinimumBasisPoints,7000);
 assert.equal(contracts.trainingPolicy.syntheticMaximumBasisPoints,3000);
 assert.equal(new Set(contracts.cases.map(c=>c.id)).size,contracts.cases.length);
});
for(const c of contracts.cases)test('training-data contract: '+c.id,()=>assert.equal(valid(c.input),c.expected));
test('unsafe counts fail closed',()=>{
 for(const c of [{authentic:-1,synthetic:0,unknown:0},{authentic:0.5,synthetic:0,unknown:0},{authentic:Number.MAX_SAFE_INTEGER,synthetic:1,unknown:0}]) assert.throws(()=>valid(c));
});
test('prevent false 30%-of-upload interpretation',()=> {
 assert.equal(valid({authentic:100,synthetic:30,unknown:0}),true);
 assert.equal(valid({authentic:100,synthetic:43,unknown:0}),false);
});
