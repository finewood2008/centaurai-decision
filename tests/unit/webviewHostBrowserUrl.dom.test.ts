/**
 * @vitest-environment-options { "url": "http://server.lan:8080/" }
 *
 * The renderer ↔ web-host URL contract for the LAN workbenches: in a browser (no
 * Electron <webview>), WebviewHost rewrites the desktop workbench URL to the
 * same-origin HTTP route served by static-server (verified end-to-end with a real
 * browser in packages/web-host). The jsdom origin is set to a non-localhost host
 * so the same-origin rewrite is actually exercised (not a coincidental passthrough).
 */
import { describe, it, expect } from 'vitest';
import { adaptWorkbenchUrlForBrowser } from '@renderer/components/media/WebviewHost';

const ORIGIN = 'http://server.lan:8080';

describe('adaptWorkbenchUrlForBrowser — image workbench', () => {
  it('maps the custom-protocol URL to the same-origin HTTP route without injecting provider config', () => {
    const desktopUrl = new URL('centaur-image-workbench://app/index.html');
    desktopUrl.searchParams.set('disableServiceWorker', 'true');

    const out = adaptWorkbenchUrlForBrowser(desktopUrl.toString());
    expect(out).not.toBeNull();
    const u = new URL(out!);
    expect(u.origin).toBe(ORIGIN);
    expect(u.pathname).toBe('/workbench/image/index.html');
    expect(u.searchParams.get('disableServiceWorker')).toBe('true');
    expect(u.searchParams.get('apiUrl')).toBeNull();
    expect(u.searchParams.get('model')).toBeNull();
    expect(u.searchParams.get('apiMode')).toBeNull();
    expect(u.searchParams.get('profileName')).toBeNull();
    expect(u.searchParams.get('apiKey')).toBeNull();
  });
});

describe('adaptWorkbenchUrlForBrowser — video workbench', () => {
  it('maps the host opencut localhost URL to the same-origin reverse-proxy route, preserving path + query', () => {
    const out = adaptWorkbenchUrlForBrowser('http://localhost:3000/workbench/video/editor/abc?x=1');
    expect(out).not.toBeNull();
    const u = new URL(out!);
    // Same-origin (the WebUI server), NOT the browser's own localhost:3000.
    expect(u.origin).toBe(ORIGIN);
    expect(u.pathname).toBe('/workbench/video/editor/abc');
    expect(u.search).toBe('?x=1');
  });

  it('maps the default projects URL', () => {
    const out = adaptWorkbenchUrlForBrowser('http://localhost:3000/workbench/video/projects');
    expect(out).toBe(`${ORIGIN}/workbench/video/projects`);
  });
});

describe('adaptWorkbenchUrlForBrowser — no browser equivalent', () => {
  it('returns null so the caller falls back to the raw URL', () => {
    expect(adaptWorkbenchUrlForBrowser('https://example.com/foo')).toBeNull();
    // A non-basePath localhost video URL has no mapping (only /workbench/video does).
    expect(adaptWorkbenchUrlForBrowser('http://localhost:3000/projects')).toBeNull();
  });
});
