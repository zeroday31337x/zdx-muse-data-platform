import { NextResponse } from 'next/server';
import { loadStore } from '@/lib/store';
import { metaConfigured, MODEL_ALLOWLIST } from '@/lib/meta';
export const dynamic = 'force-dynamic';
export function GET() {
  const s = loadStore();
  const totalRecords = s.records.length;
  return NextResponse.json({
    service: 'zdx-muse-data-platform',
    status: 'running',
    inference: metaConfigured() ? 'configured-key-present' : 'not-configured',
    models: MODEL_ALLOWLIST,
    datasets: s.datasets.length,
    records: totalRecords,
    jobs: s.jobs.length,
    usage: s.usage,
    note: 'Health reflects actual store counts. Model health is not claimed without a live probe.',
  }, { headers: { 'Cache-Control': 'no-store' } });
}
