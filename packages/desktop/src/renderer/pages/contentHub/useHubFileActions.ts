/**
 * useHubFileActions — copy-path / download / reveal handlers shared by the hub
 * file cards' hover chips and the right-click context menu.
 */
import { useMemo } from 'react';
import { Message } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { downloadFileFromPath } from '@/renderer/utils/file/download';
import type { FileEntry } from './types';

export function useHubFileActions() {
  const { t } = useTranslation();

  return useMemo(
    () => ({
      copyPath: async (file: FileEntry) => {
        try {
          await navigator.clipboard.writeText(file.path);
          Message.success(t('contentHub.toast.copied'));
        } catch {
          Message.error(t('contentHub.toast.copyFailed'));
        }
      },
      download: async (file: FileEntry) => {
        try {
          await downloadFileFromPath(file.path, file.name);
        } catch {
          Message.error(t('contentHub.toast.downloadFailed'));
        }
      },
      reveal: async (file: FileEntry) => {
        try {
          await ipcBridge.shell.showItemInFolder.invoke(file.path);
        } catch {
          Message.error(t('contentHub.toast.openFailed'));
        }
      },
    }),
    [t]
  );
}
