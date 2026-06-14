/**
 * ExpertsSettings — Settings page for managing agency experts (专家).
 */
import { Message } from '@arco-design/web-react';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import { useSettingsViewMode } from '@/renderer/components/settings/SettingsModal/settingsViewContext';
import { useDetectedAgents, useAssistantEditor, useAssistantList } from '@/renderer/hooks/assistant';
import SettingsPageWrapper from './components/SettingsPageWrapper';
import AssistantEditDrawer from '@/renderer/pages/settings/AssistantSettings/AssistantEditDrawer';
import { resolveAvatarImageSrc } from '@/renderer/pages/settings/AssistantSettings/assistantUtils';
import DeleteAssistantModal from '@/renderer/pages/settings/AssistantSettings/DeleteAssistantModal';
import SkillConfirmModals from '@/renderer/pages/settings/AssistantSettings/SkillConfirmModals';
import ExpertListPanel from './ExpertListPanel';
import React from 'react';

const ExpertsSettings: React.FC = () => {
  const [message, messageContext] = Message.useMessage({ maxCount: 10 });
  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';

  const {
    assistants: fullAssistants,
    activeAssistantId,
    setActiveAssistantId,
    activeAssistant,
    isExtensionAssistant,
    loadAssistants,
    localeKey,
  } = useAssistantList();

  const { availableBackends, refreshAgentDetection } = useDetectedAgents();

  const editor = useAssistantEditor({
    localeKey,
    activeAssistant,
    isExtensionAssistant,
    setActiveAssistantId,
    loadAssistants,
    refreshAgentDetection,
    message,
  });

  const editAvatarImage = resolveAvatarImageSrc(editor.editAvatar, {});

  // Only show agency experts
  const expertAssistants = fullAssistants.filter((a) => a.id.startsWith('agency-'));

  const handleEditExpert = (assistant: (typeof expertAssistants)[number]) => {
    void editor.handleEdit(assistant);
  };

  const modalTree = (
    <>
      {messageContext}
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
        avatarImageMap={{}}
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
        message={message}
      />
    </>
  );

  return (
    <SettingsPageWrapper>
      {isPageMode ? (
        <AionScrollArea style={{ height: '100%' }} className='scrollbar-hide'>
          <ExpertListPanel
            assistants={expertAssistants}
            localeKey={localeKey}
            onEdit={handleEditExpert}
            onToggleEnabled={(assistant, checked) => editor.handleToggleEnabled(assistant, checked)}
          />
          {modalTree}
        </AionScrollArea>
      ) : (
        <>
          <ExpertListPanel
            assistants={expertAssistants}
            localeKey={localeKey}
            onEdit={handleEditExpert}
            onToggleEnabled={(assistant, checked) => editor.handleToggleEnabled(assistant, checked)}
          />
          {modalTree}
        </>
      )}
    </SettingsPageWrapper>
  );
};

export default ExpertsSettings;
