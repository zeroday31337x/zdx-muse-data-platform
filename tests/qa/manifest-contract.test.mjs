import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const schema=JSON.parse(readFileSync(new URL('./manifest.schema.json',import.meta.url),'utf8'));
test('export manifest contract contains evidence fields',()=>{
  assert.equal(schema.type,'object');
  for(const field of ['datasetId','datasetVersion','generatedAt','composition','sources','quality']) assert.ok(schema.required.includes(field),field);
  for(const field of ['authentic','synthetic','unknown','unit']) assert.ok(schema.properties.composition.required.includes(field),field);
  assert.ok(schema.properties.sources.items.required.includes('rightsStatus'));
});
