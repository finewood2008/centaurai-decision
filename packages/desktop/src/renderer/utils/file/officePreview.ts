/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PreviewContentType } from '@/common/types/office/preview';
import { getContentTypeByExtension } from '@/renderer/pages/conversation/Preview/fileUtils';
import type { OpenPreviewOptions, PreviewMetadata } from '@/renderer/pages/conversation/Preview/context/PreviewContext';

export type OfficePreviewContentType = Extract<PreviewContentType, 'word' | 'excel' | 'ppt'>;

export type OpenPreviewFn = (
  content: string,
  type: PreviewContentType,
  metadata?: PreviewMetadata,
  options?: OpenPreviewOptions
) => void;

export function getOfficePreviewContentType(fileNameOrPath: string): OfficePreviewContentType | null {
  const contentType = getContentTypeByExtension(fileNameOrPath);
  return contentType === 'word' || contentType === 'excel' || contentType === 'ppt' ? contentType : null;
}

export function isOfficePreviewFile(fileNameOrPath: string): boolean {
  return getOfficePreviewContentType(fileNameOrPath) !== null;
}

export function openOfficePreviewForFile(
  openPreview: OpenPreviewFn,
  file: { path: string; name: string; workspace?: string },
  options: OpenPreviewOptions = { replace: true }
): boolean {
  const contentType = getOfficePreviewContentType(file.name || file.path);
  if (!contentType) return false;

  openPreview(
    '',
    contentType,
    {
      title: file.name,
      file_name: file.name,
      file_path: file.path,
      workspace: file.workspace,
      editable: false,
    },
    options
  );
  return true;
}
