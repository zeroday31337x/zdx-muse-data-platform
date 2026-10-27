import { NextResponse } from 'next/server';
import { loadStore } from '@/lib/store';
import { metaConfigured, MODEL_ALLOWLIST } from '@/lib/meta';
import { dbConfigured } from '@/lib/db';
export const dynamic = 'force-dynamic';
export function GET() {
  // In DB mode, per-tenant counts are not public health data: report
  // only the mode and inference configuration, never dataset/record totals.
  if (dbConfigured()) {
    return NextResponse.json({
      service: 'zdx-muse-data-platform',
      status: 'running',
      mode: 'db',
      inference: metaConfigured() ? 'configured-key-present' : 'not-configured',
      models: MODEL_ALLOWLIST,
      note: 'Health reflects service state only. Model health is not claimed without a live probe.',
    }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const s = loadStore();
  const totalRecords = s.records.length;
  return NextResponse.json({
    service: 'zdx-muse-data-platform',
    status: 'running',
    mode: 'demo-file',
    inference: metaConfigured() ? 'configured-key-present' : 'not-configured',
    models: MODEL_ALLOWLIST,
    datasets: s.datasets.length,
    records: totalRecords,
    jobs: s.jobs.length,
    usage: s.usage,
    note: 'Health reflects actual store counts. Model health is not claimed without a live probe.',
  }, { headers: { 'Cache-Control': 'no-store' } });
}
