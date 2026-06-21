/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { fromBackendDirOrFile, fromBackendDirOrFileList } from '@/common/adapter/workspaceMapper';

// The backend `/api/fs/dir` tree is snake_case; the mapper must surface
// camelCase so consumers (Content Hub tree walk, skill-rule generator) see
// `isFile`/`isDir` instead of `undefined`.
const rawFile = { name: 'a.md', full_path: '/ws/a.md', relative_path: 'a.md', is_dir: false, is_file: true };
const rawDir = {
  name: 'sub',
  full_path: '/ws/sub',
  relative_path: 'sub',
  is_dir: true,
  is_file: false,
  children: [rawFile],
};

describe('fromBackendDirOrFile', () => {
  it('maps snake_case fields to camelCase', () => {
    expect(fromBackendDirOrFile(rawFile as never)).toEqual({
      name: 'a.md',
      fullPath: '/ws/a.md',
      relativePath: 'a.md',
      isDir: false,
      isFile: true,
    });
  });

  it('recursively maps children and preserves the tree shape', () => {
    const mapped = fromBackendDirOrFile(rawDir as never);
    expect(mapped.isDir).toBe(true);
    expect(mapped.children).toHaveLength(1);
    expect(mapped.children?.[0]).toMatchObject({ name: 'a.md', isFile: true, fullPath: '/ws/a.md' });
  });

  it('omits the children key when the node has none', () => {
    expect('children' in fromBackendDirOrFile(rawFile as never)).toBe(false);
  });
});

describe('fromBackendDirOrFileList', () => {
  it('maps a list of nodes', () => {
    const out = fromBackendDirOrFileList([rawFile, rawDir] as never);
    expect(out).toHaveLength(2);
    expect(out[0]?.isFile).toBe(true);
    expect(out[1]?.isDir).toBe(true);
  });

  it('returns an empty array for non-array input', () => {
    expect(fromBackendDirOrFileList(undefined as never)).toEqual([]);
    expect(fromBackendDirOrFileList(null as never)).toEqual([]);
  });
});
