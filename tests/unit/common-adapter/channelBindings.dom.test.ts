/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_FRONTEND_USER_ID, CHANNEL_BINDINGS_STORAGE_KEY } from '@/common/utils/frontendUserScope';

const mocks = vi.hoisted(() => ({
  httpRequest: vi.fn(),
}));

vi.mock('@office-ai/platform', () => ({
  bridge: {
    buildProvider: vi.fn(() => ({ provider: vi.fn(), invoke: vi.fn() })),
    buildEmitter: vi.fn(() => ({ emit: vi.fn(), on: vi.fn(() => vi.fn()) })),
  },
}));

vi.mock('@/common/adapter/httpBridge', () => {
  const makeProvider = (method: string, path: string | ((params: unknown) => string), mapBody?: (params: unknown) => unknown) => ({
    provider: vi.fn(),
    invoke: vi.fn((params?: unknown) => {
      const resolvedPath = typeof path === 'function' ? path(params) : path;
      const body = mapBody ? mapBody(params) : method === 'GET' || method === 'DELETE' ? undefined : params;
      return mocks.httpRequest(method, resolvedPath, body);
    }),
  });

  return {
    httpRequest: mocks.httpRequest,
    httpGet: (path: string | ((params: unknown) => string)) => makeProvider('GET', path),
    httpPost: (path: string | ((params: unknown) => string), mapBody?: (params: unknown) => unknown) =>
      makeProvider('POST', path, mapBody),
    httpPut: (path: string | ((params: unknown) => string), mapBody?: (params: unknown) => unknown) =>
      makeProvider('PUT', path, mapBody),
    httpPatch: (path: string | ((params: unknown) => string), mapBody?: (params: unknown) => unknown) =>
      makeProvider('PATCH', path, mapBody),
    httpDelete: (path: string | ((params: unknown) => string)) => makeProvider('DELETE', path),
    stubProvider: vi.fn((_name: string, defaultValue: unknown) => ({ provider: vi.fn(), invoke: vi.fn(() => defaultValue) })),
    withResponseMap: vi.fn((inner: { invoke: (params?: unknown) => Promise<unknown> }, map: (raw: unknown) => unknown) => ({
      provider: vi.fn(),
      invoke: vi.fn(async (params?: unknown) => map(await inner.invoke(params))),
    })),
    wsEmitter: vi.fn(() => ({ emit: vi.fn(), on: vi.fn(() => vi.fn()) })),
    wsMappedEmitter: vi.fn(() => ({ emit: vi.fn(), on: vi.fn(() => vi.fn()) })),
  };
});

const rawChannelUser = (id: string, platformUserId = id) => ({
  id,
  platform_user_id: platformUserId,
  platform_type: 'weixin',
  display_name: platformUserId,
  authorized_at: 1,
});

const mockCurrentUser = (userId: string) => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, user: { id: userId, username: userId } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
  );
};

