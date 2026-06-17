import { Tooltip } from '@arco-design/web-react';
import { Comment, VideoConference, ViewGridList } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TeamViewMode } from '../hooks/useTeamViewMode';

type Props = {
  viewMode: TeamViewMode;
  onChange: (mode: TeamViewMode) => void;
};

const SwitchButton: React.FC<{
  active: boolean;
  onClick: () => void;
  title: string;
  testid: string;
  children: React.ReactNode;
}> = ({ active, onClick, title, testid, children }) => (
  <Tooltip content={title} mini>
    <button
      type='button'
      data-testid={testid}
      onClick={onClick}
      className={`flex items-center justify-center w-28px h-24px rd-4px cursor-pointer transition-colors border-none ${
        active
          ? 'bg-[color:var(--color-primary-light-1)] text-[color:var(--color-primary-6)]'
          : 'bg-transparent text-[color:var(--color-text-3)] hover:bg-[var(--fill-2)] hover:text-[color:var(--color-text-2)]'
      }`}
      style={{ lineHeight: 0 }}
      aria-pressed={active}
      aria-label={title}
    >
      {children}
    </button>
  </Tooltip>
);

/**
 * Toggle between team view modes:
 *  - split: each agent in its own column with its own send box (default)
 *  - group: shared broadcast send box at the bottom; columns hide their send boxes
 */
const TeamViewModeSwitch: React.FC<Props> = ({ viewMode, onChange }) => {
  const { t } = useTranslation();
  return (
    <div
      data-testid='team-view-mode-switch'
      className='inline-flex items-center gap-2px p-2px rd-6px border border-solid border-[color:var(--border-base)] bg-[var(--color-bg-2)]'
    >
      <SwitchButton
        active={viewMode === 'split'}
        onClick={() => onChange('split')}
        title={t('team.viewMode.split', { defaultValue: 'Split view' })}
        testid='team-view-mode-split'
      >
        <ViewGridList theme='outline' size='14' fill='currentColor' />
      </SwitchButton>
      <SwitchButton
        active={viewMode === 'group'}
        onClick={() => onChange('group')}
        title={t('team.viewMode.group', { defaultValue: 'Group chat' })}
        testid='team-view-mode-group'
      >
        <Comment theme='outline' size='14' fill='currentColor' />
      </SwitchButton>
      <SwitchButton
        active={viewMode === 'meeting'}
        onClick={() => onChange('meeting')}
        title={t('team.viewMode.meeting', { defaultValue: 'Meeting' })}
        testid='team-view-mode-meeting'
      >
        <VideoConference theme='outline' size='14' fill='currentColor' />
      </SwitchButton>
    </div>
  );
};

export default TeamViewModeSwitch;
