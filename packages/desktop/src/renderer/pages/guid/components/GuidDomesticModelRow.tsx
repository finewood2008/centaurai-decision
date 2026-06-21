/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import { getProviderLogo, isDomesticProvider } from '@/renderer/utils/model/modelPlatforms';
import { Plus, Robot } from '@icon-park/react';
import { Tooltip } from '@arco-design/web-react';
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getAvailableModels } from '../utils/modelUtils';
import styles from '../index.module.css';

type GuidDomesticModelRowProps = {
  /** All configured providers that have available models (same source as the chat-box dropdown). */
  modelList: IProvider[];
  current_model: TProviderWithModel | undefined;
  setCurrentModel: (model: TProviderWithModel) => Promise<void>;
};

/**
 * Quick-select row of domestic (Chinese) model providers, shown under the agent
 * icon bar when CentaurAI (aionrs) is selected. Selecting a provider here writes
 * the same `current_model` state used by the chat-box model dropdown, so the two
 * pickers stay perfectly in sync — picking in one updates the other.
 */
const GuidDomesticModelRow: React.FC<GuidDomesticModelRowProps> = ({ modelList, current_model, setCurrentModel }) => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const domesticProviders = React.useMemo(
    () => modelList.filter((p) => p.enabled !== false && isDomesticProvider({ name: p.name, base_url: p.base_url })),
    [modelList]
  );

  const handleSelect = React.useCallback(
    (provider: IProvider) => {
      // Re-clicking the active provider keeps its already-picked model; otherwise
      // default to the provider's first available model.
      const use_model =
        current_model?.id === provider.id && current_model?.use_model
          ? current_model.use_model
          : getAvailableModels(provider)[0];
      if (!use_model) return;
      setCurrentModel({ ...provider, use_model }).catch((error) => {
        console.error('Failed to set domestic model:', error);
      });
    },
    [current_model?.id, current_model?.use_model, setCurrentModel]
  );

  const addButton = (
    <Tooltip content={t('settings.addModel')}>
      <button
        type='button'
        className={styles.agentSegmentAdd}
        onClick={() => navigate('/settings/model')}
        aria-label={t('settings.addModel')}
      >
        <Plus theme='outline' size={16} fill='currentColor' />
      </button>
    </Tooltip>
  );

  // Nothing configured yet → just offer a shortcut to add domestic models.
  if (domesticProviders.length === 0) {
    return <div className={`${styles.agentSegmentBar} ${styles.domesticModelRow}`}>{addButton}</div>;
  }

  return (
    <div className={`${styles.agentSegmentBar} ${styles.domesticModelRow}`}>
      {domesticProviders.map((provider) => {
        const isSelected = current_model?.id === provider.id;
        const logoSrc = getProviderLogo({ name: provider.name, base_url: provider.base_url });
        return (
          <button
            key={provider.id}
            type='button'
            data-testid={`domestic-model-${provider.id}`}
            data-model-selected={isSelected ? 'true' : 'false'}
            className={`${styles.agentSegment} ${isSelected ? styles.agentSegmentSelected : ''}`}
            onClick={() => handleSelect(provider)}
          >
            <span className={styles.agentSegmentIcon} aria-hidden='true'>
              {logoSrc ? (
                <img src={logoSrc} alt='' width={18} height={18} />
              ) : (
                <Robot theme='outline' size={18} fill='currentColor' />
              )}
            </span>
            <span className={styles.agentSegmentName}>{provider.name}</span>
          </button>
        );
      })}
      {addButton}
    </div>
  );
};

export default GuidDomesticModelRow;
