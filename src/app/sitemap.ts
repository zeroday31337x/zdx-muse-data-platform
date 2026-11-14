import type { MetadataRoute } from 'next';

// Only genuinely public routes belong here. /dashboard and /settings are
// tenant-private, /admin is operator-only, and /api/* plus the auth
// callbacks are not pages — all are deliberately excluded.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: 'https://data.zerodrivex.com/',
      // Keep lastModified tied to a substantive public-content release.
      // Search engines discount a value that changes on every request or
      // unrelated rebuild.
      lastModified: new Date('2026-11-13T00:00:00.000Z'),
      changeFrequency: 'weekly',
      priority: 1,
      images: ['https://data.zerodrivex.com/og-image.png'],
    },
  ];
}
