/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { AgentMetadata } from '@/renderer/utils/model/agentTypes';
import { DETECTED_AGENTS_SWR_KEY } from '@/renderer/utils/model/agentTypes';
import AionModal from '@/renderer/components/base/AionModal';
import { useAgents } from '@/renderer/hooks/agent/useAgents';
import { Button, Typography } from '@arco-design/web-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useSWRConfig } from 'swr';
import AgentCard from './AgentCard';
import InlineAgentEditor, { type CustomAgentDraft } from './InlineAgentEditor';
import { getAgentKey } from '@/renderer/pages/guid/hooks/agentSelectionUtils';
import {
  mergeSettingsAgentRows,
  readDisabledAgentSnapshots,
  reconcileDisabledAgentSnapshots,
  removeDisabledAgentSnapshot,
  upsertDisabledAgentSnapshot,
  writeDisabledAgentSnapshots,
} from './disabledAgentSnapshots';

const LocalAgents: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { mutate } = useSWRConfig();

  // Single fetch for all agents; both detected and custom lists are derived from it.
  const { agents: allAgents } = useAgents();
  const [disabledAgentSnapshots, setDisabledAgentSnapshots] = useState<AgentMetadata[]>(() =>
    readDisabledAgentSnapshots()
  );
  const settingsAgents = useMemo(
    () => mergeSettingsAgentRows(allAgents, disabledAgentSnapshots),
    [allAgents, disabledAgentSnapshots]
  );

  const detectedAgents = settingsAgents.filter((a) => a.agent_type !== 'remote' && a.agent_source !== 'custom');

  const customAgents: AgentMetadata[] = settingsAgents.filter((a) => a.agent_source === 'custom');

  const [editorVisible, setEditorVisible] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentMetadata | null>(null);

  const persistDisabledSnapshots = useCallback((snapshots: AgentMetadata[]) => {
    setDisabledAgentSnapshots(snapshots);
    writeDisabledAgentSnapshots(snapshots);
  }, []);

  useEffect(() => {
    setDisabledAgentSnapshots((current) => {
      const next = reconcileDisabledAgentSnapshots(current, allAgents);
      if (next === current) return current;
      writeDisabledAgentSnapshots(next);
      return next;
    });
  }, [allAgents]);

  /** Optimistically update the SWR cache so the UI never flashes empty. */
  const mutateCache = useCallback(
    (updater: (agents: AgentMetadata[]) => AgentMetadata[]) => {
      mutate<AgentMetadata[]>(
        DETECTED_AGENTS_SWR_KEY,
        (current) => {
          if (!current) return current;
          return updater(current);
        },
        { revalidate: false }
      );
    },
    [mutate]
  );

  const handleSaveCustomAgent = useCallback(
    async (draft: CustomAgentDraft) => {
      const body = {
        name: draft.name,
        command: draft.command,
        icon: draft.icon,
        args: draft.args,
        env: draft.env,
        advanced: draft.advanced,
      };
      try {
        let savedAgent: AgentMetadata;
        if (editingAgent) {
          savedAgent = await ipcBridge.acpConversation.updateCustomAgent.invoke({ id: editingAgent.id, ...body });
        } else {
          savedAgent = await ipcBridge.acpConversation.createCustomAgent.invoke(body);
        }
        if (disabledAgentSnapshots.some((agent) => agent.id === savedAgent.id) || savedAgent.enabled === false) {
          const nextSnapshots =
            savedAgent.enabled === false
              ? upsertDisabledAgentSnapshot(disabledAgentSnapshots, savedAgent)
              : removeDisabledAgentSnapshot(disabledAgentSnapshots, savedAgent.id);
          persistDisabledSnapshots(nextSnapshots);
        }
        mutateCache((agents) => {
          if (agents.some((agent) => agent.id === savedAgent.id)) {
            return agents.map((agent) => (agent.id === savedAgent.id ? savedAgent : agent));
          }
          return [...agents, savedAgent];
        });
        // Re-fetch to pick up any backend-side changes
        await mutate(DETECTED_AGENTS_SWR_KEY);
        setEditorVisible(false);
        setEditingAgent(null);
      } catch (err) {
        console.error('save custom agent failed:', err);
      }
    },
    [disabledAgentSnapshots, editingAgent, mutate, mutateCache, persistDisabledSnapshots]
  );

  const handleDeleteCustomAgent = useCallback(
    async (agentId: string) => {
      const previousSnapshots = disabledAgentSnapshots;
      persistDisabledSnapshots(removeDisabledAgentSnapshot(previousSnapshots, agentId));
      try {
        await ipcBridge.acpConversation.deleteCustomAgent.invoke({ id: agentId });
        // Optimistic: remove from cache immediately
        mutateCache((agents) => agents.filter((a) => a.id !== agentId));
      } catch (err) {
        console.error('delete custom agent failed:', err);
        persistDisabledSnapshots(previousSnapshots);
        // Revert on failure
        await mutate(DETECTED_AGENTS_SWR_KEY);
      }
    },
    [disabledAgentSnapshots, mutate, mutateCache, persistDisabledSnapshots]
  );

  const handleToggle = useCallback(
    async (agent: AgentMetadata, enabled: boolean) => {
      const agentId = agent.id;
      if (!agentId) return;
      const previousSnapshots = disabledAgentSnapshots;
      const optimisticSnapshots = enabled
        ? removeDisabledAgentSnapshot(previousSnapshots, agentId)
        : upsertDisabledAgentSnapshot(previousSnapshots, agent);

      persistDisabledSnapshots(optimisticSnapshots);
      // Optimistic: update cache immediately so the UI never flickers.
      mutateCache((agents) => {
        const optimisticAgent = { ...agent, enabled };
        if (agents.some((a) => a.id === agentId)) {
          return agents.map((a) => (a.id === agentId ? optimisticAgent : a));
        }
        return [...agents, optimisticAgent];
      });
      try {
        const updatedAgent = await ipcBridge.acpConversation.setAgentEnabled.invoke({ id: agentId, enabled });
        const nextSnapshots = enabled
          ? removeDisabledAgentSnapshot(optimisticSnapshots, agentId)
          : upsertDisabledAgentSnapshot(optimisticSnapshots, updatedAgent);
        persistDisabledSnapshots(nextSnapshots);
        mutateCache((agents) => {
          const nextAgent = { ...updatedAgent, enabled };
          if (agents.some((a) => a.id === agentId)) {
            return agents.map((a) => (a.id === agentId ? nextAgent : a));
          }
          return [...agents, nextAgent];
        });
        // Revalidate in background to stay in sync with backend
        await mutate(DETECTED_AGENTS_SWR_KEY);
      } catch (err) {
        console.error('toggle agent failed:', err);
        persistDisabledSnapshots(previousSnapshots);
        // Revert on failure
        await mutate(DETECTED_AGENTS_SWR_KEY, allAgents, { revalidate: false });
      }
    },
    [allAgents, disabledAgentSnapshots, mutate, mutateCache, persistDisabledSnapshots]
  );

  // Keep the built-in direct model first, then sort enabled before disabled.
  const sortedDetected = [...detectedAgents].sort((a, b) => {
    const aIsAionrs = a.agent_type === 'aionrs' || a.backend === 'aionrs';
    const bIsAionrs = b.agent_type === 'aionrs' || b.backend === 'aionrs';
    if (aIsAionrs !== bIsAionrs) return aIsAionrs ? -1 : 1;
    if (a.enabled !== false && b.enabled === false) return -1;
    if (a.enabled === false && b.enabled !== false) return 1;
    return 0;
  });

  const openCustomAgentEditor = useCallback(() => {
    setEditingAgent(null);
    setEditorVisible(true);
  }, []);

  const goToChatWithAgent = useCallback(
    (agent: AgentMetadata) => {
      navigate('/guid', { state: { selectedAgentKey: getAgentKey(agent) } });
    },
    [navigate]
  );

  return (
    <div className='flex flex-col gap-8px py-16px'>
      <div className='px-16px text-12px text-t-secondary'>
        <span>{t('settings.agentManagement.localAgentsDescription')} </span>
        <Button
          type='text'
          size='mini'
          className='!h-auto !p-0 !align-baseline !text-12px !font-normal !text-primary-6 hover:!text-primary-7 hover:!underline underline-offset-2'
          onClick={openCustomAgentEditor}
        >
          {t('settings.agentManagement.detectCustomAgent')}
        </Button>
      </div>

      {/* Detected Agents section */}
      <div className='px-16px mt-8px'>
        <Typography.Text className='text-12px font-medium text-t-secondary mb-4px block'>
          {t('settings.agentManagement.detected')}
        </Typography.Text>
      </div>
      <div className='flex flex-col gap-4px px-16px'>
        {sortedDetected.length > 0 ? (
          sortedDetected.map((agent) => (
            <AgentCard
              key={agent.id || agent.backend || agent.agent_type}
              type='detected'
              agent={agent}
              onGoToChat={() => goToChatWithAgent(agent)}
              enabled={agent.enabled !== false}
              onToggle={(enabled) => void handleToggle(agent, enabled)}
            />
          ))
        ) : (
          <Typography.Text type='secondary' className='block py-16px text-center text-12px'>
            {t('settings.agentManagement.localAgentsEmpty')}
          </Typography.Text>
        )}
      </div>

      {/* Custom Agents section */}
      {(editorVisible || (customAgents && customAgents.length > 0)) && (
        <div className='px-16px mt-16px'>
          <Typography.Text className='text-12px font-medium text-t-secondary mb-4px block'>
            {t('settings.agentManagement.customAgents')}
          </Typography.Text>
        </div>
      )}

      <AionModal
        visible={editorVisible}
        onCancel={() => {
          setEditorVisible(false);
          setEditingAgent(null);
        }}
        header={{
          title: editingAgent
            ? t('settings.agentManagement.editCustomAgent')
            : t('settings.agentManagement.detectCustomAgent'),
          showClose: true,
        }}
        footer={null}
        style={{ maxWidth: '92vw', borderRadius: 16 }}
        contentStyle={{
          background: 'var(--dialog-fill-0)',
          borderRadius: 16,
          padding: '20px 24px 16px',
          overflow: 'auto',
        }}
      >
        {editorVisible && (
          <InlineAgentEditor
            key={editingAgent?.id ?? 'new'}
            agent={editingAgent}
            onSave={(agent) => void handleSaveCustomAgent(agent)}
            onCancel={() => {
              setEditorVisible(false);
              setEditingAgent(null);
            }}
          />
        )}
      </AionModal>

      <div className='flex flex-col gap-4px px-0'>
        {customAgents?.map((agent) => (
          <AgentCard
            key={agent.id}
            type='custom'
            agent={agent}
            onGoToChat={() => goToChatWithAgent(agent)}
            onEdit={() => {
              setEditingAgent(agent);
              setEditorVisible(true);
            }}
            onDelete={() => void handleDeleteCustomAgent(agent.id)}
            onToggle={(enabled) => void handleToggle(agent, enabled)}
          />
        ))}
      </div>
    </div>
  );
};

export default LocalAgents;
