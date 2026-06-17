import { Button, Input } from '@arco-design/web-react';
import { Redo, RightOne } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import SendBox from '@/renderer/components/chat/SendBox';
import type { MeetingOrchestrator } from './useMeetingOrchestrator';

type Props = {
  orchestrator: MeetingOrchestrator;
  /** Topic draft is owned by the parent so the expert-matcher can read it. */
  topic: string;
  onTopicChange: (v: string) => void;
};

/**
 * Bottom operation bar for the meeting room.
 *
 * - idle: topic input + start (the boss throws a question to the team).
 * - running: interject box + cancel (the backend team_run drives the debate).
 * - resolution: pick a card above; or start over.
 * - decided: start a fresh meeting.
 */
const MeetingControlBar: React.FC<Props> = ({ orchestrator, topic, onTopicChange }) => {
  const { t } = useTranslation();
  const { state, canStart, startMeeting, interject, cancel, reset } = orchestrator;
  const [interjection, setInterjection] = useState('');

  const wrapperClass =
    'shrink-0 px-12px pt-10px pb-12px border-t border-solid border-[color:var(--border-base)] bg-[var(--color-bg-1)]';

  if (state.phase === 'idle') {
    return (
      <div data-testid='meeting-control-idle' className={wrapperClass}>
        <div className='flex items-end gap-8px'>
          <Input.TextArea
            value={topic}
            onChange={onTopicChange}
            autoSize={{ minRows: 1, maxRows: 4 }}
            placeholder={t('team.meeting.topicPlaceholder', {
              defaultValue: '抛出一个议题，让一群 AI 专家帮你开会论证…',
            })}
            className='flex-1'
            disabled={!canStart}
          />
          <Button
            type='primary'
            icon={<RightOne theme='filled' size='14' fill='currentColor' />}
            disabled={!canStart || !topic.trim()}
            onClick={() => {
              startMeeting(topic);
              onTopicChange('');
            }}
            data-testid='meeting-start'
          >
            {t('team.meeting.start', { defaultValue: '开会' })}
          </Button>
        </div>
        {!canStart && (
          <div className='mt-6px text-12px text-[color:var(--color-text-3)]'>
            {t('team.meeting.needAgents', { defaultValue: '需要 1 位主持人（队长）和至少 1 位专家才能开会。' })}
          </div>
        )}
      </div>
    );
  }

  if (state.phase === 'decided') {
    return (
      <div data-testid='meeting-control-decided' className={wrapperClass}>
        <Button
          long
          icon={<Redo theme='outline' size='14' fill='currentColor' />}
          onClick={reset}
          data-testid='meeting-restart'
        >
          {t('team.meeting.newMeeting', { defaultValue: '开一场新会议' })}
        </Button>
      </div>
    );
  }

  const isResolution = state.phase === 'resolution';

  return (
    <div data-testid='meeting-control-active' className={wrapperClass}>
      <div className='flex items-center gap-6px mb-8px'>
        {isResolution ? (
          <span className='text-12px text-[color:var(--color-text-3)]'>
            {t('team.meeting.pickHint', { defaultValue: '请在上方选择一个方案拍板' })}
          </span>
        ) : (
          <span className='text-12px text-[color:var(--color-text-3)]'>
            {t('team.meeting.runningHint', { defaultValue: '主持人正在带领专家讨论…可随时举手插话' })}
          </span>
        )}
        <div className='flex-1' />
        <Button
          size='small'
          type='text'
          status='danger'
          icon={<Redo theme='outline' size='14' fill='currentColor' />}
          onClick={isResolution ? reset : cancel}
          data-testid='meeting-cancel'
        >
          {isResolution
            ? t('team.meeting.reset', { defaultValue: '重开' })
            : t('team.meeting.cancel', { defaultValue: '取消会议' })}
        </Button>
      </div>
      {!isResolution && (
        <SendBox
          value={interjection}
          onChange={setInterjection}
          onSend={async (msg: string) => {
            interject(msg);
            setInterjection('');
          }}
          placeholder={t('team.meeting.interjectPlaceholder', { defaultValue: '✋ 举手插话：随时补充想法或纠偏…' })}
        />
      )}
    </div>
  );
};

export default MeetingControlBar;
