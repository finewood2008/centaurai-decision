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
    const backendExtras = cliAgents.map(cliAgentToOption).filter((a) => !a.team_capable);
    const modelExperts = buildModelExpertOptions(providers, getAvailableModels);
    return [...backendExtras, ...modelExperts];
  }, [cliAgents, providers, getAvailableModels]);

  const guestIds = useMemo(() => new Set(guests.map((g) => g.id)), [guests]);

  if (guestCandidates.length === 0) {
    return compact ? (
      <div className='px-4px py-6px text-12px text-[color:var(--color-text-3)] max-w-220px'>
        {t('team.meeting.extraExpert.none', {
          defaultValue: '没有可加入的其他专家（如 OpenClaw / Hermes）',
        })}
      </div>
    ) : null;
  }

  return (
    <div
      data-testid='meeting-guest-panel'
      className={
        compact ? 'flex flex-col gap-8px max-w-260px' : 'flex flex-col items-center gap-8px w-full max-w-440px'
      }
    >
      <div className='flex items-center gap-6px text-12px text-[color:var(--color-text-2)]'>
        <PeoplePlus theme='outline' size='14' fill='currentColor' />
        {compact
          ? t('team.meeting.extraExpert.titleShort', { defaultValue: '加入更多专家' })
          : t('team.meeting.extraExpert.title', { defaultValue: '加入更多专家（国产模型 / OpenClaw / Hermes 等）' })}
      </div>
      <div className={compact ? 'flex flex-col gap-6px' : 'flex flex-wrap items-center justify-center gap-8px'}>
        {guestCandidates.map((a) => {
          const id = optionGuestId(a);
          const selected = guestIds.has(id);
          return (
            <button
              key={a.id}
              type='button'
              data-testid={`meeting-guest-toggle-${id}`}
              onClick={() => {
                if (selected) {
                  onRemove(id);
                } else {
                  onAdd(optionToGuest(a));
                }
              }}
              className={`flex items-center gap-6px px-10px py-6px rd-16px border border-solid cursor-pointer transition-colors ${
                selected
                  ? 'border-[color:var(--aou-6)] bg-[color:var(--aou-1)] text-[color:var(--aou-6)]'
                  : 'border-[color:var(--color-border-3)] bg-[var(--color-bg-2)] text-[color:var(--color-text-2)] hover:border-[color:var(--aou-6)]'
              }`}
            >
              <AgentOptionLabel agent={a} />
              {selected ? (
                <Close theme='outline' size='12' fill='currentColor' />
              ) : (
                <Check theme='outline' size='12' fill='currentColor' className='opacity-40' />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default MeetingGuestPanel;
