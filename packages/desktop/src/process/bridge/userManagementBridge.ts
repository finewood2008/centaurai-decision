/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * User management bridge — CRUD for user accounts via backend HTTP API.
 */

import { ipcBridge } from '@/common';
import {
  ADMIN_FRONTEND_USER_ID,
  CHANNEL_BINDINGS_STORAGE_KEY,
  CONVERSATION_OWNER_EXTRA_KEY,
} from '@/common/utils/frontendUserScope';
import type { IUserRecord, ICreateUserParams } from '@/common/adapter/ipcBridge';
import { getDataPath } from '@process/utils';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import path from 'path';
import { BetterSqlite3Driver } from '../services/database/drivers/BetterSqlite3Driver';

const BCRYPT_ROUNDS = 12;

function getBackendPort(): number | undefined {
  return (globalThis as typeof globalThis & { __backendPort?: number }).__backendPort;
}

type BackendErrorBody = {
  error?: string;
  code?: string;
};

function readBackendError(res: Response): Promise<BackendErrorBody> {
  return res.json().catch(() => ({})) as Promise<BackendErrorBody>;
}

function pruneChannelBindingsForDeletedUser(db: BetterSqlite3Driver, userId: string): void {
  const row = db.prepare('SELECT value FROM client_preferences WHERE key = ?').get(CHANNEL_BINDINGS_STORAGE_KEY) as
    | { value?: string }
    | undefined;
  if (!row?.value) return;

  let rawValue: unknown;
  try {
    rawValue = JSON.parse(row.value) as unknown;
  } catch {
    return;
  }

  const bindingsValue =
    typeof rawValue === 'string'
      ? (() => {
          try {
            return JSON.parse(rawValue) as unknown;
          } catch {
            return undefined;
          }
        })()
      : rawValue;

  if (!bindingsValue || typeof bindingsValue !== 'object' || Array.isArray(bindingsValue)) return;

  const bindings = bindingsValue as Record<string, unknown>;
  if (!(userId in bindings)) return;

  delete bindings[userId];
  db.prepare('UPDATE client_preferences SET value = ?, updated_at = ? WHERE key = ?').run(
    JSON.stringify(bindings),
    Date.now(),
    CHANNEL_BINDINGS_STORAGE_KEY
  );
}

function deleteFrontendOwnedConversations(db: BetterSqlite3Driver, userId: string): void {
  const rows = db
    .prepare('SELECT id, extra FROM conversations WHERE user_id = ? OR extra LIKE ?')
    .all(userId, `%"${CONVERSATION_OWNER_EXTRA_KEY}"%`) as Array<{ id: string; extra?: string }>;

  const conversationIds = rows
    .filter((row) => {
      if (row.id && row.extra) {
        try {
          const extra = JSON.parse(row.extra) as Record<string, unknown>;
          if (extra[CONVERSATION_OWNER_EXTRA_KEY] === userId) return true;
        } catch {
          // Keep falling back to real database ownership below.
        }
      }
      return false;
    })
    .map((row) => row.id);

  const directRows = db.prepare('SELECT id FROM conversations WHERE user_id = ?').all(userId) as Array<{ id: string }>;
  directRows.forEach((row) => {
    if (!conversationIds.includes(row.id)) {
      conversationIds.push(row.id);
    }
  });

  const deleteConversation = db.transaction((conversationId: unknown) => {
    db.prepare('DELETE FROM cron_jobs WHERE conversation_id = ?').run(conversationId);
    db.prepare('DELETE FROM conversation_artifacts WHERE conversation_id = ?').run(conversationId);
    db.prepare('DELETE FROM acp_session WHERE conversation_id = ?').run(conversationId);
    db.prepare('UPDATE assistant_sessions SET conversation_id = NULL WHERE conversation_id = ?').run(conversationId);
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
    db.prepare('DELETE FROM conversations WHERE id = ?').run(conversationId);
  });

  conversationIds.forEach((conversationId) => deleteConversation(conversationId));
}

function deleteUserTeams(db: BetterSqlite3Driver, userId: string): void {
  const teamRows = db.prepare('SELECT id FROM teams WHERE user_id = ?').all(userId) as Array<{ id: string }>;
  const deleteTeam = db.transaction((teamId: unknown) => {
    db.prepare('DELETE FROM mailbox WHERE team_id = ?').run(teamId);
    db.prepare('DELETE FROM team_tasks WHERE team_id = ?').run(teamId);
    db.prepare('DELETE FROM teams WHERE id = ?').run(teamId);
  });
  teamRows.forEach((team) => deleteTeam(team.id));
}

function deleteLocalUser(userId: string): boolean {
  if (!userId || userId === ADMIN_FRONTEND_USER_ID) {
    throw new Error('Cannot delete the admin account');
  }

  const db = new BetterSqlite3Driver(path.join(getDataPath(), 'aionui-backend.db'));
  try {
    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(userId) as { id: string } | undefined;
    if (!existing) return false;

    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    deleteFrontendOwnedConversations(db, userId);
    deleteUserTeams(db, userId);
    pruneChannelBindingsForDeletedUser(db, userId);
    return db.prepare('DELETE FROM users WHERE id = ?').run(userId).changes > 0;
  } finally {
    db.close();
  }
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
    if (!params.user_id || params.user_id === ADMIN_FRONTEND_USER_ID) {
      throw new Error('Cannot delete the admin account');
    }

    const res = await fetch(`http://127.0.0.1:${port}/api/auth/internal/users/${encodeURIComponent(params.user_id)}`, {
      method: 'DELETE',
    });

    if (!res.ok) {
      const err = await readBackendError(res);
      if (res.status === 404 || res.status === 405 || err.code === 'METHOD_NOT_ALLOWED') {
        if (deleteLocalUser(params.user_id)) return;
      }
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
