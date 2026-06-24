/**
 * WebUI reverse-proxy auth gate.
 *
 * The bundled aioncore backend runs in `--local` mode, which disables its own
 * JWT/CSRF enforcement for protected `/api/*` routes (the auth middleware
 * injects a synthetic `system_default_user` instead of verifying a token). That
 * is safe only while the WebUI is reached over loopback. When the WebUI is
 * exposed to a LAN (`allowRemote`), the reverse proxy — not the backend — is
 * the trust boundary, so we gate it here.
 *
 * Flow: a browser may reach the backend only after presenting the WebUI
 * password. We never verify the password ourselves — we let the request hit the
 * backend's `POST /login`, which DOES verify the password against its bcrypt
 * hash even in `--local` mode (only the protected-route middleware is bypassed,
 * not the login handler). On a 2xx login response we mint a signed session
 * cookie; every other `/api/*` request and `/ws` upgrade must carry a valid one.
 *
 * The cookie is a stateless HMAC token signed with a per-process secret — there
 * is no server-side session store, and sessions do not survive a web-host
 * restart (acceptable: clients simply log in again). This adds NO new login UX:
 * it reuses the existing WebUI username/password and login page.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const GATE_COOKIE_NAME = 'webui_gate';

/** Default session lifetime: 7 days. */
const DEFAULT_TTL_SEC = 7 * 24 * 60 * 60;

const nowSec = (): number => Math.floor(Date.now() / 1000);

export type AuthGate = {
  /** Build a `Set-Cookie` value authorizing the bearer for `ttlSec` seconds. */
  mintCookie: (ttlSec?: number) => string;
  /** Build a `Set-Cookie` value that immediately clears the gate cookie. */
  clearCookie: () => string;
  /** True if the raw `Cookie` header carries a valid, unexpired gate token. */
  isAuthorized: (cookieHeader: string | undefined) => boolean;
};

/**
 * Extract a single cookie value from a raw `Cookie` header, or `null`. Exported
 * so the WS-upgrade path can read the header out of a raw request buffer.
 */
export function parseCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

export function createAuthGate(opts?: { secret?: Buffer; secure?: boolean }): AuthGate {
  // A fresh random secret per process: no key management, and a restart
  // transparently invalidates every outstanding session.
  const secret = opts?.secret ?? randomBytes(32);
  const secure = opts?.secure ?? process.env.AIONUI_HTTPS === 'true';

  const sign = (payload: string): string => createHmac('sha256', secret).update(payload).digest('base64url');

  const cookieAttrs = (maxAgeSec: number): string => {
    const attrs = ['Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSec}`];
    if (secure) attrs.push('Secure');
    return attrs.join('; ');
  };

  return {
    mintCookie(ttlSec = DEFAULT_TTL_SEC): string {
      const payload = Buffer.from(JSON.stringify({ exp: nowSec() + ttlSec })).toString('base64url');
      const token = `${payload}.${sign(payload)}`;
      return `${GATE_COOKIE_NAME}=${token}; ${cookieAttrs(ttlSec)}`;
    },

    clearCookie(): string {
      return `${GATE_COOKIE_NAME}=; ${cookieAttrs(0)}`;
    },

    isAuthorized(cookieHeader): boolean {
      const token = parseCookie(cookieHeader, GATE_COOKIE_NAME);
      if (!token) return false;
      const dot = token.indexOf('.');
      if (dot <= 0) return false;

      const payload = token.slice(0, dot);
      const sig = Buffer.from(token.slice(dot + 1));
      const expected = Buffer.from(sign(payload));
      // Constant-time compare; bail before timingSafeEqual on length mismatch
      // (it throws on differing lengths).
      if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return false;

      try {
        const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: number };
        return typeof decoded.exp === 'number' && decoded.exp > nowSec();
      } catch {
        return false;
      }
    },
  };
}
