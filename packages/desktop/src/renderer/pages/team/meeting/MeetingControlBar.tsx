import { Button, Checkbox, Input, Radio } from '@arco-design/web-react';
import { CheckOne, CloseSmall, FolderClose, PauseOne, Redo, RightOne, Search } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import SendBox from '@/renderer/components/chat/SendBox';
import SharedLibraryPicker from '@/renderer/components/media/SharedLibraryPicker';
import { retrieveKnowledgeContext } from '@/renderer/services/knowledgeBaseSearch';
import { IS_DECISION } from '@/common/config/constants';
import type { MeetingOrchestrator } from './useMeetingOrchestrator';
import { MEETING_FORMS } from './meetingPrompts';
import type { MeetingForm } from './meetingTypes';

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
  const { state, canStart, startMeeting, interject, reset, pauseMeeting, finishMeeting, resumeMeeting } = orchestrator;
  const [interjection, setInterjection] = useState('');
  const [useKnowledgeBase, setUseKnowledgeBase] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [form, setForm] = useState<MeetingForm>(state.form || 'roundtable');

  // KB preview state
  const [kbPreviewOpen, setKbPreviewOpen] = useState(false);
  const [kbLoading, setKbLoading] = useState(false);
  const [kbHits, setKbHits] = useState<{ fileName: string; text: string }[]>([]);
  const [kbError, setKbError] = useState('');

  const handleKbPreview = async () => {
    const q = topic.trim();
    if (!q) return;
    setKbLoading(true);
    setKbError('');
    try {
      const result = await retrieveKnowledgeContext(q);
      if (!result.context) {
        setKbHits([]);
        return;
      }
      // Parse individual hits from the formatted context block
      const hits = (result.context || '')
        .split('\n\n')
        .filter(Boolean)
        .map((block) => {
          const m = block.match(/^\[知识库 \d+\] (.+):\n([\s\S]*)/);
          return m ? { fileName: m[1], text: m[2].trim() } : { fileName: '未知', text: block.trim() };
        });
      setKbHits(hits);
      setKbPreviewOpen(true);
    } catch (e) {
      setKbError('检索失败，请确认向量库服务已启动');
    } finally {
      setKbLoading(false);
    }
  };

  const activeDecision = IS_DECISION && (state.phase === 'running' || state.phase === 'resolution');
  const wrapperClass = activeDecision
    ? 'shrink-0 px-18px py-8px border-t border-solid border-[color:var(--border-light)] bg-[var(--bg-base)]'
    : 'shrink-0 px-24px pt-12px pb-16px border-t border-solid border-[color:var(--border-light)]';

  if (state.phase === 'idle') {
    return (
      <div data-testid='meeting-control-idle' className={wrapperClass}>
        <div className='flex items-center gap-12px mb-10px'>
          <Checkbox
            checked={useKnowledgeBase}
            onChange={(v) => {
              setUseKnowledgeBase(v);
              if (!v) setKbPreviewOpen(false);
            }}
            disabled={!canStart}
            className='text-12px text-[color:var(--color-text-2)] shrink-0'
            data-testid='meeting-kb-toggle'
          >
            {t(IS_DECISION ? 'decision.room.searchKnowledgeBase' : 'team.meeting.searchKnowledgeBase', {
              defaultValue: '检索知识库',
            })}
          </Checkbox>
          {useKnowledgeBase && (
            <>
              <Button
                size='small'
                shape='round'
                loading={kbLoading}
                disabled={!topic.trim()}
                onClick={handleKbPreview}
                data-testid='meeting-kb-preview'
              >
                {t(IS_DECISION ? 'decision.room.kbPreview' : 'team.meeting.kbPreview', {
                  defaultValue: '预览检索',
                })}
              </Button>
              {kbHits.length > 0 && (
                <span className='shrink-0 text-12px text-[color:var(--primary)] font-medium'>
                  {t('team.meeting.kbHitCount', { count: kbHits.length, defaultValue: `${kbHits.length} 条命中` })}
                </span>
              )}
            </>
          )}
          {kbError && <span className='shrink-0 text-11px text-[color:var(--danger)]'>{kbError}</span>}
          <Button
            size='small'
            shape='round'
            icon={<FolderClose theme='outline' size='13' fill='currentColor' />}
            disabled={!canStart}
            onClick={() => setPickerOpen(true)}
            data-testid='meeting-shared-attach'
          >
            {t(IS_DECISION ? 'decision.room.attachShared' : 'team.meeting.attachShared', {
              defaultValue: '引用共享库',
            })}
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
        {/* KB preview results — shows when preview has been clicked */}
        {kbPreviewOpen && kbHits.length > 0 && (
          <div className='rd-12px border border-solid border-[color:var(--border-light)] bg-[var(--bg-1)] mb-10px overflow-hidden'>
            <div className='flex items-center gap-6px px-14px h-34px border-b border-solid border-[color:var(--border-light)] text-12px font-medium text-[color:var(--primary)]'>
              <Search theme='outline' size='13' fill='currentColor' />
              <span>
                {t('team.meeting.kbResultsTitle', {
                  count: kbHits.length,
                  defaultValue: `知识库检索结果 · ${kbHits.length} 条命中`,
                })}
              </span>
              <div className='flex-1' />
              <Button size='mini' type='text' onClick={() => setKbPreviewOpen(false)}>
                {t('team.meeting.kbCollapse', { defaultValue: '收起' })}
              </Button>
            </div>
            <div className='max-h-220px overflow-y-auto [scrollbar-width:thin]'>
              {kbHits.map((hit, i) => (
                <div
                  key={i}
                  className='px-14px py-9px border-b border-solid border-[color:var(--border-light)] last:border-b-0'
                >
                  <div className='text-11px font-semibold text-[color:var(--text-secondary)] mb-3px truncate'>
                    {hit.fileName}
                  </div>
                  <div className='text-12px leading-[1.6] text-[color:var(--text-primary)] line-clamp-3'>
                    {hit.text.length > 240 ? hit.text.slice(0, 240) + '…' : hit.text}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {kbPreviewOpen && kbHits.length === 0 && !kbLoading && (
          <div className='rd-12px border border-solid border-[color:var(--border-light)] px-14px py-12px mb-10px text-12px text-[color:var(--bg-6)]'>
            {t('team.meeting.kbNoResults', { defaultValue: '知识库中未找到与当前议题相关的内容' })}
          </div>
        )}
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
            placeholder={t(IS_DECISION ? 'decision.room.topicPlaceholder' : 'team.meeting.topicPlaceholder', {
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
              startMeeting(
                topic,
                IS_DECISION ? { useKnowledgeBase, attachments } : { useKnowledgeBase, attachments, form }
              );
              onTopicChange('');
              setAttachments([]);
            }}
            data-testid='meeting-start'
          >
            {t(IS_DECISION ? 'decision.room.start' : 'team.meeting.start', { defaultValue: '开会' })}
          </Button>
        </div>
        {!canStart && (
          <div className='mt-8px text-12px text-[color:var(--bg-6)]'>
            {t(IS_DECISION ? 'decision.room.needAgents' : 'team.meeting.needAgents', {
              defaultValue: '需要 1 位主持人（队长）和至少 1 位专家才能开会。',
            })}
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
          {t(IS_DECISION ? 'decision.room.newMeeting' : 'team.meeting.newMeeting', {
            defaultValue: '开一场新会议',
          })}
        </Button>
      </div>
    );
  }

  if (state.phase === 'paused') {
    return (
      <div data-testid='meeting-control-paused' className={wrapperClass}>
        <div className='flex gap-8px'>
          <Button
            long
            type='primary'
            icon={<RightOne theme='filled' size='14' fill='currentColor' />}
            disabled={!state.activeRecordId}
            onClick={() => state.activeRecordId && resumeMeeting(state.activeRecordId)}
            data-testid='meeting-resume'
          >
            {t('team.meeting.deepDiscussion.resume', { defaultValue: '继续这场讨论' })}
          </Button>
          <Button icon={<Redo theme='outline' size='14' fill='currentColor' />} onClick={reset}>
            {t('team.meeting.newMeeting', { defaultValue: '开一场新会议' })}
          </Button>
        </div>
      </div>
    );
  }

  if (state.phase === 'completed') {
    return (
      <div data-testid='meeting-control-completed' className={wrapperClass}>
        <Button long icon={<Redo theme='outline' size='14' fill='currentColor' />} onClick={reset}>
          {t('team.meeting.newMeeting', { defaultValue: '开一场新会议' })}
        </Button>
      </div>
    );
  }

  const isResolution = state.phase === 'resolution';
  // Between-round pause: the moderator has recapped and is waiting for the boss.
  const awaiting = Boolean(state.pendingQuestion) && state.phase === 'running';
  const hint = isResolution
    ? t(IS_DECISION ? 'decision.room.pickHint' : 'team.meeting.pickHint', {
        defaultValue: '请在上方选择一个方案拍板',
      })
    : awaiting
      ? t(IS_DECISION ? 'decision.room.pausedHint' : 'team.meeting.pausedHint', {
          defaultValue: '主持人等你看完 — 可在下方补充想法，准备好后点「继续讨论」',
        })
      : t(IS_DECISION ? 'decision.room.runningHint' : 'team.meeting.runningHint', {
          defaultValue: '主持人正在带领专家讨论…可随时举手插话',
        });
  const resetLabel = isResolution
    ? t(IS_DECISION ? 'decision.room.reset' : 'team.meeting.reset', { defaultValue: '重开' })
    : t(IS_DECISION ? 'decision.room.cancel' : 'team.meeting.cancel', { defaultValue: '取消会议' });

  if (activeDecision) {
    return (
      <div data-testid='meeting-control-active' className={wrapperClass}>
        <div className='flex items-center gap-10px'>
          <span
            className={`hidden md:inline-flex shrink-0 max-w-260px truncate text-12px ${
              awaiting ? 'text-[color:var(--primary)] font-medium' : 'text-[color:var(--bg-6)]'
            }`}
            title={hint}
          >
            {hint}
          </span>
          <div className='min-w-0 flex-1'>
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
                    ? t(
                        IS_DECISION
                          ? 'decision.room.interjectPausePlaceholder'
                          : 'team.meeting.interjectPausePlaceholder',
                        {
                          defaultValue: '想补充什么？说给主持人和专家们…',
                        }
                      )
                    : t(IS_DECISION ? 'decision.room.interjectPlaceholder' : 'team.meeting.interjectPlaceholder', {
                        defaultValue: '举手插话：随时补充想法或纠偏…',
                      })
                }
                className='[&_.sendbox-panel]:!p-8px [&_.sendbox-panel]:!rd-14px'
                bottomHint=''
                compactActions
              />
            )}
          </div>
          {!isResolution && (
            <Button
              size='small'
              shape='round'
              icon={<Search theme='outline' size='13' fill='currentColor' />}
              onClick={orchestrator.refreshKnowledge}
              data-testid='meeting-refresh-kb'
              title={t(IS_DECISION ? 'decision.room.refreshKnowledge' : 'team.meeting.refreshKnowledge', {
                defaultValue: '检索知识库',
              })}
            >
              {t('team.meeting.searchKBCompact', { defaultValue: '查资料' })}
            </Button>
          )}
          {isResolution ? (
            <Button size='small' type='text' onClick={reset} data-testid='meeting-cancel'>
              {resetLabel}
            </Button>
          ) : (
            <>
              <Button
                size='small'
                type='text'
                icon={<PauseOne theme='outline' size='14' fill='currentColor' />}
                onClick={pauseMeeting}
                data-testid='meeting-pause'
              >
                {t('team.meeting.deepDiscussion.pause', { defaultValue: '暂停保存' })}
              </Button>
              <Button
                size='small'
                type='text'
                status='danger'
                icon={<CheckOne theme='outline' size='14' fill='currentColor' />}
                onClick={finishMeeting}
                data-testid='meeting-finish'
              >
                {t('team.meeting.deepDiscussion.finish', { defaultValue: '结束讨论' })}
              </Button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div data-testid='meeting-control-active' className={wrapperClass}>
      <div className='flex items-center gap-6px mb-8px'>
        {isResolution ? (
          <span className='text-12px text-[color:var(--bg-6)]'>{hint}</span>
        ) : awaiting ? (
          <span className='text-12px text-[color:var(--primary)] font-medium'>{hint}</span>
        ) : (
          <span className='text-12px text-[color:var(--bg-6)]'>{hint}</span>
        )}
        <div className='flex-1' />
        {!isResolution && (
          <Button
            size='small'
            shape='round'
            icon={<Search theme='outline' size='13' fill='currentColor' />}
            onClick={orchestrator.refreshKnowledge}
            data-testid='meeting-refresh-kb'
          >
            {t('team.meeting.searchKBCompact', { defaultValue: '查资料' })}
          </Button>
        )}
        {isResolution ? (
          <Button size='small' type='text' onClick={reset} data-testid='meeting-cancel'>
            {resetLabel}
          </Button>
        ) : (
          <>
            <Button
              size='small'
              type='text'
              icon={<PauseOne theme='outline' size='14' fill='currentColor' />}
              onClick={pauseMeeting}
              data-testid='meeting-pause'
            >
              {t('team.meeting.deepDiscussion.pause', { defaultValue: '暂停保存' })}
            </Button>
            <Button
              size='small'
              type='text'
              status='danger'
              icon={<CheckOne theme='outline' size='14' fill='currentColor' />}
              onClick={finishMeeting}
              data-testid='meeting-finish'
            >
              {t('team.meeting.deepDiscussion.finish', { defaultValue: '结束讨论' })}
            </Button>
          </>
        )}
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
              ? t(IS_DECISION ? 'decision.room.interjectPausePlaceholder' : 'team.meeting.interjectPausePlaceholder', {
                  defaultValue: '想补充什么？说给主持人和专家们…',
                })
              : t(IS_DECISION ? 'decision.room.interjectPlaceholder' : 'team.meeting.interjectPlaceholder', {
                  defaultValue: '举手插话：随时补充想法或纠偏…',
                })
          }
        />
      )}
    </div>
  );
};

export default MeetingControlBar;
