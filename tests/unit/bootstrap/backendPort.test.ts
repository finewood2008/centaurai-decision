import { describe, expect, it } from 'vitest';

import { DEFAULT_DEV_BACKEND_PORT, resolvePreferredBackendPort } from '@/process/startup/backendPort';

describe('resolvePreferredBackendPort', () => {
  it('uses the shared dev default so Vite API proxy reaches the local backend', () => {
    expect(resolvePreferredBackendPort({ NODE_ENV: 'development' })).toBe(DEFAULT_DEV_BACKEND_PORT);
  });

  it('does not force a fixed backend port outside development', () => {
    expect(resolvePreferredBackendPort({ NODE_ENV: 'production' })).toBeUndefined();
    expect(resolvePreferredBackendPort({})).toBeUndefined();
  });

  it('lets explicit backend port environment variables win', () => {
    expect(
      resolvePreferredBackendPort({
        NODE_ENV: 'development',
        AIONUI_BACKEND_PORT: '61234',
      })
    ).toBe(61234);
    expect(
      resolvePreferredBackendPort({
        NODE_ENV: 'development',
        AIONUI_BACKEND_PORT: '61234',
        AIONUI_DEV_BACKEND_PORT: '52345',
      })
    ).toBe(52345);
  });

  it('ignores invalid explicit ports', () => {
    expect(resolvePreferredBackendPort({ NODE_ENV: 'development', AIONUI_DEV_BACKEND_PORT: 'abc' })).toBeUndefined();
    expect(resolvePreferredBackendPort({ NODE_ENV: 'development', AIONUI_DEV_BACKEND_PORT: '70000' })).toBeUndefined();
  });
});
