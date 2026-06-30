import type { TChatConversation } from '@/common/config/storage';
import type { BillingSourceType } from '@/common/types/billing';

export function resolveBillingSourceType(conversation?: Partial<TChatConversation> | null): BillingSourceType {
  if (!conversation) return 'unknown';
  const extra = conversation.extra as Record<string, unknown> | undefined;
  const assistantId =
    typeof extra?.preset_assistant_id === 'string'
      ? extra.preset_assistant_id
      : typeof extra?.assistant_id === 'string'
        ? extra.assistant_id
        : '';

  if (assistantId.startsWith('agency-')) return 'advisor';
  if (assistantId) return 'office_assistant';
  if (conversation.type === 'aionrs' || conversation.type === 'acp') return 'chat';
  if (conversation.type === 'remote') return 'decision_room';
  return 'unknown';
}
