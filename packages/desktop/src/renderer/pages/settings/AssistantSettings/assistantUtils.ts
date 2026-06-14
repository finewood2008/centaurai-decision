import { resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import type { AssistantListItem } from './types';

export type AssistantListFilter = 'all' | 'enabled' | 'disabled' | 'builtin' | 'user' | 'extension';

/**
 * Check if a string is an emoji (simple check for common emoji patterns).
 */
export const isEmoji = (str: string): boolean => {
  if (!str) return false;
  const emojiRegex = /^(?:\p{Emoji_Presentation}|\p{Emoji}️)(?:‍(?:\p{Emoji_Presentation}|\p{Emoji}️))*$/u;
  return emojiRegex.test(str);
};

/**
 * Resolve an avatar string to an image src URL, or undefined if it is not an image.
 */
export const resolveAvatarImageSrc = (
  avatar: string | undefined,
  avatarImageMap: Record<string, string>
): string | undefined => {
  const value = avatar?.trim();
  if (!value) return undefined;

  const mapped = avatarImageMap[value];
  if (mapped) return mapped;

  const resolved = resolveExtensionAssetUrl(value) || value;
  const isImage = /\.(svg|png|jpe?g|webp|gif)$/i.test(resolved) || /^(https?:|file:\/\/|data:|\/)/i.test(resolved);
  return isImage ? resolved : undefined;
};

/**
 * Sort assistants by sortOrder. The backend already returns sorted lists; this
 * is a deterministic fallback for local reorder operations.
 */
export const sortAssistants = (list: AssistantListItem[]): AssistantListItem[] =>
  [...list].toSorted((a, b) => a.sort_order - b.sort_order);

/**
 * Apply search and management filter to assistant list.
 */
export const filterAssistants = (
  assistants: AssistantListItem[],
  query: string,
  filter: AssistantListFilter,
  localeKey: string
): AssistantListItem[] => {
  const normalizedQuery = query.trim().toLowerCase();

  return assistants.filter((assistant) => {
    if (normalizedQuery) {
      const searchableText = [
        assistant.name_i18n?.[localeKey] || assistant.name,
        assistant.description_i18n?.[localeKey] || assistant.description || '',
      ]
        .join(' ')
        .toLowerCase();

      if (!searchableText.includes(normalizedQuery)) return false;
    }

    switch (filter) {
      case 'enabled':
        return assistant.enabled !== false;
      case 'disabled':
        return assistant.enabled === false;
      case 'builtin':
        return assistant.source === 'builtin';
      case 'user':
        return assistant.source === 'user' && !assistant.id.startsWith('agency-');
      case 'extension':
        return assistant.source === 'extension';
      case 'all':
      default:
        return true;
    }
  });
};

/**
 * Split assistants into enabled and disabled groups while preserving order.
 */
export const groupAssistantsByEnabled = (assistants: AssistantListItem[]) => ({
  enabledAssistants: assistants.filter((assistant) => assistant.enabled !== false),
  disabledAssistants: assistants.filter((assistant) => assistant.enabled === false),
});

/**
 * Category display names for agency agents.
 */
const AGENCY_CATEGORY_NAMES: Record<string, string> = {
  academic: '学术',
  design: '设计',
  engineering: '工程开发',
  finance: '财务',
  'game-development': '游戏开发',
  gis: '地理信息',
  integrations: '集成',
  marketing: '市场营销',
  'paid-media': '付费媒体',
  product: '产品',
  'project-management': '项目管理',
  sales: '销售',
  security: '安全',
  specialized: '专项专家',
  'spatial-computing': '空间计算',
  strategy: '战略',
  support: '技术支持',
  testing: '测试',
};

/**
 * Extract category from an agency assistant key.
 * Keys are like "agency-engineering-frontend-developer".
 */
export const getAgencyCategory = (assistant: AssistantListItem): string | null => {
  if (!assistant.id.startsWith('agency-')) return null;
  const parts = assistant.id.split('-');
  // parts: ['agency', 'engineering', 'frontend', 'developer']
  if (parts.length < 3) return null;
  // Try single category name
  const cat1 = parts[1];
  if (AGENCY_CATEGORY_NAMES[cat1]) return cat1;
  // Try two-word category like "game-development"
  const cat2 = `${parts[1]}-${parts[2]}`;
  if (AGENCY_CATEGORY_NAMES[cat2]) return cat2;
  return 'specialized';
};

/**
 * Group agency assistants by their category.
 * Returns an object of category name → sorted assistants.
 */
export const groupAgencyByCategory = (assistants: AssistantListItem[]): Record<string, AssistantListItem[]> => {
  const groups: Record<string, AssistantListItem[]> = {};
  for (const a of assistants) {
    const cat = getAgencyCategory(a);
    if (!cat) continue;
    const name = AGENCY_CATEGORY_NAMES[cat] || cat;
    if (!groups[name]) groups[name] = [];
    groups[name].push(a);
  }
  // Sort each group by sort_order
  for (const name of Object.keys(groups)) {
    groups[name] = [...groups[name]].sort((a, b) => a.sort_order - b.sort_order);
  }
  return groups;
};