describe('channel frontend bindings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    delete (window as Window & { electronAPI?: unknown }).electronAPI;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('filters authorized channel users with server bindings instead of stale local admin bindings', async () => {
    mockCurrentUser('user_child');
    window.localStorage.setItem(
      CHANNEL_BINDINGS_STORAGE_KEY,
      JSON.stringify({
        [ADMIN_FRONTEND_USER_ID]: ['wx-child'],
      })
    );
    mocks.httpRequest.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/api/channel/users') {
        return Promise.resolve([
          rawChannelUser('wx-child'),
          rawChannelUser('wx-admin'),
          rawChannelUser('wx-unbound'),
        ]);
      }
      if (method === 'GET' && path === '/api/settings/client') {
        return Promise.resolve({
          [CHANNEL_BINDINGS_STORAGE_KEY]: {
            user_child: ['wx-child'],
            [ADMIN_FRONTEND_USER_ID]: ['wx-admin'],
          },
          unrelated: true,
        });
      }
      return Promise.resolve(undefined);
    });

    const { channel } = await import('@/common/adapter/ipcBridge');
    const users = await channel.getAuthorizedUsers.invoke();

    expect(users.map((user) => user.id)).toEqual(['wx-child']);
    expect(mocks.httpRequest).toHaveBeenCalledWith('GET', '/api/settings/client');
    expect(mocks.httpRequest).not.toHaveBeenCalledWith(
      'GET',
      `/api/settings/client?key=${encodeURIComponent(CHANNEL_BINDINGS_STORAGE_KEY)}`,
    );
  });

  it('binds an approved Weixin user to the authenticated child user and removes stale admin ownership', async () => {
    mockCurrentUser('user_child');
    let channelUsersReadCount = 0;
    const putBodies: unknown[] = [];
    mocks.httpRequest.mockImplementation((method: string, path: string, body?: unknown) => {
      if (method === 'GET' && path === '/api/channel/users') {
        channelUsersReadCount += 1;
        return Promise.resolve(channelUsersReadCount === 1 ? [] : [rawChannelUser('wx-user', 'openid-1')]);
      }
      if (method === 'GET' && path === '/api/channel/pairings') {
        return Promise.resolve([
          {
            code: '123456',
            platform_user_id: 'openid-1',
            platform_type: 'weixin',
            requested_at: 1,
            expires_at: 2,
          },
        ]);
      }
      if (method === 'POST' && path === '/api/channel/pairings/approve') {
        return Promise.resolve(undefined);
      }
      if (method === 'GET' && path === '/api/settings/client') {
        return Promise.resolve({
          [CHANNEL_BINDINGS_STORAGE_KEY]: {
            [ADMIN_FRONTEND_USER_ID]: ['wx-user'],
          },
        });
      }
      if (method === 'PUT' && path === '/api/settings/client') {
        putBodies.push(body);
        return Promise.resolve(undefined);
      }
      return Promise.resolve(undefined);
    });

    const { channel } = await import('@/common/adapter/ipcBridge');
    await channel.approvePairing.invoke({ code: '123456' });

    expect(putBodies.at(-1)).toEqual({
      [CHANNEL_BINDINGS_STORAGE_KEY]: {
        user_child: ['wx-user'],
      },
    });
  });

  it('revokes the visible channel user and removes it from all frontend bindings', async () => {
    mockCurrentUser('user_child');
    const putBodies: unknown[] = [];
    mocks.httpRequest.mockImplementation((method: string, path: string, body?: unknown) => {
      if (method === 'GET' && path === '/api/settings/client') {
        return Promise.resolve({
          [CHANNEL_BINDINGS_STORAGE_KEY]: {
            user_child: ['wx-user', 'wx-other'],
          },
        });
      }
      if (method === 'POST' && path === '/api/channel/users/revoke') {
        return Promise.resolve(undefined);
      }
      if (method === 'PUT' && path === '/api/settings/client') {
        putBodies.push(body);
        return Promise.resolve(undefined);
      }
      return Promise.resolve(undefined);
    });

    const { channel } = await import('@/common/adapter/ipcBridge');
    await channel.revokeUser.invoke({ user_id: 'wx-user' });

    expect(mocks.httpRequest).toHaveBeenCalledWith('POST', '/api/channel/users/revoke', { user_id: 'wx-user' });
    expect(putBodies.at(-1)).toEqual({
      [CHANNEL_BINDINGS_STORAGE_KEY]: {
        user_child: ['wx-other'],
      },
    });
  });

  it('does not revoke a channel user that is already bound to another frontend user', async () => {
    mockCurrentUser('user_child');
    mocks.httpRequest.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/api/settings/client') {
        return Promise.resolve({
          [CHANNEL_BINDINGS_STORAGE_KEY]: {
            user_other: ['wx-user'],
          },
        });
      }
      return Promise.resolve(undefined);
    });

    const { channel } = await import('@/common/adapter/ipcBridge');

    await expect(channel.revokeUser.invoke({ user_id: 'wx-user' })).rejects.toThrow(
      'Channel user is bound to another user'
    );
    expect(mocks.httpRequest).not.toHaveBeenCalledWith('POST', '/api/channel/users/revoke', { user_id: 'wx-user' });
  });
});
