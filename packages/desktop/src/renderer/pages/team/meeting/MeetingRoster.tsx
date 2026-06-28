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
  compact?: boolean;
};

/** Short, human-friendly model/backend label so the heterogeneous mix is visible. */
function modelLabel(a: TeamAgent): string {
  const m = (a.model || '').trim();
  if (m && m !== 'default' && m !== 'default/default' && m !== 'auto') {
    return m.includes(':') ? (m.split(':').pop() ?? a.agent_type) : (m.split('/')[0] ?? a.agent_type);
  }
  return a.agent_type;
}

/** Soft clay ring used to mark whoever is currently speaking. */
const activeRing = 'shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_18%,transparent)]';

/** Small "发言中" pill anchored above an active full-size seat. */
const SpeakingPill: React.FC = () => {
  const { t } = useTranslation();
  return (
    <span className='absolute -top-9px left-1/2 -translate-x-1/2 flex items-center gap-3px px-7px h-18px rd-full bg-[var(--primary)] text-white text-10px leading-none whitespace-nowrap shadow-[var(--shadow-sm)]'>
      <Loading theme='outline' size='10' fill='currentColor' className='animate-spin' />
      {t('team.meeting.speaking', { defaultValue: '发言中' })}
    </span>
  );
};

const Seat: React.FC<{ agent: TeamAgent; isLeader: boolean; active: boolean }> = ({ agent, isLeader, active }) => {
  const { t } = useTranslation();
  const role = isLeader
    ? t('team.meeting.role.moderator', { defaultValue: '主持人' })
    : t('team.meeting.role.panelist', { defaultValue: '专家' });
  return (
    <div
      data-testid={`meeting-seat-${agent.slot_id}`}
      className={`relative shrink-0 flex flex-col items-center gap-6px px-14px py-10px rd-14px border border-solid transition-all ${
        active
          ? `border-[color:var(--primary)] bg-[color:var(--color-primary-light-1)] ${activeRing}`
          : isLeader
            ? 'border-[color:var(--color-primary-light-3)] bg-[var(--bg-1)]'
            : 'border-[color:var(--border-light)] bg-[var(--bg-1)]'
      }`}
    >
      <TeamAgentIdentity
        agent_name={agent.agent_name}
        agent_type={agent.agent_type}
        icon={agent.icon}
        conversation_id={agent.conversation_id}
        isLeader={isLeader}
        className='flex-col !gap-5px'
        logoClassName='w-36px h-36px object-contain rounded-10px'
        avatarClassName='w-36px h-36px rounded-10px flex items-center justify-center text-16px leading-none bg-[var(--bg-2)] shrink-0'
        nameClassName='text-13px font-medium text-[color:var(--text-primary)] max-w-104px text-center !flex-none'
      />
      {agent.conversation_id ? (
        <span className='max-w-104px truncate text-11px text-[color:var(--bg-6)] leading-none' title={agent.model || agent.agent_type}>
          {role} · {modelLabel(agent)}
        </span>
      ) : (
        <span className='flex items-center gap-3px text-11px text-[color:var(--bg-6)] leading-none'>
          <Loading theme='outline' size='10' fill='currentColor' className='animate-spin' />
          {t('team.meeting.connecting', { defaultValue: '连接中…' })}
        </span>
      )}
      {active && <SpeakingPill />}
    </div>
  );
};

