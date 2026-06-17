/**
 * FileGrid — responsive wrap of FileCard.
 */
import React from 'react';
import FileCard from './FileCard';
import type { FileEntry } from '../types';

type FileGridProps = {
  files: FileEntry[];
  onOpen: (file: FileEntry) => void;
  onShare?: (file: FileEntry) => void;
  onContextMenu?: (file: FileEntry, e: React.MouseEvent) => void;
};

const FileGrid: React.FC<FileGridProps> = ({ files, onOpen, onShare, onContextMenu }) => (
  <div className='flex flex-wrap gap-8px'>
    {files.map((file) => (
      <FileCard key={file.path} file={file} onOpen={onOpen} onShare={onShare} onContextMenu={onContextMenu} />
    ))}
  </div>
);

export default FileGrid;
