import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
export const metadata: Metadata = { title: 'ZeroDriveX Data Intelligence Platform', description: 'Real-data-first intelligence and governed dataset preparation, powered by Meta Muse models' };
export default function RootLayout({children}:{children:ReactNode}) {return <html lang="en"><body>{children}</body></html>}
