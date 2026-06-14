/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Message, Select } from '@arco-design/web-react';
import { Magic, SettingConfig } from '@icon-park/react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useConfigModelListWithImage from '@/renderer/hooks/agent/useConfigModelListWithImage';
import { useConfig } from '@/renderer/hooks/config/useConfig';
import { getAgentDisplayName, type AgentMetadata } from '@/renderer/utils/model/agentTypes';
import { getImageModelValue } from '@/renderer/utils/model/imageGenerationModels';
import { findMissingRequired } from '../toolboxPrompt';
import { applyImageModelSelection, getCurrentImageModelValue, getImageModelOptions } from '../imageModel';
import type { ToolDef, ToolFormValues } from '../types';
import { DynamicField } from './DynamicField';

const Option = Select.Option;
const OptGroup = Select.OptGroup;

type ToolFormProps = {
  tool: ToolDef;
  agents: AgentMetadata[];
  running: boolean;
  disabled?: boolean;
  onRun: (tool: ToolDef, agent: AgentMetadata | null, values: ToolFormValues) => void;
};

/** Build the initial form values from the tool's declared field defaults. */
function initialValues(tool: ToolDef): ToolFormValues {
  const values: ToolFormValues = {};
  for (const field of tool.fields) {
    if (field.defaultValue !== undefined) values[field.name] = field.defaultValue;
    else if (field.type === 'upload') values[field.name] = [];
  }
  return values;
}

/** Form for a single tool: dynamic fields + agent picker + run action. */
export const ToolForm: React.FC<ToolFormProps> = ({ tool, agents, running, disabled, onRun }) => {
  const { t } = useTranslation();
  const [values, setValues] = useState<ToolFormValues>(() => initialValues(tool));
  const [agentKey, setAgentKey] = useState<string>('');

  // Image tools generate directly with the configured image model — no agent.
  const usesImageModel = tool.requires === 'image-model';
  const { modelListWithImage: imageProviders } = useConfigModelListWithImage();
  const [imageModelRegistry] = useConfig('tools.imageGenerationModels');
  const [configuredImageModel] = useConfig('tools.imageGenerationModel');
  const [imageModel, setImageModel] = useState<string>(() => getCurrentImageModelValue());
  const imageModelOptions = useMemo(
    () => getImageModelOptions(imageProviders, imageModelRegistry),
    [imageModelRegistry, imageProviders]
  );

  const handleImageModelChange = async (value: string) => {
    setImageModel(value);
  };

  useEffect(() => {
    const currentValue =
      configuredImageModel?.id && configuredImageModel.use_model
        ? getImageModelValue(configuredImageModel.id, configuredImageModel.use_model)
        : '';
    setImageModel(currentValue);
  }, [configuredImageModel?.id, configuredImageModel?.use_model]);

  // Reset the form whenever the selected tool changes.
  useEffect(() => {
    setValues(initialValues(tool));
  }, [tool]);

  const eligibleAgents = useMemo(() => {
    return agents.filter((agent) => {
      if (agent.available === false || agent.enabled === false) return false;
      if (!tool.agents || tool.agents.length === 0) return true;
      const backend = agent.backend || agent.agent_type;
      return tool.agents.includes(backend);
    });
  }, [agents, tool.agents]);

  // Default the agent selection to the first eligible agent.
  useEffect(() => {
    if (!agentKey && eligibleAgents.length > 0) setAgentKey(eligibleAgents[0].id);
  }, [agentKey, eligibleAgents]);

  const handleChange = (name: string, value: string | number | string[]) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  };

  const handleRun = async () => {
    const missing = findMissingRequired(tool, values);
    if (missing.length > 0) {
      Message.error(t('toolbox.fillRequired', { field: t(missing[0].labelKey) }));
      return;
    }
    if (usesImageModel) {
      if (imageModel) await applyImageModelSelection(imageModel, imageProviders);
      onRun(tool, null, values);
      return;
    }
    const agent = eligibleAgents.find((a) => a.id === agentKey);
    if (!agent) {
      Message.error(t('toolbox.noAgent'));
      return;
    }
    onRun(tool, agent, values);
  };

  const runDisabled = disabled || (!usesImageModel && eligibleAgents.length === 0);

  return (
    <div className='centaur-card' style={{ borderRadius: 'var(--centaur-radius-sm)' }}>
      <div
        className='flex items-center gap-10px px-16px py-14px'
        style={{ borderBottom: '1px solid var(--centaur-line)' }}
      >
        <div
          className='flex h-30px w-30px items-center justify-center rounded-10px'
          style={{ background: 'var(--centaur-clay-tint)', color: 'var(--centaur-clay-deep)' }}
        >
          <SettingConfig size={16} />
        </div>
        <span className='text-14px font-600' style={{ color: 'var(--centaur-ink)' }}>
          {t('toolbox.formTitle')}
        </span>
      </div>
      <div className='flex flex-col gap-16px p-16px'>
        {tool.fields.map((field) => (
          <DynamicField key={field.name} field={field} value={values[field.name]} onChange={handleChange} />
        ))}

        <div className='rounded-12px p-12px' style={{ background: 'var(--centaur-bg-warm)' }}>
          {usesImageModel ? (
            <div className='flex flex-col gap-6px'>
              <span className='text-13px font-500' style={{ color: 'var(--centaur-ink-soft)' }}>
                {t('toolbox.imageModel')}
              </span>
              <Select
                value={imageModel || undefined}
                showSearch
                placeholder={t('toolbox.imageModelPlaceholder')}
                notFoundContent={t('toolbox.imageModelUnset')}
                onChange={(v) => void handleImageModelChange(v)}
              >
                {imageModelOptions.map((provider) => (
                  <OptGroup label={provider.name} key={provider.id}>
                    {provider.models.map((modelName) => (
                      <Option
                        key={getImageModelValue(provider.id, modelName)}
                        value={getImageModelValue(provider.id, modelName)}
                      >
                        {modelName}
                      </Option>
                    ))}
                  </OptGroup>
                ))}
              </Select>
            </div>
          ) : (
            <div className='flex flex-col gap-6px'>
              <span className='text-13px font-500' style={{ color: 'var(--centaur-ink-soft)' }}>
                {t('toolbox.agent')}
              </span>
              <Select
                value={agentKey}
                placeholder={t('toolbox.agentPlaceholder')}
                onChange={setAgentKey}
                notFoundContent={t('toolbox.noAgent')}
              >
                {eligibleAgents.map((agent) => (
                  <Option key={agent.id} value={agent.id}>
                    {getAgentDisplayName(agent)}
                  </Option>
                ))}
              </Select>
            </div>
          )}
        </div>

        <Button
          type='primary'
          size='large'
          long
          icon={<Magic />}
          loading={running}
          disabled={runDisabled}
          onClick={() => void handleRun()}
        >
          {running ? t('toolbox.generating') : t('toolbox.generate')}
        </Button>
      </div>
    </div>
  );
};

export default ToolForm;
