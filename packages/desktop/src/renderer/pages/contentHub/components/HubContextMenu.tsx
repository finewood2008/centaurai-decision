/**
 * HubContextMenu — right-click menu for content-hub file cards.
 * Fixed-positioned at the cursor, clamped to the viewport (mirrors
 * WorkspaceContextMenu). Closes on outside click / Escape via the parent.
 */
import React from 'react';
import { Copy, Download, FolderOpen, PreviewOpen, Share } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { FileEntry } from '../types';

export type HubMenuState = { x: number; y: number; file: FileEntry } | null;

type HubContextMenuProps = {
  state: HubMenuState;
  onOpen: (file: FileEntry) => void;
  onCopyPath: (file: FileEntry) => void;
  onDownload: (file: FileEntry) => void;
  onReveal: (file: FileEntry) => void;
  onShare: (file: FileEntry) => void;
  onClose: () => void;
};

const MENU_W = 200;
const MENU_H = 230;
const BTN =
  'w-full flex items-center gap-8px px-14px py-6px text-13px text-left text-t-primary rounded-md transition-colors hover:bg-fill-2 border-none bg-transparent cursor-pointer';

const HubContextMenu: React.FC<HubContextMenuProps> = ({
  state,
  onOpen,
  onCopyPath,
  onDownload,
  onReveal,
  onShare,
  onClose,
}) => {
  const { t } = useTranslation();
  if (!state) return null;
  const { file } = state;

  const top = typeof window !== 'undefined' ? Math.min(state.y, window.innerHeight - MENU_H) : state.y;
  const left = typeof window !== 'undefined' ? Math.min(state.x, window.innerWidth - MENU_W) : state.x;

  const run = (fn: (f: FileEntry) => void) => () => {
    onClose();
    fn(file);
  };

  return (
    <>
      {/* Invisible backdrop closes the menu on any outside interaction. */}
      <div
        className='fixed inset-0 z-99'
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        className='fixed z-100 min-w-200px rd-12px bg-[var(--color-bg-2)] shadow-md p-6px'
        style={{ top, left }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className='flex flex-col gap-4px'>
          <button className={BTN} onClick={run(onOpen)}>
            <PreviewOpen size='14' /> {t('contentHub.actions.open')}
          </button>
          <button className={BTN} onClick={run(onShare)}>
            <Share size='14' /> {t('contentHub.actions.shareToTeam')}
          </button>
          <div className='h-1px my-2px bg-[var(--color-border-2)]' />
          <button className={BTN} onClick={run(onCopyPath)}>
            <Copy size='14' /> {t('contentHub.actions.copyPath')}
          </button>
          <button className={BTN} onClick={run(onDownload)}>
            <Download size='14' /> {t('contentHub.actions.download')}
          </button>
          <button className={BTN} onClick={run(onReveal)}>
            <FolderOpen size='14' /> {t('contentHub.actions.showInFolder')}
          </button>
        </div>
      </div>
    </>
  );
};

export default HubContextMenu;
