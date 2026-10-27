import { NextResponse } from 'next/server';
import { metaConfigured } from '@/lib/meta';
export const dynamic = 'force-dynamic';
export async function POST() {
  // Gated, never simulated: image / voice / SAM endpoint functions are
  // not implemented or verified against Meta's API in this codebase
  // (only allowlist entries and pricing rows exist in src/lib/meta.ts),
  // so this endpoint must not return a fabricated result. It reports
  // blocked until a verified endpoint implementation lands.
  return NextResponse.json({
    error: 'MULTIMODAL_NOT_OPERATIONAL',
    configured: metaConfigured(),
    note: 'Multimodal ingestion (image, voice transcription, SAM) is not operational: no verified Meta endpoint functions exist yet. This endpoint returns no simulated result.',
  }, { status: 503 });
}
