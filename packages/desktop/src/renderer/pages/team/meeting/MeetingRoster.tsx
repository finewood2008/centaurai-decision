import React from 'react';
import { useTranslation } from 'react-i18next';
import { Loading } from '@icon-park/react';
import type { TeamAgent } from '@/common/types/team/teamTypes';
import TeamAgentIdentity from '../components/TeamAgentIdentity';
import type { MeetingGuest } from './meetingGuests';

type Props = {
  moderator: TeamAgent | null;
  panelists: TeamAgent[];
  activeSlotId: string | null;
  guests: MeetingGuest[];
};

/** Short, human-friendly model/backend label so the heterogeneous mix is visible. */
function modelLabel(a: TeamAgent): string {
  const m = (a.model || '').trim();
  if (m && m !== 'default' && m !== 'default/default' && m !== 'auto') {
    return m.includes(':') ? (m.split(':').pop() ?? a.agent_type) : (m.split('/')[0] ?? a.agent_type);
  }
  return a.agent_type;
}

const Seat: React.FC<{ agent: TeamAgent; isLeader: boolean; active: boolean }> = ({ agent, isLeader, active }) => {
  const { t } = useTranslation();
  return (
    <div
      data-testid={`meeting-seat-${agent.slot_id}`}
      className={`relative shrink-0 flex flex-col items-center gap-4px px-12px py-8px rd-10px border border-solid transition-all ${
        active
          ? 'border-[color:var(--color-primary-6)] bg-[color:var(--color-primary-light-1)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-primary-6)_20%,transparent)]'
          : 'border-[color:var(--border-base)] bg-[var(--color-bg-2)]'
      }`}
    >
      <TeamAgentIdentity
        agent_name={agent.agent_name}
        agent_type={agent.agent_type}
        icon={agent.icon}
        conversation_id={agent.conversation_id}
        isLeader={isLeader}
        className='flex-col !gap-4px'
        logoClassName='w-32px h-32px object-contain rounded-6px'
        avatarClassName='w-32px h-32px rounded-6px flex items-center justify-center text-16px leading-none bg-fill-2 shrink-0'
        nameClassName='text-12px text-[color:var(--color-text-2)] max-w-96px text-center !flex-none'
      />
      <span className='text-10px text-[color:var(--color-text-3)] leading-none'>
        {isLeader
          ? t('team.meeting.role.moderator', { defaultValue: '主持人' })
          : t('team.meeting.role.panelist', { defaultValue: '专家' })}
      </span>
      <span
        className='max-w-96px truncate px-5px h-14px flex items-center rd-7px text-9px leading-none bg-[var(--fill-2)] text-[color:var(--color-text-3)]'
        title={agent.model || agent.agent_type}
      >
        {modelLabel(agent)}
      </span>
      {active && (
        <span className='absolute -top-7px left-1/2 -translate-x-1/2 flex items-center gap-2px px-6px h-16px rd-8px bg-[color:var(--color-primary-6)] text-white text-10px leading-none whitespace-nowrap'>
          <Loading theme='outline' size='10' fill='currentColor' className='animate-spin' />
          {t('team.meeting.speaking', { defaultValue: '发言中' })}
        </span>
      )}
    </div>
  );
};

/** An openclaw/hermes seat — a full expert (driven by the renderer-side loop). */
const ExtraSeat: React.FC<{ guest: MeetingGuest; active: boolean }> = ({ guest, active }) => {
  const { t } = useTranslation();
  return (
    <div
      data-testid={`meeting-guest-seat-${guest.id}`}
      className={`relative shrink-0 flex flex-col items-center gap-4px px-12px py-8px rd-10px border border-solid transition-all ${
        active
          ? 'border-[color:var(--color-primary-6)] bg-[color:var(--color-primary-light-1)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-primary-6)_20%,transparent)]'
          : 'border-[color:var(--border-base)] bg-[var(--color-bg-2)]'
      }`}
    >
      <TeamAgentIdentity
        agent_name={guest.agent_name}
        agent_type={guest.agent_type}
        icon={guest.icon}
        conversation_id={''}
        isLeader={false}
        className='flex-col !gap-4px'
        logoClassName='w-32px h-32px object-contain rounded-6px'
        avatarClassName='w-32px h-32px rounded-6px flex items-center justify-center text-16px leading-none bg-fill-2 shrink-0'
        nameClassName='text-12px text-[color:var(--color-text-2)] max-w-96px text-center !flex-none'
      />
      <span className='text-10px text-[color:var(--color-text-3)] leading-none'>
        {t('team.meeting.role.panelist', { defaultValue: '专家' })}
      </span>
      <span
        className='max-w-96px truncate px-5px h-14px flex items-center rd-7px text-9px leading-none bg-[var(--fill-2)] text-[color:var(--color-text-3)]'
        title={guest.model_name || guest.agent_type}
      >
        {guest.model_name || guest.agent_type}
      </span>
      {active && (
        <span className='absolute -top-7px left-1/2 -translate-x-1/2 flex items-center gap-2px px-6px h-16px rd-8px bg-[color:var(--color-primary-6)] text-white text-10px leading-none whitespace-nowrap'>
          <Loading theme='outline' size='10' fill='currentColor' className='animate-spin' />
          {t('team.meeting.speaking', { defaultValue: '发言中' })}
        </span>
      )}
    </div>
  );
};

/** Round-table seating: moderator + all panelists (team + openclaw/hermes), speaker highlighted. */
const MeetingRoster: React.FC<Props> = ({ moderator, panelists, activeSlotId, guests }) => {
  return (
    <div
      data-testid='meeting-roster'
      className='shrink-0 flex items-center gap-12px px-16px py-12px border-b border-solid border-[color:var(--border-base)] overflow-x-auto [scrollbar-width:none]'
    >
      {moderator && <Seat agent={moderator} isLeader active={moderator.slot_id === activeSlotId} />}
      {moderator && (panelists.length > 0 || guests.length > 0) && (
        <span className='shrink-0 w-1px h-40px bg-[color:var(--border-base)]' />
      )}
      {panelists.map((p) => (
        <Seat key={p.slot_id} agent={p} isLeader={false} active={p.slot_id === activeSlotId} />
      ))}
      {guests.map((g) => (
        <ExtraSeat key={g.id} guest={g} active={g.id === activeSlotId} />
      ))}
    </div>
  );
};

export default MeetingRoster;
