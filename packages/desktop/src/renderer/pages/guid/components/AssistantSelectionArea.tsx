/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import coworkSvg from '@/renderer/assets/icons/cowork.svg';
import { useDetectedAgents, useAssistantEditor, useAssistantList } from '@/renderer/hooks/assistant';
import AssistantEditDrawer from '@/renderer/pages/settings/AssistantSettings/AssistantEditDrawer';
import DeleteAssistantModal from '@/renderer/pages/settings/AssistantSettings/DeleteAssistantModal';
import SkillConfirmModals from '@/renderer/pages/settings/AssistantSettings/SkillConfirmModals';
import { resolveAvatarImageSrc } from '@/renderer/pages/settings/AssistantSettings/assistantUtils';
import { normalizeBrandText } from '@/renderer/utils/brandText';
import { assistantSkills, prettifySkill, skillIcon } from './assistantPresentation';
import { CUSTOM_AVATAR_IMAGE_MAP } from '../constants';
import styles from '../index.module.css';
import type { AvailableAgent, EffectiveAgentInfo } from '../types';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import { Message } from '@arco-design/web-react';
import { Plus, Robot } from '@icon-park/react';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

type AssistantSelectionAreaProps = {
  is_presetAgent: boolean;
  selectedAgentKey?: string;
  selectedAgentInfo: AvailableAgent | undefined;
  /**
   * Backend-merged preset catalog. Renders as the pill bar and drives the
   * selected-preset prompt examples. Does NOT include ACP engine configs —
   * those are a separate concept sourced from the AgentRegistry.
   */
  assistants: Assistant[];
  localeKey: string;
  currentEffectiveAgentInfo: EffectiveAgentInfo;
  onSelectAssistant: (assistantId: string) => void;
  onSetInput: (text: string) => void;
  onFocusInput: () => void;
  onRegisterOpenDetails?: (openDetails: (() => void) | null) => void;
  /** When true, the default-state assistant grid is not rendered (the right-side
   *  AssistantRail shows the list instead); only modals stay mounted. */
  railMode?: boolean;
  /** 'assistants' shows the built-in grid; 'experts' shows the agency expert
   *  department filter. undefined (default) shows both. */
  sectionMode?: 'assistants' | 'experts';
};

/** Max capability chips on the assistant page before a "+N" overflow chip. */
const MAX_PRESET_SKILLS = 12;

/** 办公助理 = general office-productivity assistants only (non-office builtin
 *  presets like 3D game / story roleplay / coach are intentionally excluded). */
const OFFICE_ASSISTANT_IDS = new Set([
  // CentaurAI 管家 — meta-management assistant (configure/diagnose CentaurAI
  // itself). Desktop-only: the WebUI proxy strips it from the assistant list,
  // so it only surfaces here on the admin desktop.
  'centaurai-butler',
  'cowork',
  'ppt-creator',
  'morph-ppt',
  'morph-ppt-3d',
  'word-creator',
  'word-form-creator',
  'excel-creator',
  'pitch-deck-creator',
  'dashboard-creator',
  'financial-model-creator',
  'academic-paper',
  'beautiful-mermaid',
  'planning-with-files',
  'star-office-helper',
]);
const isOfficeAssistant = (id: string) => OFFICE_ASSISTANT_IDS.has(id.replace(/^builtin-/, ''));

/** Expert department order: market-related first, engineering/dev last. Default
 *  selection is the first entry (市场营销). Shared with the experts page. */
const EXPERT_DEPT_ORDER = [
  '市场营销',
  '付费媒体',
  '销售',
  '产品',
  '战略',
  '设计',
  '学术',
  '财务',
  '项目管理',
  '技术支持',
  '专项专家',
  '集成',
  '工程开发',
  '测试',
  '安全',
  '游戏开发',
  '地理信息',
  '空间计算',
];

const resolveAssistantCandidateIds = (assistantId: string): string[] => {
  const stripped = assistantId.replace(/^builtin-/, '');
  return Array.from(new Set([assistantId, `builtin-${stripped}`, stripped]));
};

