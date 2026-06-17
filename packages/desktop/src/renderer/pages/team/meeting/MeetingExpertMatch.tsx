import { Button, Message } from '@arco-design/web-react';
import { MagicWand, Plus } from '@icon-park/react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSWRConfig } from 'swr';
import { ipcBridge } from '@/common';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import type { TeamAgent, TTeam } from '@/common/types/team/teamTypes';
import { getAgents } from '@renderer/hooks/agent/useAgents';
import type { AgentMetadata } from '@renderer/utils/model/agentTypes';
import { resolveConversationType } from '../components/agentSelectUtils';
import { resolveDefaultTeamAgentModel } from '../components/teamCreateModelResolver';
import { buildExpertMatchQuestion, parseExpertPicks, type AdvisorBrief } from './meetingPrompts';

type Props = {
  team: TTeam;
  topic: string;
  moderatorConversationId: string | null;
};

/** Suggest topic-relevant advisors and one-click add them to the team. */
const MeetingExpertMatch: React.FC<Props> = ({ team, topic, moderatorConversationId }) => {
  const { t } = useTranslation();
  const { mutate } = useSWRConfig();
  const [matching, setMatching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Assistant[]>([]);

  const existingAgentIds = useMemo(
    () => new Set(team.agents.map((a) => a.custom_agent_id).filter(Boolean)),
    [team.agents]
  );

  const handleMatch = async () => {
    const trimmed = topic.trim();
    if (!trimmed) {
      Message.warning(t('team.meeting.match.needTopic', { defaultValue: '请先填写议题' }));
      return;
    }
    if (!moderatorConversationId) return;
    setMatching(true);
    try {
      const [assistants, cliAgents] = await Promise.all([
        ipcBridge.assistants.list.invoke(),
        getAgents().catch((): AgentMetadata[] => []),
      ]);
      const teamCapableKeys = new Set(
        (cliAgents ?? []).filter((a) => a.team_capable).map((a) => a.backend ?? a.agent_type)
      );
      const candidates = (assistants ?? []).filter(
        (a) => a.enabled !== false && teamCapableKeys.has(a.preset_agent_type) && !existingAgentIds.has(a.id)
      );
      if (candidates.length === 0) {
        Message.info(t('team.meeting.match.noCandidates', { defaultValue: '没有可加入的候选专家' }));
        setSuggestions([]);
        return;
      }
      const catalog: AdvisorBrief[] = candidates.map((a) => ({ name: a.name, description: a.description ?? '' }));
      // The side-question needs the moderator's agent process to be active, so
      // warm up the team session first, then retry briefly while it spins up.
      await ipcBridge.team.ensureSession.invoke({ team_id: team.id }).catch(() => {});
      const question = buildExpertMatchQuestion(trimmed, catalog);
      let answer = '';
      // Sequential by design: poll the moderator until its agent is warm.
      for (let i = 0; i < 4; i += 1) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const res = await ipcBridge.conversation.askSideQuestion.invoke({
            conversation_id: moderatorConversationId,
            question,
          });
          if (res && res.status === 'ok') {
            answer = res.answer;
            break;
          }
          if (res && (res.status === 'unsupported' || res.status === 'noAnswer')) break; // won't improve on retry
        } catch {
          // agent likely still warming up — wait and retry
        }
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 1500));
      }
      const picks = parseExpertPicks(answer);
      const matched = picks
        .map((name) => candidates.find((c) => c.name === name))
        .filter((a): a is Assistant => Boolean(a));
      // Fall back to the first few candidates if the LLM was unavailable or
      // parsing yielded nothing — the boss still gets actionable suggestions.
      setSuggestions(matched.length > 0 ? matched : candidates.slice(0, 3));
    } catch (error) {
      Message.error(String(error));
    } finally {
      setMatching(false);
    }
  };

  const handleAdd = async (assistant: Assistant) => {
    setAdding(assistant.id);
    try {
      const agentType = assistant.preset_agent_type;
      const conversationType = resolveConversationType(agentType);
      const model = await resolveDefaultTeamAgentModel({ agent_type: agentType, conversation_type: conversationType });
      const agent: Omit<TeamAgent, 'slot_id' | 'conversation_id'> = {
        role: 'teammate',
        status: 'pending',
        agent_type: agentType,
        agent_name: assistant.name,
        icon: assistant.avatar,
        conversation_type: conversationType,
        custom_agent_id: assistant.id,
        model,
      };
      await ipcBridge.team.addAgent.invoke({ team_id: team.id, agent });
      await mutate(`team/${team.id}`);
      setSuggestions((prev) => prev.filter((s) => s.id !== assistant.id));
      Message.success(
        t('team.meeting.match.added', { name: assistant.name, defaultValue: `已加入 ${assistant.name}` })
      );
    } catch (error) {
      Message.error(String(error));
    } finally {
      setAdding(null);
    }
  };

  return (
    <div data-testid='meeting-expert-match' className='flex flex-col items-center gap-10px w-full max-w-440px'>
      <Button
        type='outline'
        size='small'
        loading={matching}
        icon={<MagicWand theme='outline' size='14' fill='currentColor' />}
        onClick={handleMatch}
        data-testid='meeting-match-btn'
      >
        {t('team.meeting.match.recommend', { defaultValue: '按议题推荐专家' })}
      </Button>
      {suggestions.length > 0 && (
        <div className='flex flex-col gap-6px w-full'>
          {suggestions.map((s) => (
            <div
              key={s.id}
              className='flex items-center gap-8px px-10px py-6px rd-8px border border-solid border-[color:var(--border-base)] bg-[var(--color-bg-2)]'
            >
              <div className='flex flex-col min-w-0 flex-1'>
                <span className='text-13px text-[color:var(--color-text-1)] truncate'>{s.name}</span>
                {s.description && (
                  <span className='text-11px text-[color:var(--color-text-3)] truncate'>{s.description}</span>
                )}
              </div>
              <Button
                size='mini'
                type='primary'
                loading={adding === s.id}
                icon={<Plus theme='outline' size='12' fill='currentColor' />}
                onClick={() => handleAdd(s)}
                data-testid={`meeting-add-${s.id}`}
              >
                {t('team.meeting.match.add', { defaultValue: '加入' })}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MeetingExpertMatch;
