/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IProvider } from '@/common/config/storage';
import {
  Button,
  Divider,
  Message,
  Popconfirm,
  Collapse,
  Tag,
  Switch,
  Tooltip,
  Tabs,
  Input,
} from '@arco-design/web-react';
import { DeleteFour, Info, Minus, Plus, Write, Heartbeat } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AddModelModal from '@/renderer/pages/settings/components/AddModelModal';
import AddPlatformModal from '@/renderer/pages/settings/components/AddPlatformModal';
import { isNewApiPlatform, NEW_API_PROTOCOL_OPTIONS } from '@/renderer/utils/model/modelPlatforms';
import EditModeModal from '@/renderer/pages/settings/components/EditModeModal';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import { useProvidersQuery } from '@/renderer/hooks/agent/useModelProviderList';
import { useConfig } from '@/renderer/hooks/config/useConfig';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { useSettingsViewMode } from '../settingsViewContext';
import { consumePendingDeepLink } from '@/renderer/hooks/system/useDeepLink';
import type { ImageGenProvider } from '@/common/config/configKeys';
import '../model-provider.css';

const getProtocolColor = (p: string) => {
  switch (p) {
    case 'gemini':
      return 'blue';
    case 'anthropic':
      return 'orange';
    default:
      return 'green';
  }
};
const getProtocolLabel = (p: string) => NEW_API_PROTOCOL_OPTIONS.find((x) => x.value === p)?.label || 'OpenAI';
const getNextProtocol = (c: string) =>
  NEW_API_PROTOCOL_OPTIONS[
    (NEW_API_PROTOCOL_OPTIONS.findIndex((x) => x.value === c) + 1) % NEW_API_PROTOCOL_OPTIONS.length
  ].value;
const getApiKeyCount = (k: string) => (k ? k.split(/[,\n]/).filter((x) => x.trim()).length : 0);
const getProviderState = (p: IProvider) => {
  const m = p.models ?? [];
  const total = m.length;
  const enabled = p.model_enabled ? m.filter((m2) => p.model_enabled?.[m2] !== false).length : total;
  if (!p.model_enabled) return { checked: true, indeterminate: false, enabled, total };
  if (enabled === 0) return { checked: false, indeterminate: false, enabled, total };
  if (enabled === total) return { checked: true, indeterminate: false, enabled, total };
  return { checked: true, indeterminate: true, enabled, total };
};
const isModelEnabled = (p: IProvider, m: string) => !p.model_enabled || p.model_enabled[m] !== false;

// ── Media provider preset lists ──

type PresetProvider = { name: string; base_url: string; hint: string };

