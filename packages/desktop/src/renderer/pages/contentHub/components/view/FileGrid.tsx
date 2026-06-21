/**
 * FileGrid — lays files out in the selected presentation mode:
 *   - 'grid'      : uniform, fixed-width cards (flex wrap).
 *   - 'waterfall' : masonry via CSS multi-column; image cards keep their aspect
 *                   ratio so columns interlock.
 */
import React from 'react';
import FileCard from './FileCard';
import WaterfallCard from './WaterfallCard';
import { WATERFALL_COL_WIDTH } from './viewConfig';
import type { FileEntry, HubCardSize, HubViewMode } from '../../types';

type FileGridProps = {
  files: FileEntry[];
  view: HubViewMode;
  size: HubCardSize;
  onOpen: (file: FileEntry) => void;
  onShare?: (file: FileEntry) => void;
  onContextMenu?: (file: FileEntry, e: React.MouseEvent) => void;
};

const FileGrid: React.FC<FileGridProps> = ({ files, view, size, onOpen, onShare, onContextMenu }) => {
  if (view === 'waterfall') {
    return (
      <div style={{ columnWidth: WATERFALL_COL_WIDTH[size], columnGap: 12 }}>
        {files.map((file) => (
          <WaterfallCard
            key={file.path}
            file={file}
            size={size}
            onOpen={onOpen}
            onShare={onShare}
            onContextMenu={onContextMenu}
          />
        ))}
      </div>
    );
  }

  return (
    <div className='flex flex-wrap gap-8px'>
      {files.map((file) => (
        <FileCard
          key={file.path}
          file={file}
          size={size}
          onOpen={onOpen}
          onShare={onShare}
          onContextMenu={onContextMenu}
        />
      ))}
    </div>
  );
};

export default FileGrid;
