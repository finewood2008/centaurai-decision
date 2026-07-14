import { describe, expect, it } from 'vitest';
import {
  getProviderModelFetchStrategy,
  isMaskedProviderSecret,
  sanitizeProviderUpdate,
} from '../../../packages/desktop/src/common/types/provider/providerApi';

describe('provider API secret handling', () => {
  it('recognizes only backend-generated masked provider secrets', () => {
    expect(isMaskedProviderSecret('masked:v1:sk-a…b')).toBe(true);
    expect(isMaskedProviderSecret('sk-live-secret')).toBe(false);
    expect(isMaskedProviderSecret(undefined)).toBe(false);
  });

  it('omits a masked API key from provider updates', () => {
    expect(sanitizeProviderUpdate({ name: 'DeepSeek', api_key: 'masked:v1:sk-a…b' })).toEqual({
      name: 'DeepSeek',
    });
  });

  it('preserves a newly entered plaintext API key', () => {
    expect(sanitizeProviderUpdate({ api_key: 'sk-new-secret' })).toEqual({ api_key: 'sk-new-secret' });
  });

  it('uses the stored secret for an existing masked provider', () => {
    expect(getProviderModelFetchStrategy('masked:v1:sk-a…b', 'provider-1')).toBe('stored-provider');
    expect(getProviderModelFetchStrategy(undefined, 'provider-1')).toBe('stored-provider');
  });

  it('never sends a masked secret through the anonymous model endpoint', () => {
    expect(getProviderModelFetchStrategy('masked:v1:sk-a…b', undefined)).toBe('none');
    expect(getProviderModelFetchStrategy('sk-new-secret', undefined)).toBe('anonymous');
  });
});