const AssistantSelectionArea: React.FC<AssistantSelectionAreaProps> = ({
  is_presetAgent,
  selectedAgentKey,
  selectedAgentInfo,
  assistants,
  localeKey,
  currentEffectiveAgentInfo,
  onSelectAssistant,
  onSetInput,
  onFocusInput,
  onRegisterOpenDetails,
  railMode,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [agentMessage, agentMessageContext] = Message.useMessage({ maxCount: 10 });

  const avatarImageMap: Record<string, string> = useMemo(
    () => ({
      'cowork.svg': coworkSvg,
      '\u{1F6E0}\u{FE0F}': coworkSvg,
    }),
    []
  );

  // Internal useAssistantList owns the drawer editor's working state. Its
  // `assistants` list is the same backend catalog we receive via the
  // `assistants` prop (both sourced from ipcBridge.assistants.list), so we
  // drop it here to avoid a parallel fetch and prop shadow; lookups for the
  // editor target use the prop.
  const { activeAssistantId, setActiveAssistantId, activeAssistant, isExtensionAssistant, loadAssistants } =
    useAssistantList();
  const { availableBackends, refreshAgentDetection } = useDetectedAgents();

  const editor = useAssistantEditor({
    localeKey,
    activeAssistant,
    isExtensionAssistant,
    setActiveAssistantId,
    loadAssistants,
    refreshAgentDetection,
    message: agentMessage,
  });

  const editAvatarImage = resolveAvatarImageSrc(editor.editAvatar, avatarImageMap);

  const modalTree = (
    <>
      {agentMessageContext}
      <AssistantEditDrawer
        editVisible={editor.editVisible}
        setEditVisible={editor.setEditVisible}
        isCreating={editor.isCreating}
        editName={editor.editName}
        setEditName={editor.setEditName}
        editDescription={editor.editDescription}
        setEditDescription={editor.setEditDescription}
        editAvatar={editor.editAvatar}
        setEditAvatar={editor.setEditAvatar}
        editAvatarImage={editAvatarImage}
        editAgent={editor.editAgent}
        setEditAgent={editor.setEditAgent}
        editContext={editor.editContext}
        setEditContext={editor.setEditContext}
        promptViewMode={editor.promptViewMode}
        setPromptViewMode={editor.setPromptViewMode}
        availableSkills={editor.availableSkills}
        selectedSkills={editor.selectedSkills}
        setSelectedSkills={editor.setSelectedSkills}
        pendingSkills={editor.pendingSkills}
        customSkills={editor.customSkills}
        setDeletePendingSkillName={editor.setDeletePendingSkillName}
        setDeleteCustomSkillName={editor.setDeleteCustomSkillName}
        builtinAutoSkills={editor.builtinAutoSkills}
        disabledBuiltinSkills={editor.disabledBuiltinSkills}
        setDisabledBuiltinSkills={editor.setDisabledBuiltinSkills}
        activeAssistant={activeAssistant}
        activeAssistantId={activeAssistantId}
        isExtensionAssistant={isExtensionAssistant}
        availableBackends={availableBackends}
        handleSave={editor.handleSave}
        handleDeleteClick={editor.handleDeleteClick}
        handleDuplicate={(assistant) => void editor.handleDuplicate(assistant)}
      />
      <DeleteAssistantModal
        visible={editor.deleteConfirmVisible}
        onCancel={() => editor.setDeleteConfirmVisible(false)}
        onConfirm={editor.handleDeleteConfirm}
        activeAssistant={activeAssistant}
        avatarImageMap={avatarImageMap}
      />
      <SkillConfirmModals
        deletePendingSkillName={editor.deletePendingSkillName}
        setDeletePendingSkillName={editor.setDeletePendingSkillName}
        pendingSkills={editor.pendingSkills}
        setPendingSkills={editor.setPendingSkills}
        deleteCustomSkillName={editor.deleteCustomSkillName}
        setDeleteCustomSkillName={editor.setDeleteCustomSkillName}
        customSkills={editor.customSkills}
        setCustomSkills={editor.setCustomSkills}
        selectedSkills={editor.selectedSkills}
        setSelectedSkills={editor.setSelectedSkills}
        message={agentMessage}
      />
    </>
  );

  const resolveOpenAssistantId = (): string | null => {
    if (selectedAgentInfo?.custom_agent_id) return selectedAgentInfo.custom_agent_id;
    if (selectedAgentKey?.startsWith('custom:')) return selectedAgentKey.slice(7);
    return null;
  };

  const openAssistantDetails = useCallback(() => {
    const assistantId = resolveOpenAssistantId();
    if (!assistantId) {
      agentMessage.warning(
        t('common.failed', { defaultValue: 'Failed' }) +
          `: ${t('settings.editAssistant', { defaultValue: 'Assistant Details' })}`
      );
      return;
    }

    const candidates = resolveAssistantCandidateIds(assistantId);
    // `assistants` is the backend-merged catalog (builtin + user + extension)
    // and is the only list that yields the Assistant shape the editor expects.
    const targetAssistant = assistants.find((assistant) => candidates.includes(assistant.id));
    if (!targetAssistant) {
      agentMessage.warning(
        t('common.failed', { defaultValue: 'Failed' }) +
          `: ${t('settings.editAssistant', { defaultValue: 'Assistant Details' })}`
      );
      return;
    }

    void editor.handleEdit(targetAssistant);
  }, [agentMessage, assistants, editor, selectedAgentInfo?.custom_agent_id, selectedAgentKey, t]);

  useLayoutEffect(() => {
    if (!onRegisterOpenDetails) return;
    onRegisterOpenDetails(openAssistantDetails);
  }, [onRegisterOpenDetails, openAssistantDetails]);

  // Separate agency assistants from others. Disabled experts (toggled off in
  // settings) are hidden everywhere they're surfaced.
  const isAgency = (a: Assistant) => a.id.startsWith('agency-');
  const agencyAssistants = useMemo(() => assistants.filter((a) => isAgency(a) && a.enabled !== false), [assistants]);
  const nonAgencyAssistants = useMemo(() => assistants.filter((a) => !isAgency(a)), [assistants]);
  const getAgencyDept = (id: string) => {
    const parts = id.replace('agency-', '').split('-');
    const nameMap: Record<string, string> = {
      academic: '学术',
      design: '设计',
      engineering: '工程开发',
      finance: '财务',
      'game-development': '游戏开发',
      gis: '地理信息',
      integrations: '集成',
      marketing: '市场营销',
      'paid-media': '付费媒体',
      product: '产品',
      'project-management': '项目管理',
      sales: '销售',
      security: '安全',
      specialized: '专项专家',
      'spatial-computing': '空间计算',
      strategy: '战略',
      support: '技术支持',
      testing: '测试',
    };
    return nameMap[parts[0]] || nameMap[`${parts[0]}-${parts[1]}`] || parts[0];
  };
  // Department tabs, market-first ordered, limited to categories that still
  // have at least one enabled expert. A fully-disabled category has no tab.
  const agencyDeptNames = useMemo(
    () => EXPERT_DEPT_ORDER.filter((dept) => agencyAssistants.some((a) => getAgencyDept(a.id) === dept)),
    [agencyAssistants]
  );
  const [agencyDeptFilter, setAgencyDeptFilter] = useState<string | null>('市场营销');
  // Keep a non-null selection valid: if the chosen department was disabled
  // away, jump to the first remaining one. A null filter (user collapsed the
  // grid) is left alone.
  useEffect(() => {
    if (agencyDeptFilter && agencyDeptNames.length > 0 && !agencyDeptNames.includes(agencyDeptFilter)) {
      setAgencyDeptFilter(agencyDeptNames[0]);
    }
  }, [agencyDeptNames, agencyDeptFilter]);
  const filteredAgency = useMemo(() => {
    if (!agencyDeptFilter) return [];
    return agencyAssistants.filter((a) => getAgencyDept(a.id) === agencyDeptFilter);
  }, [agencyAssistants, agencyDeptFilter]);

  // Render only if the backend catalog has at least one assistant.
  if (!assistants || assistants.length === 0) return null;

  if (is_presetAgent && selectedAgentInfo) {
    // Selected Assistant View — a richer intro: core-capability chips sourced
    // from the assistant's skills, followed by its example prompts.
    const selectedAssistantRecord = assistants.find((a) => a.id === selectedAgentInfo.custom_agent_id);
    const presetSkills = selectedAssistantRecord ? assistantSkills(selectedAssistantRecord) : [];
    const shownSkills = presetSkills.slice(0, MAX_PRESET_SKILLS);
    const skillOverflow = presetSkills.length - shownSkills.length;
    return (
      <div className='mt-20px w-full'>
        <div className='flex flex-col w-full animate-fade-in'>
          {/* Main Agent Fallback Notice */}
          {currentEffectiveAgentInfo.isFallback && (
            <div
              className='mb-12px px-12px py-8px rd-8px text-12px flex items-center gap-8px'
              style={{
                background: 'rgb(var(--warning-1))',
                border: '1px solid rgb(var(--warning-3))',
                color: 'rgb(var(--warning-6))',
              }}
            >
              <span>
                {t('guid.agentFallbackNotice', {
                  original:
                    currentEffectiveAgentInfo.originalType.charAt(0).toUpperCase() +
                    currentEffectiveAgentInfo.originalType.slice(1),
                  fallback:
                    currentEffectiveAgentInfo.agent_type.charAt(0).toUpperCase() +
                    currentEffectiveAgentInfo.agent_type.slice(1),
                  defaultValue: `${currentEffectiveAgentInfo.originalType.charAt(0).toUpperCase() + currentEffectiveAgentInfo.originalType.slice(1)} is unavailable, using ${currentEffectiveAgentInfo.agent_type.charAt(0).toUpperCase() + currentEffectiveAgentInfo.agent_type.slice(1)} instead.`,
                })}
              </span>
            </div>
          )}
          {/* Core Capabilities Section */}
          {shownSkills.length > 0 && (
            <div className='mt-16px'>
              <div className={styles.assistantPromptHint}>
                {t('guid.coreCapabilities', { defaultValue: 'Core capabilities' })}
              </div>
              <div className='flex flex-wrap gap-8px mt-12px'>
                {shownSkills.map((skill) => {
                  const Icon = skillIcon(skill);
                  return (
                    <span key={skill} className={styles.capabilityChip} title={skill}>
                      <Icon size={13} theme='outline' />
                      {prettifySkill(skill)}
                    </span>
                  );
                })}
                {skillOverflow > 0 && <span className={styles.capabilityChip}>+{skillOverflow}</span>}
              </div>
            </div>
          )}
          {/* Prompts Section */}
          {(() => {
            const agent = selectedAssistantRecord;
            const prompts = agent?.prompts_i18n?.[localeKey] || agent?.prompts_i18n?.['en-US'] || agent?.prompts;
            if (prompts && prompts.length > 0) {
              return (
                <div className='mt-16px'>
                  <div className={styles.assistantPromptHint}>
                    {t('guid.promptExamplesHint', { defaultValue: 'Try these example prompts:' })}
                  </div>
                  <div className='flex flex-wrap gap-8px mt-12px'>
                    {prompts.map((prompt: string, index: number) => (
                      <div
                        key={index}
                        className={`${styles.assistantPromptChip} px-12px py-6px text-2 text-13px rd-16px cursor-pointer transition-colors shadow-sm`}
                        onClick={() => {
                          onSetInput(prompt);
                          onFocusInput();
                        }}
                      >
                        {prompt}
                      </div>
                    ))}
                  </div>
                </div>
              );
            }
            return null;
          })()}
        </div>
        {modalTree}
      </div>
    );
  }

  // Assistant List View — in rail mode the right-side AssistantRail renders the
  // list, so here we only keep the modals mounted.
  if (railMode) return <>{modalTree}</>;

  const showAssistants = true;
  const showExperts = true;

  // Two independent, parallel sections: 办公助理 (office) first, then 专家
  // (experts) as a separate block. Neither is locked in a fixed-height scroll
  // box — both flow naturally with the page.
  return (
    <div className='mt-32px w-full'>
      {/* ── Section 1: 办公助理 ── */}
      {showAssistants && (
        <>
          <div className={`${styles.assistantPromptHint} text-center mb-12px`}>
            {t('guid.selectAssistantHint', { defaultValue: 'Select an office assistant to start a task' })}
          </div>
          <div className={styles.assistantCardGrid}>
            {nonAgencyAssistants
              .filter((a) => a.enabled !== false)
              .filter((a) => isOfficeAssistant(a.id))
              .toSorted((a, b) => {
                if (a.id === 'cowork') return -1;
                if (b.id === 'cowork') return 1;
                return 0;
              })
              .map((assistant) => {
                const avatarValue = assistant.avatar?.trim();
                const mappedAvatar = avatarValue ? CUSTOM_AVATAR_IMAGE_MAP[avatarValue] : undefined;
                const resolvedAvatar = avatarValue ? resolveExtensionAssetUrl(avatarValue) : undefined;
                const avatarImage = mappedAvatar || resolvedAvatar;
                const isImageAvatar = Boolean(
                  avatarImage &&
                  (/\.(svg|png|jpe?g|webp|gif)$/i.test(avatarImage) ||
                    /^(https?:|file:\/\/|data:|\/)/i.test(avatarImage))
                );
                const displayName = assistant.name_i18n?.[localeKey] || assistant.name;
                return (
                  <div
                    key={assistant.id}
                    data-testid={`preset-pill-${assistant.id}`}
                    className={styles.assistantCard}
                    onClick={() => onSelectAssistant(`custom:${assistant.id}`)}
                    title={displayName}
                  >
                    <div className={styles.assistantCardAvatar}>
                      {isImageAvatar ? (
                        <img src={avatarImage} alt='' />
                      ) : avatarValue ? (
                        <span className={styles.assistantCardEmoji}>{avatarValue}</span>
                      ) : (
                        <Robot theme='outline' size={18} />
                      )}
                    </div>
                    <div className={styles.assistantCardMeta}>
                      <div className={styles.assistantCardName}>{displayName}</div>
                    </div>
                  </div>
                );
              })}
            <div
              data-testid='btn-add-preset'
              className={styles.assistantCardAdd}
              onClick={() => navigate('/settings/assistants')}
            >
              <Plus theme='outline' size={20} />
            </div>
          </div>
        </>
      )}

      {/* ── Section 2: 专家 (independent parallel block) ── */}
      {showExperts && agencyAssistants.length > 0 && (
        <div className={showAssistants ? 'mt-32px' : ''}>
          <div className={`${styles.assistantPromptHint} text-center mb-12px`}>专家 — 各领域专业专家</div>
          <div className='flex flex-wrap justify-center gap-6px mb-14px'>
            {agencyDeptNames.map((dept) => (
              <span
                key={dept}
                onClick={() => setAgencyDeptFilter(agencyDeptFilter === dept ? null : dept)}
                className='px-10px py-4px rd-12px text-12px cursor-pointer transition-colors'
                style={{
                  background: agencyDeptFilter === dept ? 'var(--color-primary-light-1)' : 'var(--color-fill-2)',
                  color: agencyDeptFilter === dept ? 'var(--color-primary-6)' : 'var(--color-text-3)',
                  border:
                    agencyDeptFilter === dept ? '1px solid var(--color-primary-light-3)' : '1px solid transparent',
                }}
              >
                {dept} ({agencyAssistants.filter((a) => getAgencyDept(a.id) === dept).length})
              </span>
            ))}
          </div>
          {filteredAgency.length > 0 && (
            <div className={styles.assistantCardGrid}>
              {filteredAgency.map((assistant) => {
                const avatarValue = assistant.avatar?.trim();
                const resolvedAvatar = avatarValue ? resolveExtensionAssetUrl(avatarValue) : undefined;
                const isImageAvatar = Boolean(
                  resolvedAvatar &&
                  (/\.(svg|png|jpe?g|webp|gif)$/i.test(resolvedAvatar) ||
                    /^(https?:|file:\/\/|data:|\/)/i.test(resolvedAvatar))
                );
                const description = normalizeBrandText(
                  assistant.description_i18n?.[localeKey] ||
                    assistant.description_i18n?.['en-US'] ||
                    assistant.description ||
                    ''
                );
                return (
                  <div
                    key={assistant.id}
                    data-testid={`preset-pill-${assistant.id}`}
                    className={styles.assistantCard}
                    onClick={() => onSelectAssistant(`custom:${assistant.id}`)}
                  >
                    <div className={styles.assistantCardAvatar}>
                      {isImageAvatar ? (
                        <img src={resolvedAvatar} alt='' />
                      ) : avatarValue ? (
                        <span className={styles.assistantCardEmoji}>{avatarValue}</span>
                      ) : (
                        <Robot theme='outline' size={18} />
                      )}
                    </div>
                    <div className={styles.assistantCardMeta}>
                      <div className={styles.assistantCardName}>
                        {assistant.name_i18n?.[localeKey] || assistant.name}
                      </div>
                      {description && <div className={styles.assistantCardDesc}>{description}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {modalTree}
    </div>
  );
};

export default AssistantSelectionArea;
