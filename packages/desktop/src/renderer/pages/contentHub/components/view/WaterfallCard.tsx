/**
 * WaterfallCard — one artifact in the masonry (waterfall) layout. Images render
 * at their natural aspect ratio so columns interlock; other types show a compact
 * tile. Same copy / download / reveal / share hover actions as the grid card.
 */
import React, { useCallback } from 'react';
import { Copy, Download, FolderOpen, Share } from '@icon-park/react';
import { formatSize, formatTime, shortConversation } from '@/renderer/pages/guid/components/RecentFiles';
import { ipcBridge } from '@/common';
import FileThumb from './FileThumb';
import { WATERFALL_EMOJI } from './viewConfig';
import { useHubFileActions } from '../../useHubFileActions';
import type { FileEntry, HubCardSize } from '../../types';

type WaterfallCardProps = {
  file: FileEntry;
  size: HubCardSize;
  onOpen: (file: FileEntry) => void;
  onShare?: (file: FileEntry) => void;
  onContextMenu?: (file: FileEntry, e: React.MouseEvent) => void;
};

const ActionChip: React.FC<{ onClick: (e: React.MouseEvent) => void; children: React.ReactNode }> = ({
  onClick,
  children,
}) => (
  <span
    onClick={onClick}
    className='w-20px h-20px flex items-center justify-center rd-4px bg-[var(--color-bg-2)] text-t-secondary hover:text-t-primary cursor-pointer'
  >
    {children}
  </span>
);

const WaterfallCard: React.FC<WaterfallCardProps> = ({ file, size, onOpen, onShare, onContextMenu }) => {
  const actions = useHubFileActions();

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
      className='break-inside-avoid mb-12px rd-10px overflow-hidden cursor-pointer
        bg-[var(--color-fill-1)] hover:bg-[var(--color-fill-2)] transition-colors group relative'
      onClick={() => onOpen(file)}
      onContextMenu={onContextMenu ? (e) => onContextMenu(file, e) : undefined}
      title={`${file.name}\n${file.conversation}\n${formatSize(file.size)} · ${formatTime(file.mtime)}`}
    >
      <div className='absolute top-6px right-6px z-1 flex gap-2px opacity-0 group-hover:opacity-100 transition-opacity'>
        {onShare && (
          <ActionChip onClick={handleShare}>
            <Share size='11' />
          </ActionChip>
        )}
        <ActionChip onClick={handleCopy}>
          <Copy size='11' />
        </ActionChip>
        <ActionChip onClick={handleDownload}>
          <Download size='11' />
        </ActionChip>
        <ActionChip onClick={handleShowFolder}>
          <FolderOpen size='11' />
        </ActionChip>
      </div>
      <FileThumb name={file.name} loadImage={loadImage} variant='natural' emojiClass={WATERFALL_EMOJI[size]} />
      <div className='px-8px py-8px'>
        <div className='text-12px text-t-primary truncate leading-tight'>{file.name}</div>
        <div className='mt-2px text-10px text-t-secondary truncate leading-tight'>
          {shortConversation(file.conversation)} · {formatSize(file.size)} · {formatTime(file.mtime)}
        </div>
      </div>
    </div>
  );
};

export default WaterfallCard;
