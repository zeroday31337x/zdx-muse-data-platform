'use client';
import { useEffect, useState } from 'react';

// Operator TOTP enrollment page (admin-route MFA). The operator must
// already hold an MFA_PENDING operator session from a fresh operator
// sign-in: the setup secret comes from that sign-in's Cognito access
// token, held server-side in process memory only. No QR library is
// used — the secret is shown for manual authenticator entry, so the
// secret never leaves this page for a third-party QR service.
type Setup = { secretCode: string; account: string; issuer: string };
export default function OperatorMfaSetup() {
  const [state, setState] = useState<'loading' | 'setup' | 'expired' | 'verified' | 'done' | 'error'>('loading');
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/admin/auth/mfa-setup');
        if (r.status === 401) { setState('expired'); return; }
        if (r.status === 409) { setState('verified'); return; }
        if (!r.ok) { setState('error'); return; }
        const j = (await r.json().catch(() => ({}))) as Partial<Setup>;
        if (typeof j.secretCode !== 'string' || typeof j.account !== 'string') { setState('error'); return; }
        setSetup({ secretCode: j.secretCode, account: j.account, issuer: typeof j.issuer === 'string' ? j.issuer : 'ZeroDriveX' });
        setState('setup');
      } catch {
        setState('error');
      }
    })();
  }, []);

  const verify = async () => {
    if (!/^\d{6}$/.test(code)) { setNotice('Enter the 6-digit code from your authenticator app.'); return; }
    setBusy(true);
    setNotice('');
    try {
      const r = await fetch('/api/admin/auth/mfa-setup/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (r.ok) { setState('done'); return; }
      if (r.status === 401) { setState('expired'); return; }
      if (r.status === 429) { setNotice('Too many wrong codes for this enrollment. Sign in as operator again to start a fresh enrollment.'); return; }
      if (j.error === 'SETUP_NOT_STARTED') { setNotice('Enrollment was not started. Reload this page and try again.'); return; }
      setNotice('That code did not match. Use the current code from your authenticator app and try again.');
    } catch {
      setNotice('Verification failed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (state === 'loading') return <main className="page"><p className="muted">Loading…</p></main>;
  if (state === 'expired') {
    return (
      <main className="page">
        <p className="kicker">Admin dashboard</p>
        <h1 className="brand">Sign-in expired</h1>
        <p className="subtitle">Your operator sign-in is too old to start enrollment, or the server restarted. Sign in as operator again and come straight back here.</p>
        <p><a className="btn btn-primary" href="/api/admin/auth/cognito?next=/admin/mfa-setup">Sign in as operator again</a></p>
      </main>
    );
  }
  if (state === 'verified') {
    return (
      <main className="page">
        <p className="kicker">Admin dashboard</p>
        <h1 className="brand">Already verified</h1>
        <p className="subtitle">This operator session is already MFA-verified. The console is open.</p>
        <p><a className="btn btn-primary" href="/admin">Open the console</a></p>
      </main>
    );
  }
  if (state === 'done') {
    return (
      <main className="page">
        <p className="kicker">Admin dashboard</p>
        <h1 className="brand">Authenticator enabled</h1>
        <p className="subtitle">MFA is now enabled for your operator account. Your session is verified — the console is open without another sign-in.</p>
        <p><a className="btn btn-primary" href="/admin">Open the console</a></p>
      </main>
    );
  }
  if (state === 'error' || !setup) {
    return (
      <main className="page">
        <p className="kicker">Admin dashboard</p>
        <h1 className="brand">Enrollment unavailable</h1>
        <p className="muted">Enrollment could not be started. Sign in as operator again, then return here.</p>
        <p><a href="/api/admin/auth/cognito?next=/admin/mfa-setup">Retry operator sign-in →</a></p>
      </main>
    );
  }
  return (
    <main className="page">
      <p className="kicker">Admin dashboard</p>
      <h1 className="brand">Set up your authenticator</h1>
      <p className="subtitle">MFA is required for operator access. Add this key to your authenticator app manually, then enter the 6-digit code it shows.</p>
      <section className="card">
        <p><span className="muted">Account: </span>{setup.account}</p>
        <p><span className="muted">Issuer: </span>{setup.issuer}</p>
        <p><span className="muted">Secret key: </span><code>{setup.secretCode}</code></p>
        <p className="muted">In your authenticator app, choose manual entry and enter the account, issuer, and key above. Keep this key private — anyone with it can generate your codes.</p>
        <label style={{ display: 'block', marginBottom: '0.5rem' }}>
          <span className="muted">6-digit code from your authenticator app</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            placeholder="123456"
            style={{ display: 'block', width: '100%', marginTop: '0.25rem' }}
          />
        </label>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void verify()}>Verify and enable MFA</button>
        {notice && <p className="muted">{notice}</p>}
      </section>
    </main>
  );
}
