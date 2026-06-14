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
import styles from '../index.module.css';

export interface FileEntry {
  name: string;
  path: string;
  size: number;
  mtime: number;
  conversation: string;
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

export async function fetchRecentFiles(): Promise<FileEntry[]> {
  const resp = await fetch('http://127.0.0.1:8699/api/user-files');
  const data = await resp.json();
  return data.files || [];
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
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchRecentFiles();
      setFiles(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    const t = setInterval(loadFiles, 30000);
    return () => clearInterval(t);
  }, [loadFiles]);

  const handleOpen = async (path: string) => {
    try {
      await ipcBridge.shell.openFile.invoke(path);
    } catch {
      Message.error('无法打开');
    }
  };

  const handleCopy = async (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(path);
      Message.success('已复制');
    } catch {
      Message.error('复制失败');
    }
  };

  const handleShowFolder = async (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    try {
      await ipcBridge.shell.showItemInFolder.invoke(path);
    } catch {
      Message.error('无法打开');
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
              <span
                onClick={(e) => handleShowFolder(e, file.path)}
                className={styles.recentItemAction}
                title='Show in folder'
              >
                <FolderOpen size='12' />
              </span>
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
              <span
                onClick={(e) => handleShowFolder(e, file.path)}
                className='w-18px h-18px flex items-center justify-center rd-4px bg-[var(--color-bg-2)] text-t-secondary hover:text-t-primary cursor-pointer'
              >
                <FolderOpen size='10' />
              </span>
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
