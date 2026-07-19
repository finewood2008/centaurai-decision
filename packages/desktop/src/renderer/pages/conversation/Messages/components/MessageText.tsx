/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMessageText } from '@/common/chat/chatLib';
import { AIONUI_FILES_MARKER } from '@/common/config/constants';
import { useConversationContextSafe } from '@/renderer/hooks/context/ConversationContext';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { iconColors } from '@/renderer/styles/colors';
import { Alert, Message, Tooltip } from '@arco-design/web-react';
import { Copy } from '@icon-park/react';
import classNames from 'classnames';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { copyText } from '@/renderer/utils/ui/clipboard';
import CollapsibleContent from '@renderer/components/chat/CollapsibleContent';
import FilePreview from '@renderer/components/media/FilePreview';
import HorizontalFileList from '@renderer/components/media/HorizontalFileList';
import MarkdownView from '@renderer/components/Markdown';
import { stripThinkTags, hasThinkTags } from '@renderer/utils/chat/thinkTagFilter';
import { stripSkillSuggest, hasSkillSuggest } from '@renderer/utils/chat/skillSuggestParser';

/**
 * Format a timestamp for message display.
 * Today: "HH:mm", older: "MM-DD HH:mm".
 */
export const formatMessageTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  const now = new Date();
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const time = `${hours}:${minutes}`;

  if (
    date.getFullYear() !== now.getFullYear() ||
    date.getMonth() !== now.getMonth() ||
    date.getDate() !== now.getDate()
  ) {
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${month}-${day} ${time}`;
  }
  return time;
};
import MessageCronBadge from './MessageCronBadge';
import { getAgentLogo } from '@/renderer/utils/model/agentLogo';
import TeammateMessageAvatar from './TeammateMessageAvatar';

const CODE_STYLE = { marginTop: 4, marginBlock: 4 };

const parseFileMarker = (content: string) => {
  const markerIndex = content.indexOf(AIONUI_FILES_MARKER);
  if (markerIndex === -1) {
    return { text: content, files: [] as string[] };
  }
  const text = content.slice(0, markerIndex).trimEnd();
  const afterMarker = content.slice(markerIndex + AIONUI_FILES_MARKER.length).trim();
  const files = afterMarker
    ? afterMarker
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    : [];
  return { text, files };
};

const isAbsoluteMessageFilePath = (file_path: string): boolean =>
  file_path.startsWith('/') || /^[A-Za-z]:/.test(file_path);

export const resolveMessageFilePath = (file_path: string, workspace?: string): string => {
  if (!file_path || isAbsoluteMessageFilePath(file_path) || !workspace) {
    return file_path;
  }

  const normalizedWorkspace = workspace.replace(/[\\/]+$/, '').replace(/\\/g, '/');
  const normalizedFilePath = file_path.replace(/^\.?[\\/]+/, '').replace(/\\/g, '/');
  return `${normalizedWorkspace}/${normalizedFilePath}`.replace(/\/+/g, '/');
};

const useFormatContent = (content: string) => {
  return useMemo(() => {
    try {
      const json = JSON.parse(content);
      const isJson = typeof json === 'object';
      return {
        json: isJson,
        data: isJson ? json : content,
      };
    } catch {
      return { data: content };
    }
  }, [content]);
};

const LOCAL_VECTOR_DB_DISPLAY_MARKS = [
  '【CentaurAI 检索上下文】',
  '【local-vector-db 检索结果】',
  '【知识库检索结果】',
] as const;

type LocalVectorDbDisplay = {
  question: string;
  mode: string;
  count: string;
  sources: string[];
  snippet: string;
  preview: string;
};

const decodeLocalVectorText = (value: string): string =>
  String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

const cleanLocalVectorText = (value: string): string =>
  decodeLocalVectorText(
    String(value || '')
      .replace(/<\/details>/g, '\n')
      .replace(/<\/section>/g, '\n')
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

const isLocalVectorSourceName = (value: string): boolean =>
  /\.[A-Za-z0-9]{1,8}(\b|$)/.test(value) || /[\\/]/.test(value) || /^(USER|AGENTS)\.md$/i.test(value);

const localVectorPreview = (value: string): string =>
  cleanLocalVectorText(value)
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !/^检索模式[：:]/.test(line) &&
        !line.startsWith('以下内容来自本地资料') &&
        !/^<\/?retrieved_context>$/.test(line) &&
        !/^[-—]{3,}$/.test(line) &&
        !/^用户问题[：:]/.test(line) &&
        !/^##\s*/.test(line) &&
        !/^\[\d+\]\s+/.test(line)
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const clampLocalVectorText = (value: string): string => {
  const text = String(value || '').trim();
  return text.length > 520 ? `${text.slice(0, 520)}…` : text;
};

const parseLocalVectorDisplay = (content: string, defaultMode: string): LocalVectorDbDisplay | null => {
  const text = String(content || '');
  const displayMark = LOCAL_VECTOR_DB_DISPLAY_MARKS.find((mark) => text.startsWith(mark));
  if (!displayMark) return null;

  const questionMatch = text.match(
    /\n---\n(?:#{1,6}\s*)?(?:用户问题|使用者問題|User question)(?:[：:]?\s*\n|[：:]\s*)([\s\S]*)$/i
  );
  const question = questionMatch ? questionMatch[1].trim() : '';
  const body = text.slice(displayMark.length, questionMatch?.index ?? text.length).trim();
  const mode = (
    (body.match(/(?:检索模式|檢索模式|Retrieval mode|模式)[：:]\s*([^·\n<]+)/i) || [])[1] || defaultMode
  ).trim();
  const retrievedBody = (body.match(/<retrieved_context>([\s\S]*?)<\/retrieved_context>/i) || [])[1] || body;

  let sources: string[] = [];
  for (const match of retrievedBody.matchAll(/local-vector-db-source-name[^>]*>([\s\S]*?)<\/span>/g)) {
    sources.push(cleanLocalVectorText(match[1]));
  }
  for (const match of retrievedBody.matchAll(/^\[(\d+)\]\s*([^\n]+)/gm)) {
    sources.push(
      cleanLocalVectorText(match[2])
        .replace(/^\[(document|wiki|memory|image)\]\s*/i, '')
        .replace(/\s*·\s*score.*$/, '')
    );
  }
  for (const match of retrievedBody.matchAll(/^##\s+(.+)$/gm)) {
    const source = cleanLocalVectorText(match[1])
      .replace(/（\d+\s*条）$/, '')
      .trim();
    if (isLocalVectorSourceName(source)) {
      sources.push(source);
    }
  }
  sources = [...new Set(sources.map((source) => source.trim()).filter(Boolean))].slice(0, 6);

  const count = ((body.match(/(\d+)\s*条/) || [])[1] || sources.length || '').toString();
  const snippet = cleanLocalVectorText(retrievedBody).slice(0, 2200);
  const preview = clampLocalVectorText(localVectorPreview(retrievedBody) || snippet);

  return { question: question || text, mode, count, sources, snippet, preview };
};

const renderLocalVectorUserMessage = (content: string, t: TFunction): React.ReactNode => {
  const result = parseLocalVectorDisplay(
    content,
    t('messages.knowledgeRetrieval.defaultMode', { defaultValue: '本地检索' })
  );

  if (!result) {
    return (
      <div className='whitespace-pre-wrap break-words' data-testid='message-text-content'>
        {content}
      </div>
    );
  }

  const sourceCount = result.count
    ? ` · ${t('messages.knowledgeRetrieval.sourceCount', {
        count: Number(result.count),
        defaultValue: `${result.count} 条来源`,
      })}`
    : '';

  return (
    <div className='flex flex-col gap-8px' data-testid='message-text-content'>
      <div className='whitespace-pre-wrap break-words'>{result.question}</div>
      <div
        className='w-full'
        style={{
          width: 'min(560px,72vw)',
          maxWidth: '100%',
          boxSizing: 'border-box',
          border: '1px solid var(--aou-3, #ddccb4)',
          borderLeft: '3px solid var(--brand, #c0755a)',
          background: 'var(--aou-1, #f3ece2)',
          borderRadius: 8,
          padding: '12px 13px',
          boxShadow: '0 12px 32px rgba(78,44,32,.12)',
        }}
      >
        <div className='flex items-start justify-between gap-12px'>
          <div className='flex items-start gap-9px min-w-0'>
            <span
              className='shrink-0 text-11px font-700'
              style={{
                width: 28,
                height: 28,
                borderRadius: 7,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--brand-light, #f4e7e0)',
                border: '1px solid var(--aou-3, #ddccb4)',
                color: 'var(--brand, #c0755a)',
                letterSpacing: 0,
              }}
            >
              KB
            </span>
            <div className='min-w-0'>
              <div className='text-13px font-700 text-t-primary truncate'>
                {t('messages.knowledgeRetrieval.cardTitle', { defaultValue: '私有知识与记忆检索' })}
              </div>
              <div className='text-11px text-t-secondary mt-1px'>
                {t('messages.knowledgeRetrieval.cardDescription', {
                  defaultValue: '已选取相关片段作为回答依据',
                })}
              </div>
            </div>
          </div>
          <span
            className='text-11px shrink-0'
            style={{
              border: '1px solid var(--aou-3, #ddccb4)',
              background: 'var(--bg-1, #fffdfa)',
              borderRadius: 999,
              padding: '3px 8px',
              color: 'var(--color-text-2,#4e5969)',
            }}
          >
            {result.mode}
            {sourceCount}
          </span>
        </div>

        {result.preview && (
          <div className='mt-10px' style={{ borderTop: '1px solid var(--aou-3, #ddccb4)', paddingTop: 9 }}>
            <div className='text-11px font-600 mb-5px' style={{ color: 'var(--color-text-2,#4e5969)' }}>
              {t('messages.knowledgeRetrieval.preview', { defaultValue: '检索内容预览' })}
            </div>
            <div
              className='whitespace-pre-wrap break-words'
              style={{
                fontSize: 12,
                lineHeight: 1.65,
                maxHeight: 104,
                overflow: 'hidden',
                color: 'var(--color-text-1,#1d2129)',
              }}
            >
              {result.preview}
            </div>
          </div>
        )}

        {result.sources.length > 0 && (
          <div className='mt-10px flex flex-wrap gap-6px'>
            {result.sources.slice(0, 5).map((source, index) => (
              <span
                key={index}
                className='text-11px truncate'
                style={{
                  maxWidth: 220,
                  border: '1px solid var(--aou-3, #ddccb4)',
                  background: 'var(--bg-1, #fffdfa)',
                  borderRadius: 6,
                  padding: '3px 7px',
                  color: 'var(--color-text-2,#4e5969)',
                }}
              >
                {source}
              </span>
            ))}
          </div>
        )}

        {result.snippet && (
          <details className='mt-9px'>
            <summary
              className='text-12px cursor-pointer select-none'
              style={{ color: 'var(--brand)', outline: 'none' }}
            >
              {t('messages.knowledgeRetrieval.expand', { defaultValue: '展开完整检索片段' })}
            </summary>
            <pre
              className='mt-7px mb-0 whitespace-pre-wrap break-words'
              style={{
                maxHeight: 280,
                overflow: 'auto',
                fontSize: 11,
                lineHeight: 1.6,
                border: '1px solid var(--aou-3, #ddccb4)',
                borderRadius: 7,
                padding: 10,
                background: 'var(--bg-1, #fffdfa)',
                color: 'var(--color-text-2,#4e5969)',
              }}
            >
              {result.snippet}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
};

const MessageText: React.FC<{ message: IMessageText }> = ({ message }) => {
  // Filter think tags from content before rendering
  // 在渲染前过滤 think 标签
  const contentToRender = useMemo(() => {
    let content = message.content.content;
    if (typeof content === 'string') {
      if (hasThinkTags(content)) {
        content = stripThinkTags(content);
      }
      // Strip any inline [SKILL_SUGGEST] blocks (now handled via separate skill_suggest message type)
      if (hasSkillSuggest(content)) {
        content = stripSkillSuggest(content);
      }
      return content;
    }
    return content;
  }, [message.content.content]);

  const { text, files } = parseFileMarker(contentToRender);
  const { data, json } = useFormatContent(text);
  const { t } = useTranslation();
  const [showCopyAlert, setShowCopyAlert] = useState(false);
  const isUserMessage = message.position === 'right';
  const isTeammateMessage = message.position === 'left' && message.content.teammateMessage === true;
  const shouldRenderPlainText = isUserMessage;
  const conversationContext = useConversationContextSafe();
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const resolvedFiles = useMemo(
    () => files.map((file_path) => resolveMessageFilePath(file_path, conversationContext?.workspace)),
    [conversationContext?.workspace, files]
  );

  // 过滤空内容，避免渲染空DOM
  if (!message.content.content || (typeof message.content.content === 'string' && !message.content.content.trim())) {
    return null;
  }

  const handleCopy = () => {
    const baseText = shouldRenderPlainText ? text : json ? JSON.stringify(data, null, 2) : text;
    const fileList = files.length ? `Files:\n${files.map((path) => `- ${path}`).join('\n')}\n\n` : '';
    const textToCopy = fileList + baseText;
    copyText(textToCopy)
      .then(() => {
        setShowCopyAlert(true);
        setTimeout(() => setShowCopyAlert(false), 2000);
      })
      .catch(() => {
        Message.error(t('common.copyFailed'));
      });
  };

  const copyButton = (
    <Tooltip content={t('common.copy', { defaultValue: 'Copy' })}>
      <div
        className='p-4px rd-4px cursor-pointer hover:bg-3 transition-colors opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto'
        onClick={handleCopy}
        style={{ lineHeight: 0 }}
      >
        <Copy theme='outline' size='16' fill={iconColors.secondary} />
      </div>
    </Tooltip>
  );

  const cronMeta = message.content.cronMeta;
  const senderName = message.content.senderName;
  const senderAgentType = message.content.senderAgentType;
  const senderConversationId = message.content.senderConversationId;
  const fallbackBackendLogo = senderAgentType ? getAgentLogo(senderAgentType) : null;

  return (
    <>
      <div className={classNames('min-w-0 flex flex-col group', isUserMessage ? 'items-end' : 'items-start')}>
        {cronMeta && <MessageCronBadge meta={cronMeta} />}
        {isTeammateMessage && senderName && (
          <div className='flex items-center gap-6px mb-4px'>
            <TeammateMessageAvatar
              senderName={senderName}
              senderConversationId={senderConversationId}
              backendLogo={fallbackBackendLogo}
            />
            <span className='text-12px text-t-secondary'>{senderName}</span>
          </div>
        )}
        {files.length > 0 && (
          <div className={classNames('mt-6px', { 'self-end': isUserMessage })}>
            {resolvedFiles.length === 1 ? (
              <div className='flex items-center'>
                <FilePreview path={resolvedFiles[0]} onRemove={() => undefined} readonly />
              </div>
            ) : (
              <HorizontalFileList>
                {resolvedFiles.map((path) => (
                  <FilePreview key={path} path={path} onRemove={() => undefined} readonly />
                ))}
              </HorizontalFileList>
            )}
          </div>
        )}
        <div
          className={classNames('min-w-0 [&>p:first-child]:mt-0px [&>p:last-child]:mb-0px md:max-w-780px', {
            'bg-aou-2 p-6px md:p-8px': isUserMessage || cronMeta,
            'bg-3 p-6px md:p-8px': isTeammateMessage,
            'w-full': !(isUserMessage || cronMeta || isTeammateMessage),
          })}
          style={{
            ...(isUserMessage || cronMeta
              ? { borderRadius: '8px 0 8px 8px', color: 'var(--text-primary)' }
              : isTeammateMessage
                ? { borderRadius: '0 8px 8px 8px' }
                : undefined),
          }}
        >
          {/* JSON 内容使用折叠组件 Use CollapsibleContent for JSON content */}
          {shouldRenderPlainText ? (
            renderLocalVectorUserMessage(text, t)
          ) : json ? (
            <CollapsibleContent maxHeight={200} defaultCollapsed={true}>
              <div data-testid='message-text-content'>
                <MarkdownView
                  codeStyle={CODE_STYLE}
                >{`\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``}</MarkdownView>
              </div>
            </CollapsibleContent>
          ) : (
            <div data-testid='message-text-content'>
              <MarkdownView codeStyle={CODE_STYLE}>{data}</MarkdownView>
            </div>
          )}
        </div>
        {/* Hover-revealed copy + timestamp row. Mobile has no hover affordance,
            so we drop the row entirely — system-level long-press still copies. */}
        {!isMobile && (
          <div
            className={classNames('h-32px flex items-center mt-4px gap-8px', {
              'flex-row-reverse': isUserMessage,
            })}
          >
            {copyButton}
            {message.created_at && (
              <span className='text-12px text-t-secondary opacity-0 group-hover:opacity-100 transition-opacity select-none'>
                {formatMessageTime(message.created_at)}
              </span>
            )}
          </div>
        )}
      </div>
      {showCopyAlert && (
        <Alert
          type='success'
          content={t('messages.copySuccess')}
          showIcon
          className='fixed top-20px left-50% transform -translate-x-50% z-9999 w-max max-w-[80%]'
          style={{ boxShadow: '0px 2px 12px rgba(0,0,0,0.12)' }}
          closable={false}
        />
      )}
    </>
  );
};

export default MessageText;
