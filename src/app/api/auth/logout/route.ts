import { NextResponse } from 'next/server';
import { clearSessionCookie, getSessionFromCookie } from '@/lib/auth';
import { dbConfigured, prisma } from '@/lib/db';
import { getCognitoConfig, buildCognitoLogoutUrl, publicOrigin } from '@/lib/cognito';
export const dynamic = 'force-dynamic';

// Security fix (contract §2): logout DELETES the DB session row, then
// clears the cookie. A post-logout replay of the old cookie → 401.
// For Cognito sessions the response also carries the hosted-UI logout
// URL (a JSON POST cannot itself complete a hosted-UI logout).
export async function POST(req: Request) {
  if (dbConfigured()) {
    try {
      const session = await getSessionFromCookie(req.headers.get('cookie'));
      if (session) {
        const db = prisma();
        await db.session.deleteMany({ where: { tokenHash: session.tokenHash } });
        if (session.provider === 'cognito') {
          const cfg = getCognitoConfig();
          const res = NextResponse.json({
            ok: true,
            // logout_uri must be a REGISTERED Cognito logout URL, so it
            // must use the public origin, never the proxied request
            // origin (localhost:3000 would be rejected by Cognito).
            cognitoLogoutUrl: cfg ? buildCognitoLogoutUrl(cfg, `${publicOrigin(cfg.redirectUri, new URL(req.url).origin)}/`) : null,
          });
          res.headers.set('Set-Cookie', clearSessionCookie());
          return res;
        }
      }
    } catch {
      // Fall through: the cookie is cleared regardless; a missing row
      // is not an error for logout.
    }
  }
  const res = NextResponse.json({ ok: true });
  res.headers.set('Set-Cookie', clearSessionCookie());
  return res;
}
