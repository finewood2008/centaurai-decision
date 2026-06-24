/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IDirOrFile, IFileMetadata, IWorkspaceFlatFile } from './ipcBridge';

type RawFsEntry = { name: string; type: string };
export type RawWorkspaceFlatFile = { name: string; full_path: string; relative_path: string };

/** Raw `/api/fs/metadata` response — snake_case, as serialized by the backend. */
export type RawFileMetadata = {
  name: string;
  path: string;
  size: number;
  type: string;
  last_modified: number;
  is_directory?: boolean;
};

/** Raw `/api/fs/dir` tree node — snake_case, as serialized by the backend. */
export type RawDirOrFile = {
  name: string;
  full_path: string;
  relative_path: string;
  is_dir: boolean;
  is_file: boolean;
  children?: RawDirOrFile[];
};

// ── Path helpers ───────────────────────────────────────────────────────

function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}

function stripTrailingSlash(p: string): string {
  return p.replace(/\/+$/, '');
}

// ── Frontend → Backend ─────────────────────────────────────────────────

export function absoluteToRelativePath(absolutePath: string, workspace: string): string {
  if (!absolutePath || !workspace) return absolutePath || '.';
  const abs = stripTrailingSlash(normalizeSlashes(absolutePath));
  const ws = stripTrailingSlash(normalizeSlashes(workspace));
  if (abs === ws) return '.';
  if (abs.startsWith(ws + '/')) {
    return abs.slice(ws.length + 1) || '.';
  }
  return absolutePath;
}

// ── Backend → Frontend ─────────────────────────────────────────────────

export function fromBackendFsEntry(item: RawFsEntry, workspace: string, parentRelPath: string): IDirOrFile {
  const ws = stripTrailingSlash(workspace);
  const name = item.name || '';
  const isDir = item.type === 'directory';
  const relativePath = parentRelPath ? `${parentRelPath}/${name}` : name;
  return {
    name,
    fullPath: `${ws}/${relativePath}`,
    relativePath,
    isDir,
    isFile: !isDir,
  };
}

export function fromBackendWorkspaceList(raw: RawFsEntry[], workspace: string, relPath: string): IDirOrFile[] {
  const ws = stripTrailingSlash(workspace);
  const base = relPath === '.' ? '' : relPath;
  const children = raw.map((item) => fromBackendFsEntry(item, ws, base));

  if (relPath === '.' || !relPath) {
    const rootName = ws.split('/').pop() || '';
    return [
      {
        name: rootName,
        fullPath: ws,
        relativePath: '',
        isDir: true,
        isFile: false,
        children,
      },
    ];
  }

  const dirName = relPath.split('/').pop() || '';
  return [
    {
      name: dirName,
      fullPath: `${ws}/${relPath}`,
      relativePath: relPath,
      isDir: true,
      isFile: false,
      children,
    },
  ];
}

/**
 * Map a `/api/fs/dir` response tree from the backend's snake_case
 * (`is_file`/`is_dir`/`full_path`/`relative_path`) into the camelCase
 * {@link IDirOrFile} shape every consumer reads. Without this, `node.isFile`
 * etc. are `undefined`, so the tree walk in the Content Hub (and the skill-rule
 * generator) collects zero files — i.e. the hub renders empty.
 */
export function fromBackendDirOrFile(item: RawDirOrFile): IDirOrFile {
  return {
    name: item.name,
    fullPath: item.full_path,
    relativePath: item.relative_path,
    isDir: item.is_dir,
    isFile: item.is_file,
    ...(item.children ? { children: item.children.map(fromBackendDirOrFile) } : {}),
  };
}

export function fromBackendDirOrFileList(raw: RawDirOrFile[]): IDirOrFile[] {
  return Array.isArray(raw) ? raw.map(fromBackendDirOrFile) : [];
}

export function fromBackendWorkspaceFlatFiles(raw: RawWorkspaceFlatFile[]): IWorkspaceFlatFile[] {
  return raw.map((item) => ({
    name: item.name,
    fullPath: item.full_path,
    relativePath: item.relative_path,
  }));
}

/**
 * Map a `/api/fs/metadata` response from the backend's snake_case
 * (`last_modified`/`is_directory`) into the camelCase {@link IFileMetadata}
 * shape every consumer reads. Without this, `metadata.lastModified` and
 * `metadata.isDirectory` are `undefined`, so drag-import treats folders as
 * files and the preview live-refresh mtime poll never triggers.
 */
export function fromBackendFileMetadata(raw: RawFileMetadata): IFileMetadata {
  return {
    name: raw.name,
    path: raw.path,
    size: raw.size,
    type: raw.type,
    lastModified: raw.last_modified,
    ...(raw.is_directory !== undefined ? { isDirectory: raw.is_directory } : {}),
  };
}
