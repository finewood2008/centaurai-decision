import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Close, PeoplePlus } from '@icon-park/react';
import { useConversationAgents } from '@renderer/pages/conversation/hooks/useConversationAgents';
import { useModelProviderList } from '@renderer/hooks/agent/useModelProviderList';
import { AgentOptionLabel, cliAgentToOption } from '../components/agentSelectUtils';
import type { TeamAgentOption } from '../components/agentSelectUtils';
import { buildModelExpertOptions, optionGuestId, optionToGuest, type MeetingGuest } from './meetingGuests';

type Props = {
  guests: MeetingGuest[];
  onAdd: (guest: MeetingGuest) => void;
  onRemove: (guest_id: string) => void;
  /** `full` (centered onboarding card) vs `compact` (left-aligned, for a popover). */
  variant?: 'full' | 'compact';
};

/** Small muted header above a chip group (only shown when both groups are present). */
const groupHeader = (label: string) => (
  <div className='w-full text-11px font-medium text-[color:var(--bg-6)] tracking-wide'>{label}</div>
);

/**
 * Add non-team-capable agents (e.g. OpenClaw, Hermes) as roundtable experts.
 * aioncore's team.create rejects them, so they join via the renderer-orchestrated
 * extras — but they're FULL equal experts in the debate, not a separate tier.
 */
const MeetingGuestPanel: React.FC<Props> = ({ guests, onAdd, onRemove, variant = 'full' }) => {
  const { t } = useTranslation();
  const { cliAgents } = useConversationAgents();
  const { providers, getAvailableModels } = useModelProviderList();
  const compact = variant === 'compact';

  // Experts the boss can seat without going through aioncore's team.create:
  //  • backends that can't join the team (no MCP): OpenClaw / Hermes
  //  • 直连模型专家: each configured provider model (incl. SiliconFlow 国产模型)
  // All are renderer-driven, equal experts in the debate.
  const guestCandidates = useMemo<TeamAgentOption[]>(() => {
    const backendExtras = cliAgents.map((agent) => cliAgentToOption(agent)).filter((a) => !a.team_capable);
    const modelExperts = buildModelExpertOptions(providers, getAvailableModels);
    return [...backendExtras, ...modelExperts];
  }, [cliAgents, providers, getAvailableModels]);

  const guestIds = useMemo(() => new Set(guests.map((g) => g.id)), [guests]);

  // Split for light grouping in the onboarding (full) panel: non-team backends
  // (OpenClaw / Hermes …) vs. 直连模型专家 (each configured provider model).
  const backendExtras = guestCandidates.filter((a) => !a.isModelExpert);
  const modelExperts = guestCandidates.filter((a) => a.isModelExpert);

  if (guestCandidates.length === 0) {
    return compact ? (
      <div className='px-4px py-6px text-12px text-[color:var(--bg-6)] max-w-220px'>
        {t('team.meeting.extraExpert.none', {
          defaultValue: '没有可加入的其他专家（如 OpenClaw / Hermes）',
        })}
      </div>
    ) : null;
  }

  const renderChip = (a: TeamAgentOption) => {
    const id = optionGuestId(a);
    const selected = guestIds.has(id);
    return (
      <button
        key={a.id}
        type='button'
        data-testid={`meeting-guest-toggle-${id}`}
        title={a.name}
        onClick={() => {
          if (selected) {
            onRemove(id);
          } else {
            onAdd(optionToGuest(a));
          }
        }}
        className={`centaur-chip ${selected ? 'centaur-chip-active' : ''} ${compact ? 'max-w-full' : 'max-w-200px'} px-10px py-5px text-12px cursor-pointer`}
      >
        <AgentOptionLabel agent={a} />
        {selected ? (
          <Close theme='outline' size='12' fill='currentColor' className='shrink-0' />
        ) : (
          <Check theme='outline' size='12' fill='currentColor' className='shrink-0 opacity-40' />
        )}
      </button>
    );
  };

  return (
    <div
      data-testid='meeting-guest-panel'
      className={compact ? 'flex flex-col gap-8px max-w-260px' : 'flex flex-col items-center gap-10px w-full'}
    >
      <div className='flex items-center gap-6px text-12px font-medium text-[color:var(--text-secondary)]'>
        <PeoplePlus theme='outline' size='14' fill='var(--primary)' />
        {compact
          ? t('team.meeting.extraExpert.titleShort', { defaultValue: '加入更多专家' })
          : t('team.meeting.extraExpert.title', { defaultValue: '加入更多专家（国产模型 / OpenClaw / Hermes 等）' })}
      </div>
      {compact ? (
        <div className='flex flex-col gap-6px'>{guestCandidates.map(renderChip)}</div>
      ) : (
        <div className='w-full max-h-220px overflow-y-auto px-2px [scrollbar-width:thin] flex flex-col gap-10px'>
          {backendExtras.length > 0 && (
            <div className='flex flex-wrap items-center justify-center gap-8px'>
              {modelExperts.length > 0 &&
                groupHeader(t('team.meeting.extraExpert.groupBackends', { defaultValue: '其它后端' }))}
              {backendExtras.map(renderChip)}
            </div>
          )}
          {modelExperts.length > 0 && (
            <div className='flex flex-wrap items-center justify-center gap-8px'>
              {backendExtras.length > 0 &&
                groupHeader(t('team.meeting.extraExpert.groupModels', { defaultValue: '直连模型' }))}
              {modelExperts.map(renderChip)}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MeetingGuestPanel;
