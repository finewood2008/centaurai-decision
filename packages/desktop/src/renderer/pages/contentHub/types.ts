/**
 * Content Hub shared types.
 */
import type { FileEntry } from '@/renderer/pages/guid/components/RecentFiles';

/** Top-level sections of the Content Hub. */
export type HubSection = 'mine' | 'shared' | 'nas' | 'knowledge';

/** Sub-views within the 我的产物 (mine) section. */
export type HubMineView = 'drafts' | 'assets' | 'knowledge' | 'archived' | 'all' | 'byConversation' | 'byType';

/** Decision personal-workspace sections. */
export type PersonalWorkspaceView = 'drafts' | 'assets' | 'knowledge';

/** How files are laid out: uniform grid vs. masonry waterfall. */
export type HubViewMode = 'list' | 'grid' | 'waterfall';

/** Card size preset, shared by both view modes. */
export type HubCardSize = 'small' | 'medium' | 'large';

/** Coarse classification used by the 按类型 (by type) filter. */
export type HubFileKind = 'all' | 'image' | 'document' | 'code' | 'other';

export type HubSortKey = 'modified' | 'name' | 'size';
export type HubSortDirection = 'asc' | 'desc';

export type HubUrlState = {
  section: HubSection;
  mineView: HubMineView;
  search: string;
  kind: HubFileKind;
  sortKey: HubSortKey;
  sortDirection: HubSortDirection;
  view: HubViewMode;
};

export type HubSelectionState = { selectedIds: ReadonlySet<string> };

export type HubFileRecord<T = unknown> = {
  id: string;
  name: string;
  size: number;
  modifiedAt: number;
  kind: Exclude<HubFileKind, 'all'>;
  source: HubSection;
  raw: T;
  path?: string;
  subtitle?: string;
  isDirectory?: boolean;
  asset?: ContentAsset;
};

export type ContentAssetKind = Exclude<HubFileKind, 'all'>;
export type ContentAssetStatusFlag =
  | 'draft'
  | 'saved'
  | 'shared'
  | 'stored_in_nas'
  | 'indexed'
  | 'archived'
  | 'missing';
export type ContentAsset = {
  id: string;
  title: string;
  kind: ContentAssetKind;
  ownerUserId: string;
  visibility: 'private' | 'team' | 'public';
  sourceConversationId?: string;
  sourceWorkspacePath: string;
  storageProvider: 'workspace' | 'personal_content' | 'shared_drive' | 'nas' | 'knowledge';
  storagePath: string;
  tags: string[];
  category?: string;
  statusFlags: ContentAssetStatusFlag[];
  createdAt: number;
  updatedAt: number;
  size: number;
  draftProvenance?: 'registered-generated-artifact' | 'meeting-output' | 'uploaded-draft';
};

/** A group of files that belong to the same conversation. */
export type HubConversationGroup = {
  conversation: string;
  files: FileEntry[];
};

export type { FileEntry };
