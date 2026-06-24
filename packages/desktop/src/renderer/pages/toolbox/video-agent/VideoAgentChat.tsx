/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Input, Select, Spin } from '@arco-design/web-react';
import { Close, Robot, SendOne } from '@icon-park/react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WebviewControl } from '@/renderer/components/media/WebviewHost';
import { useConversationAgents } from '@/renderer/pages/conversation/hooks/useConversationAgents';
import { useVideoAgent } from './useVideoAgent';

type Props = {
  /** Control handle of the embedded editor webview. */
  control: React.MutableRefObject<WebviewControl | null>;
};

const DRAWER_WIDTH = 360;

/**
 * Floating, collapsible AI assistant drawer that overlays the embedded video
 * editor (does not resize it). Drives the editor via window.__centaurVideoAgent.
 */
const VideoAgentChat: React.FC<Props> = ({ control }) => {
  const { t } = useTranslation();
  const { cliAgents } = useConversationAgents();
  const [open, setOpen] = useState(false);
  const [agentId, setAgentId] = useState<string>('');
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);

  const { messages, busy, send } = useVideoAgent();
  const agent = useMemo(() => cliAgents.find((a) => a.id === agentId) ?? cliAgents[0], [cliAgents, agentId]);

  useEffect(() => {
    if (!agentId && cliAgents.length) setAgentId(cliAgents[0].id);
  }, [cliAgents, agentId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, open]);

  const onSend = () => {
    if (!draft.trim() || busy || !agent) return;
    const text = draft.trim();
    setDraft('');
    void send(text, agent);
  };

  return (
    <>
      {/* Edge toggle tab — always visible, floats on the right edge */}
      {!open && (
        <button
          type='button'
          onClick={() => setOpen(true)}
          className='absolute right-0 top-1/2 z-30 flex -translate-y-1/2 cursor-pointer flex-col items-center gap-4px rounded-l-12px border-none px-8px py-12px text-white'
          style={{ background: 'var(--centaur-clay)', boxShadow: '-4px 0 14px rgba(0,0,0,0.18)' }}
          title={t('toolbox.videoAgent.title')}
        >
          <Robot theme='outline' size='18' fill='currentColor' />
          <span className='text-11px font-600' style={{ writingMode: 'vertical-rl' }}>
            {t('toolbox.videoAgent.title')}
          </span>
        </button>
      )}

      {/* Sliding drawer (overlays the editor; clipped by the card's overflow-hidden when closed) */}
      <div
        className='absolute inset-y-0 right-0 z-30 flex flex-col'
        style={{
          width: DRAWER_WIDTH,
          transform: open ? 'translateX(0)' : `translateX(${DRAWER_WIDTH}px)`,
          transition: 'transform 0.25s ease',
          background: 'var(--centaur-card)',
          borderLeft: '1px solid var(--centaur-line)',
          boxShadow: open ? '-10px 0 28px rgba(0,0,0,0.14)' : 'none',
          pointerEvents: open ? 'auto' : 'none',
        }}
      >
        {/* Header */}
        <div
          className='flex items-center justify-between gap-8px px-14px py-10px'
          style={{ borderBottom: '1px solid var(--centaur-line)' }}
        >
          <span className='flex items-center gap-6px text-14px font-700' style={{ color: 'var(--centaur-ink)' }}>
            <Robot theme='outline' size='16' fill='var(--centaur-clay)' />
            {t('toolbox.videoAgent.title')}
          </span>
          <div className='flex items-center gap-6px'>
            <Select
              size='small'
              value={agent?.id}
              onChange={(v) => setAgentId(v as string)}
              style={{ width: 116 }}
              placeholder={t('toolbox.videoAgent.agent')}
            >
              {cliAgents.map((a) => (
                <Select.Option key={a.id} value={a.id}>
                  {a.name}
                </Select.Option>
              ))}
            </Select>
            <Button size='mini' type='text' icon={<Close />} onClick={() => setOpen(false)} />
          </div>
        </div>

        {/* Messages */}
        <div ref={listRef} className='flex-1 overflow-y-auto px-14px py-12px'>
          {messages.length === 0 ? (
            <div className='flex h-full flex-col items-center justify-center gap-10px px-8px text-center'>
              <div className='text-13px leading-20px' style={{ color: 'var(--centaur-ink-soft)' }}>
                {t('toolbox.videoAgent.empty')}
              </div>
              <div className='text-11px' style={{ color: 'var(--centaur-ink-mute)' }}>
                {t('toolbox.videoAgent.agent')}: {cliAgents.length} · {t('toolbox.videoAgent.title')}:{' '}
                {control.current ? 'OK' : '…'}
              </div>
            </div>
          ) : (
            <div className='flex flex-col gap-10px'>
              {messages.map((m) => (
                <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  <div
                    className='max-w-90% rounded-12px px-12px py-8px text-13px leading-20px'
                    style={{
                      background:
                        m.role === 'user'
                          ? 'var(--centaur-clay-tint)'
                          : m.role === 'error'
                            ? '#f8e3df'
                            : 'var(--centaur-bg-warm)',
                      color: m.role === 'error' ? '#c0492f' : 'var(--centaur-ink)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {m.text}
                  </div>
                </div>
              ))}
              {busy && (
                <div className='flex items-center gap-8px text-13px' style={{ color: 'var(--centaur-ink-soft)' }}>
                  <Spin size={14} /> {t('toolbox.videoAgent.thinking')}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Input */}
        <div className='flex items-end gap-8px px-12px py-10px' style={{ borderTop: '1px solid var(--centaur-line)' }}>
          <Input.TextArea
            value={draft}
            onChange={setDraft}
            autoSize={{ minRows: 1, maxRows: 4 }}
            placeholder={t('toolbox.videoAgent.placeholder')}
            onPressEnter={(e) => {
              if (!(e as unknown as KeyboardEvent).shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
          />
          <Button
            type='primary'
            icon={<SendOne />}
            loading={busy}
            disabled={!draft.trim() || !agent}
            onClick={onSend}
          />
        </div>
      </div>
    </>
  );
};

export default VideoAgentChat;
