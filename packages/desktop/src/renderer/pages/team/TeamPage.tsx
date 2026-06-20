import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR, { useSWRConfig } from 'swr';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import { ipcBridge } from '@/common';
import type { TTeam } from '@/common/types/team/teamTypes';
import ChatLayout from '@/renderer/pages/conversation/components/ChatLayout';
import ChatSlider from '@renderer/pages/conversation/components/ChatSlider.tsx';
import StackedAgentAvatars from './components/StackedAgentAvatars';
import TeamSharedContextSwitch from './components/TeamSharedContextSwitch';
import MeetingOutputsSider from './components/MeetingOutputsSider';
import MeetingRoomView from './meeting/MeetingRoomView';
import { TeamPermissionProvider } from './hooks/TeamPermissionContext';
import { useTeamSession } from './hooks/useTeamSession';
import { TeamSharedContextRoot } from './hooks/useTeamSharedContext';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';

type Props = {
  team: TTeam;
};

type TeamPageContentProps = {
  team: TTeam;
  onRenameTeam: (new_name: string) => Promise<boolean>;
};

/**
 * A roundtable session's page — topic-centric: one team ⇄ one topic. The only
 * view is the meeting room (MeetingRoomView); the multi-agent panel discusses
 * the topic (= team.name) via the backend team_run.
 */
const TeamPageContent: React.FC<TeamPageContentProps> = ({ team, onRenameTeam }) => {
  const { t } = useTranslation();

  const leadAgent = team.agents.find((a) => a.role === 'leader');
  const leaderConversationId = leadAgent?.conversation_id ?? '';
  const allConversationIds = useMemo(() => team.agents.map((a) => a.conversation_id).filter(Boolean), [team.agents]);

  // Fetch the leader agent's conversation for the workspace sider (where the 方案书 archives).
  const { data: dispatchConversation } = useSWR(
    leadAgent?.conversation_id ? ['team-conversation', leadAgent.conversation_id] : null,
    () => getConversationOrNull(leadAgent!.conversation_id)
  );

  const effectiveWorkspace = team.workspace || (dispatchConversation?.extra as { workspace?: string })?.workspace || '';
  const workspaceEnabled = Boolean(effectiveWorkspace);
  const isTeamWorkspaceTemporary = !team.workspace;

  const siderTitle = useMemo(
    () => (
      <div className='flex items-center justify-between'>
        <span className='text-16px font-bold text-t-primary'>{t('conversation.workspace.title')}</span>
      </div>
    ),
    [t]
  );

  // Merge the 会议产出 list INTO the existing right workspace sider (it sits above
  // the 临时空间 file tree — not a separate sidebar).
  const sider = useMemo(() => {
    if (!workspaceEnabled || !dispatchConversation) return <div />;
    return (
      <div className='flex flex-col h-full min-h-0'>
        <MeetingOutputsSider teamId={team.id} />
        <div className='flex-1 min-h-0'>
          <ChatSlider conversation={dispatchConversation} />
        </div>
      </div>
    );
  }, [workspaceEnabled, dispatchConversation, team.id]);

  return (
    <TeamPermissionProvider
      team_id={team.id}
      isLeaderAgent={false}
      leaderConversationId={leaderConversationId}
      allConversationIds={allConversationIds}
      agentSlots={team.agents.map((a) => ({ slot_id: a.slot_id, conversation_id: a.conversation_id }))}
    >
      <ChatLayout
        title={team.name}
        siderTitle={siderTitle}
        sider={sider}
        workspaceEnabled={workspaceEnabled}
        conversation_id={leaderConversationId || undefined}
        workspacePath={effectiveWorkspace}
        isTemporaryWorkspace={isTeamWorkspaceTemporary}
        workspacePreferenceKey={team.id}
        onRenameTitle={onRenameTeam}
        headerLeading={<StackedAgentAvatars agents={team.agents} size={16} max={3} />}
        headerExtra={<TeamSharedContextSwitch />}
      >
        <MeetingRoomView team={team} />
      </ChatLayout>
    </TeamPermissionProvider>
  );
};

const TeamPage: React.FC<Props> = ({ team }) => {
  // Keep useTeamSession mounted: its agentSpawned/renamed/removed subscriptions
  // refetch the team (populating conversation_ids) — which flips the room's
  // `canStart` true and lets the auto-start handshake fire on a new roundtable.
  const { mutateTeam } = useTeamSession(team);
  const { user } = useAuth();
  const { mutate: globalMutate } = useSWRConfig();

  const handleRenameTeam = useCallback(
    async (new_name: string): Promise<boolean> => {
      try {
        await ipcBridge.team.renameTeam.invoke({ id: team.id, name: new_name });
        await mutateTeam();
        await globalMutate(`teams/${user?.id ?? 'system_default_user'}`);
        return true;
      } catch (error) {
        console.error('Failed to rename team:', error);
        return false;
      }
    },
    [team.id, mutateTeam, globalMutate, user]
  );

  return (
    <TeamSharedContextRoot team={team}>
      <TeamPageContent team={team} onRenameTeam={handleRenameTeam} />
    </TeamSharedContextRoot>
  );
};

export default TeamPage;
