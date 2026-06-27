import type { TChatConversation } from '@/common/config/storage';
import { getBaseUrl, getWebuiGateHeaders, isRemoteClientBridgeMode } from '@/common/adapter/httpBridge';
import type { IChannelUser } from '@/common/types/channel/channel';

export const ADMIN_FRONTEND_USER_ID = 'system_default_user';
const CURRENT_USER_STORAGE_KEY = 'centaur.currentUserId';
export const CHANNEL_BINDINGS_STORAGE_KEY = 'centaur.channelBindings.v1';
export const CONVERSATION_OWNER_EXTRA_KEY = 'frontend_owner_user_id';

export type ChannelBindings = Record<string, string[]>;
export type ConversationVisibilityScope = {
  channelConversationUserIds?: Map<string, string>;
  visibleChannelUserIds?: Set<string>;
  channelBindings?: ChannelBindings;
};

function readLocalStorage(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Local storage can be unavailable in restricted contexts.
  }
}

function removeLocalStorage(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Local storage can be unavailable in restricted contexts.
  }
}

export function setCurrentFrontendUserId(userId: string | null | undefined): void {
  const normalized = userId?.trim();
  if (normalized) {
    writeLocalStorage(CURRENT_USER_STORAGE_KEY, normalized);
  } else {
    removeLocalStorage(CURRENT_USER_STORAGE_KEY);
  }
}

export function getCurrentFrontendUserId(): string {
  return readLocalStorage(CURRENT_USER_STORAGE_KEY)?.trim() || ADMIN_FRONTEND_USER_ID;
}

export function isAdminFrontendUser(userId = getCurrentFrontendUserId()): boolean {
  return userId === ADMIN_FRONTEND_USER_ID;
}

export function isDesktopFrontendRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean((window as Window & { electronAPI?: unknown }).electronAPI) &&
    !isRemoteClientBridgeMode()
  );
}

export async function resolveCurrentFrontendUserId(): Promise<string> {
  if (isDesktopFrontendRuntime()) {
    setCurrentFrontendUserId(ADMIN_FRONTEND_USER_ID);
    return ADMIN_FRONTEND_USER_ID;
  }

  if (typeof window === 'undefined') {
    return getCurrentFrontendUserId();
  }

  try {
    const response = await fetch(`${getBaseUrl()}/api/auth/user`, {
      method: 'GET',
      credentials: 'include',
      headers: getWebuiGateHeaders(),
    });
    if (response.ok) {
      const data = (await response.json()) as {
        success?: boolean;
        user?: { id?: unknown };
      };
      const userId = typeof data.user?.id === 'string' ? data.user.id.trim() : '';
      if (userId) {
        setCurrentFrontendUserId(userId);
        return userId;
      }
    }
  } catch {
    // Keep the last known frontend user when the auth check is temporarily unavailable.
  }

  return getCurrentFrontendUserId();
}

export function isChannelConversation(conversation: TChatConversation): boolean {
  return Boolean(conversation.channel_chat_id || (conversation.source && conversation.source !== 'aionui'));
}

function getConversationFrontendOwnerId(conversation: TChatConversation): string | undefined {
  const extra = conversation.extra as Record<string, unknown> | undefined;
  const owner = extra?.[CONVERSATION_OWNER_EXTRA_KEY];
  return typeof owner === 'string' && owner.trim() ? owner : undefined;
}

function getChannelConversationUserId(
  conversation: TChatConversation,
  scope?: ConversationVisibilityScope
): string | undefined {
  return scope?.channelConversationUserIds?.get(conversation.id);
}

export function withCurrentConversationOwner<T extends { extra?: unknown }>(params: T): T {
  const currentUserId = getCurrentFrontendUserId();
  return {
    ...params,
    extra: {
      ...(params.extra && typeof params.extra === 'object' ? (params.extra as Record<string, unknown>) : {}),
      [CONVERSATION_OWNER_EXTRA_KEY]: currentUserId,
    },
  } as T;
}

export function isConversationVisibleForCurrentUser(
  conversation: TChatConversation,
  scope?: ConversationVisibilityScope
): boolean {
  const currentUserId = getCurrentFrontendUserId();
  const ownerId = getConversationFrontendOwnerId(conversation);

  if (ownerId) {
    return ownerId === currentUserId;
  }

  const channelUserId = getChannelConversationUserId(conversation, scope);
  if (channelUserId) {
    if (scope?.visibleChannelUserIds) {
      return scope.visibleChannelUserIds.has(channelUserId);
    }
    return isChannelUserVisibleForCurrentUser(channelUserId, scope?.channelBindings);
  }

  if (isChannelConversation(conversation)) {
    return isAdminFrontendUser(currentUserId);
  }

  // Rows created before this frontend-only scoping marker remain in the admin view.
  return isAdminFrontendUser(currentUserId);
}

export function filterConversationsForCurrentUser(
  conversations: TChatConversation[],
  scope?: ConversationVisibilityScope
): TChatConversation[] {
  return conversations.filter((conversation) => isConversationVisibleForCurrentUser(conversation, scope));
}

