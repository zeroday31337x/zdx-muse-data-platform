import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="page">
      <p
        className="kicker"
        style={{ color: '#d4af37', fontSize: 15, letterSpacing: '0.2em' }}
      >
        404 — Page not found
      </p>
      <h1 className="brand">ZeroDriveX Data Intelligence Platform</h1>
      <p className="subtitle">
        The page you are looking for doesn&apos;t exist or has moved. The
        platform itself is right where you left it.
      </p>
      <div className="callout">
        <Link href="/">Return to the homepage</Link>
      </div>
    </main>
  );
}
