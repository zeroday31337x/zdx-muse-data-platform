import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
    },
    sitemap: 'https://data.zerodrivex.com/sitemap.xml',
    host: 'https://data.zerodrivex.com',
  };
}
