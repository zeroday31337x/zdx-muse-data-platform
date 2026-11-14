import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Settings',
  description: 'Private ZeroDriveX account settings, profile and billing summary.',
  alternates: { canonical: '/settings' },
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
};

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
