/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Empty, Input, Select, Spin } from '@arco-design/web-react';
import { SendOne } from '@icon-park/react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WebviewControl } from '@/renderer/components/media/WebviewHost';
import { useConversationAgents } from '@/renderer/pages/conversation/hooks/useConversationAgents';
import { useVideoAgent } from './useVideoAgent';

type Props = {
  /** Control handle of the embedded editor webview. */
  control: React.MutableRefObject<WebviewControl | null>;
};

/** Right-side AI assistant that drives the embedded video editor. */
const VideoAgentChat: React.FC<Props> = ({ control }) => {
  const { t } = useTranslation();
  const { cliAgents } = useConversationAgents();
  const [agentId, setAgentId] = useState<string>('');
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);

  const { messages, busy, send } = useVideoAgent(() => control.current);

  const agent = useMemo(() => cliAgents.find((a) => a.id === agentId) ?? cliAgents[0], [cliAgents, agentId]);

  useEffect(() => {
    if (!agentId && cliAgents.length) setAgentId(cliAgents[0].id);
  }, [cliAgents, agentId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  const onSend = () => {
    if (!draft.trim() || busy || !agent) return;
    const text = draft.trim();
    setDraft('');
    void send(text, agent);
  };

  return (
    <div className='flex h-full w-full flex-col' style={{ background: 'var(--centaur-card)' }}>
      <div
        className='flex items-center justify-between gap-8px px-14px py-10px'
        style={{ borderBottom: '1px solid var(--centaur-line)' }}
      >
        <span className='text-14px font-700' style={{ color: 'var(--centaur-ink)' }}>
          {t('toolbox.videoAgent.title')}
        </span>
        <Select
          size='small'
          value={agent?.id}
          onChange={(v) => setAgentId(v as string)}
          style={{ width: 130 }}
          placeholder={t('toolbox.videoAgent.agent')}
        >
          {cliAgents.map((a) => (
            <Select.Option key={a.id} value={a.id}>
              {a.name}
            </Select.Option>
          ))}
        </Select>
      </div>

      <div ref={listRef} className='flex-1 overflow-y-auto px-14px py-12px'>
        {messages.length === 0 ? (
          <div className='flex h-full items-center justify-center'>
            <Empty description={t('toolbox.videoAgent.empty')} />
          </div>
        ) : (
          <div className='flex flex-col gap-10px'>
            {messages.map((m) => (
              <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className='max-w-86% rounded-12px px-12px py-8px text-13px leading-20px'
                  style={{
                    background:
                      m.role === 'user'
                        ? 'var(--centaur-clay-tint)'
                        : m.role === 'error'
                          ? 'var(--centaur-danger-tint, #f8e3df)'
                          : 'var(--centaur-bg-warm)',
                    color: m.role === 'error' ? 'var(--centaur-danger, #c0492f)' : 'var(--centaur-ink)',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {m.text}
                  {m.actions && m.actions.length > 0 && (
                    <div className='mt-6px flex flex-wrap gap-4px'>
                      {m.actions.map((a, i) => (
                        <span
                          key={`${m.id}-${i}`}
                          className='inline-flex items-center rounded-6px px-6px py-1px text-11px'
                          style={{
                            background: 'var(--centaur-card)',
                            color: a.ok ? 'var(--centaur-green, #5a8a4e)' : 'var(--centaur-danger, #c0492f)',
                            border: '1px solid var(--centaur-line)',
                          }}
                        >
                          {a.ok ? '✓' : '✗'} {a.name}
                        </span>
                      ))}
                    </div>
                  )}
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
        <Button type='primary' icon={<SendOne />} loading={busy} disabled={!draft.trim() || !agent} onClick={onSend} />
      </div>
    </div>
  );
};

export default VideoAgentChat;
