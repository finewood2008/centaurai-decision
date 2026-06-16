/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import type { TChatConversation } from '@/common/config/storage';
import { isConversationVisibleForCurrentUser } from '@/common/utils/frontendUserScope';
import { buildConversationVisibilityScope } from '@/renderer/utils/user/conversationVisibility';
import { mutate } from 'swr';

export async function getConversationOrNull(conversation_id: string): Promise<TChatConversation | null> {
  try {
    const conversation = await ipcBridge.conversation.get.invoke({ id: conversation_id });
    if (!conversation) return null;
    const visibilityScope = await buildConversationVisibilityScope();
    return isConversationVisibleForCurrentUser(conversation, visibilityScope) ? conversation : null;
  } catch (error) {
    if (isBackendHttpError(error) && error.status === 404 && error.code === 'NOT_FOUND') {
      return null;
    }
    throw error;
  }
}

export async function refreshConversationCache(conversation_id: string): Promise<void> {
  const conversation = await getConversationOrNull(conversation_id);
  if (!conversation) return;

  await mutate<TChatConversation>(`conversation/${conversation_id}`, conversation, false);
}
