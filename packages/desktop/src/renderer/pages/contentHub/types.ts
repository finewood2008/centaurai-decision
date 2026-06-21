/**
 * Content Hub shared types.
 */
import type { FileEntry } from '@/renderer/pages/guid/components/RecentFiles';

/** Top-level sections of the Content Hub. */
export type HubSection = 'mine' | 'shared' | 'knowledge';

/** Sub-views within the 我的产物 (mine) section. */
export type HubMineView = 'all' | 'byConversation' | 'byType';

/** How files are laid out: uniform grid vs. masonry waterfall. */
export type HubViewMode = 'grid' | 'waterfall';

/** Card size preset, shared by both view modes. */
export type HubCardSize = 'small' | 'medium' | 'large';

/** Coarse classification used by the 按类型 (by type) filter. */
export type HubFileKind = 'all' | 'image' | 'document' | 'code' | 'other';

/** A group of files that belong to the same conversation. */
export type HubConversationGroup = {
  conversation: string;
  files: FileEntry[];
};

export type { FileEntry };
