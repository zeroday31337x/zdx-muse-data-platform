import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import Nav from '@/components/Nav';

const title = 'AI Dataset Intelligence & Provenance Platform | ZeroDriveX';
const description =
  'Build training-ready datasets with verified provenance, dataset quality analysis, controlled synthetic augmentation capped at 30%, and audit-ready exports.';

export const metadata: Metadata = {
  metadataBase: new URL('https://data.zerodrivex.com'),
  title: {
    default: title,
    template: '%s | ZeroDriveX Data Intelligence Platform',
  },
  description,
  applicationName: 'ZeroDriveX Data Intelligence Platform',
  authors: [{ name: 'ZeroDriveX', url: 'https://zerodrivex.com/' }],
  creator: 'ZeroDriveX',
  publisher: 'ZeroDriveX',
  category: 'Data intelligence software',
  keywords: [
    'AI dataset intelligence',
    'dataset provenance',
    'training data quality',
    'synthetic data governance',
    'dataset augmentation',
    'audit-ready data exports',
  ],
  alternates: {
    canonical: '/',
    languages: {
      'en-US': '/',
    },
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  manifest: '/site.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  openGraph: {
    title,
    description,
    url: 'https://data.zerodrivex.com',
    siteName: 'ZeroDriveX Data Intelligence Platform',
    locale: 'en_US',
    images: [
      {
        url: '/og-image.png',
        secureUrl: 'https://data.zerodrivex.com/og-image.png',
        type: 'image/png',
        width: 1200,
        height: 630,
        alt: 'ZeroDriveX Data Intelligence Platform — Your data can prove itself.',
      },
    ],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: [
      {
        url: '/og-image.png',
        alt: 'ZeroDriveX Data Intelligence Platform — Your data can prove itself.',
      },
    ],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-US">
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}
