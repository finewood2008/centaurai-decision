/**
 * RecentFiles — recent files list on homepage.
 *
 * Two layouts:
 *   - horizontal (default): wrap of square icon cards, used at the bottom of
 *     the main column when there's no room for a right rail.
 *   - vertical: stacked rows with icon + name + meta, used by the right-side
 *     rail on wider viewports.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { Message } from '@arco-design/web-react';
import { Copy, FolderOpen } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { IDirOrFile } from '@/common/adapter/ipcBridge';
import type { TChatConversation } from '@/common/config/storage';
import { getCurrentFrontendUserId } from '@/common/utils/frontendUserScope';
import { filterConversationsWithChannelScope } from '@/renderer/utils/user/conversationVisibility';
import { useGeneratedFilesAutoRefresh } from '@/renderer/hooks/workspace/useGeneratedFilesAutoRefresh';
import { isUnsafeTemporaryWorkspacePath } from '@/renderer/utils/workspace/workspace';
import { useFileActions } from '@/renderer/hooks/file/useFileActions';
import styles from '../index.module.css';

export interface FileEntry {
  name: string;
  path: string;
  size: number;
  mtime: number;
  conversation: string;
  sourceConversationId?: string;
  workspaceRoot?: string;
  draftProvenance?:
    | 'managed-temporary-workspace'
    | 'registered-generated-artifact'
    | 'meeting-output'
    | 'uploaded-draft';
  canDiscardDraft?: boolean;
}

export const FILE_ICONS: Record<string, string> = {
  '.py': '🐍',
  '.js': '📜',
  '.ts': '🔷',
  '.tsx': '⚛️',
  '.jsx': '⚛️',
  '.json': '📋',
  '.yaml': '⚙️',
  '.yml': '⚙️',
  '.toml': '⚙️',
  '.html': '🌐',
  '.css': '🎨',
  '.scss': '🎨',
  '.svg': '🖼️',
  '.md': '📝',
  '.txt': '📄',
  '.log': '📋',
  '.png': '🖼️',
  '.jpg': '🖼️',
  '.jpeg': '🖼️',
  '.gif': '🖼️',
  '.webp': '🖼️',
  '.mp3': '🎵',
  '.wav': '🎵',
  '.ogg': '🎵',
  '.mp4': '🎬',
  '.pdf': '📕',
  '.doc': '📘',
  '.docx': '📘',
  '.xlsx': '📊',
  '.pptx': '📊',
  '.zip': '📦',
  '.tar': '📦',
  '.gz': '📦',
  '.sh': '💻',
  '.bash': '💻',
  '.rs': '🦀',
  '.go': '🔵',
  '.java': '☕',
  '.cpp': '⚡',
  '.c': '⚡',
  '.h': '⚡',
};

export function getFileIcon(name: string): string {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  return FILE_ICONS[ext] || '📁';
}

export function formatSize(bytes: number): string {
  // The workspace fs API exposes no per-file size; treat 0/unknown as "no size"
  // and render nothing rather than a misleading "0B".
  if (bytes <= 0) return '';
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'K';
  return (bytes / (1024 * 1024)).toFixed(1) + 'M';
}

export function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
  return d.toLocaleDateString('zh-CN');
}

export function shortConversation(name: string): string {
  const m = name.match(/-([a-f0-9]{6,})$/);
  return m ? '#' + m[1].slice(0, 8) : name.slice(0, 16);
}

/**
 * Directory names that are build/dependency noise, never user deliverables.
 * Pruned while walking a conversation workspace so the Content Hub and the
 * recent-files rail show generated artifacts, not `node_modules` internals.
 */
const EXCLUDED_DIRS = new Set([
  'node_modules',
  'venv',
  '.venv',
  '__pycache__',
  'dist',
  'build',
  'out',
  '.next',
  'target',
  '.cache',
  'coverage',
  '.turbo',
  '.pytest_cache',
  '.git',
  '.idea',
  '.vscode',
]);

/** Bound per-conversation enumeration so a single file-heavy workspace can't
 *  dominate the listing or the request budget. */
