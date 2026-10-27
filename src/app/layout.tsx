import type { Metadata } from 'next';
import type { ReactNode } from 'react';
export const metadata: Metadata = { title: 'ZDX Muse Data Platform', description: 'Real-data-first intelligence and governed dataset preparation' };
export default function RootLayout({children}:{children:ReactNode}) {return <html lang="en"><body style={{margin:0,fontFamily:'system-ui, sans-serif',background:'#0e1626',color:'#eff6ff'}}>{children}</body></html>}
