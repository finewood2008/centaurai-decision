/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { isRemoteClientBridgeMode } from '@/common/adapter/httpBridge';
import type { PreviewContentType } from '@/common/types/office/preview';
import {
  LARGE_TEXT_PREVIEW_MAX_LENGTH,
  LARGE_TEXT_PREVIEW_THRESHOLD,
} from '@/renderer/pages/conversation/Preview/constants';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview/context/PreviewContext';
import { getContentTypeByExtension } from '@/renderer/pages/conversation/Preview/fileUtils';
import { downloadFileFromPath } from '@/renderer/utils/file/download';
import { isOfficePreviewFile } from '@/renderer/utils/file/officePreview';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { useCallback, useMemo } from 'react';

export type FileActionTarget = {
  path: string;
  name: string;
  workspace?: string;
};

export type FilePreviewOptions = {
  replace?: boolean;
};

const BINARY_PREVIEW_TYPES = new Set<PreviewContentType>(['pdf', 'word', 'excel', 'ppt']);
const ACTIVE_DOCUMENT_EXTENSIONS = new Set(['html', 'htm', 'xhtml', 'svg', 'xml']);
const canUseLocalShell = (): boolean => isElectronDesktop() && !isRemoteClientBridgeMode();

function extensionFromName(name: string): string {
  return name.toLowerCase().split('.').pop() || '';
}

function nameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function normalizeTarget(file: FileActionTarget): FileActionTarget {
  return {
    ...file,
    name: file.name || nameFromPath(file.path),
  };
}

export function useFileActions() {
  const { openPreview } = usePreviewContext();

  const previewFile = useCallback(
    async (rawFile: FileActionTarget, options: FilePreviewOptions = { replace: true }): Promise<void> => {
      const file = normalizeTarget(rawFile);
      const ext = extensionFromName(file.name);
      const detectedType = getContentTypeByExtension(file.name || file.path);
      const contentType: PreviewContentType = ACTIVE_DOCUMENT_EXTENSIONS.has(ext) ? 'code' : detectedType;
      let content = '';
      let truncated = false;

      if (BINARY_PREVIEW_TYPES.has(contentType)) {
        content = '';
      } else if (contentType === 'image') {
        content = await ipcBridge.fs.getImageBase64.invoke({ path: file.path, workspace: file.workspace });
        if (content == null) throw null;
      } else {
        content = await ipcBridge.fs.readFile.invoke({ path: file.path, workspace: file.workspace });
        if (content == null) throw null;
        if (contentType === 'code' && content.length > LARGE_TEXT_PREVIEW_THRESHOLD) {
          content = content.slice(0, LARGE_TEXT_PREVIEW_MAX_LENGTH);
          truncated = true;
        }
      }

      openPreview(
        content,
        contentType,
        {
          title: file.name,
          file_name: file.name,
          file_path: file.path,
          workspace: file.workspace,
          language: ext,
          truncated,
          editable:
            ACTIVE_DOCUMENT_EXTENSIONS.has(ext) || contentType === 'markdown' || contentType === 'image' || truncated
              ? false
              : undefined,
        },
        options
      );
    },
    [openPreview]
  );

  const downloadFile = useCallback(async (rawFile: FileActionTarget): Promise<void> => {
    const file = normalizeTarget(rawFile);
    await downloadFileFromPath(file.path, file.name, file.workspace);
  }, []);

  const revealFile = useCallback(async (file: FileActionTarget): Promise<void> => {
    if (!canUseLocalShell()) {
      throw new Error('Reveal in folder is only available in the desktop app');
    }
    await ipcBridge.shell.showItemInFolder.invoke(file.path);
  }, []);

  const openFile = useCallback(
    async (rawFile: FileActionTarget): Promise<void> => {
      const file = normalizeTarget(rawFile);
      if (canUseLocalShell()) {
        await ipcBridge.shell.openFile.invoke(file.path);
        return;
      }
      if (isOfficePreviewFile(file.name || file.path)) {
        await previewFile(file);
        return;
      }
      await downloadFile(file);
    },
    [downloadFile, previewFile]
  );

  return useMemo(
    () => ({
      canReveal: canUseLocalShell(),
      openFile,
      previewFile,
      downloadFile,
      revealFile,
    }),
    [downloadFile, openFile, previewFile, revealFile]
  );
}
