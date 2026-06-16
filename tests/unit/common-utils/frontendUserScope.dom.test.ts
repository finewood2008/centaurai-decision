/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IChannelUser } from '@/common/types/channel/channel';
import {
  ADMIN_FRONTEND_USER_ID,
  addChannelUserBindingForUser,
  filterChannelUsersForUser,
  getChannelUserBindingOwnerIds,
  getCurrentFrontendUserId,
  removeChannelUserBindingForUser,
  resolveCurrentFrontendUserId,
  setCurrentFrontendUserId,
} from '@/common/utils/frontendUserScope';

const channelUser = (id: string): IChannelUser => ({
  id,
  platformUserId: id,
  platformType: 'weixin',
  authorizedAt: 1,
});

describe('frontendUserScope channel bindings', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
    delete (window as Window & { electronAPI?: unknown }).electronAPI;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as Window & { electronAPI?: unknown }).electronAPI;
    window.localStorage.clear();
  });

  it('resolves WebUI user from auth endpoint and refreshes local cache', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true, user: { id: 'user_child', username: 'child' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    await expect(resolveCurrentFrontendUserId()).resolves.toBe('user_child');
    expect(getCurrentFrontendUserId()).toBe('user_child');
  });

  it('treats Electron desktop runtime as the admin frontend user', async () => {
    (window as Window & { electronAPI?: unknown }).electronAPI = {};
    setCurrentFrontendUserId('user_child');

    await expect(resolveCurrentFrontendUserId()).resolves.toBe(ADMIN_FRONTEND_USER_ID);
    expect(getCurrentFrontendUserId()).toBe(ADMIN_FRONTEND_USER_ID);
  });

  it('moves an existing channel binding to the newly selected frontend user', () => {
    const next = addChannelUserBindingForUser(
      {
        [ADMIN_FRONTEND_USER_ID]: ['wx-user'],
        user_child: ['wx-other'],
      },
      'user_child',
      'wx-user'
    );

    expect(next).toEqual({
      user_child: ['wx-other', 'wx-user'],
    });
    expect(getChannelUserBindingOwnerIds(next, 'wx-user')).toEqual(['user_child']);
  });

  it('filters channel users by frontend binding owner', () => {
    const users = [channelUser('wx-child'), channelUser('wx-unbound')];
    const bindings = {
      user_child: ['wx-child'],
    };

    expect(filterChannelUsersForUser(users, 'user_child', bindings).map((user) => user.id)).toEqual(['wx-child']);
    expect(filterChannelUsersForUser(users, ADMIN_FRONTEND_USER_ID, bindings).map((user) => user.id)).toEqual([
      'wx-unbound',
    ]);
  });

  it('removes only the selected frontend user binding', () => {
    const next = removeChannelUserBindingForUser(
      {
        [ADMIN_FRONTEND_USER_ID]: ['wx-user'],
        user_child: ['wx-user', 'wx-other'],
      },
      'user_child',
      'wx-user'
    );

    expect(next).toEqual({
      [ADMIN_FRONTEND_USER_ID]: ['wx-user'],
      user_child: ['wx-other'],
    });
  });
});
