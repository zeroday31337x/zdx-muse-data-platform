import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import Nav from '@/components/Nav';
export const metadata: Metadata = { title: 'ZeroDriveX Data Intelligence Platform', description: 'Real-data-first intelligence and governed dataset preparation, powered by Meta Muse models' };
export default function RootLayout({children}:{children:ReactNode}) {return <html lang="en"><body><Nav />{children}</body></html>}
