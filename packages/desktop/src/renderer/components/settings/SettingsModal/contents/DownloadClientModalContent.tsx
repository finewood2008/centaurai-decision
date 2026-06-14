/**
 * Local Client download panel (WebUI browser mode only).
 *
 * The native client installers are bundled inside the admin server and are not
 * published anywhere public. Browser users fetch the list from
 * /api/downloads/list and download the matching file from
 * /api/downloads/get?file=<name>, both served locally by web-host's
 * static-server (see packages/web-host/src/downloads.ts).
 *
 * Installers are grouped by version (newest first) so users can grab any
 * available version, not just the latest.
 */

import { httpGet } from '@/common/adapter/httpBridge';
import { Button, Message } from '@arco-design/web-react';
import { Apple, Computer, Download, Refresh, Windows } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

type InstallerOs = 'windows' | 'macos' | 'linux' | 'unknown';
type InstallerArch = 'x64' | 'arm64' | 'unknown';

type InstallerInfo = {
  file: string;
  os: InstallerOs;
  arch: InstallerArch;
  ext: string;
  size: number;
  version: string;
};

const OS_ORDER: Record<InstallerOs, number> = { windows: 0, macos: 1, linux: 2, unknown: 3 };

const OS_ICON: Record<InstallerOs, React.FC<{ theme?: 'outline' | 'filled'; size?: string | number }>> = {
  windows: Windows,
  macos: Apple,
  linux: Computer,
  unknown: Computer,
};

function osLabel(os: InstallerOs, t: (k: string) => string): string {
  switch (os) {
    case 'windows':
      return 'Windows';
    case 'macos':
      return 'macOS';
    case 'linux':
      return 'Linux';
    default:
      return t('settings.webui.downloadClient.otherOs');
  }
}

function archLabel(arch: InstallerArch): string {
  return arch === 'unknown' ? '' : arch;
}

function formatSize(bytes: number): string {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

/** Compare semver-ish version strings descending; '' sorts last. */
function compareVersionDesc(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Best-guess the visitor's OS so we can highlight the matching installer. */
function detectOs(): InstallerOs {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();
  if (ua.includes('win')) return 'windows';
  if (ua.includes('mac')) return 'macos';
  if (ua.includes('linux') || ua.includes('x11')) return 'linux';
  return 'unknown';
}

const DownloadClientModalContent: React.FC = () => {
  const { t } = useTranslation();
  const [installers, setInstallers] = useState<InstallerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const currentOs = detectOs();

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const list = await httpGet<InstallerInfo[]>('/api/downloads/list').invoke();
      setInstallers(Array.isArray(list) ? list : []);
    } catch (e) {
      console.error('[DownloadClient] list failed', e);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDownload = useCallback(
    (file: string) => {
      // Same-origin attachment download — let the browser handle it.
      const a = document.createElement('a');
      a.href = `/api/downloads/get?file=${encodeURIComponent(file)}`;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      Message.success(t('settings.webui.downloadClient.started'));
    },
    [t]
  );

  // Group by version (newest first); each version lists its per-OS/arch installers.
  const versionGroups = useMemo(() => {
    const byVersion = new Map<string, InstallerInfo[]>();
    for (const item of installers) {
      const list = byVersion.get(item.version);
      if (list) list.push(item);
      else byVersion.set(item.version, [item]);
    }
    return Array.from(byVersion.entries())
      .sort(([a], [b]) => compareVersionDesc(a, b))
      .map(([version, items]) => ({
        version,
        items: items.slice().sort((x, y) => OS_ORDER[x.os] - OS_ORDER[y.os] || x.file.localeCompare(y.file)),
      }));
  }, [installers]);

  return (
    <div className='space-y-16px'>
      <div className='flex items-start justify-between gap-12px'>
        <div className='min-w-0'>
          <h2 className='text-20px font-500 text-t-primary m-0'>{t('settings.webui.downloadClient.title')}</h2>
          <p className='m-0 mt-4px text-13px text-t-secondary leading-relaxed'>
            {t('settings.webui.downloadClient.description')}
          </p>
        </div>
        <Button
          size='small'
          className='rd-100px shrink-0'
          icon={<Refresh theme='outline' size='14' />}
          onClick={() => void load()}
        >
          {t('common.refresh')}
        </Button>
      </div>

      {loading ? (
        <div className='text-13px text-t-secondary py-24px text-center'>{t('common.loading')}</div>
      ) : error ? (
        <div className='rd-12px border border-line bg-2 px-16px py-24px text-center text-13px text-t-secondary'>
          {t('settings.webui.downloadClient.loadError')}
        </div>
      ) : versionGroups.length === 0 ? (
        <div className='rd-12px border border-line bg-2 px-16px py-24px text-center text-13px text-t-secondary'>
          {t('settings.webui.downloadClient.empty')}
        </div>
      ) : (
        <div className='space-y-12px'>
          {versionGroups.map((group, groupIdx) => (
            <div key={group.version || 'unknown'} className='rd-16px border border-line bg-2 px-16px py-14px'>
              <div className='flex items-center gap-8px mb-10px'>
                <span className='text-14px font-600 text-t-primary'>
                  {group.version ? `v${group.version}` : t('settings.webui.downloadClient.unknownVersion')}
                </span>
                {groupIdx === 0 && group.version && (
                  <span className='text-10px font-600 px-6px py-1px rd-100px bg-[rgba(var(--primary-6),0.12)] text-[rgb(var(--primary-6))]'>
                    {t('settings.webui.downloadClient.latest')}
                  </span>
                )}
              </div>
              <div className='space-y-8px'>
                {group.items.map((item) => {
                  const Icon = OS_ICON[item.os];
                  const arch = archLabel(item.arch);
                  const meta = [osLabel(item.os, t), arch, formatSize(item.size)].filter(Boolean).join(' · ');
                  const recommended = item.os === currentOs;
                  return (
                    <div key={item.file} className='flex items-center justify-between gap-12px'>
                      <div className='min-w-0 flex items-center gap-8px'>
                        <Icon theme='outline' size='18' />
                        <div className='min-w-0'>
                          <div className='flex items-center gap-6px'>
                            <span className='text-13px text-t-primary'>{meta}</span>
                            {recommended && (
                              <span className='text-10px font-600 px-6px py-1px rd-100px bg-[rgba(var(--primary-6),0.12)] text-[rgb(var(--primary-6))]'>
                                {t('settings.webui.downloadClient.recommended')}
                              </span>
                            )}
                          </div>
                          <div className='text-12px text-t-tertiary truncate'>{item.file}</div>
                        </div>
                      </div>
                      <Button
                        type='primary'
                        size='small'
                        className='rd-100px shrink-0'
                        icon={<Download theme='outline' size='14' />}
                        onClick={() => handleDownload(item.file)}
                      >
                        {t('settings.webui.downloadClient.download')}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DownloadClientModalContent;
