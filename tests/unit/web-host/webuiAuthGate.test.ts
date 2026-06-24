import { describe, expect, it } from 'vitest';

import { createAuthGate, GATE_COOKIE_NAME, parseCookie } from '../../../packages/web-host/src/webui-auth-gate.js';

const FIXED_SECRET = Buffer.alloc(32, 7);

function cookieValue(setCookie: string): string {
  // "webui_gate=<token>; Path=/; ..." → "webui_gate=<token>"
  return setCookie.split(';')[0]!;
}

describe('parseCookie', () => {
  it('extracts a named cookie from a raw header', () => {
    expect(parseCookie('a=1; webui_gate=xyz; b=2', GATE_COOKIE_NAME)).toBe('xyz');
  });
  it('returns null when absent or header missing', () => {
    expect(parseCookie('a=1; b=2', GATE_COOKIE_NAME)).toBeNull();
    expect(parseCookie(undefined, GATE_COOKIE_NAME)).toBeNull();
  });
});

describe('createAuthGate', () => {
  it('authorizes a freshly minted cookie', () => {
    const gate = createAuthGate({ secret: FIXED_SECRET });
    const header = cookieValue(gate.mintCookie());
    expect(gate.isAuthorized(header)).toBe(true);
  });

  it('rejects a missing or empty cookie header', () => {
    const gate = createAuthGate({ secret: FIXED_SECRET });
    expect(gate.isAuthorized(undefined)).toBe(false);
    expect(gate.isAuthorized('')).toBe(false);
    expect(gate.isAuthorized('other=1')).toBe(false);
  });

  it('rejects a tampered payload', () => {
    const gate = createAuthGate({ secret: FIXED_SECRET });
    const token = cookieValue(gate.mintCookie()).slice(GATE_COOKIE_NAME.length + 1);
    const [, sig] = token.split('.');
    const forged = `${Buffer.from(JSON.stringify({ exp: 9999999999 })).toString('base64url')}.${sig}`;
    expect(gate.isAuthorized(`${GATE_COOKIE_NAME}=${forged}`)).toBe(false);
  });

  it('rejects a token signed by a different secret', () => {
    const minted = cookieValue(createAuthGate({ secret: Buffer.alloc(32, 1) }).mintCookie());
    const other = createAuthGate({ secret: Buffer.alloc(32, 2) });
    expect(other.isAuthorized(minted)).toBe(false);
  });

  it('rejects an expired cookie', () => {
    const gate = createAuthGate({ secret: FIXED_SECRET });
    expect(gate.isAuthorized(cookieValue(gate.mintCookie(-1)))).toBe(false);
  });

  it('rejects a malformed token', () => {
    const gate = createAuthGate({ secret: FIXED_SECRET });
    expect(gate.isAuthorized(`${GATE_COOKIE_NAME}=not-a-token`)).toBe(false);
    expect(gate.isAuthorized(`${GATE_COOKIE_NAME}=.sig`)).toBe(false);
  });

  it('clearCookie produces an immediately-expiring cookie', () => {
    const gate = createAuthGate({ secret: FIXED_SECRET });
    const cleared = gate.clearCookie();
    expect(cleared).toContain(`${GATE_COOKIE_NAME}=;`);
    expect(cleared).toContain('Max-Age=0');
  });

  it('marks the cookie Secure only when AIONUI_HTTPS is set', () => {
    expect(createAuthGate({ secret: FIXED_SECRET, secure: true }).mintCookie()).toContain('Secure');
    const insecure = createAuthGate({ secret: FIXED_SECRET, secure: false }).mintCookie();
    expect(insecure).not.toContain('Secure');
    expect(insecure).toContain('HttpOnly');
    expect(insecure).toContain('SameSite=Strict');
  });
});
