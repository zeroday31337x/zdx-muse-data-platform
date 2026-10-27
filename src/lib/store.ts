import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from './ingest';

export type Provenance = 'AUTHENTIC_VERIFIED' | 'AUTHENTIC_UNVERIFIED' | 'DERIVED_SOURCE_PRESERVING' | 'AI_AUGMENTED' | 'SYNTHETIC' | 'UNKNOWN';
export type RecordItem = { id: string; datasetId: string; recordKey: string; data: Record<string, unknown>; provenance: Provenance; sourceId: string; sourceFamilyId: string | null; tokens: number; createdAt: string; meta?: Record<string, unknown> };
export type Dataset = { id: string; name: string; purpose: 'training' | 'simulation'; tenant: string; createdAt: string; sourceName: string; sourceLicense: string; sourceChecksum: string };
export type Job = { id: string; datasetId: string; kind: string; status: string; committed: number; total: number; error: string | null; createdAt: string; updatedAt: string };

type StoreShape = { datasets: Dataset[]; records: RecordItem[]; jobs: Job[]; usage: { model: string; promptTokens: number; completionTokens: number; costUsd: number; calls: number }[] };

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

function empty(): StoreShape { return { datasets: [], records: [], jobs: [], usage: [] }; }

export function loadStore(): StoreShape {
  try {
    if (!fs.existsSync(DATA_FILE)) return empty();
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) as StoreShape;
  } catch { return empty(); }
}
export function saveStore(s: StoreShape) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}
export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
export function recordKeyFor(datasetId: string, data: Record<string, unknown>, index: number): string {
  // Stable, idempotent key: dataset + content hash, so replay does not duplicate.
  return sha256(`${datasetId}:${JSON.stringify(data)}`).slice(0, 32) || `r${index}`;
}
export function estimateTokens(data: Record<string, unknown>): number {
  return Math.max(1, Math.ceil(JSON.stringify(data).length / 4));
}
export function datasetRecords(s: StoreShape, datasetId: string): RecordItem[] {
  return s.records.filter((r) => r.datasetId === datasetId);
}
export function compositionOf(s: StoreShape, datasetId: string) {
  const recs = datasetRecords(s, datasetId);
  const authentic = recs.filter((r) => r.provenance === 'AUTHENTIC_VERIFIED').length;
  const synthetic = recs.filter((r) => r.provenance === 'SYNTHETIC' || r.provenance === 'AI_AUGMENTED').length;
  const unknown = recs.filter((r) => r.provenance === 'UNKNOWN' || r.provenance === 'AUTHENTIC_UNVERIFIED').length;
  const authenticTokens = recs.filter((r) => r.provenance === 'AUTHENTIC_VERIFIED').reduce((a, r) => a + r.tokens, 0);
  const syntheticTokens = recs.filter((r) => r.provenance === 'SYNTHETIC' || r.provenance === 'AI_AUGMENTED').reduce((a, r) => a + r.tokens, 0);
  return { authentic, synthetic, unknown, total: recs.length, authenticTokens, syntheticTokens };
}
