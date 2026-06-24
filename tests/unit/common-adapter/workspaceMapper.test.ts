/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fs } from '@/common/adapter/ipcBridge';
import {
  fromBackendDirOrFileList,
  fromBackendWorkspaceFlatFiles,
  type RawDirOrFile,
  type RawWorkspaceFlatFile,
} from '@/common/adapter/workspaceMapper';

describe('workspaceMapper', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps workspace flat files from backend snake_case to frontend camelCase', () => {
    const raw: RawWorkspaceFlatFile[] = [
      {
        name: 'main.ts',
        full_path: '/workspace/src/main.ts',
        relative_path: 'src/main.ts',
      },
    ];

    expect(fromBackendWorkspaceFlatFiles(raw)).toEqual([
      {
        name: 'main.ts',
        fullPath: '/workspace/src/main.ts',
        relativePath: 'src/main.ts',
      },
    ]);
  });

  it('does not leak snake_case path fields', () => {
    const [file] = fromBackendWorkspaceFlatFiles([
      {
        name: 'README.md',
        full_path: '/workspace/README.md',
        relative_path: 'README.md',
      },
    ]);

    expect(file).toBeDefined();
    expect((file as Record<string, unknown>).full_path).toBeUndefined();
    expect((file as Record<string, unknown>).relative_path).toBeUndefined();
    expect(file?.fullPath).toBe('/workspace/README.md');
    expect(file?.relativePath).toBe('README.md');
  });

  // Regression context: the Content Hub / RecentFiles tree walk reads camelCase
  // (`isFile`/`isDir`/`fullPath`). This test verifies the mapper recursively
  // normalizes the backend `/api/fs/dir` tree to the camelCase IDirOrFile shape.
  it('maps the /api/fs/dir tree from snake_case to camelCase, recursively', () => {
    const raw: RawDirOrFile[] = [
      {
        name: 'workspace',
        full_path: '/ws',
        relative_path: '.',
        is_dir: true,
        is_file: false,
        children: [
          {
            name: '方案书.md',
            full_path: '/ws/方案书.md',
            relative_path: '方案书.md',
            is_dir: false,
            is_file: true,
          },
        ],
      },
    ];

    const [dir] = fromBackendDirOrFileList(raw);
    expect(dir?.isDir).toBe(true);
    expect(dir?.isFile).toBe(false);
    expect(dir?.fullPath).toBe('/ws');
    const child = dir?.children?.[0];
    expect(child?.isFile).toBe(true);
    expect(child?.fullPath).toBe('/ws/方案书.md');
    // No snake_case fields leak through to break camelCase consumers.
    expect((child as Record<string, unknown>).is_file).toBeUndefined();
    expect((child as Record<string, unknown>).full_path).toBeUndefined();
  });

  it('tolerates a non-array /api/fs/dir payload without throwing', () => {
    expect(fromBackendDirOrFileList(undefined as unknown as RawDirOrFile[])).toEqual([]);
  });

  it('maps /api/fs/dir payload when invoking ipcBridge.fs.getFilesByDir', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            data: [
              {
                name: 'workspace',
                full_path: '/ws',
                relative_path: '.',
                is_dir: true,
                is_file: false,
                children: [
                  {
                    name: 'notes.md',
                    full_path: '/ws/notes.md',
                    relative_path: 'notes.md',
                    is_dir: false,
                    is_file: true,
                  },
                ],
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      )
    );

    const [dir] = await fs.getFilesByDir.invoke({ dir: '/ws', root: '/ws' });
    const child = dir?.children?.[0];
    expect(dir?.isDir).toBe(true);
    expect(dir?.isFile).toBe(false);
    expect(dir?.fullPath).toBe('/ws');
    expect(child?.isFile).toBe(true);
    expect(child?.fullPath).toBe('/ws/notes.md');
    expect((child as Record<string, unknown>).is_file).toBeUndefined();
    expect((child as Record<string, unknown>).full_path).toBeUndefined();
  });
});
