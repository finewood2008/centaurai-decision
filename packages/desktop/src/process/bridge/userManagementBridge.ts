/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * User management bridge — CRUD for user accounts via backend HTTP API.
 */

import { ipcBridge } from '@/common';
import type { IUserRecord, ICreateUserParams, IResetUserPasswordResult } from '@/common/adapter/ipcBridge';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

const BCRYPT_ROUNDS = 12;

function getBackendPort(): number | undefined {
  return (globalThis as typeof globalThis & { __backendPort?: number }).__backendPort;
}

export function initUserManagementBridge(): void {
  // ── list ──────────────────────────────────────────────────────
  ipcBridge.users.list.provider(async () => {
    const port = getBackendPort();
    if (!port) throw new Error('Backend not running');

    const res = await fetch(`http://127.0.0.1:${port}/api/auth/internal/users`);
    if (!res.ok) {
      throw new Error(`Failed to list users (${res.status})`);
    }

    const json = (await res.json()) as { success?: boolean; data?: IUserRecord[] };
    if (json.success && Array.isArray(json.data)) {
      // Strip password_hash and jwt_secret before sending to renderer
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      return json.data.map(
        ({ password_hash: _, jwt_secret: __, ...rest }: Record<string, unknown>) => rest as unknown as IUserRecord
      );
    }

    throw new Error('Failed to list users');
  });

  // ── create ────────────────────────────────────────────────────
  ipcBridge.users.create.provider(async (params: ICreateUserParams) => {
    const port = getBackendPort();
    if (!port) throw new Error('Backend not running');

    const passwordHash = bcrypt.hashSync(params.password, BCRYPT_ROUNDS);

    const res = await fetch(`http://127.0.0.1:${port}/api/auth/internal/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: params.username,
        password_hash: passwordHash,
      }),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error || `Failed to create user (${res.status})`);
    }

    const json = (await res.json()) as { success?: boolean; data?: IUserRecord };
    if (!json.success || !json.data) {
      throw new Error('Failed to create user');
    }

    return json.data;
  });

  // ── delete ────────────────────────────────────────────────────
  ipcBridge.users.delete.provider(async (params: { user_id: string }) => {
    const port = getBackendPort();
    if (!port) throw new Error('Backend not running');

    const res = await fetch(`http://127.0.0.1:${port}/api/auth/internal/users/${encodeURIComponent(params.user_id)}`, {
      method: 'DELETE',
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error || `Failed to delete user (${res.status})`);
    }

    const json = (await res.json()) as { success?: boolean; data?: boolean };
    if (!json.success || !json.data) {
      throw new Error('User not found or could not be deleted');
    }
  });

  // ── resetPassword ─────────────────────────────────────────────
  ipcBridge.users.resetPassword.provider(async (params: { user_id: string }) => {
    const port = getBackendPort();
    if (!port) throw new Error('Backend not running');

    const newPassword = randomBytes(8).toString('hex');
    const passwordHash = bcrypt.hashSync(newPassword, BCRYPT_ROUNDS);

    // Update password via internal API
    const res = await fetch(
      `http://127.0.0.1:${port}/api/auth/internal/users/${encodeURIComponent(params.user_id)}/password`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password_hash: passwordHash }),
      }
    );

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error || `Failed to reset password (${res.status})`);
    }

    return { new_password: newPassword };
  });
}
