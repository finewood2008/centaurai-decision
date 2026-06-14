/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Robot } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import { normalizeBrandText } from '@/renderer/utils/brandText';
import { resolveAgentLogo } from '@/renderer/utils/model/agentLogo';
import styles from '../index.module.css';
import { assistantSkills, prettifySkill, resolveAssistantAvatar, skillIcon } from './assistantPresentation';

type AssistantCapabilityCardProps = {
  assistant: Assistant;
  localeKey: string;
  /** Keeps this assistant pinned while the mouse is over the card. */
  onHover?: (assistant: Assistant) => void;
  /** Fill the input with an example prompt. */
  onUsePrompt?: (prompt: string) => void;
};

/** Max capability chips to show before a "+N" overflow indicator. */
const MAX_SKILLS = 8;
/** Max example prompts to surface. */
const MAX_PROMPTS = 3;

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/** Visualizes a single assistant's identity + core capabilities (图文并茂). */
export const AssistantCapabilityCard: React.FC<AssistantCapabilityCardProps> = ({
  assistant,
  localeKey,
  onHover,
  onUsePrompt,
}) => {
  const { t } = useTranslation();
  const avatar = resolveAssistantAvatar(assistant);
  const name = assistant.name_i18n?.[localeKey] || assistant.name;
  const description = normalizeBrandText(
    assistant.description_i18n?.[localeKey] || assistant.description_i18n?.['en-US'] || assistant.description || ''
  );
  const skills = assistantSkills(assistant);
  const shown = skills.slice(0, MAX_SKILLS);
  const overflow = skills.length - shown.length;
  const agentLogo = assistant.preset_agent_type
    ? resolveAgentLogo({ backend: assistant.preset_agent_type })
    : undefined;
  const agentName = capitalize(assistant.preset_agent_type || '');
  const prompts = (
    assistant.prompts_i18n?.[localeKey] ||
    assistant.prompts_i18n?.['en-US'] ||
    assistant.prompts ||
    []
  ).slice(0, MAX_PROMPTS);

  return (
    <div className={styles.capabilityCard} onMouseEnter={() => onHover?.(assistant)}>
      <div className={styles.capabilityHeader}>
        <div className={styles.capabilityAvatar}>
          {avatar.kind === 'image' ? (
            <img src={avatar.src} alt='' />
          ) : avatar.kind === 'emoji' ? (
            <span className={styles.capabilityEmoji}>{avatar.value}</span>
          ) : (
            <Robot theme='outline' size={28} />
          )}
        </div>
        <div className={styles.capabilityMeta}>
          <div className={styles.capabilityName}>{name}</div>
          {agentName && (
            <div className={styles.capabilityAgentBadge}>
              {agentLogo ? <img src={agentLogo} alt='' /> : <Robot theme='outline' size={12} />}
              <span>{agentName}</span>
            </div>
          )}
          {description && <div className={styles.capabilityDesc}>{description}</div>}
        </div>
      </div>

      {shown.length > 0 && (
        <div className={styles.capabilitySkills}>
          <span className={styles.capabilitySkillsLabel}>
            {t('guid.coreCapabilities', { defaultValue: 'Core capabilities' })}
          </span>
          <div className={styles.capabilitySkillsWrap}>
            {shown.map((skill) => {
              const Icon = skillIcon(skill);
              return (
                <span key={skill} className={styles.capabilityChip} title={skill}>
                  <Icon size={13} theme='outline' />
                  {prettifySkill(skill)}
                </span>
              );
            })}
            {overflow > 0 && <span className={styles.capabilityChip}>+{overflow}</span>}
          </div>
        </div>
      )}

      {prompts.length > 0 && (
        <div className={styles.capabilityPrompts}>
          <span className={styles.capabilitySkillsLabel}>
            {t('guid.promptExamplesHint', { defaultValue: 'Try these example prompts:' })}
          </span>
          <div className={styles.capabilityPromptsWrap}>
            {prompts.map((prompt) => (
              <button
                key={prompt}
                type='button'
                className={styles.capabilityPrompt}
                title={prompt}
                onClick={() => onUsePrompt?.(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default AssistantCapabilityCard;
