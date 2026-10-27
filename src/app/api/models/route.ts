import { NextResponse } from 'next/server';
import { MODEL_ALLOWLIST, MODEL_PRICING, metaConfigured, IMAGE_PRICE_PER_IMAGE, VOICE_PRICE_PER_HOUR, WEB_SEARCH_PRICE_PER_1000 } from '@/lib/meta';
export const dynamic = 'force-dynamic';
export function GET() {
  return NextResponse.json({
    configured: metaConfigured(),
    baseUrl: 'https://api.meta.ai/v1',
    allowlist: MODEL_ALLOWLIST,
    pricing: MODEL_PRICING,
    extras: { imagePerImage: IMAGE_PRICE_PER_IMAGE, voicePerHour: VOICE_PRICE_PER_HOUR, webSearchPer1000: WEB_SEARCH_PRICE_PER_1000 },
    note: 'Pricing as of 2026-10-27 from Meta Model API docs. Health is not claimed without a live probe; use a real Meta call to verify.',
  });
}
