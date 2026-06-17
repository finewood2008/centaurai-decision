/**
 * useHubPreview — opens a flat FileEntry in the global preview panel.
 *
 * This mirrors the per-conversation Workspace preview recipe
 * (pages/conversation/Workspace/hooks/useWorkspaceFileOps.ts → handlePreviewFile)
 * but adapts it to the hub's flat FileEntry (path + name, no workspace tree node).
 */
import { useCallback } from 'react';
import { Message } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { PreviewContentType } from '@/common/types/office/preview';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview/context/PreviewContext';
import { getContentTypeByExtension } from '@/renderer/pages/conversation/Preview/fileUtils';
import {
  LARGE_TEXT_PREVIEW_MAX_LENGTH,
  LARGE_TEXT_PREVIEW_THRESHOLD,
} from '@/renderer/pages/conversation/Preview/constants';
import { classifyPreviewError, previewErrorToI18nKey } from '@/renderer/utils/previewError';
import type { FileEntry } from './types';

export function useHubPreview() {
  const { t } = useTranslation();
  const { openPreview } = usePreviewContext();

  return useCallback(
    async (file: FileEntry) => {
      try {
        const ext = file.name.toLowerCase().split('.').pop() || '';
        const contentType: PreviewContentType = getContentTypeByExtension(file.name);
        let content = '';
        let isLargeTextTruncated = false;

        if (contentType === 'pdf' || contentType === 'word' || contentType === 'excel' || contentType === 'ppt') {
          content = '';
        } else if (contentType === 'image') {
          content = await ipcBridge.fs.getImageBase64.invoke({ path: file.path });
          if (content == null) throw null;
        } else {
          content = await ipcBridge.fs.readFile.invoke({ path: file.path });
          if (content == null) throw null;
          if (contentType === 'code' && content.length > LARGE_TEXT_PREVIEW_THRESHOLD) {
            content = content.slice(0, LARGE_TEXT_PREVIEW_MAX_LENGTH);
            isLargeTextTruncated = true;
          }
        }

        openPreview(
          content,
          contentType,
          {
            title: file.name,
            file_name: file.name,
            file_path: file.path,
            language: ext,
            truncated: isLargeTextTruncated,
            editable: contentType === 'markdown' || contentType === 'image' || isLargeTextTruncated ? false : undefined,
          },
          { replace: true }
        );
      } catch (error) {
        const kind = classifyPreviewError(error);
        Message.error(t(previewErrorToI18nKey(kind)));
      }
    },
    [openPreview, t]
  );
}
