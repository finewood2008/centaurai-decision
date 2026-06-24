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
      <div className='flex h-full flex-col gap-16px p-24px'>
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
            className='centaur-card relative w-full flex-1 overflow-hidden'
            style={{ padding: 0, borderRadius: 'var(--centaur-radius-sm)', minHeight: 480 }}
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
    <div className='flex h-full flex-col gap-20px overflow-auto p-24px'>
      <div className='flex items-start gap-14px'>
        <div className='centaur-mark h-52px w-52px shrink-0'>
          <Shop size={26} />
        </div>
        <div className='min-w-0'>
          <div className='centaur-eyebrow'>CENTAUR · APP STORE</div>
          <div className='mt-2px text-26px font-900 leading-32px' style={{ color: 'var(--centaur-ink)' }}>
            {t('appstore.title')}
          </div>
          <div className='mt-5px max-w-760px text-14px leading-21px' style={{ color: 'var(--centaur-ink-soft)' }}>
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
        <div className='grid grid-cols-1 gap-16px sm:grid-cols-2 lg:grid-cols-3'>
          {apps.map((app) => (
            <Button
              key={app.id}
              type='text'
              className='centaur-card centaur-liftable group !h-auto !w-full !overflow-hidden !p-0 !text-left'
              style={{ borderRadius: 'var(--centaur-radius)' }}
              onClick={() => setOpenApp(app)}
            >
              <div className='flex min-h-200px w-full flex-col overflow-hidden'>
                <div
                  className='relative flex h-90px items-start justify-between gap-12px p-16px'
                  style={{ background: 'var(--centaur-clay-tint)' }}
                >
                  <div className='centaur-rail absolute bottom-0 left-0 h-3px w-full' />
                  <div className='flex min-w-0 items-center gap-12px'>
                    <div
                      className='flex h-46px w-46px shrink-0 items-center justify-center rounded-14px'
                      style={{
                        background: 'var(--centaur-card)',
                        color: 'var(--centaur-clay-deep)',
                        boxShadow: 'var(--centaur-shadow-sm)',
                      }}
                    >
                      <Picture size={24} />
                    </div>
                    <div className='min-w-0'>
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
                  <div
                    className='flex h-30px w-30px shrink-0 items-center justify-center rounded-10px transition-all group-hover:translate-x-2px'
                    style={{ background: 'var(--centaur-card)', color: 'var(--centaur-clay)' }}
                  >
                    <ArrowRight size={15} />
                  </div>
                </div>
                <div className='flex flex-1 flex-col p-16px'>
                  <div
                    className='min-h-42px text-13px leading-21px line-clamp-2'
                    style={{ color: 'var(--centaur-ink-soft)' }}
                  >
                    {pickText(app.description, lang)}
                  </div>
                  <div
                    className='mt-auto flex items-center justify-between gap-10px pt-12px'
                    style={{ borderTop: '1px solid var(--centaur-line)' }}
                  >
                    <span className='truncate text-12px' style={{ color: 'var(--centaur-ink-mute)' }}>
                      {t('appstore.byok')}
                    </span>
                    <span className='text-12px font-600' style={{ color: 'var(--centaur-clay)' }}>
                      {t('appstore.open')}
                    </span>
                  </div>
                </div>
              </div>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
};

export default AppStorePage;