const IMG_PRESETS: PresetProvider[] = [
  { name: '通义万相', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', hint: 'sk-...' },
  { name: '文心一格 (ERNIE-ViLG)', base_url: 'https://qianfan.baidubce.com/v2', hint: 'bce-...' },
  { name: '智谱 CogView', base_url: 'https://open.bigmodel.cn/api/paas/v4', hint: 'xxx.' },
  { name: '豆包/即梦 (Jimeng)', base_url: 'https://ark.cn-beijing.volces.com/api/v3', hint: 'ep-...' },
  { name: 'SiliconFlow (FLUX)', base_url: 'https://api.siliconflow.cn/v1', hint: 'sk-...' },
  { name: 'OpenAI DALL·E', base_url: 'https://api.openai.com/v1', hint: 'sk-...' },
];
const IMG_KW = [
  'dall',
  'flux',
  'stable',
  'sdxl',
  'sd3',
  'imagen',
  'image',
  'midjourney',
  'wanxiang',
  'ernie-vilg',
  'cogview',
  'kolors',
  'playground',
  'pixart',
  'sana',
  'jimeng',
  'qwen-vl',
  'hunyuan',
  'kling',
  'seedream',
];
const isImageModelName = (n: string) => IMG_KW.some((k) => n.toLowerCase().includes(k));

const VOICE_PRESETS: PresetProvider[] = [
  { name: '讯飞星火 (语音)', base_url: 'https://spark-api-open.xf-yun.com/v1', hint: 'appid:key' },
  { name: '火山引擎 (语音)', base_url: 'https://openspeech.bytedance.com/api/v1', hint: 'appid:token' },
  { name: '阿里云 (语音)', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', hint: 'sk-...' },
  { name: 'MiniMax (语音)', base_url: 'https://api.minimax.chat/v1', hint: 'eyJ...' },
  { name: '腾讯云 (语音)', base_url: 'https://tts.cloud.tencent.com/stream', hint: 'appid:key' },
];
const VOICE_KW = [
  'tts',
  'speech',
  'whisper',
  'voice',
  'audio',
  'speaker',
  'para',
  'bert-vits',
  'cosyvoice',
  'chattts',
  'fish',
  'gpt-sovits',
  'bark',
  'xtts',
];
const isVoiceModelName = (n: string) => VOICE_KW.some((k) => n.toLowerCase().includes(k));

const VIDEO_PRESETS: PresetProvider[] = [
  { name: '可灵 Kling', base_url: 'https://api.klingai.com/v1', hint: 'ak:sk' },
  { name: '即梦 Jimeng', base_url: 'https://ark.cn-beijing.volces.com/api/v3', hint: 'ep-...' },
  { name: '智谱 CogVideo', base_url: 'https://open.bigmodel.cn/api/paas/v4', hint: 'xxx.' },
  { name: '海螺 Hailuo (MiniMax)', base_url: 'https://api.minimax.chat/v1', hint: 'eyJ...' },
  { name: 'Vidu', base_url: 'https://api.vidu.cn/v1', hint: 'sk-...' },
  { name: '通义万相 (视频)', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', hint: 'sk-...' },
];
const VIDEO_KW = [
  'video',
  'kling',
  'cogvideo',
  'hailuo',
  'vidu',
  'animate',
  'sora',
  'runway',
  'pika',
  'luma',
  'gen',
  'motion',
  'wan',
  'veo',
];
const isVideoModelName = (n: string) => VIDEO_KW.some((k) => n.toLowerCase().includes(k));

// ── Reusable media provider tab ──

function MediaProviderTab(props: {
  configKey: 'tools.imageGenerationProviders' | 'tools.voiceProviders' | 'tools.videoProviders';
  presets: PresetProvider[];
  filterFn: (name: string) => boolean;
  title: string;
  subtitle: string;
  readOnly?: boolean;
}) {
  const { configKey, presets, filterFn, title, subtitle, readOnly } = props;
  const [message, messageContext] = Message.useMessage();
  const [providers, setProviders] = useConfig(configKey);
  const list = providers ?? [];
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newModel, setNewModel] = useState<Record<string, string>>({});
  const [fetching, setFetching] = useState<Record<string, boolean>>({});
  const [presetKeys, setPresetKeys] = useState<Record<string, string>>({});

  const save = useCallback((next: ImageGenProvider[]) => setProviders(next), [setProviders]);

  const addProvider = useCallback(
    (name: string, url: string, key: string, autoFetch: boolean) => {
      if (!name.trim() || !url.trim()) return;
      const id = 'mp_' + Date.now().toString(36);
      const next = [
        ...list,
        { id, name: name.trim(), base_url: url.trim().replace(/\/$/, ''), api_key: key.trim(), models: [] },
      ];
      save(next);
      if (autoFetch) fetchModels(id, url.trim().replace(/\/$/, ''), key.trim());
    },
    [list, save]
  );

  const removeProvider = useCallback((id: string) => save(list.filter((p) => p.id !== id)), [list, save]);

  const addModel = useCallback(
    (pid: string) => {
      const mn = (newModel[pid] || '').trim();
      if (!mn) return;
      save(list.map((p) => (p.id === pid ? { ...p, models: [...p.models, mn] } : p)));
      setNewModel((prev) => ({ ...prev, [pid]: '' }));
    },
    [newModel, list, save]
  );

  const removeModel = useCallback(
    (pid: string, mn: string) => {
      save(list.map((p) => (p.id === pid ? { ...p, models: p.models.filter((m) => m !== mn) } : p)));
    },
    [list, save]
  );

  const fetchModels = useCallback(
    async (pid: string, url: string, key: string) => {
      if (!key.trim()) {
        message.warning('请填入 API Key');
        return;
      }
      setFetching((prev) => ({ ...prev, [pid]: true }));
      try {
        const resp = await fetch(url + '/models', { headers: { Authorization: `Bearer ${key}` } });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json();
        const allModels: string[] = (json.data || []).map((m: any) => m.id || '').filter(Boolean);
        const filtered = allModels.filter(filterFn);
        if (filtered.length === 0) message.info(`未检测到匹配模型（共 ${allModels.length} 个），可手动添加`);
        else {
          save(list.map((p) => (p.id === pid ? { ...p, models: [...new Set([...p.models, ...filtered])] } : p)));
          message.success(`已加载 ${filtered.length} 个模型`);
        }
      } catch (e: any) {
        message.error(`加载失败: ${e.message}`);
      } finally {
        setFetching((prev) => ({ ...prev, [pid]: false }));
      }
    },
    [list, save, filterFn, message]
  );

  const addPreset = useCallback(
    (p: PresetProvider) => {
      const key = presetKeys[p.name] || '';
      if (!key.trim()) {
        message.warning('请填入 API Key');
        return;
      }
      if (list.find((x) => x.base_url === p.base_url)) {
        message.warning('已存在');
        return;
      }
      addProvider(p.name, p.base_url, key, true);
      setPresetKeys((prev) => ({ ...prev, [p.name]: '' }));
    },
    [list, presetKeys, addProvider, message]
  );

  return (
    <div className='space-y-16px mt-12px'>
      {messageContext}
      {!readOnly && (
        <>
      {/* Presets */}
      <div className='rounded-12px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)] p-14px'>
        <div className='text-15px font-600 text-t-primary mb-10px'>{title}</div>
        <div className='text-12px text-t-secondary mb-14px'>{subtitle}</div>
        <div className='space-y-10px'>
          {presets.map((p) => {
            const added = list.find((x) => x.base_url === p.base_url);
            return (
              <div key={p.name} className='flex items-center gap-10px'>
                <span className='text-13px text-t-primary w-180px shrink-0'>{p.name}</span>
                {added ? (
                  <Tag color='green' className='shrink-0'>
                    已添加
                  </Tag>
                ) : (
                  <>
                    <Input
                      size='small'
                      placeholder={`API Key (${p.hint})`}
                      value={presetKeys[p.name] || ''}
                      onChange={(v) => setPresetKeys((prev) => ({ ...prev, [p.name]: v }))}
                      className='flex-1'
                    />
                    <Button size='small' type='primary' onClick={() => addPreset(p)}>
                      添加并加载
                    </Button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {/* Custom */}
      <div className='rounded-12px border border-dashed border-[var(--color-border-2)] bg-[var(--color-bg-2)] p-14px'>
        <div className='text-15px font-600 text-t-primary mb-10px'>自定义端点</div>
        <div className='grid grid-cols-1 lg:grid-cols-[1fr_1fr_1fr_auto] gap-10px items-end'>
          <Input size='small' placeholder='名称' value={newName} onChange={setNewName} />
          <Input size='small' placeholder='Base URL' value={newUrl} onChange={setNewUrl} />
          <Input size='small' placeholder='API Key' value={newKey} onChange={setNewKey} />
          <Button
            size='small'
            type='outline'
            icon={<Plus size='14' />}
            disabled={!newName.trim() || !newUrl.trim()}
            onClick={() => {
              addProvider(newName, newUrl, newKey, false);
              setNewName('');
              setNewUrl('');
              setNewKey('');
            }}
          >
            添加端点
          </Button>
        </div>
      </div>
        </>
      )}
      {/* Provider list */}
      {list.length === 0 ? (
        <div className='text-13px text-t-secondary text-center py-24px rounded-12px border border-dashed border-[var(--color-border-2)]'>
          暂无 Provider
        </div>
      ) : (
        list.map((provider) => (
          <div
            key={provider.id}
            className='rounded-12px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)] p-14px'
          >
            <div className='flex items-center justify-between mb-8px'>
              <div className='flex items-center gap-8px'>
                <span className='text-14px font-600 text-t-primary'>{provider.name}</span>
                {!readOnly && (
                  <Button
                    size='mini'
                    icon={<Heartbeat size='12' />}
                    loading={fetching[provider.id]}
                    onClick={() => fetchModels(provider.id, provider.base_url, provider.api_key)}
                  >
                    加载模型
                  </Button>
                )}
              </div>
              {!readOnly && (
                <Button
                  size='mini'
                  status='danger'
                  icon={<DeleteFour size='12' />}
                  onClick={() => removeProvider(provider.id)}
                >
                  删除
                </Button>
              )}
            </div>
            <div className='text-11px text-t-secondary mb-8px'>{provider.base_url}</div>
            <div className='flex flex-wrap gap-6px mb-10px'>
              {provider.models.length === 0 && (
                <span className='text-12px text-t-secondary'>{readOnly ? '暂无模型' : '暂无模型，点击"加载模型"自动获取'}</span>
              )}
              {provider.models.map((m) => (
                <Tag key={m} closable={!readOnly} onClose={() => removeModel(provider.id, m)} size='small'>
                  {m}
                </Tag>
              ))}
            </div>
            {!readOnly && (
              <div className='flex gap-8px items-center'>
                <Input
                  size='small'
                  placeholder='手动添加模型'
                  value={newModel[provider.id] || ''}
                  onChange={(v) => setNewModel((prev) => ({ ...prev, [provider.id]: v }))}
                  className='flex-1'
                />
                <Button
                  size='mini'
                  icon={<Plus size='12' />}
                  disabled={!newModel[provider.id]?.trim()}
                  onClick={() => addModel(provider.id)}
                >
                  添加
                </Button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ── Main component ──

const ModelModalContent: React.FC = () => {
  const { t } = useTranslation();
  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';
  // Admin = desktop owner. WebUI (browser) users get a read-only view: models
  // are configured centrally by the admin and auto-used; no add/edit/delete.
  const isReadOnly = !isElectronDesktop();
  const [collapseKey, setCollapseKey] = useState<Record<string, boolean>>({});
  const [healthCheckLoading, setHealthCheckLoading] = useState<Record<string, boolean>>({});
  const { data, mutate } = useProvidersQuery();
  const [message, messageContext] = Message.useMessage();
  const [modelTab, setModelTab] = useState('llm');

  const persistPlatform = async (platform: IProvider) => {
    if ((data || []).some((x) => x.id === platform.id)) {
      const { id, ...body } = platform;
      await ipcBridge.mode.updateProvider.invoke({ id, ...body });
    } else await ipcBridge.mode.createProvider.invoke(platform);
  };
  const updatePlatform = (platform: IProvider, success: () => void) => {
    const existing = (data || []).find((x) => x.id === platform.id);
    const next = existing
      ? (data || []).map((x) => (x.id === platform.id ? { ...x, ...platform } : x))
      : [...(data || []), platform];
    void mutate(next, false);
    persistPlatform(platform)
      .then(() => {
        void mutate();
        success();
      })
      .catch(() => {
        void mutate();
        message.error(t('settings.saveModelConfigFailed'));
      });
  };
  const removePlatform = (id: string) => {
    void mutate(
      (data ?? []).filter((x: IProvider) => x.id !== id),
      false
    );
    ipcBridge.mode.deleteProvider
      .invoke({ id })
      .then(() => void mutate())
      .catch(() => void mutate());
  };
  const toggleProviderEnabled = (p: IProvider) => {
    const { checked } = getProviderState(p);
    const me: Record<string, boolean> = {};
    (p.models ?? []).forEach((m) => {
      me[m] = !checked;
    });
    updatePlatform({ ...p, model_enabled: me }, () => {});
  };
  const toggleModelEnabled = (p: IProvider, m: string, e: boolean) =>
    updatePlatform({ ...p, model_enabled: { ...p.model_enabled, [m]: e } }, () => {});
  const toggleModelProtocol = (p: IProvider, m: string, pt: string) =>
    updatePlatform({ ...p, model_protocols: { ...p.model_protocols, [m]: pt } }, () => {});
  const performHealthCheck = async (p: IProvider, m: string) => {
    const lk = `${p.id}-${m}`;
    setHealthCheckLoading((prev) => ({ ...prev, [lk]: true }));
    try {
      const r = await ipcBridge.acpConversation.checkProviderHealth.invoke({ provider_id: p.id, model: m });
      const ok = r.status === 'healthy';
      const lat = r.elapsed_ms || Date.now();
      const ld = await ipcBridge.mode.listProviders.invoke();
      const lp = (ld || []).find((x: IProvider) => x.id === p.id);
      const mh = {
        ...lp?.model_health,
        [m]: {
          status: ok ? 'healthy' : 'unhealthy',
          last_check: Date.now(),
          latency: lat,
          error: ok ? undefined : r.message || 'unknown',
        },
      };
      await ipcBridge.mode.updateProvider.invoke({ id: p.id, model_health: mh as any });
      await mutate();
      Message[ok ? 'success' : 'error']({
        content: `${p.name} - ${m}: ${ok ? `OK (${lat}ms)` : 'Failed'}`,
        duration: 3000,
      });
    } catch {
      Message.error({ content: `${p.name} - ${m}: Failed`, duration: 3000 });
    } finally {
      setHealthCheckLoading((prev) => ({ ...prev, [lk]: false }));
    }
  };
  const clearAllHealthData = () => {
    if (!data) return;
    void mutate(
      data.map((p) => ({ ...p, model_health: undefined as any })),
      false
    );
    Promise.all((data || []).map((p) => ipcBridge.mode.updateProvider.invoke({ id: p.id, model_health: {} })))
      .then(() => {
        void mutate();
        Message.success({ content: t('settings.healthStatusCleared'), duration: 2000 });
      })
      .catch(() => void mutate());
  };

  const [addPlatformModalCtrl, apmc] = AddPlatformModal.useModal({
    onSubmit(p) {
      updatePlatform(p, () => {
        setCollapseKey((prev) => ({ ...prev, [p.id]: true }));
        addPlatformModalCtrl.close();
      });
    },
  });
  useEffect(() => {
    const pd = consumePendingDeepLink();
    if (pd) addPlatformModalCtrl.open({ deepLinkData: pd });
  }, [addPlatformModalCtrl]);
  const [addModelModalCtrl, ammc] = AddModelModal.useModal({
    onSubmit(p) {
      updatePlatform(p, () => {
        setCollapseKey((prev) => ({ ...prev, [p.id]: true }));
        addModelModalCtrl.close();
      });
    },
  });
  const [editModalCtrl, emc] = EditModeModal.useModal({
    onChange(p) {
      updatePlatform(p, () => editModalCtrl.close());
    },
  });

  return (
    <div className='flex flex-col bg-2 rd-16px px-16px md:px-24px lg:px-28px py-16px md:py-18px'>
      {messageContext}
      {apmc}
      {emc}
      {ammc}

      <div className='flex-shrink-0 border-b border-[var(--color-border-2)] pb-12px mb-14px flex flex-col gap-10px'>
        <div className='flex items-center justify-between gap-8px flex-wrap'>
          <div className='text-20px font-600 text-t-primary leading-34px'>{t('settings.model')}</div>
          <div className='flex items-center gap-8px flex-wrap'>
            {modelTab === 'llm' && !isReadOnly && (
              <>
                <Button
                  type='outline'
                  shape='round'
                  size='small'
                  onClick={clearAllHealthData}
                  className='rd-100px border-1 border-solid border-[var(--color-border-2)] h-34px px-14px text-t-secondary hover:text-t-primary'
                >
                  {t('settings.clearStatus')}
                </Button>
                <Button
                  type='primary'
                  shape='round'
                  icon={<Plus size='16' />}
                  onClick={() => addPlatformModalCtrl.open()}
                  className='rd-100px h-34px px-16px'
                >
                  {t('settings.addProvider', { defaultValue: '添加供应商' })}
                </Button>
              </>
            )}
          </div>
        </div>
        {isReadOnly ? (
          <div
            className='rd-8px px-12px py-8px text-12px leading-5 border border-solid flex items-center gap-6px'
            style={{
              borderColor: 'rgba(var(--primary-6),0.32)',
              backgroundColor: 'rgba(var(--primary-6),0.08)',
              color: 'rgb(var(--primary-6))',
            }}
          >
            <Info theme='outline' size='14' />
            {t('settings.modelReadOnlyNote', {
              defaultValue: '模型由管理员统一配置，使用时将自动调用。如需新增或修改，请联系管理员。',
            })}
          </div>
        ) : (
          <div
            className='rd-8px px-12px py-8px text-12px leading-5 border border-solid'
            style={{
              borderColor: 'rgba(var(--primary-6),0.32)',
              backgroundColor: 'rgba(var(--primary-6),0.08)',
              color: 'rgb(var(--primary-6))',
            }}
          >
            {t('settings.customModelSupportNote')}
          </div>
        )}
      </div>

      <AionScrollArea className='flex-1 min-h-0' disableOverflow={isPageMode}>
        {!data || data.length === 0 ? (
          <div className='flex flex-col items-center justify-center py-40px'>
            <Info theme='outline' size='48' className='text-t-secondary mb-16px' />
            <h3 className='text-16px font-500 text-t-primary mb-8px'>{t('settings.noConfiguredModels')}</h3>
            {isReadOnly ? (
              <p className='text-14px text-t-secondary text-center max-w-400px'>
                {t('settings.modelReadOnlyEmpty', { defaultValue: '管理员尚未配置任何模型，请联系管理员添加。' })}
              </p>
            ) : (
            <p className='text-14px text-t-secondary text-center max-w-400px'>
              {t('settings.needHelpConfigGuide')}
              <a
                href='https://github.com/iOfficeAI/CentaurAI/wiki/LLM-Configuration'
                target='_blank'
                rel='noopener noreferrer'
                className='text-[rgb(var(--primary-6))] hover:text-[rgb(var(--primary-5))] underline ml-4px'
              >
                {t('settings.configGuide')}
              </a>
              {t('settings.configGuideSuffix')}
            </p>
            )}
          </div>
        ) : (
          <Tabs activeTab={modelTab} onChange={setModelTab} type='line'>
            <Tabs.TabPane key='llm' title='LLM 模型'>
              <div className='space-y-16px mt-12px'>
                {(data || []).map((platform: IProvider) => {
                  const key = platform.id;
                  const isExpanded = collapseKey[platform.id] ?? false;
                  return (
                    <Collapse
                      activeKey={isExpanded ? ['models'] : []}
                      onChange={(_, ak) =>
                        setCollapseKey((prev) => ({ ...prev, [platform.id]: ak.includes('models') }))
                      }
                      key={key}
                      bordered
                      expandIconPosition='left'
                      className={`[&_.arco-collapse-item]:!border-0 [&_.arco-collapse-item]:!rounded-12px [&_.arco-collapse-item]:!overflow-hidden [&_.arco-collapse-item]:!bg-[var(--color-bg-2)] [&_.arco-collapse-item-header]:!bg-[var(--fill-0)] [&_.arco-collapse-item-header]:!pl-36px [&_.arco-collapse-item-header]:!pr-12px [&_.arco-collapse-item-header]:!py-8px [&_.arco-collapse-item-header]:hover:!bg-[var(--color-bg-2)] [&_.arco-collapse-item-header]:!gap-8px [&_.arco-collapse-item-content]:!bg-fill-1 [&_.arco-collapse-item-content-box]:!px-10px [&_.arco-collapse-item-content-box]:!py-8px [&_.arco-collapse-item-content]:!border-t [&_.arco-collapse-item-content]:!border-[var(--color-border-2)] ${isExpanded ? '[&_.arco-collapse-item-header]:!rounded-t-12px [&_.arco-collapse-item-header]:!rounded-b-0 [&_.arco-collapse-item-content]:!rounded-b-12px' : '[&_.arco-collapse-item-header]:!rounded-12px'}`}
                    >
                      <Collapse.Item
                        name='models'
                        className='[&_.arco-collapse-item-header-title]:flex-1 group'
                        header={
                          <div className='group flex items-center justify-between w-full min-h-32px gap-8px min-w-0'>
                            <div className='min-w-0 flex-1'>
                              <span
                                className={`text-14px font-500 truncate min-w-0 transition-colors ${isExpanded ? 'text-t-primary' : 'text-2 group-hover:text-1'}`}
                              >
                                {platform.name}
                              </span>
                              <div className='text-11px text-t-tertiary truncate mt-2px'>
                                {platform.base_url || platform.platform} · {getProviderState(platform).enabled}/
                                {(platform.models ?? []).length} {t('settings.model', { defaultValue: '模型' })}
                              </div>
                            </div>
                            <div
                              className='flex items-center gap-8px shrink-0'
                              onClick={(e) => e.stopPropagation()}
                              onMouseDown={(e) => e.stopPropagation()}
                            >
                              {isReadOnly ? (
                                <Tag size='small' color={getProviderState(platform).checked ? 'green' : undefined}>
                                  {getProviderState(platform).checked
                                    ? t('common.enabled', { defaultValue: '已启用' })
                                    : t('common.disabled', { defaultValue: '已停用' })}
                                </Tag>
                              ) : (
                                <>
                                  <Switch
                                    size='small'
                                    checked={getProviderState(platform).checked}
                                    onChange={() => toggleProviderEnabled(platform)}
                                  />
                                  <div className='flex items-center gap-4px'>
                                    <Button
                                      size='mini'
                                      className='model-provider-action-btn !w-28px !h-28px !min-w-28px'
                                      icon={<Plus size='14' />}
                                      onClick={() => addModelModalCtrl.open({ data: platform })}
                                    />
                                    <Popconfirm
                                      title={t('settings.deleteAllModelConfirm')}
                                      onOk={() => removePlatform(platform.id)}
                                    >
                                      <Button
                                        size='mini'
                                        className='model-provider-action-btn !w-28px !h-28px !min-w-28px'
                                        icon={<Minus size='14' />}
                                      />
                                    </Popconfirm>
                                    <Button
                                      size='mini'
                                      className='model-provider-action-btn !w-28px !h-28px !min-w-28px'
                                      icon={<Write size='14' />}
                                      onClick={() => editModalCtrl.open({ data: platform })}
                                    />
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        }
                      >
                        {(platform.models ?? []).map((model: string, idx: number, arr: string[]) => {
                          const nip = isNewApiPlatform(platform.platform);
                          const mp = platform.model_protocols?.[model] || 'openai';
                          const mh = platform.model_health?.[model];
                          const hs = mh?.status || 'unknown';
                          return (
                            <div key={model}>
                              <div className='flex items-center justify-between px-8px py-12px transition-colors hover:bg-[var(--fill-0)]'>
                                <div className='flex items-center gap-8px'>
                                  {hs !== 'unknown' && (
                                    <Tooltip
                                      content={
                                        hs === 'healthy' ? `OK (${mh?.latency ?? '?'}ms)` : mh?.error || 'Failed'
                                      }
                                    >
                                      <div
                                        className={`w-6px h-6px rd-999px ${hs === 'healthy' ? 'bg-[rgb(var(--success-6))]' : 'bg-[rgb(var(--danger-6))]'}`}
                                      />
                                    </Tooltip>
                                  )}
                                  <span className='text-14px text-t-primary'>{model}</span>
                                  {nip && (
                                    <span
                                      className={`rd-4px px-6px py-1px text-10px ${isReadOnly ? '' : 'cursor-pointer'}`}
                                      style={{
                                        backgroundColor:
                                          getProtocolColor(mp) === 'blue'
                                            ? 'rgba(var(--primary-6),0.1)'
                                            : getProtocolColor(mp) === 'orange'
                                              ? 'rgba(var(--warning-6),0.1)'
                                              : 'rgba(var(--success-6),0.1)',
                                        color:
                                          getProtocolColor(mp) === 'blue'
                                            ? 'rgb(var(--primary-6))'
                                            : getProtocolColor(mp) === 'orange'
                                              ? 'rgb(var(--warning-6))'
                                              : 'rgb(var(--success-6))',
                                      }}
                                      onClick={
                                        isReadOnly ? undefined : () => toggleModelProtocol(platform, model, getNextProtocol(mp))
                                      }
                                    >
                                      {getProtocolLabel(mp)}
                                    </span>
                                  )}
                                </div>
                                {isReadOnly ? (
                                  !isModelEnabled(platform, model) && (
                                    <Tag size='small'>{t('common.disabled', { defaultValue: '已停用' })}</Tag>
                                  )
                                ) : (
                                  <div className='flex items-center gap-6px'>
                                    <Button
                                      size='mini'
                                      className='model-provider-action-btn !w-22px !h-22px !min-w-22px'
                                      icon={<Heartbeat size='12' />}
                                      loading={healthCheckLoading?.[`${platform.id}-${model}`]}
                                      onClick={() => void performHealthCheck(platform, model)}
                                    />
                                    <Switch
                                      size='small'
                                      checked={isModelEnabled(platform, model)}
                                      onChange={(v) => toggleModelEnabled(platform, model, v)}
                                    />
                                  </div>
                                )}
                              </div>
                              {idx < arr.length - 1 && <Divider className='!my-0' />}
                            </div>
                          );
                        })}
                      </Collapse.Item>
                    </Collapse>
                  );
                })}
              </div>
            </Tabs.TabPane>
            <Tabs.TabPane key='image' title='图像模型'>
              <MediaProviderTab
                configKey='tools.imageGenerationProviders'
                presets={IMG_PRESETS}
                filterFn={isImageModelName}
                title='常用图像 Provider'
                subtitle='填入 API Key 自动加载可用图像模型'
                readOnly={isReadOnly}
              />
            </Tabs.TabPane>
            <Tabs.TabPane key='voice' title='语音模型'>
              <MediaProviderTab
                configKey='tools.voiceProviders'
                presets={VOICE_PRESETS}
                filterFn={isVoiceModelName}
                title='常用语音 Provider'
                subtitle='填入 API Key 自动加载可用语音模型（TTS / STT）'
                readOnly={isReadOnly}
              />
            </Tabs.TabPane>
            <Tabs.TabPane key='video' title='视频模型'>
              <MediaProviderTab
                configKey='tools.videoProviders'
                presets={VIDEO_PRESETS}
                filterFn={isVideoModelName}
                title='常用视频 Provider'
                subtitle='填入 API Key 自动加载可用视频生成模型'
                readOnly={isReadOnly}
              />
            </Tabs.TabPane>
          </Tabs>
        )}
      </AionScrollArea>
    </div>
  );
};

export default ModelModalContent;