export function normalizeChannelBindings(value: unknown): ChannelBindings {
  let parsed = value;
  if (typeof value === 'string') {
    if (!value) return {};
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return {};
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

  const bindings: ChannelBindings = {};
  Object.entries(parsed as Record<string, unknown>).forEach(([userId, userIds]) => {
    if (!Array.isArray(userIds)) return;
    bindings[userId] = userIds.filter((id): id is string => typeof id === 'string' && id.length > 0);
  });
  return bindings;
}

export function readLocalChannelBindings(): ChannelBindings {
  const raw = readLocalStorage(CHANNEL_BINDINGS_STORAGE_KEY);
  return normalizeChannelBindings(raw);
}

export function writeLocalChannelBindings(bindings: ChannelBindings): void {
  writeLocalStorage(CHANNEL_BINDINGS_STORAGE_KEY, JSON.stringify(bindings));
}

export function mergeChannelBindings(...sources: ChannelBindings[]): ChannelBindings {
  const merged: ChannelBindings = {};
  sources.forEach((source) => {
    Object.entries(source).forEach(([userId, userIds]) => {
      const current = new Set(merged[userId] ?? []);
      userIds.forEach((id) => current.add(id));
      if (current.size > 0) {
        merged[userId] = [...current];
      }
    });
  });
  return merged;
}

export function addChannelUserBindingForCurrentUser(bindings: ChannelBindings, channelUserId: string): ChannelBindings {
  return addChannelUserBindingForUser(bindings, getCurrentFrontendUserId(), channelUserId);
}

export function addChannelUserBindingForUser(
  bindings: ChannelBindings,
  frontendUserId: string,
  channelUserId: string
): ChannelBindings {
  const currentUserId = frontendUserId.trim() || ADMIN_FRONTEND_USER_ID;
  const next = removeChannelUserBindingFromAllUsers(bindings, channelUserId);
  const current = new Set(next[currentUserId] ?? []);
  current.add(channelUserId);
  next[currentUserId] = [...current];
  return next;
}

export function removeChannelUserBindingForUser(
  bindings: ChannelBindings,
  frontendUserId: string,
  channelUserId: string
): ChannelBindings {
  const currentUserId = frontendUserId.trim() || ADMIN_FRONTEND_USER_ID;
  const next: ChannelBindings = { ...bindings };
  const remaining = (next[currentUserId] ?? []).filter((id) => id !== channelUserId);
  if (remaining.length > 0) {
    next[currentUserId] = remaining;
  } else {
    delete next[currentUserId];
  }
  return next;
}

export function removeChannelUserBindingFromAllUsers(
  bindings: ChannelBindings,
  channelUserId: string
): ChannelBindings {
  const next: ChannelBindings = {};
  Object.entries(bindings).forEach(([userId, userIds]) => {
    const remaining = userIds.filter((id) => id !== channelUserId);
    if (remaining.length > 0) {
      next[userId] = remaining;
    }
  });
  return next;
}

export function getChannelUserBindingOwnerIds(bindings: ChannelBindings, channelUserId: string): string[] {
  return Object.entries(bindings)
    .filter(([, userIds]) => userIds.includes(channelUserId))
    .map(([userId]) => userId);
}

function readChannelBindings(): ChannelBindings {
  return readLocalChannelBindings();
}

function writeChannelBindings(bindings: ChannelBindings): void {
  writeLocalChannelBindings(bindings);
}

export function bindChannelUserToCurrentUser(channelUserId: string): void {
  writeChannelBindings(addChannelUserBindingForCurrentUser(readChannelBindings(), channelUserId));
}

export function removeChannelUserBinding(channelUserId: string): void {
  writeChannelBindings(removeChannelUserBindingFromAllUsers(readChannelBindings(), channelUserId));
}

export function isChannelUserVisibleForUser(
  channelUserId: string,
  frontendUserId: string,
  bindings: ChannelBindings = readChannelBindings()
): boolean {
  const currentUserId = frontendUserId.trim() || ADMIN_FRONTEND_USER_ID;
  const boundForCurrent = new Set(bindings[currentUserId] ?? []);
  const allBound = new Set(Object.values(bindings).flat());

  if (boundForCurrent.has(channelUserId)) return true;
  if (allBound.has(channelUserId)) return false;
  return isAdminFrontendUser(currentUserId);
}

function isChannelUserVisibleForCurrentUser(
  channelUserId: string,
  bindings: ChannelBindings = readChannelBindings()
): boolean {
  return isChannelUserVisibleForUser(channelUserId, getCurrentFrontendUserId(), bindings);
}

export function filterChannelUsersForUser(
  channelUsers: IChannelUser[],
  frontendUserId: string,
  bindings: ChannelBindings = readChannelBindings()
): IChannelUser[] {
  return channelUsers.filter((user) => isChannelUserVisibleForUser(user.id, frontendUserId, bindings));
}

export function filterChannelUsersForCurrentUser(
  channelUsers: IChannelUser[],
  bindings: ChannelBindings = readChannelBindings()
): IChannelUser[] {
  return filterChannelUsersForUser(channelUsers, getCurrentFrontendUserId(), bindings);
}
