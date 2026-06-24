/**
 * The renderer ↔ web-host URL contract for the LAN image workbench: in a browser
 * (no Electron <webview>), WebviewHost rewrites the desktop custom-protocol URL to
 * the same-origin HTTP route served by static-server (verified end-to-end with a
 * real browser in packages/web-host). This pins that exact mapping.
 */
import { describe, it, expect } from 'vitest';
import { adaptWorkbenchUrlForBrowser } from '@renderer/components/media/WebviewHost';

describe('adaptWorkbenchUrlForBrowser', () => {
  it('maps the image workbench custom-protocol URL to the same-origin HTTP route, repointing apiUrl at the proxy', () => {
    // Exactly the shape ToolboxPage builds (apiUrl points at the desktop custom-protocol proxy).
    const desktopUrl = new URL('centaur-image-workbench://app/index.html');
    desktopUrl.searchParams.set('profileName', 'TokenClub Image2');
    desktopUrl.searchParams.set('apiUrl', 'centaur-image-workbench://app/__tokenclub/v1');
    desktopUrl.searchParams.set('model', 'gpt-image-2');
    desktopUrl.searchParams.set('apiMode', 'images');

    const out = adaptWorkbenchUrlForBrowser(desktopUrl.toString());
    expect(out).not.toBeNull();
    const u = new URL(out!);
    // jsdom default origin.
    expect(u.origin).toBe('http://localhost:3000');
    expect(u.pathname).toBe('/workbench/image/index.html');
    // apiUrl is repointed at the same-origin key-injecting proxy (no key in the URL).
    expect(u.searchParams.get('apiUrl')).toBe('http://localhost:3000/workbench/image/__proxy/v1');
    expect(u.searchParams.get('apiUrl')).not.toContain('centaur-image-workbench://');
    // Other profile params are preserved.
    expect(u.searchParams.get('model')).toBe('gpt-image-2');
    expect(u.searchParams.get('apiMode')).toBe('images');
    expect(u.searchParams.get('profileName')).toBe('TokenClub Image2');
    // No API key ever placed in the browser URL.
    expect(u.searchParams.get('apiKey')).toBeNull();
  });

  it('returns null for URLs with no browser equivalent yet (caller falls back to raw)', () => {
    expect(adaptWorkbenchUrlForBrowser('http://localhost:3000/projects')).toBeNull();
    expect(adaptWorkbenchUrlForBrowser('https://example.com/foo')).toBeNull();
  });
});
