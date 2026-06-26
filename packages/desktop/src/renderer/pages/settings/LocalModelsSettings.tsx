/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Settings → Local Models. Detects the local ollama daemon, lets the user add
 * its models to CentaurAI (as an OpenAI-compatible provider at the local /v1
 * endpoint), and launches the standalone Local Model Manager app where all
 * model management (download / delete / hardware-fit) actually happens.
 */

import { ipcBridge } from '@/common';
import { uuid } from '@/common/utils';
import type { IProvider } from '@/common/config/storage';
import { useProvidersQuery } from '@/renderer/hooks/agent/useModelProviderList';
import { Alert, Button, Checkbox, Empty, Message, Spin, Tag } from '@arco-design/web-react';
import { Components, Plus, Refresh } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import SettingsPageWrapper from './components/SettingsPageWrapper';

/** OpenAI-compatible endpoint exposed by the local ollama daemon. */
const OLLAMA_BASE_URL = 'http://127.0.0.1:11434/v1';
/** Recognise a provider as "the local ollama one" by its URL (no schema change). */
const OLLAMA_URL_RE = /(127\.0\.0\.1|localhost):11434/;

type DetectState = 'detecting' | 'online' | 'onlineEmpty' | 'offline';

/** Detection request timeout — avoids the banner spinning forever on a stalled backend. */
const DETECT_TIMEOUT_MS = 6000;

function normalizeModelId(m: string | { id: string; name?: string }): string {
  return typeof m === 'string' ? m : m.id;
}

const LocalModelsContent: React.FC = () => {
  const { t } = useTranslation();
  const { data: providers, mutate } = useProvidersQuery();
  const [detect, setDetect] = useState<DetectState>('detecting');
  const [models, setModels] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [launching, setLaunching] = useState(false);

  const existingProvider = useMemo<IProvider | undefined>(
    () => (providers || []).find((p) => OLLAMA_URL_RE.test(p.base_url || '')),
    [providers]
  );
  const alreadyAdded = useMemo(() => new Set(existingProvider?.models ?? []), [existingProvider]);

  const reDetect = useCallback(async () => {
    setDetect('detecting');
    try {
      const res = await Promise.race([
        ipcBridge.mode.fetchModelList.invoke({
          platform: 'custom',
          base_url: OLLAMA_BASE_URL,
          api_key: 'ollama',
          try_fix: false,
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), DETECT_TIMEOUT_MS)),
      ]);
      const ids = (res?.models ?? []).map(normalizeModelId).filter(Boolean);
      setModels(ids);
      setSelected((prev) => {
        const next = prev.filter((id) => ids.includes(id));
        return next.length ? next : ids.filter((id) => !alreadyAdded.has(id));
      });
      // ollama reachable but with no models is distinct from "ollama not running".
      setDetect(ids.length ? 'online' : 'onlineEmpty');
    } catch {
      setModels([]);
      setDetect('offline');
    }
  }, [alreadyAdded]);

  useEffect(() => {
    void reDetect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Surface async launch failures (spawn 'error' / unexpected exit) from the bridge.
  useEffect(() => {
    return ipcBridge.localModelManager.statusChanged.on((status) => {
      if (status.error) Message.error(status.error);
    });
  }, []);

  const addToChat = useCallback(async () => {
    if (!selected.length) return;
    setAdding(true);
    try {
      // Merge with whatever is already registered so we never drop existing models.
      const merged = Array.from(new Set([...(existingProvider?.models ?? []), ...selected]));
      const model_enabled: Record<string, boolean> = { ...existingProvider?.model_enabled };
      selected.forEach((id) => {
        model_enabled[id] = true;
      });
      if (existingProvider) {
        await ipcBridge.mode.updateProvider.invoke({
          id: existingProvider.id,
          models: merged,
          model_enabled,
          enabled: true,
        });
      } else {
        await ipcBridge.mode.createProvider.invoke({
          id: uuid(),
          platform: 'custom',
          name: t('settings.localModels.providerName'),
          base_url: OLLAMA_BASE_URL,
          api_key: 'ollama',
          models: merged,
          model_enabled,
          enabled: true,
          is_full_url: false,
        });
      }
      await mutate();
      Message.success(t('settings.localModels.added'));
    } catch (e) {
      Message.error(String(e));
    } finally {
      setAdding(false);
    }
  }, [selected, existingProvider, mutate, t]);

  const openManager = useCallback(async () => {
    setLaunching(true);
    try {
      const status = await ipcBridge.localModelManager.start.invoke();
      if (!status.running) Message.error(status.error || t('settings.localModels.managerLaunchFailed'));
    } catch {
      Message.error(t('settings.localModels.managerLaunchFailed'));
    } finally {
      setLaunching(false);
    }
  }, [t]);

  return (
    <div className='flex flex-col gap-16px'>
      <div>
        <div className='text-16px font-600'>{t('settings.localModels.title')}</div>
        <div className='text-13px color-[var(--color-text-3)] mt-4px'>{t('settings.localModels.subtitle')}</div>
      </div>

      {/* Detection banner */}
      {detect === 'detecting' && (
        <Alert type='info' content={<Spin size={14}>{t('settings.localModels.detecting')}</Spin>} />
      )}
      {detect === 'online' && (
        <Alert type='success' content={t('settings.localModels.detected', { count: models.length })} />
      )}
      {detect === 'onlineEmpty' && (
        <Alert
          type='info'
          content={t('settings.localModels.noModels')}
          action={
            <Button size='mini' type='text' onClick={() => void openManager()}>
              {t('settings.localModels.openManager')}
            </Button>
          }
        />
      )}
      {detect === 'offline' && (
        <Alert
          type='warning'
          content={t('settings.localModels.notDetected')}
          action={
            <Button size='mini' type='text' onClick={() => void openManager()}>
              {t('settings.localModels.openManager')}
            </Button>
          }
        />
      )}

      {/* Detected model list */}
      {detect === 'online' && (
        <div className='flex flex-col gap-8px'>
          <Checkbox.Group
            value={selected}
            onChange={(v) => setSelected(v as string[])}
            className='flex flex-col gap-4px'
          >
            {models.map((id) => (
              <div key={id} className='flex items-center gap-8px py-4px'>
                <Checkbox value={id}>{id}</Checkbox>
                {alreadyAdded.has(id) && (
                  <Tag size='small' color='green'>
                    {t('settings.localModels.alreadyAdded')}
                  </Tag>
                )}
              </div>
            ))}
          </Checkbox.Group>
        </div>
      )}

      {detect === 'offline' && <Empty description={t('settings.localModels.notDetected')} />}

      {/* Actions */}
      <div className='flex items-center gap-8px'>
        <Button icon={<Refresh />} loading={detect === 'detecting'} onClick={() => void reDetect()}>
          {t('settings.localModels.reDetect')}
        </Button>
        {detect === 'online' && (
          <Button
            type='primary'
            icon={<Plus />}
            loading={adding}
            disabled={!selected.length}
            onClick={() => void addToChat()}
          >
            {t('settings.localModels.addToChat')}
          </Button>
        )}
        <div className='flex-1' />
        <Button icon={<Components />} loading={launching} onClick={() => void openManager()}>
          {t('settings.localModels.openManager')}
        </Button>
      </div>
    </div>
  );
};

const LocalModelsSettings: React.FC = () => {
  return (
    <SettingsPageWrapper contentClassName='max-w-1100px'>
      <LocalModelsContent />
    </SettingsPageWrapper>
  );
};

export default LocalModelsSettings;