const MAX_FILES_PER_CONVERSATION = 300;

/** Epoch ms is ≥ 1e12 since 2001; smaller values are already epoch seconds. */
function toEpochSeconds(ts: number): number {
  if (!ts) return 0;
  return ts >= 1e12 ? Math.floor(ts / 1000) : Math.floor(ts);
}

/**
 * Collect deliverable files from one workspace directory.
 *
 * Uses the real backend (`/api/fs/dir` via {@link ipcBridge.fs.getFilesByDir}),
 * which returns a shallow (~2-level) tree with each entry's immediate children
 * pre-populated. We walk that tree, prune {@link EXCLUDED_DIRS} and dotfiles,
 * and only issue an extra `getFilesByDir` call to expand a directory the
 * backend left unexpanded — so a typical workspace costs a single request.
 *
 * The backend fs API exposes no per-file mtime/size, so every file inherits the
 * owning entity's timestamp (`mtimeSec`, newest first) and size 0.
 */
async function collectWorkspaceFiles(workspace: string, label: string, mtimeSec: number): Promise<FileEntry[]> {
  if (!workspace) return [];

  const out: FileEntry[] = [];
  const fetchDir = async (dir: string): Promise<IDirOrFile[]> => {
    try {
      return await ipcBridge.fs.getFilesByDir.invoke({ dir, root: workspace });
    } catch {
      return [];
    }
  };

  const MAX_DEPTH = 3;
  const walk = async (entries: IDirOrFile[], depth: number): Promise<void> => {
    for (const node of entries) {
      if (out.length >= MAX_FILES_PER_CONVERSATION) return;
      if (node.name.startsWith('.')) continue; // hidden files/dirs
      if (node.isDir) {
        if (EXCLUDED_DIRS.has(node.name) || depth >= MAX_DEPTH) continue;
        const children = node.children && node.children.length > 0 ? node.children : await fetchDir(node.fullPath);
        await walk(children, depth + 1);
      } else if (node.isFile) {
        out.push({
          name: node.name,
          path: node.fullPath,
          size: 0,
          mtime: mtimeSec,
          conversation: label,
          workspaceRoot: workspace,
          draftProvenance: 'managed-temporary-workspace',
          canDiscardDraft: false,
        });
      }
    }
  };

  await walk(await fetchDir(workspace), 0);
  return out;
}

/**
 * Files generated inside a single conversation's workspace.
 *
 * 智囊团/圆桌会议 meeting deliverables (the synthesized 方案书 and the 拍板 decision
 * .docx) are written into the team's *leader* conversation workspace, which is
 * named "Leader" and carries `extra.teamId`. We relabel those with the team name
 * (via `teamNames`) so they're recognizable as meeting outputs in the Content Hub
 * instead of an opaque "Leader" group.
 */
function collectConversationFiles(
  conversation: TChatConversation,
  teamNames: Map<string, string>
): Promise<FileEntry[]> {
  const workspace = (conversation.extra as { workspace?: string } | undefined)?.workspace;
  const isTemporary =
    (conversation.extra as { is_temporary_workspace?: boolean } | undefined)?.is_temporary_workspace === true;
  if (!workspace || !isTemporary || isUnsafeTemporaryWorkspacePath(workspace)) return Promise.resolve([]);
  // modified_at is epoch ms; FileEntry.mtime is epoch seconds (see formatTime).
  const mtimeSec = toEpochSeconds(conversation.modified_at || conversation.created_at || 0);
  const teamId =
    (conversation.extra as { teamId?: string; team_id?: string } | undefined)?.teamId ??
    (conversation.extra as { team_id?: string } | undefined)?.team_id;
  const teamName = teamId ? teamNames.get(teamId) : undefined;
  const label = teamName ? `${teamName} · 圆桌会议` : conversation.name || workspace.split('/').pop() || '';
  return collectWorkspaceFiles(workspace, label, mtimeSec).then((files) =>
    files.map((file) => ({ ...file, sourceConversationId: conversation.id }))
  );
}

