import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Private ZeroDriveX tenant dashboard for datasets, billing status and account summary.',
  alternates: { canonical: '/dashboard' },
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
};

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
