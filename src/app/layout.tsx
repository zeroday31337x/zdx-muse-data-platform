import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import Nav from '@/components/Nav';
export const metadata: Metadata = {
  metadataBase: new URL('https://data.zerodrivex.com'),
  title: 'ZeroDriveX Data Intelligence Platform',
  description: 'Real-data-first intelligence and governed dataset preparation, powered by Meta Muse models',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  },
  openGraph: {
    title: 'ZeroDriveX Data Intelligence Platform',
    description: 'Real-data-first intelligence and governed dataset preparation, powered by Meta Muse models',
    url: 'https://data.zerodrivex.com',
    siteName: 'ZeroDriveX Data Intelligence Platform',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'ZeroDriveX Data Intelligence Platform — Your data can prove itself.' }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ZeroDriveX Data Intelligence Platform',
    description: 'Real-data-first intelligence and governed dataset preparation, powered by Meta Muse models',
    images: ['/og-image.png'],
  },
};
export default function RootLayout({children}:{children:ReactNode}) {return <html lang="en"><body><Nav />{children}</body></html>}
