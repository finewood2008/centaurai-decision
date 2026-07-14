import { describe, expect, it } from 'vitest';
import { safeFileResponseHeaders, safeInlineContentType } from '../../../packages/web-host/src/safe-preview';

describe('managed asset preview safety', () => {
  it.each(['text/html', 'image/svg+xml', 'application/xml', 'application/xhtml+xml'])(
    'renders active document MIME %s as plain text',
    (mime) => expect(safeInlineContentType(mime)).toBe('text/plain; charset=utf-8')
  );

  it('preserves passive document MIME types', () => {
    expect(safeInlineContentType('application/pdf')).toBe('application/pdf');
  });

  it('adds a no-script sandbox to inline responses', () => {
    expect(safeFileResponseHeaders(true)['content-security-policy']).toContain("default-src 'none'");
  });
});
