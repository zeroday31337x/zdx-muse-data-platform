import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Private application surfaces and machine endpoints are not search
      // landing pages. The public homepage remains crawlable.
      disallow: ['/admin/', '/dashboard/', '/settings/', '/api/'],
    },
    sitemap: 'https://data.zerodrivex.com/sitemap.xml',
    host: 'https://data.zerodrivex.com',
  };
}
