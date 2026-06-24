/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Empty, Spin } from '@arco-design/web-react';
import { Download, Picture, Shop, Video } from '@icon-park/react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { IAppStoreApp, IAppStoreArtifact } from '@/common/adapter/ipcBridge';

/** Human label for an artifact OS. */
const OS_LABEL: Record<string, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };

/** Detect the user's OS from the browser (works in desktop Electron and LAN browser). */
const detectOs = (): string => {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();
  if (ua.includes('win')) return 'windows';
  if (ua.includes('mac') || ua.includes('iphone') || ua.includes('ipad')) return 'macos';
  if (ua.includes('linux') || ua.includes('x11') || ua.includes('android')) return 'linux';
  return 'unknown';
};

/** Same-origin download URL served by web-host /api/appstore/downloads/get. */
const downloadHref = (appId: string, file: string): string =>
  `/api/appstore/downloads/get?appId=${encodeURIComponent(appId)}&file=${encodeURIComponent(file)}`;

/** Trigger a browser attachment download (the proven DownloadClient pattern). */
const triggerDownload = (appId: string, file: string): void => {
  const a = document.createElement('a');
  a.href = downloadHref(appId, file);
  a.download = file;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
};

const pickText = (map: Record<string, string> | undefined, lang: string): string => {
  if (!map) return '';
  return map[lang] ?? map['en-US'] ?? map['zh-CN'] ?? Object.values(map)[0] ?? '';
};

const isVideoApp = (app: IAppStoreApp): boolean => app.type === 'local-service';
const iconFor = (app: IAppStoreApp): React.ReactNode => (isVideoApp(app) ? <Video size={24} /> : <Picture size={24} />);

type Tone = { surface: string; icon: string; rail: string };
const TONES: Tone[] = [
  { surface: 'var(--centaur-clay-tint)', icon: 'var(--centaur-clay-deep)', rail: 'var(--centaur-clay)' },
  { surface: 'var(--centaur-gold-tint)', icon: 'var(--centaur-gold-deep)', rail: 'var(--centaur-gold)' },
  { surface: 'var(--centaur-green-tint)', icon: 'var(--centaur-green)', rail: 'var(--centaur-green)' },
];
const toneFor = (id: string): Tone => {
  let hash = 0;
  for (const ch of id) hash += ch.charCodeAt(0);
  return TONES[hash % TONES.length];
};

const osLabel = (os: string): string => OS_LABEL[os] ?? os;

type TFn = (key: string, opts?: Record<string, unknown>) => string;

