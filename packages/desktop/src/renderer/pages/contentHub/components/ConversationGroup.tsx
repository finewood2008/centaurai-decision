/**
 * ConversationGroup — collapsible section grouping a conversation's files.
 */
import React, { useState } from 'react';
import { Down, Right } from '@icon-park/react';
import { shortConversation } from '@/renderer/pages/guid/components/RecentFiles';
import FileGrid from './view/FileGrid';
import type { FileEntry, HubCardSize, HubViewMode } from '../types';

type ConversationGroupProps = {
  conversation: string;
  files: FileEntry[];
  view: HubViewMode;
  size: HubCardSize;
  onOpen: (file: FileEntry) => void;
  onShare?: (file: FileEntry) => void;
  onContextMenu?: (file: FileEntry, e: React.MouseEvent) => void;
};

const ConversationGroup: React.FC<ConversationGroupProps> = ({
  conversation,
  files,
  view,
  size,
  onOpen,
  onShare,
  onContextMenu,
}) => {
  const [open, setOpen] = useState(true);

  return (
    <div className='mb-12px'>
      <div
        className='flex items-center gap-6px py-6px cursor-pointer text-t-secondary hover:text-t-primary'
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <Down size='14' /> : <Right size='14' />}
        <span className='text-13px font-[500] truncate'>{shortConversation(conversation)}</span>
        <span className='text-11px text-t-secondary'>({files.length})</span>
      </div>
      {open && (
        <div className='pl-20px'>
          <FileGrid
            files={files}
            view={view}
            size={size}
            onOpen={onOpen}
            onShare={onShare}
            onContextMenu={onContextMenu}
          />
        </div>
      )}
    </div>
  );
};

export default ConversationGroup;
