/**
 * FileArchivePage — full file browser showing all generated files.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { Message, Input } from '@arco-design/web-react';
import { Copy, FolderOpen, Search, ArrowLeft, Download } from '@icon-park/react';
import { useNavigate } from 'react-router-dom';
import { ipcBridge } from '@/common';
import { downloadFileFromPath } from '@/renderer/utils/file/download';
import { filterConversationsWithChannelScope } from '@/renderer/utils/user/conversationVisibility';
import {
  buildVisibleFileFilter,
  fetchRecentFiles,
  getFileIcon,
  formatSize,
  formatTime,
  shortConversation,
} from '@/renderer/pages/guid/components/RecentFiles';
import type { FileEntry } from '@/renderer/pages/guid/components/RecentFiles';

const FileArchivePage: React.FC = () => {
  const navigate = useNavigate();
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const conversations = await ipcBridge.database.getUserConversations.invoke({ limit: 10000 });
      const visibleConversations = await filterConversationsWithChannelScope(conversations.items ?? []);
      setFiles(await fetchRecentFiles(buildVisibleFileFilter(visibleConversations)));
    } catch {
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const filtered = search.trim() ? files.filter((f) => f.name.toLowerCase().includes(search.toLowerCase())) : files;

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

  const handleDownload = async (e: React.MouseEvent, file: FileEntry) => {
    e.stopPropagation();
    try {
      await downloadFileFromPath(file.path, file.name);
    } catch {
      Message.error('下载失败');
    }
  };

  return (
    <div className='h-full flex flex-col bg-[var(--color-bg-1)]'>
      {/* Header */}
      <div className='flex items-center gap-12px px-20px py-14px border-b border-[var(--color-border-2)] shrink-0'>
        <button onClick={() => navigate(-1)} className='p-4px cursor-pointer text-t-secondary hover:text-t-primary'>
          <ArrowLeft size='18' />
        </button>
        <span className='text-16px font-semibold'>工作空间</span>
        <span className='text-12px text-t-secondary'>({files.length})</span>
        <div className='flex-1' />
        <Input
          prefix={<Search size='14' />}
          placeholder='搜索文件名...'
          value={search}
          onChange={setSearch}
          size='small'
          style={{ width: 200 }}
          allowClear
        />
      </div>

      {/* File grid */}
      {loading ? (
        <div className='flex-1 flex items-center justify-center text-t-secondary'>加载中...</div>
      ) : filtered.length === 0 ? (
        <div className='flex-1 flex items-center justify-center text-t-secondary'>
          {search ? '无匹配文件' : '暂无生成文件'}
        </div>
      ) : (
        <div className='flex-1 overflow-y-auto p-16px'>
          <div className='flex flex-wrap gap-8px'>
            {filtered.map((file, idx) => (
              <div
                key={idx}
                className='flex flex-col items-center gap-4px w-90px px-4px py-12px rd-10px cursor-pointer
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
                    onClick={(e) => handleDownload(e, file)}
                    className='w-18px h-18px flex items-center justify-center rd-4px bg-[var(--color-bg-2)] text-t-secondary hover:text-t-primary cursor-pointer'
                  >
                    <Download size='10' />
                  </span>
                  <span
                    onClick={(e) => handleShowFolder(e, file.path)}
                    className='w-18px h-18px flex items-center justify-center rd-4px bg-[var(--color-bg-2)] text-t-secondary hover:text-t-primary cursor-pointer'
                  >
                    <FolderOpen size='10' />
                  </span>
                </div>
                <span className='text-34px leading-none'>{getFileIcon(file.name)}</span>
                <span className='text-11px text-t-primary text-center w-full truncate leading-tight'>{file.name}</span>
                <span className='text-10px text-t-secondary text-center leading-tight'>
                  {shortConversation(file.conversation)}
                </span>
                <span className='text-10px text-t-secondary text-center leading-tight'>{formatSize(file.size)}</span>
                <span className='text-10px text-t-secondary text-center leading-tight'>{formatTime(file.mtime)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default FileArchivePage;
