import React from 'react';
import { useTranslation } from 'react-i18next';
import { CheckOne, Loading, Trophy } from '@icon-park/react';
import type { MeetingPhase } from './meetingTypes';

type Props = {
  phase: MeetingPhase;
  turnsCompleted: number;
};

/** Compact status strip reflecting the backend team_run lifecycle. */
const MeetingPhaseBar: React.FC<Props> = ({ phase, turnsCompleted }) => {
  const { t } = useTranslation();

  const content = (() => {
    if (phase === 'running') {
      return (
        <>
          <Loading theme='outline' size='14' fill='var(--primary)' className='animate-spin' />
          <span className='font-medium text-[color:var(--primary)]'>
            {t('team.meeting.status.running', { defaultValue: '会议进行中' })}
          </span>
          {turnsCompleted > 0 && (
            <span className='text-[color:var(--bg-6)]'>
              {t('team.meeting.status.turns', {
                count: turnsCompleted,
                defaultValue: `已完成 ${turnsCompleted} 段发言`,
              })}
            </span>
          )}
        </>
      );
    }
    if (phase === 'resolution') {
      return (
        <>
          <Trophy theme='outline' size='14' fill='var(--accent-gold-deep)' />
          <span className='font-medium text-[color:var(--text-secondary)]'>
            {t('team.meeting.status.resolution', { defaultValue: '讨论结束，请拍板' })}
          </span>
        </>
      );
    }
    return (
      <>
        <CheckOne theme='filled' size='14' fill='var(--success)' />
        <span className='font-medium text-[color:var(--text-secondary)]'>
          {t('team.meeting.status.decided', { defaultValue: '已拍板' })}
        </span>
      </>
    );
  })();

  return (
    <div
      data-testid='meeting-phase-bar'
      className='shrink-0 flex items-center gap-6px px-20px h-40px border-b border-solid border-[color:var(--border-light)] text-13px'
    >
      {content}
    </div>
  );
};

export default MeetingPhaseBar;
