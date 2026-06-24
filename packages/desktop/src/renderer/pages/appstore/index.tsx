/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Alert, Button, Empty, Spin } from '@arco-design/web-react';
import { ArrowRight, Left, Picture, Shop } from '@icon-park/react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { IAppStoreApp } from '@/common/adapter/ipcBridge';
import WebviewHost from '@renderer/components/media/WebviewHost';

/** Client-side SPA profile for the image workbench (mirrors ToolboxPage). */
const IMAGE2_WORKBENCH_PROFILE: Record<string, string> = {
  profileName: 'TokenClub Image2',
  apiUrl: 'http://8.209.228.147:8080/v1',
  model: 'gpt-image-2',
  apiMode: 'images',
  streamImages: 'false',
  streamPartialImages: '0',
  disableServiceWorker: 'true',
};

const buildImageWorkbenchUrl = (): string => {
  const url = new URL('centaur-image-workbench://app/index.html');
  for (const [key, value] of Object.entries(IMAGE2_WORKBENCH_PROFILE)) url.searchParams.set(key, value);
  return url.toString();
};

/** Resolve a localized-text map against the active language with fallbacks. */
const pickText = (map: Record<string, string> | undefined, lang: string): string => {
  if (!map) return '';
  return map[lang] ?? map['en-US'] ?? map['zh-CN'] ?? Object.values(map)[0] ?? '';
};

/**
 * The embed URL for an app, or null when this build can't run it yet. MVP
 * supports the image workbench (via its registered custom protocol); the
 * generic `centaur-app://` runtime arrives in a later milestone.
 */
const embedUrlFor = (app: IAppStoreApp): string | null => {
  if (app.id === 'centaur-image-workbench') return buildImageWorkbenchUrl();
  return null;
};

/** Warm-brand accent palette, picked deterministically per app id. */
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

const AppCard: React.FC<{
  app: IAppStoreApp;
  lang: string;
  openLabel: string;
  byokLabel: string;
  onOpen: () => void;
}> = ({ app, lang, openLabel, byokLabel, onOpen }) => {
  const tone = toneFor(app.id);
  return (
    <div
      role='button'
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className='centaur-liftable group flex cursor-pointer flex-col overflow-hidden outline-none'
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
          <Picture size={24} />
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
        <div
          className='flex h-30px w-30px shrink-0 items-center justify-center rounded-10px transition-transform group-hover:translate-x-2px'
          style={{ background: 'var(--centaur-card)', color: tone.icon }}
        >
          <ArrowRight size={15} />
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
          className='mt-14px flex items-center justify-between gap-10px pt-12px'
          style={{ borderTop: '1px solid var(--centaur-line)' }}
        >
          <span
            className='inline-flex items-center gap-5px truncate text-12px'
            style={{ color: 'var(--centaur-ink-mute)' }}
          >
            <span className='h-6px w-6px rounded-full' style={{ background: tone.rail }} />
            {byokLabel}
          </span>
          <span
            className='inline-flex items-center gap-4px rounded-8px px-10px py-3px text-12px font-600 transition-colors'
            style={{ background: tone.surface, color: tone.icon }}
          >
            {openLabel}
            <ArrowRight size={12} />
          </span>
        </div>
      </div>
    </div>
  );
};

const AppStorePage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [apps, setApps] = useState<IAppStoreApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [openApp, setOpenApp] = useState<IAppStoreApp | null>(null);

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

  const openUrl = useMemo(() => (openApp ? embedUrlFor(openApp) : null), [openApp]);

  if (openApp) {
    return (
      <div className='centaur-brand flex h-full flex-col gap-16px p-24px'>
        <div className='flex items-center gap-14px'>
          <Button shape='circle' icon={<Left />} onClick={() => setOpenApp(null)} />
          <div className='min-w-0'>
            <div className='centaur-eyebrow'>CENTAUR · APP STORE</div>
            <div className='text-22px font-900 leading-28px' style={{ color: 'var(--centaur-ink)' }}>
              {pickText(openApp.name, lang)}
            </div>
          </div>
        </div>
        {openUrl ? (
          <div
            className='relative w-full flex-1 overflow-hidden'
            style={{
              background: 'var(--centaur-card)',
              border: '1px solid var(--centaur-line)',
              borderRadius: 'var(--centaur-radius-sm)',
              minHeight: 480,
            }}
          >
            <WebviewHost
              url={openUrl}
              id={openApp.id}
              partition={`persist:${openApp.id}`}
              className='h-full w-full'
              style={{ height: '100%', minHeight: 480 }}
            />
          </div>
        ) : (
          <Alert type='info' content={t('appstore.empty')} />
        )}
      </div>
    );
  }

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
            <AppCard
              key={app.id}
              app={app}
              lang={lang}
              openLabel={t('appstore.open')}
              byokLabel={t('appstore.byok')}
              onOpen={() => setOpenApp(app)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default AppStorePage;