const AppCard: React.FC<{ app: IAppStoreApp; lang: string; t: TFn; os: string }> = ({ app, lang, t, os }) => {
  const tone = toneFor(app.id);
  const artifacts: IAppStoreArtifact[] = app.artifacts || [];
  const comingSoon = artifacts.length === 0;
  const primary = artifacts.find((a) => a.os === os) ?? artifacts[0];
  const others = artifacts.filter((a) => a !== primary);

  return (
    <div
      className='flex flex-col overflow-hidden'
      style={{
        background: 'var(--centaur-card)',
        border: '1px solid var(--centaur-line)',
        borderRadius: 'var(--centaur-radius)',
        boxShadow: 'var(--centaur-shadow-sm)',
      }}
    >
      <div className='relative flex items-center gap-12px p-16px' style={{ background: tone.surface }}>
        <div className='absolute bottom-0 left-0 h-3px w-full' style={{ background: tone.rail, opacity: 0.85 }} />
        <div
          className='flex h-46px w-46px shrink-0 items-center justify-center rounded-14px'
          style={{ background: 'var(--centaur-card)', color: tone.icon, boxShadow: 'var(--centaur-shadow-sm)' }}
        >
          {iconFor(app)}
        </div>
        <div className='min-w-0 flex-1'>
          <div className='truncate text-16px font-700 leading-22px' style={{ color: 'var(--centaur-ink)' }}>
            {pickText(app.name, lang)}
          </div>
          <div
            className='mt-4px inline-flex items-center rounded-8px px-7px py-1px text-11px font-500'
            style={{
              background: 'var(--centaur-card)',
              color: 'var(--centaur-ink-mute)',
              border: '1px solid var(--centaur-line)',
            }}
          >
            {app.category}
          </div>
        </div>
      </div>
      <div className='flex flex-1 flex-col p-16px'>
        <div
          className='text-13px leading-20px line-clamp-2'
          style={{ color: 'var(--centaur-ink-soft)', minHeight: 40 }}
        >
          {pickText(app.description, lang)}
        </div>
        <div
          className='mt-14px flex items-center justify-between gap-12px pt-12px'
          style={{ borderTop: '1px solid var(--centaur-line)' }}
        >
          <span
            className='inline-flex items-center gap-5px truncate text-12px'
            style={{ color: 'var(--centaur-ink-mute)' }}
          >
            <span className='h-6px w-6px rounded-full' style={{ background: tone.rail }} />
            {t('appstore.byok')}
          </span>
          {comingSoon ? (
            <span
              className='inline-flex items-center rounded-8px px-10px py-3px text-12px font-600'
              style={{ background: 'var(--centaur-bg-warm)', color: 'var(--centaur-ink-mute)' }}
            >
              {t('appstore.comingSoon')}
            </span>
          ) : (
            <div className='flex flex-col items-end gap-4px'>
              <Button
                type='primary'
                size='small'
                icon={<Download />}
                onClick={() => primary && triggerDownload(app.id, primary.file)}
              >
                {t('appstore.downloadFor', { os: osLabel(primary?.os ?? os) })}
              </Button>
              {others.length > 0 && (
                <div className='flex items-center gap-8px text-11px' style={{ color: 'var(--centaur-ink-mute)' }}>
                  <span>{t('appstore.otherSystems')}</span>
                  {others.map((a) => (
                    <a
                      key={a.os}
                      className='cursor-pointer'
                      style={{ color: tone.icon }}
                      onClick={() => triggerDownload(app.id, a.file)}
                    >
                      {osLabel(a.os)}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const AppStorePage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const os = useMemo(detectOs, []);
  const [apps, setApps] = useState<IAppStoreApp[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    ipcBridge.appstore.list
      .invoke()
      .then((res) => {
        if (alive) setApps(res.apps);
      })
      .catch((error) => console.error('[AppStore] list failed', error))
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className='centaur-brand mx-auto flex h-full w-full max-w-1080px flex-col gap-20px overflow-auto p-28px'>
      <div className='flex items-start gap-16px pb-18px' style={{ borderBottom: '1px solid var(--centaur-line)' }}>
        <div
          className='flex h-54px w-54px shrink-0 items-center justify-center rounded-16px'
          style={{
            background: 'var(--centaur-clay-tint)',
            color: 'var(--centaur-clay-deep)',
            boxShadow: 'var(--centaur-shadow-sm)',
          }}
        >
          <Shop size={26} />
        </div>
        <div className='min-w-0'>
          <div className='centaur-eyebrow'>CENTAUR · APP STORE</div>
          <div className='mt-2px text-28px font-900 leading-34px' style={{ color: 'var(--centaur-ink)' }}>
            {t('appstore.title')}
          </div>
          <div className='mt-6px max-w-720px text-14px leading-21px' style={{ color: 'var(--centaur-ink-soft)' }}>
            {t('appstore.subtitle')}
          </div>
        </div>
      </div>

      {loading ? (
        <div className='flex flex-1 items-center justify-center'>
          <Spin />
        </div>
      ) : apps.length === 0 ? (
        <Empty description={t('appstore.empty')} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 18 }}>
          {apps.map((app) => (
            <AppCard key={app.id} app={app} lang={lang} t={t} os={os} />
          ))}
        </div>
      )}
    </div>
  );
};

export default AppStorePage;
