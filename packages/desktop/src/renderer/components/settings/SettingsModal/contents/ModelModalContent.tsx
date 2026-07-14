/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IProvider } from '@/common/config/storage';
import { sanitizeProviderUpdate } from '@/common/types/provider/providerApi';
import { Button, Divider, Message, Popconfirm, Collapse, Tag, Switch, Tooltip } from '@arco-design/web-react';
import { DeleteFour, Info, Minus, Plus, Write, Heartbeat } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AddModelModal from '@/renderer/pages/settings/components/AddModelModal';
import AddPlatformModal from '@/renderer/pages/settings/components/AddPlatformModal';
import { isNewApiPlatform, NEW_API_PROTOCOL_OPTIONS } from '@/renderer/utils/model/modelPlatforms';
import EditModeModal from '@/renderer/pages/settings/components/EditModeModal';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import { useProvidersQuery } from '@/renderer/hooks/agent/useModelProviderList';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { useSettingsViewMode } from '../settingsViewContext';
import { consumePendingDeepLink } from '@/renderer/hooks/system/useDeepLink';
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

  const persistPlatform = async (platform: IProvider) => {
    if ((data || []).some((x) => x.id === platform.id)) {
      const { id, ...body } = platform;
      await ipcBridge.mode.updateProvider.invoke({ id, ...sanitizeProviderUpdate(body) });
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
      .then((): void => void mutate())
      .catch((): void => void mutate());
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
      .catch((): void => void mutate());
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
            {!isReadOnly && (
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
          <div className='space-y-16px mt-12px'>
            {(data || []).map((platform: IProvider) => {
              const key = platform.id;
              const isExpanded = collapseKey[platform.id] ?? false;
              return (
                <Collapse
                  activeKey={isExpanded ? ['models'] : []}
                  onChange={(_, ak) => setCollapseKey((prev) => ({ ...prev, [platform.id]: ak.includes('models') }))}
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
                                  content={hs === 'healthy' ? `OK (${mh?.latency ?? '?'}ms)` : mh?.error || 'Failed'}
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
                                    isReadOnly
                                      ? undefined
                                      : () => toggleModelProtocol(platform, model, getNextProtocol(mp))
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
        )}
      </AionScrollArea>
    </div>
  );
};

export default ModelModalContent;
