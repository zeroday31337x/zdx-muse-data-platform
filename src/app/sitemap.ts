import type { MetadataRoute } from 'next';

// Only genuinely public routes belong here. /dashboard and /settings are
// tenant-private, /admin is operator-only, and /api/* plus the auth
// callbacks are not pages — all are deliberately excluded.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: 'https://data.zerodrivex.com/',
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
  ];
}
