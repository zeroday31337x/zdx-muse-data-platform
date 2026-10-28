import { NextResponse } from 'next/server';
import { MODEL_ALLOWLIST, MODEL_PRICING, metaConfigured, IMAGE_PRICE_PER_IMAGE, VOICE_PRICE_PER_HOUR, WEB_SEARCH_PRICE_PER_1000 } from '@/lib/meta';
export const dynamic = 'force-dynamic';
export function GET() {
  return NextResponse.json({
    configured: metaConfigured(),
    baseUrl: 'https://api.meta.ai/v1',
    allowlist: MODEL_ALLOWLIST,
    pricing: MODEL_PRICING,
    // Verification labels: only TEXT pricing is the verified Meta price
    // list. The image/voice/SAM figures are unverified placeholders (0 in
    // MODEL_PRICING; the extras below are unconfirmed) and must never be
    // read as free or billable: the model resolver rejects those
    // modalities with MODEL_PRICE_UNVERIFIED, and tier allowlists are
    // empty for them on every tier.
    pricingVerified: { text: true, image: false, voice: false, sam: false },
    extras: { imagePerImage: IMAGE_PRICE_PER_IMAGE, voicePerHour: VOICE_PRICE_PER_HOUR, webSearchPer1000: WEB_SEARCH_PRICE_PER_1000 },
    note: 'Text pricing as of 2026-10-27 from Meta Model API docs. Image/voice/SAM prices are UNVERIFIED placeholders, not a price list. Health is not claimed without a live probe; use a real Meta call to verify.',
  });
}
