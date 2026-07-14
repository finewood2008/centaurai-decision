/**
 * Headers and MIME projection for same-origin user-controlled file previews.
 *
 * HTML/SVG/XML are active documents: serving one inline from the WebHost origin
 * would let an uploaded file run with the viewer's authenticated cookie. Keep
 * them inert, and disable MIME sniffing so a misleading extension cannot turn
 * an otherwise passive response back into script.
 */

const ACTIVE_DOCUMENT_MIME = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'text/xml',
  'application/xml',
]);

export function safeInlineContentType(mime: string): string {
  const base = mime.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return ACTIVE_DOCUMENT_MIME.has(base) || base.endsWith('+xml') ? 'text/plain; charset=utf-8' : mime;
}

export function safeFileResponseHeaders(inline: boolean): Record<string, string> {
  return {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cross-origin-resource-policy': 'same-origin',
    ...(inline
      ? {
          'content-security-policy': "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'",
        }
      : {}),
  };
}
