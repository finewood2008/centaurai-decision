import { Button, Checkbox, Input, Radio } from '@arco-design/web-react';
import { CloseSmall, FolderClose, Redo, RightOne } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import SendBox from '@/renderer/components/chat/SendBox';
import SharedLibraryPicker from '@/renderer/components/media/SharedLibraryPicker';
import type { MeetingOrchestrator } from './useMeetingOrchestrator';
import { MEETING_FORMS } from './meetingPrompts';
import type { MeetingForm } from './meetingTypes';
import { IS_DECISION } from '@/common/config/constants';

/** Last path segment, for a compact attachment chip label. */
const baseName = (p: string): string => p.split(/[\\/]/).pop() || p;

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
  const [useKnowledgeBase, setUseKnowledgeBase] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [form, setForm] = useState<MeetingForm>(state.form || 'roundtable');

  const wrapperClass = 'shrink-0 px-24px pt-12px pb-16px border-t border-solid border-[color:var(--border-light)]';

  if (state.phase === 'idle') {
    return (
      <div data-testid='meeting-control-idle' className={wrapperClass}>
        <div className='flex items-center gap-12px mb-10px'>
          <Checkbox
            checked={useKnowledgeBase}
            onChange={setUseKnowledgeBase}
            disabled={!canStart}
            className='text-12px text-[color:var(--color-text-2)] shrink-0'
            data-testid='meeting-kb-toggle'
          >
            {t('team.meeting.searchKnowledgeBase', { defaultValue: '检索知识库' })}
          </Checkbox>
          <Button
            size='small'
            shape='round'
            icon={<FolderClose theme='outline' size='13' fill='currentColor' />}
            disabled={!canStart}
            onClick={() => setPickerOpen(true)}
            data-testid='meeting-shared-attach'
          >
            {t('team.meeting.attachShared', { defaultValue: '引用共享库' })}
          </Button>
          {attachments.length > 0 && (
            <div className='flex items-center gap-4px overflow-x-auto [scrollbar-width:none]'>
              {attachments.map((p) => (
                <span
                  key={p}
                  className='shrink-0 flex items-center gap-2px pl-8px pr-4px h-22px rd-full text-11px bg-[var(--bg-2)] text-[color:var(--text-secondary)]'
                  title={p}
                >
                  <span className='max-w-120px truncate'>{baseName(p)}</span>
                  <CloseSmall
                    theme='outline'
                    size='13'
                    fill='currentColor'
                    className='cursor-pointer opacity-70 hover:opacity-100'
                    onClick={() => setAttachments((prev) => prev.filter((x) => x !== p))}
                  />
                </span>
              ))}
            </div>
          )}
        </div>
        {/* Flow picker — Decision edition fixes the 流程 at create time (by department),
            so the runtime picker is hidden there; full/team keep it. */}
        {!IS_DECISION && (
          <div className='flex items-center gap-10px mb-10px flex-wrap'>
            <Radio.Group
              type='button'
              size='small'
              value={form}
              onChange={(v) => setForm(v as MeetingForm)}
              disabled={!canStart}
              data-testid='meeting-form-picker'
            >
              {MEETING_FORMS.map((f) => (
                <Radio key={f.id} value={f.id}>
                  {f.label}
                </Radio>
              ))}
            </Radio.Group>
            <span className='text-12px text-[color:var(--bg-6)] truncate'>
              {MEETING_FORMS.find((f) => f.id === form)?.hint}
            </span>
          </div>
        )}
        <div className='flex items-end gap-10px'>
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
            shape='round'
            icon={<RightOne theme='filled' size='14' fill='currentColor' />}
            disabled={!canStart || !topic.trim()}
            onClick={() => {
              // Decision: omit form → startMeeting falls back to the team-fixed workflow (state.form).
              startMeeting(topic, IS_DECISION ? { useKnowledgeBase, attachments } : { useKnowledgeBase, attachments, form });
              onTopicChange('');
              setAttachments([]);
            }}
            data-testid='meeting-start'
          >
            {t('team.meeting.start', { defaultValue: '开会' })}
          </Button>
        </div>
        {!canStart && (
          <div className='mt-8px text-12px text-[color:var(--bg-6)]'>
            {t('team.meeting.needAgents', { defaultValue: '需要 1 位主持人（队长）和至少 1 位专家才能开会。' })}
          </div>
        )}
        <SharedLibraryPicker
          visible={pickerOpen}
          onCancel={() => setPickerOpen(false)}
          onConfirm={(paths) => {
            setAttachments((prev) => [...new Set([...prev, ...paths])]);
            setPickerOpen(false);
          }}
        />
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
  // Between-round pause: the moderator has recapped and is waiting for the boss.
  const awaiting = state.awaitingContinue && state.phase === 'running';

  return (
    <div data-testid='meeting-control-active' className={wrapperClass}>
      <div className='flex items-center gap-6px mb-8px'>
        {isResolution ? (
          <span className='text-12px text-[color:var(--bg-6)]'>
            {t('team.meeting.pickHint', { defaultValue: '请在上方选择一个方案拍板' })}
          </span>
        ) : awaiting ? (
          <span className='text-12px text-[color:var(--primary)] font-medium'>
            {t('team.meeting.pausedHint', {
              defaultValue: '⏸ 主持人等你看完 — 可在下方补充想法，准备好后点「继续讨论」',
            })}
          </span>
        ) : (
          <span className='text-12px text-[color:var(--bg-6)]'>
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
          placeholder={
            awaiting
              ? t('team.meeting.interjectPausePlaceholder', { defaultValue: '💡 想补充什么？说给主持人和专家们…' })
              : t('team.meeting.interjectPlaceholder', { defaultValue: '✋ 举手插话：随时补充想法或纠偏…' })
          }
        />
      )}
    </div>
  );
};

export default MeetingControlBar;
