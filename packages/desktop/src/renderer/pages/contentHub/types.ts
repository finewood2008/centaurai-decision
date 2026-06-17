/**
 * Content Hub shared types.
 */
import type { FileEntry } from '@/renderer/pages/guid/components/RecentFiles';

export type HubTab = 'mine' | 'byConversation' | 'byType' | 'shared';

/** Coarse classification used by the 按类型 (by type) filter. */
export type HubFileKind = 'all' | 'image' | 'document' | 'code' | 'other';

/** A group of files that belong to the same conversation. */
export type HubConversationGroup = {
  conversation: string;
  files: FileEntry[];
};

export type { FileEntry };
