/**
 * MeetingOutputsSider — a "会议产出" section that lives at the top of the team's
 * right-hand workspace sider (merged into the existing panel, not a separate one).
 * Lists this roundtable's synthesized 方案书 outputs; clicking one asks the
 * meeting room to reopen it (via the `meeting.open.record` event).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Notes, Right } from '@icon-park/react';
import classNames from 'classnames';
import { emitter } from '@/renderer/utils/emitter';
import { readMeetingHistory } from '../meeting/useMeetingOrchestrator';

const MeetingOutputsSider: React.FC<{ teamId: string }> = ({ teamId }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<boolean>(() => localStorage.getItem('meeting-outputs-expanded') !== 'false');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    localStorage.setItem('meeting-outputs-expanded', String(expanded));
  }, [expanded]);

  // Refresh when a meeting finishes (appendHistory emits this).
  useEffect(() => {
    const onChange = () => setTick((v) => v + 1);
    emitter.on('meeting.outputs.changed', onChange);
    return () => {
      emitter.off('meeting.outputs.changed', onChange);
    };
  }, []);

  const outputs = useMemo(() => readMeetingHistory(teamId), [teamId, tick]);

  if (outputs.length === 0) return null;

  return (
    <div className='shrink-0 border-b border-solid border-[color:var(--border-base)] max-h-240px flex flex-col'>
      <div
        className='shrink-0 flex items-center gap-6px px-12px h-32px cursor-pointer select-none'
        onClick={() => setExpanded((v) => !v)}
      >
        <Notes theme='outline' size='14' fill='var(--color-primary-6)' />
        <span className='text-13px font-semibold text-t-primary'>
          {t('team.meeting.outputs.section', { defaultValue: '会议产出' })}
        </span>
        <span className='text-11px text-t-tertiary'>（{outputs.length}）</span>
        <div className='flex-1' />
        <Right
          theme='outline'
          size={12}
          fill='currentColor'
          className={classNames('text-t-tertiary transition-transform duration-150', { 'rotate-90': expanded })}
        />
      </div>
      {expanded && (
        <div className='flex-1 min-h-0 overflow-y-auto pb-6px'>
          {outputs.map((rec) => (
            <div
              key={rec.id}
              onClick={() => emitter.emit('meeting.open.record', { teamId, recordId: rec.id })}
              title={rec.topic || ''}
              className='flex items-start gap-8px mx-6px px-8px py-6px rd-8px cursor-pointer hover:bg-fill-2 transition-colors'
            >
              <Notes theme='outline' size='14' fill='currentColor' className='shrink-0 mt-2px text-t-tertiary' />
              <div className='min-w-0 flex-1'>
                <div className='text-13px text-t-primary truncate leading-tight'>
                  {rec.topic || t('team.meeting.history.untitled', { defaultValue: '未命名议题' })}
                </div>
                <div className='mt-2px text-10px text-t-tertiary'>{new Date(rec.ts).toLocaleString('zh-CN')}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MeetingOutputsSider;