const CompactSeat: React.FC<{ agent: TeamAgent; isLeader: boolean; active: boolean }> = ({
  agent,
  isLeader,
  active,
}) => {
  const { t } = useTranslation();
  return (
    <div
      data-testid={`meeting-seat-${agent.slot_id}`}
      title={`${agent.agent_name} · ${modelLabel(agent)}`}
      className={`relative shrink-0 h-32px max-w-180px flex items-center gap-7px px-10px rd-full border border-solid transition-all ${
        active
          ? `border-[color:var(--primary)] bg-[color:var(--color-primary-light-1)] ${activeRing}`
          : 'border-[color:var(--border-light)] bg-[var(--bg-1)]'
      }`}
    >
      <TeamAgentIdentity
        agent_name={agent.agent_name}
        agent_type={agent.agent_type}
        icon={agent.icon}
        conversation_id={agent.conversation_id}
        isLeader={isLeader}
        className='min-w-0 !gap-6px'
        logoClassName='w-20px h-20px object-contain rounded-6px'
        avatarClassName='w-20px h-20px rounded-6px flex items-center justify-center text-11px leading-none bg-[var(--bg-2)] shrink-0'
        nameClassName='text-12px font-medium text-[color:var(--text-secondary)] max-w-86px'
        crownClassName='hidden'
      />
      {agent.conversation_id ? (
        <span className='shrink-0 text-10px text-[color:var(--bg-6)] leading-none'>
          {isLeader ? t('team.meeting.role.moderator', { defaultValue: '主持' }) : t('team.meeting.role.panelist', { defaultValue: '专家' })}
        </span>
      ) : (
        <span className='shrink-0 flex items-center gap-2px text-10px text-[color:var(--bg-6)] leading-none'>
          <Loading theme='outline' size='10' fill='currentColor' className='animate-spin' />
          {t('team.meeting.connecting', { defaultValue: '连接中' })}
        </span>
      )}
      {active && (
        <span className='shrink-0 flex items-center gap-2px text-10px text-[color:var(--primary)] leading-none'>
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
      className={`relative shrink-0 flex flex-col items-center gap-6px px-14px py-10px rd-14px border border-solid transition-all ${
        active
          ? `border-[color:var(--primary)] bg-[color:var(--color-primary-light-1)] ${activeRing}`
          : 'border-[color:var(--border-light)] bg-[var(--bg-1)]'
      }`}
    >
      <TeamAgentIdentity
        agent_name={guest.agent_name}
        agent_type={guest.agent_type}
        icon={guest.icon}
        conversation_id={''}
        isLeader={false}
        className='flex-col !gap-5px'
        logoClassName='w-36px h-36px object-contain rounded-10px'
        avatarClassName='w-36px h-36px rounded-10px flex items-center justify-center text-16px leading-none bg-[var(--bg-2)] shrink-0'
        nameClassName='text-13px font-medium text-[color:var(--text-primary)] max-w-104px text-center !flex-none'
      />
      <span
        className='max-w-104px truncate text-11px text-[color:var(--bg-6)] leading-none'
        title={guest.model_name || guest.agent_type}
      >
        {t('team.meeting.role.panelist', { defaultValue: '专家' })} · {guest.model_name || guest.agent_type}
      </span>
      {active && <SpeakingPill />}
    </div>
  );
};

const CompactExtraSeat: React.FC<{ guest: MeetingGuest; active: boolean }> = ({ guest, active }) => {
  const { t } = useTranslation();
  return (
    <div
      data-testid={`meeting-guest-seat-${guest.id}`}
      title={`${guest.agent_name} · ${guest.model_name || guest.agent_type}`}
      className={`relative shrink-0 h-32px max-w-180px flex items-center gap-7px px-10px rd-full border border-solid transition-all ${
        active
          ? `border-[color:var(--primary)] bg-[color:var(--color-primary-light-1)] ${activeRing}`
          : 'border-[color:var(--border-light)] bg-[var(--bg-1)]'
      }`}
    >
      <TeamAgentIdentity
        agent_name={guest.agent_name}
        agent_type={guest.agent_type}
        icon={guest.icon}
        conversation_id={''}
        isLeader={false}
        className='min-w-0 !gap-6px'
        logoClassName='w-20px h-20px object-contain rounded-6px'
        avatarClassName='w-20px h-20px rounded-6px flex items-center justify-center text-11px leading-none bg-[var(--bg-2)] shrink-0'
        nameClassName='text-12px font-medium text-[color:var(--text-secondary)] max-w-86px'
      />
      <span className='shrink-0 text-10px text-[color:var(--bg-6)] leading-none'>
        {t('team.meeting.role.panelist', { defaultValue: '专家' })}
      </span>
      {active && (
        <span className='shrink-0 flex items-center gap-2px text-10px text-[color:var(--primary)] leading-none'>
          <Loading theme='outline' size='10' fill='currentColor' className='animate-spin' />
          {t('team.meeting.speaking', { defaultValue: '发言中' })}
        </span>
      )}
    </div>
  );
};

/** Round-table seating: moderator + all panelists (team + openclaw/hermes), speaker highlighted. */
const MeetingRoster: React.FC<Props> = ({ moderator, panelists, activeSlotId, guests, compact = false }) => {
  if (compact) {
    return (
      <div
        data-testid='meeting-roster'
        data-compact='true'
        className='shrink-0 flex items-center gap-8px px-20px py-8px min-h-46px border-b border-solid border-[color:var(--border-light)] overflow-x-auto [scrollbar-width:none]'
      >
        {moderator && <CompactSeat agent={moderator} isLeader active={moderator.slot_id === activeSlotId} />}
        {moderator && (panelists.length > 0 || guests.length > 0) && (
          <span className='shrink-0 w-1px h-22px bg-[color:var(--border-base)]' />
        )}
        {panelists.map((p) => (
          <CompactSeat key={p.slot_id} agent={p} isLeader={false} active={p.slot_id === activeSlotId} />
        ))}
        {guests.map((g) => (
          <CompactExtraSeat key={g.id} guest={g} active={g.id === activeSlotId} />
        ))}
      </div>
    );
  }

  return (
    <div
      data-testid='meeting-roster'
      className='shrink-0 flex items-center gap-12px px-20px py-14px border-b border-solid border-[color:var(--border-light)] overflow-x-auto [scrollbar-width:none]'
    >
      {moderator && <Seat agent={moderator} isLeader active={moderator.slot_id === activeSlotId} />}
      {moderator && (panelists.length > 0 || guests.length > 0) && (
        <span className='shrink-0 w-1px h-44px bg-[color:var(--border-base)]' />
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