/** Fetch the current frontend user's teams (id → name), swallowing any error. */
async function fetchTeamNames(): Promise<Map<string, string>> {
  try {
    const teams = (await ipcBridge.team.list.invoke({ user_id: getCurrentFrontendUserId() })) ?? [];
    return new Map(teams.filter((team) => team.id).map((team) => [team.id, team.name || '圆桌会议']));
  } catch {
    return new Map();
  }
}

/**
 * Aggregate generated files across the given (already user-scoped) conversations
 * by enumerating each conversation's workspace via the real backend. Replaces the
 * previous reliance on a hardcoded, 100-capped `127.0.0.1:8699/api/user-files`
 * endpoint — so the Hub/rail are complete, exclude dependency noise, are scoped
 * per sub-user, and work on desktop, WebUI and LAN alike. Meeting deliverables
 * surface here too because they live in the team leader conversation's workspace
 * (relabeled with the team name). Files come back newest-first.
 */
export async function fetchRecentFiles(conversations: TChatConversation[]): Promise<FileEntry[]> {
  if (!conversations.length) return [];
  const teamNames = await fetchTeamNames();
  const perConversation = await Promise.all(
    conversations.map((conversation) => collectConversationFiles(conversation, teamNames))
  );
  return perConversation.flat().toSorted((a, b) => b.mtime - a.mtime);
}

interface RecentFilesProps {
  onViewAll?: () => void;
  maxRows?: number;
  variant?: 'horizontal' | 'vertical';
  /** Max items in vertical variant before "See all". */
  verticalLimit?: number;
}

