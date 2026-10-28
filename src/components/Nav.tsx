'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { navLinksFor, type MeState } from '@/lib/nav';

// Page links use next/link (client navigation); auth initiator links
// (/api/auth/cognito?mode=...) must stay plain <a> tags so the browser
// performs a full navigation and the hosted-UI redirect + flow
// cookies work as designed.

// Shared navigation, rendered in the root layout on every page.
// Mobile-first: a hamburger button toggles the menu (aria-expanded,
// closes on navigation); wide screens show the horizontal link menu.
// Link set comes from navLinksFor: signed-out visitors get Home /
// Sign in / Create account; signed-in users get Dashboard / Workbench
// / Settings; the Admin link appears only when the browser also holds
// a valid OPERATOR session (mfa-status 200) — a tenant session alone
// is never presented as operator access.
export default function Nav() {
  const [me, setMe] = useState<MeState | null>(null);
  const [isOperator, setIsOperator] = useState(false);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/auth/me');
        const j = await r.json().catch(() => ({}));
        const state: MeState = { authenticated: Boolean(j?.authenticated), user: j?.user };
        setMe(state);
        if (state.authenticated) {
          // Operator cookie is Path=/api/admin, so it IS sent with
          // this same-origin fetch to an /api/admin/* route.
          const mr = await fetch('/api/admin/auth/mfa-status');
          setIsOperator(mr.ok);
        }
      } catch {
        setMe({ authenticated: false });
      }
    })();
  }, []);

  useEffect(() => { setOpen(false); }, [pathname]);

  const signOut = async () => {
    try {
      const r = await fetch('/api/auth/logout', { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (j?.cognitoLogoutUrl) { window.location.href = j.cognitoLogoutUrl; return; }
    } catch {
      // Fall through: the tenant cookie is cleared server-side even
      // when the response is lost; landing on Home is still signed out.
    }
    window.location.href = '/';
  };

  const links = navLinksFor(me, isOperator);
  const renderLink = (l: { href: string; label: string }, onNavigate?: () => void) =>
    l.href.startsWith('/api/') ? (
      <a href={l.href} onClick={onNavigate}>{l.label}</a>
    ) : (
      <Link href={l.href} onClick={onNavigate}>{l.label}</Link>
    );
  return (
    <header className="topnav">
      <div className="nav-inner">
        <Link className="nav-brand" href="/" onClick={() => setOpen(false)}>ZeroDriveX</Link>
        <nav aria-label="Main navigation">
          <ul className="nav-links">
            {links.map((l) => (
              <li key={l.href + l.label}>{renderLink(l)}</li>
            ))}
            {me?.authenticated && (
              <li><button type="button" className="nav-signout" onClick={signOut}>Sign out</button></li>
            )}
          </ul>
          <button
            type="button"
            className="nav-toggle"
            aria-expanded={open}
            aria-controls="nav-menu"
            aria-label="Toggle navigation menu"
            onClick={() => setOpen((v) => !v)}
          >
            ☰
          </button>
          <ul id="nav-menu" className={open ? 'nav-menu open' : 'nav-menu'}>
            {links.map((l) => (
              <li key={l.href + l.label}>{renderLink(l, () => setOpen(false))}</li>
            ))}
            {me?.authenticated && (
              <li><button type="button" className="nav-signout" onClick={signOut}>Sign out</button></li>
            )}
            {me?.authenticated && me.user?.email && (
              <li className="muted">Signed in as {me.user.email}</li>
            )}
          </ul>
        </nav>
      </div>
    </header>
  );
}
