/**
 * FileCard — one generated artifact in the uniform grid. Copy / download /
 * reveal hover actions plus an optional "share to team". Size-aware.
 */
import React, { useCallback } from 'react';
import { Copy, Download, FolderOpen, Share } from '@icon-park/react';
import { formatSize, formatTime, shortConversation } from '@/renderer/pages/guid/components/RecentFiles';
import { ipcBridge } from '@/common';
import FileThumb from './FileThumb';
import { GRID_SIZE } from './viewConfig';
import { useHubFileActions } from '../../useHubFileActions';
import type { FileEntry, HubCardSize } from '../../types';

type FileCardProps = {
  file: FileEntry;
  size: HubCardSize;
  onOpen: (file: FileEntry) => void;
  /** When provided, renders a "share to team" hover action. */
  onShare?: (file: FileEntry) => void;
  /** Right-click handler — opens the hub context menu at the cursor. */
  onContextMenu?: (file: FileEntry, e: React.MouseEvent) => void;
};

const ActionChip: React.FC<{ onClick: (e: React.MouseEvent) => void; children: React.ReactNode }> = ({
  onClick,
  children,
}) => (
  <span
    onClick={onClick}
    className='w-18px h-18px flex items-center justify-center rd-4px bg-[var(--color-bg-2)] text-t-secondary hover:text-t-primary cursor-pointer'
  >
    {children}
  </span>
);

const FileCard: React.FC<FileCardProps> = ({ file, size, onOpen, onShare, onContextMenu }) => {
  const actions = useHubFileActions();
  const dim = GRID_SIZE[size];

  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  const handleCopy = stop(() => void actions.copyPath(file));
  const handleDownload = stop(() => void actions.download(file));
  const handleShowFolder = stop(() => void actions.reveal(file));
  const handleShare = stop(() => onShare?.(file));
  const loadImage = useCallback(() => ipcBridge.fs.getImageBase64.invoke({ path: file.path }), [file.path]);

  return (
    <div
      className={`flex flex-col items-center gap-4px ${dim.card} rd-10px cursor-pointer
        bg-[var(--color-fill-1)] hover:bg-[var(--color-fill-2)] transition-colors group relative`}
      onClick={() => onOpen(file)}
      onContextMenu={onContextMenu ? (e) => onContextMenu(file, e) : undefined}
      title={`${file.name}\n${file.conversation}\n${formatSize(file.size)} · ${formatTime(file.mtime)}`}
    >
      <div className='absolute -top-4px right-0 flex gap-2px opacity-0 group-hover:opacity-100 transition-opacity'>
        {onShare && (
          <ActionChip onClick={handleShare}>
            <Share size='10' />
          </ActionChip>
        )}
        <ActionChip onClick={handleCopy}>
          <Copy size='10' />
        </ActionChip>
        <ActionChip onClick={handleDownload}>
          <Download size='10' />
        </ActionChip>
        <ActionChip onClick={handleShowFolder}>
          <FolderOpen size='10' />
        </ActionChip>
      </div>
      <FileThumb
        name={file.name}
        loadImage={loadImage}
        variant='cover'
        heightClass={dim.thumb}
        emojiClass={dim.emoji}
      />
      <span className={`${dim.name} text-t-primary text-center w-full truncate leading-tight`}>{file.name}</span>
      <span className='text-10px text-t-secondary text-center leading-tight'>
        {shortConversation(file.conversation)}
      </span>
      <span className='text-10px text-t-secondary text-center leading-tight'>{formatSize(file.size)}</span>
      <span className='text-10px text-t-secondary text-center leading-tight'>{formatTime(file.mtime)}</span>
    </div>
  );
};

export default FileCard;