const RecentFiles: React.FC<RecentFilesProps> = ({
  onViewAll,
  maxRows = 2,
  variant = 'horizontal',
  verticalLimit = 6,
}) => {
  const { t } = useTranslation();
  const fileActions = useFileActions();
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [visibleConversations, setVisibleConversations] = useState<TChatConversation[] | null>(null);

  const loadVisibleConversations = useCallback(async () => {
    try {
      const result = await ipcBridge.database.getUserConversations.invoke({ limit: 10000 });
      setVisibleConversations(await filterConversationsWithChannelScope(result.items ?? []));
    } catch {
      setVisibleConversations([]);
    }
  }, []);

  const loadFiles = useCallback(async () => {
    if (!visibleConversations) return;
    setLoading(true);
    try {
      const data = await fetchRecentFiles(visibleConversations);
      setFiles(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [visibleConversations]);

  useEffect(() => {
    void loadVisibleConversations();
  }, [loadVisibleConversations]);

  useEffect(() => {
    if (!visibleConversations) return;
    loadFiles();
  }, [loadFiles, visibleConversations]);

  useEffect(() => {
    const timer = setInterval(loadFiles, 30000);
    return () => clearInterval(timer);
  }, [loadFiles]);

  // Live-refresh on agent file writes. Re-fetch the conversation list (not just
  // files) so outputs from a freshly created conversation also appear.
  useGeneratedFilesAutoRefresh(loadVisibleConversations);

  const handleOpen = async (path: string) => {
    try {
      await fileActions.previewFile({ path, name: path.split(/[\\/]/).pop() || path });
    } catch {
      Message.error(t('contentHub.actions.openFailed'));
    }
  };

  const handleCopy = async (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(path);
      Message.success(t('common.copySuccess'));
    } catch {
      Message.error(t('contentHub.toast.copyFailed'));
    }
  };

  const handleShowFolder = async (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    try {
      await fileActions.revealFile({ path, name: path.split(/[\\/]/).pop() || path });
    } catch {
      Message.error(t('contentHub.actions.openFailed'));
    }
  };

  if (variant === 'vertical') {
    if (loading) return null;
    if (files.length === 0) {
      return (
        <div className={styles.recentEmpty}>{t('guid.recentFiles.empty', { defaultValue: 'No recent files yet' })}</div>
      );
    }
    const displayed = files.slice(0, verticalLimit);
    const hasMore = files.length > verticalLimit;
    return (
      <div className={styles.recentList}>
        {displayed.map((file, idx) => (
          <div
            key={idx}
            className={styles.recentItem}
            onClick={() => handleOpen(file.path)}
            title={`${file.name}\n${file.conversation}\n${formatSize(file.size)} · ${formatTime(file.mtime)}`}
          >
            <span className={styles.recentItemIcon}>{getFileIcon(file.name)}</span>
            <div className={styles.recentItemBody}>
              <div className={styles.recentItemName}>{file.name}</div>
              <div className={styles.recentItemMeta}>
                <span>{formatTime(file.mtime)}</span>
                <span className={styles.recentItemDot}>·</span>
                <span>{formatSize(file.size)}</span>
              </div>
            </div>
            <div className={styles.recentItemActions}>
              <span onClick={(e) => handleCopy(e, file.path)} className={styles.recentItemAction} title='Copy path'>
                <Copy size='12' />
              </span>
              {fileActions.canReveal && (
                <span
                  onClick={(e) => handleShowFolder(e, file.path)}
                  className={styles.recentItemAction}
                  title={t('contentHub.actions.reveal')}
                >
                  <FolderOpen size='12' />
                </span>
              )}
            </div>
          </div>
        ))}
        {hasMore && onViewAll && (
          <button type='button' onClick={onViewAll} className={styles.recentViewAll}>
            {t('guid.recentFiles.viewAll', { defaultValue: 'See all' })} →
          </button>
        )}
      </div>
    );
  }

  // horizontal (legacy / narrow-screen fallback)
  if (loading) return null;
  if (files.length === 0) return null;

  // Approximate: 84px card + 6px gap ≈ 90px, 760px container → ~8 per row
  const maxItems = maxRows * 8;
  const displayed = files.slice(0, maxItems);
  const hasMore = files.length > maxItems;

  return (
    <div className='mt-18px w-full relative'>
      <div className='text-11px text-t-secondary mb-8px text-center'>
        {t('guid.recentFiles.title', { defaultValue: '最近生成的文件' })}
      </div>
      <div className='flex flex-wrap gap-6px pr-28px'>
        {displayed.map((file, idx) => (
          <div
            key={idx}
            className='flex flex-col items-center gap-4px w-84px px-4px py-10px rd-10px cursor-pointer
              bg-[var(--color-fill-1)] hover:bg-[var(--color-fill-2)] transition-colors group relative'
            onClick={() => handleOpen(file.path)}
            title={`${file.name}\n对话: ${file.conversation}\n${formatSize(file.size)} · ${formatTime(file.mtime)}`}
          >
            <div className='absolute -top-4px right-0 flex gap-2px opacity-0 group-hover:opacity-100 transition-opacity'>
              <span
                onClick={(e) => handleCopy(e, file.path)}
                className='w-18px h-18px flex items-center justify-center rd-4px bg-[var(--color-bg-2)] text-t-secondary hover:text-t-primary cursor-pointer'
              >
                <Copy size='10' />
              </span>
              {fileActions.canReveal && (
                <span
                  onClick={(e) => handleShowFolder(e, file.path)}
                  className='w-18px h-18px flex items-center justify-center rd-4px bg-[var(--color-bg-2)] text-t-secondary hover:text-t-primary cursor-pointer'
                >
                  <FolderOpen size='10' />
                </span>
              )}
            </div>
            <span className='text-32px leading-none'>{getFileIcon(file.name)}</span>
            <span className='text-11px text-t-primary text-center w-full truncate leading-tight'>{file.name}</span>
            <span className='text-10px text-t-secondary text-center leading-tight'>
              {shortConversation(file.conversation)}
            </span>
            <span className='text-10px text-t-secondary text-center leading-tight'>{formatTime(file.mtime)}</span>
          </div>
        ))}
      </div>

      {hasMore && onViewAll && (
        <span
          onClick={onViewAll}
          className='absolute right-0 bottom-0 text-11px text-t-secondary hover:text-[var(--color-primary-6)] cursor-pointer'
        >
          {t('guid.recentFiles.viewAll', { defaultValue: '查看全部' })} →
        </span>
      )}
    </div>
  );
};

export default RecentFiles;
