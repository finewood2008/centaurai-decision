/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import { getProviderLogo } from '@/renderer/utils/model/modelPlatforms';
import { isLocalOllamaUrl } from '@/renderer/utils/model/localModelProvider';
import { Computer, Down, Plus, Robot } from '@icon-park/react';
import { Button, Dropdown, Menu, Tooltip } from '@arco-design/web-react';
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getAvailableModels } from '../utils/modelUtils';
import styles from '../index.module.css';

type GuidProviderModelRowProps = {
  modelList: IProvider[];
  current_model: TProviderWithModel | undefined;
  setCurrentModel: (model: TProviderWithModel) => Promise<void>;
};

/** Provider shortcuts shown only while the CentaurAI agent is active. */
const GuidProviderModelRow: React.FC<GuidProviderModelRowProps> = ({ modelList, current_model, setCurrentModel }) => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const enabledProviders = React.useMemo(
    () => modelList.filter((provider) => provider.enabled !== false && getAvailableModels(provider).length > 0),
    [modelList]
  );
  const directProviders = React.useMemo(
    () => enabledProviders.filter((provider) => !isLocalOllamaUrl(provider.base_url)),
    [enabledProviders]
  );
  const localProviders = React.useMemo(
    () => enabledProviders.filter((provider) => isLocalOllamaUrl(provider.base_url)),
    [enabledProviders]
  );
  const isLocalSelected = localProviders.some((provider) => provider.id === current_model?.id);

  const selectModel = React.useCallback(
    (provider: IProvider, use_model: string) => {
      setCurrentModel({ ...provider, use_model }).catch((error) => {
        console.error('Failed to set provider model:', error);
      });
    },
    [setCurrentModel]
  );

  const selectProvider = React.useCallback(
    (provider: IProvider) => {
      const use_model =
        current_model?.id === provider.id && current_model.use_model
          ? current_model.use_model
          : getAvailableModels(provider)[0];
      if (use_model) selectModel(provider, use_model);
    },
    [current_model?.id, current_model?.use_model, selectModel]
  );

  const addButton = (
    <Tooltip content={t('settings.addModel')}>
      <Button
        type='text'
        htmlType='button'
        className={styles.agentSegmentAdd}
        onClick={() => navigate('/settings/model')}
        aria-label={t('settings.addModel')}
      >
        <Plus theme='outline' size={16} fill='currentColor' />
      </Button>
    </Tooltip>
  );

  const localModelButton = localProviders.length > 0 && (
    <Dropdown
      trigger='click'
      position='bl'
      droplist={
        <Menu selectedKeys={isLocalSelected && current_model ? [`${current_model.id}:${current_model.use_model}`] : []}>
          {localProviders.map((provider) => (
            <Menu.ItemGroup key={provider.id} title={provider.name}>
              {getAvailableModels(provider).map((modelName) => (
                <Menu.Item
                  key={`${provider.id}:${modelName}`}
                  onClick={() => selectModel(provider, modelName)}
                  data-testid={`local-model-option-${provider.id}-${modelName}`}
                >
                  {modelName}
                </Menu.Item>
              ))}
            </Menu.ItemGroup>
          ))}
        </Menu>
      }
    >
      <Button
        type='text'
        htmlType='button'
        data-testid='provider-model-local'
        data-model-selected={isLocalSelected ? 'true' : 'false'}
        className={`${styles.agentSegment} ${isLocalSelected ? styles.agentSegmentSelected : ''}`}
      >
        <span className={styles.agentSegmentIcon} aria-hidden='true'>
          <Computer theme='outline' size={18} fill='currentColor' />
        </span>
        <span className={styles.agentSegmentName}>{t('settings.localModels.title')}</span>
        <Down theme='outline' size={12} fill='currentColor' />
      </Button>
    </Dropdown>
  );

  return (
    <div className={`${styles.agentSegmentBar} ${styles.providerModelRow}`}>
      {directProviders.map((provider) => {
        const isSelected = current_model?.id === provider.id;
        const logoSrc = getProviderLogo({ name: provider.name, base_url: provider.base_url });
        return (
          <Button
            key={provider.id}
            type='text'
            htmlType='button'
            data-testid={`provider-model-${provider.id}`}
            data-model-selected={isSelected ? 'true' : 'false'}
            className={`${styles.agentSegment} ${isSelected ? styles.agentSegmentSelected : ''}`}
            onClick={() => selectProvider(provider)}
          >
            <span className={styles.agentSegmentIcon} aria-hidden='true'>
              {logoSrc ? (
                <img src={logoSrc} alt='' width={18} height={18} />
              ) : (
                <Robot theme='outline' size={18} fill='currentColor' />
              )}
            </span>
            <span className={styles.agentSegmentName}>{provider.name}</span>
          </Button>
        );
      })}
      {addButton}
      {localModelButton}
    </div>
  );
};

export default GuidProviderModelRow;
