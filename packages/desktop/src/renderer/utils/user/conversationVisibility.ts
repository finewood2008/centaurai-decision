import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/config/storage';
import type { IChannelSession, IChannelUser } from '@/common/types/channel/channel';
import { filterConversationsForCurrentUser, type ConversationVisibilityScope } from '@/common/utils/frontendUserScope';

export async function buildConversationVisibilityScope(): Promise<ConversationVisibilityScope> {
  const [channelUsers, channelSessions] = await Promise.all([
    ipcBridge.channel.getAuthorizedUsers.invoke().catch((): IChannelUser[] => []),
    ipcBridge.channel.getActiveSessions.invoke().catch((): IChannelSession[] => []),
  ]);
  const visibleChannelUserIds = new Set(channelUsers.map((user) => user.id));
  const channelConversationUserIds = new Map<string, string>();

  channelSessions.forEach((session) => {
    if (session.conversation_id) {
      channelConversationUserIds.set(session.conversation_id, session.user_id);
    }
  });

  return {
    channelConversationUserIds,
    visibleChannelUserIds,
  };
}

export async function filterConversationsWithChannelScope(
  conversations: TChatConversation[]
): Promise<TChatConversation[]> {
  const scope = await buildConversationVisibilityScope();
  return filterConversationsForCurrentUser(conversations, scope);
}
