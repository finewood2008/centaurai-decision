/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Alert, Button, Empty, Input, Spin } from '@arco-design/web-react';
import {
  ArrowRight,
  Avatar,
  BookOne,
  Bowl,
  EditMovie,
  IdCard,
  Left,
  Magic,
  Picture,
  PictureOne,
  Search,
  ShoppingBag,
  SmilingFace,
  Time,
  Toolkit,
  Topic,
  Workbench,
} from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ipcBridge } from '@/common';
import WebviewHost, { type WebviewControl } from '@/renderer/components/media/WebviewHost';
import { isElectronDesktop } from '@/renderer/utils/platform';
import VideoAgentChat from './video-agent/VideoAgentChat';
import { useAgents } from '@/renderer/hooks/agent/useAgents';
import type { AgentMetadata } from '@/renderer/utils/model/agentTypes';
import { ResultPanel } from './components/ResultPanel';
import { ToolForm } from './components/ToolForm';
import { checkToolReadiness } from './imageGenReadiness';
import type { ToolDef, ToolFormValues } from './types';
import { useToolboxRun } from './useToolboxRun';
import { useToolboxTools } from './useToolboxTools';

const ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  Picture,
  PictureOne,
  Topic,
  Magic,
  Avatar,
  SmilingFace,
  ShoppingBag,
  IdCard,
  BookOne,
  Bowl,
  Time,
  Workbench,
};

const ToolIcon: React.FC<{ name: string; size?: number }> = ({ name, size }) => {
  const Cmp = ICONS[name] ?? Picture;
  return <Cmp size={size} />;
};

type LastRun = { tool: ToolDef; agent: AgentMetadata | null; values: ToolFormValues };
type ToolboxCategory = 'all' | ToolDef['category'];
type ToolboxPageMode = 'toolbox' | 'workbench';

type ToolboxPageProps = {
  mode?: ToolboxPageMode;
};

const getToolTitle = (tool: ToolDef, t: (key: string) => string) => tool.titleText ?? t(tool.titleKey);
const getToolDesc = (tool: ToolDef, t: (key: string) => string) => tool.descText ?? t(tool.descKey);

const IMAGE2_WORKBENCH_PROFILE = {
  profileName: 'TokenClub Image2',
  apiUrl: 'centaur-image-workbench://app/__tokenclub/v1',
  model: 'gpt-image-2',
  apiMode: 'images',
  streamImages: 'false',
  streamPartialImages: '0',
  disableServiceWorker: 'true',
} as const;

const addImage2WorkbenchProfile = (url: URL): URL => {
  for (const [key, value] of Object.entries(IMAGE2_WORKBENCH_PROFILE)) {
    url.searchParams.set(key, value);
  }
  return url;
};

/** Warm-domain tone palette (clay / gold / green / deep-clay) per BRAND_GUIDE.md. */
type Tone = { surface: string; icon: string; rail: string; dot: string };
const TOOL_TONES: Tone[] = [
  {
    surface: 'var(--centaur-clay-tint)',
    icon: 'var(--centaur-clay-deep)',
    rail: 'var(--centaur-clay)',
    dot: 'var(--centaur-clay)',
  },
  {
    surface: 'var(--centaur-gold-tint)',
    icon: 'var(--centaur-gold-deep)',
    rail: 'var(--centaur-gold)',
    dot: 'var(--centaur-gold)',
  },
  {
    surface: 'var(--centaur-green-tint)',
    icon: 'var(--centaur-green)',
    rail: 'var(--centaur-green)',
    dot: 'var(--centaur-green)',
  },
  {
    surface: 'var(--centaur-bg-warm)',
    icon: 'var(--centaur-ink-soft)',
    rail: 'var(--centaur-clay-deep)',
    dot: 'var(--centaur-clay-deep)',
  },
];

function toneForTool(tool: ToolDef): Tone {
  let hash = 0;
  for (const char of tool.id) hash += char.charCodeAt(0);
  return TOOL_TONES[hash % TOOL_TONES.length];
}

const ToolCard: React.FC<{
  tool: ToolDef;
  onOpen: (tool: ToolDef) => void;
}> = ({ tool, onOpen }) => {
  const { t } = useTranslation();
  const fieldLabels = tool.fields.slice(0, 3).map((field) => t(field.labelKey));
  const extraFieldCount = Math.max(0, tool.fields.length - fieldLabels.length);
  const tone = toneForTool(tool);
  const executorLabel = tool.requires === 'image-model' ? t('toolbox.imageModel') : t('toolbox.agent');

  return (
    <Button
      type='text'
      className='centaur-card centaur-liftable group !h-auto !w-full !overflow-hidden !p-0 !text-left'
      style={{ borderRadius: 'var(--centaur-radius)' }}
      onClick={() => onOpen(tool)}
    >
      <div className='flex min-h-232px w-full flex-col overflow-hidden'>
        <div
          className='relative flex h-90px items-start justify-between gap-12px p-16px'
          style={{ background: tone.surface }}
        >
          <div className='centaur-rail absolute bottom-0 left-0 h-3px w-full' />
          <div className='flex min-w-0 items-center gap-12px'>
            <div
              className='flex h-46px w-46px shrink-0 items-center justify-center rounded-14px'
              style={{ background: 'var(--centaur-card)', color: tone.icon, boxShadow: 'var(--centaur-shadow-sm)' }}
            >
              <ToolIcon name={tool.icon} size={24} />
            </div>
            <div className='min-w-0'>
              <div className='truncate text-16px font-700 leading-22px' style={{ color: 'var(--centaur-ink)' }}>
                {getToolTitle(tool, t)}
              </div>
              <div className='mt-4px flex items-center gap-6px'>
                <span
                  className='inline-flex items-center rounded-8px px-7px py-1px text-11px font-500'
                  style={{
                    background: 'var(--centaur-card)',
                    color: 'var(--centaur-ink-mute)',
                    border: '1px solid var(--centaur-line)',
                  }}
                >
                  {t(`toolbox.categories.${tool.category}`)}
                </span>
                {tool.source === 'skill' && (
                  <span
                    className='inline-flex items-center rounded-8px px-7px py-1px text-11px font-500'
                    style={{ background: 'var(--centaur-gold-tint)', color: 'var(--centaur-gold-deep)' }}
                  >
                    {t('toolbox.source.skill')}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div
            className='flex h-30px w-30px shrink-0 items-center justify-center rounded-10px transition-all group-hover:translate-x-2px'
            style={{ background: 'var(--centaur-card)', color: 'var(--centaur-clay)' }}
          >
            <ArrowRight size={15} />
          </div>
        </div>

        <div className='flex flex-1 flex-col p-16px'>
          <div className='min-h-42px text-13px leading-21px line-clamp-2' style={{ color: 'var(--centaur-ink-soft)' }}>
            {getToolDesc(tool, t)}
          </div>
          <div className='mt-12px flex min-h-24px flex-wrap items-center gap-6px'>
            {fieldLabels.map((label) => (
              <span
                key={label}
                className='inline-flex max-w-120px items-center truncate rounded-8px px-7px py-2px text-11px'
                style={{ background: 'var(--centaur-bg-warm)', color: 'var(--centaur-ink-soft)' }}
              >
                {label}
              </span>
            ))}
            {extraFieldCount > 0 && (
              <span
                className='inline-flex items-center rounded-8px px-7px py-2px text-11px'
                style={{ background: 'var(--centaur-bg-warm)', color: 'var(--centaur-ink-mute)' }}
              >
                +{extraFieldCount}
              </span>
            )}
          </div>
          <div
            className='mt-auto flex items-center justify-between gap-10px pt-12px'
            style={{ borderTop: '1px solid var(--centaur-line)' }}
          >
            <span className='truncate text-12px' style={{ color: 'var(--centaur-ink-mute)' }}>
              {executorLabel}
            </span>
            <div className='h-8px w-8px shrink-0 rounded-full' style={{ background: tone.dot }} />
          </div>
        </div>
      </div>
    </Button>
  );
};

const WorkbenchCard: React.FC<{
  title: string;
  desc: string;
  icon: React.ReactNode;
  meta: string;
  chips: string[];
  onOpen: () => void;
}> = ({ title, desc, icon, meta, chips, onOpen }) => (
  <Button
    type='text'
    className='centaur-card centaur-liftable group !h-auto !w-full !overflow-hidden !p-0 !text-left'
    style={{ borderRadius: 'var(--centaur-radius)' }}
    onClick={onOpen}
  >
    <div className='flex min-h-232px w-full flex-col overflow-hidden'>
      <div
        className='relative flex h-96px items-start justify-between gap-12px p-16px'
        style={{ background: 'var(--centaur-clay-tint)' }}
      >
        <div className='centaur-rail absolute bottom-0 left-0 h-3px w-full' />
        <div className='flex min-w-0 items-center gap-12px'>
          <div
            className='flex h-46px w-46px shrink-0 items-center justify-center rounded-14px'
            style={{
              background: 'var(--centaur-card)',
              color: 'var(--centaur-clay-deep)',
              boxShadow: 'var(--centaur-shadow-sm)',
            }}
          >
            {icon}
          </div>
          <div className='min-w-0'>
            <div className='truncate text-16px font-700 leading-22px' style={{ color: 'var(--centaur-ink)' }}>
              {title}
            </div>
            <div
              className='mt-4px inline-flex items-center rounded-8px px-7px py-1px text-11px font-500'
              style={{
                background: 'var(--centaur-card)',
                color: 'var(--centaur-ink-mute)',
                border: '1px solid var(--centaur-line)',
              }}
            >
              {meta}
            </div>
          </div>
        </div>
        <div
          className='flex h-30px w-30px shrink-0 items-center justify-center rounded-10px transition-all group-hover:translate-x-2px'
          style={{ background: 'var(--centaur-card)', color: 'var(--centaur-clay)' }}
        >
          <ArrowRight size={15} />
        </div>
      </div>
      <div className='flex flex-1 flex-col p-16px'>
        <div className='min-h-42px text-13px leading-21px line-clamp-2' style={{ color: 'var(--centaur-ink-soft)' }}>
          {desc}
        </div>
        <div className='mt-12px flex min-h-24px flex-wrap items-center gap-6px'>
          {chips.map((chip) => (
            <span
              key={chip}
              className='inline-flex max-w-126px items-center truncate rounded-8px px-7px py-2px text-11px'
              style={{ background: 'var(--centaur-bg-warm)', color: 'var(--centaur-ink-soft)' }}
            >
              {chip}
            </span>
          ))}
        </div>
      </div>
    </div>
  </Button>
);

/**
 * Local Centaur Video Workbench server origin. Served by the desktop launcher
 * or `bun run dev` in the opencut-classic project; embedded via WebviewHost.
 */
// opencut runs under a Next basePath so one instance serves both the desktop
// <webview> and the LAN reverse proxy. In a browser, WebviewHost rewrites this
// localhost URL to the same-origin /workbench/video route.
const VIDEO_WORKBENCH_URL = 'http://localhost:3000/workbench/video/projects';

/** Common AI Toolbox — a grid of practical, form-driven AI tools. */
const ToolboxPage: React.FC<ToolboxPageProps> = ({ mode = 'toolbox' }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { agents } = useAgents();
  const { status, result, error, run, reset } = useToolboxRun();
  const isWorkbenchMode = mode === 'workbench';

  const tools = useToolboxTools();
  const imageTools = useMemo(() => tools.filter((tool) => tool.category === 'image'), [tools]);
  const workbenchTools = useMemo(() => tools.filter((tool) => tool.category === 'workbench'), [tools]);
  const visibleTools = isWorkbenchMode ? workbenchTools : imageTools;
  const [activeTool, setActiveTool] = useState<ToolDef | null>(null);
  const [imageWorkbenchOpen, setImageWorkbenchOpen] = useState(!isWorkbenchMode);
  const [videoWorkbenchOpen, setVideoWorkbenchOpen] = useState(false);
  const [videoServer, setVideoServer] = useState<{ state: 'starting' | 'ready' | 'error'; error?: string }>({
    state: 'starting',
  });
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ToolboxCategory>('all');
  const lastRunRef = useRef<LastRun | null>(null);
  const videoControlRef = useRef<WebviewControl | null>(null);

  useEffect(() => {
    setImageWorkbenchOpen(!isWorkbenchMode);
  }, [isWorkbenchMode]);

  // Embedded 半人马 AI 图形工作台. Use a main-process protocol so the workbench
  // does not depend on the renderer dev-server port.
  const workbenchUrl = useMemo(() => {
    const url = new URL('centaur-image-workbench://app/index.html');
    return addImage2WorkbenchProfile(url).toString();
  }, []);

  const keyword = query.trim().toLowerCase();
  const imageWorkbenchMatches =
    !keyword ||
    [t('toolbox.imageWorkbench.title'), t('toolbox.imageWorkbench.cardDesc'), t('toolbox.imageWorkbench.subtitle')]
      .join(' ')
      .toLowerCase()
      .includes(keyword);
  const showImageWorkbenchCard = isWorkbenchMode && category !== 'workbench' && imageWorkbenchMatches;
  const videoWorkbenchMatches =
    !keyword ||
    [t('toolbox.videoWorkbench.title'), t('toolbox.videoWorkbench.cardDesc'), t('toolbox.videoWorkbench.subtitle')]
      .join(' ')
      .toLowerCase()
      .includes(keyword);
  const showVideoWorkbenchCard = isWorkbenchMode && category !== 'workbench' && videoWorkbenchMatches;

  const filteredTools = visibleTools.filter((tool) => {
    if (category !== 'all' && tool.category !== category) return false;
    if (!keyword) return true;
    const title = getToolTitle(tool, t);
    const desc = getToolDesc(tool, t);
    return `${title} ${desc}`.toLowerCase().includes(keyword);
  });

  const imageCount = isWorkbenchMode ? 1 : visibleTools.filter((tool) => tool.category === 'image').length;
  const textCount = visibleTools.filter((tool) => tool.category === 'text').length;
  const workbenchCount = visibleTools.filter((tool) => tool.category === 'workbench').length;

  const categoryOptions: Array<{ key: ToolboxCategory; label: string; count: number }> = (
    [
      {
        key: 'all',
        label: t('toolbox.categories.all'),
        count: isWorkbenchMode ? workbenchTools.length + 1 : visibleTools.length,
      },
      { key: 'image', label: t('toolbox.categories.image'), count: imageCount },
      { key: 'text', label: t('toolbox.categories.text'), count: textCount },
      { key: 'workbench', label: t('toolbox.categories.workbench'), count: workbenchCount },
    ] as Array<{ key: ToolboxCategory; label: string; count: number }>
  ).filter((item) => item.key === 'all' || item.count > 0);

  const statCards = isWorkbenchMode
    ? [
        {
          label: t('toolbox.categories.all'),
          count: workbenchTools.length + 1,
          icon: <Workbench size={20} />,
          tone: 'var(--centaur-clay)',
          surface: 'var(--centaur-clay-tint)',
        },
        {
          label: t('toolbox.categories.image'),
          count: 1,
          icon: <Picture size={20} />,
          tone: 'var(--centaur-gold-deep)',
          surface: 'var(--centaur-gold-tint)',
        },
        {
          label: t('toolbox.categories.workbench'),
          count: workbenchCount,
          icon: <Workbench size={20} />,
          tone: 'var(--centaur-clay-deep)',
          surface: 'var(--centaur-bg-warm)',
        },
      ]
    : [
        {
          label: t('toolbox.categories.all'),
          count: visibleTools.length,
          icon: <Toolkit size={22} />,
          tone: 'var(--centaur-clay)',
          surface: 'var(--centaur-clay-tint)',
        },
        {
          label: t('toolbox.categories.image'),
          count: imageCount,
          icon: <Picture size={20} />,
          tone: 'var(--centaur-gold-deep)',
          surface: 'var(--centaur-gold-tint)',
        },
        {
          label: t('toolbox.categories.text'),
          count: textCount,
          icon: <BookOne size={20} />,
          tone: 'var(--centaur-green)',
          surface: 'var(--centaur-green-tint)',
        },
      ];

  const headerIcon = isWorkbenchMode ? <Workbench size={26} /> : <Toolkit size={26} />;
  const headerEyebrow = isWorkbenchMode ? 'CENTAUR · WORKBENCH' : 'CENTAUR · IMAGE WORKBENCH';
  const headerTitle = isWorkbenchMode ? t('toolbox.workbench.title') : t('toolbox.title');
  const headerSubtitle = isWorkbenchMode ? t('toolbox.workbench.subtitle') : t('toolbox.subtitle');
  const searchPlaceholder = isWorkbenchMode ? t('toolbox.workbench.searchPlaceholder') : t('toolbox.searchPlaceholder');
  const emptyDescription = isWorkbenchMode ? t('toolbox.workbench.empty') : t('toolbox.empty');

  const readiness = activeTool ? checkToolReadiness(activeTool) : null;
  const toolReady = !readiness || readiness.ready;

  let readinessAlert: React.ReactNode = null;
  if (readiness && readiness.ready === false) {
    const { reasonKey, settingsRoute } = readiness;
    readinessAlert = (
      <Alert
        type='warning'
        content={t(reasonKey)}
        action={
          <Button size='mini' type='text' onClick={() => void navigate(settingsRoute)}>
            {t('toolbox.goToSettings')}
          </Button>
        }
      />
    );
  }

  const openTool = useCallback(
    (tool: ToolDef) => {
      reset();
      lastRunRef.current = null;
      setActiveTool(tool);
    },
    [reset]
  );

  const closeTool = useCallback(() => setActiveTool(null), []);

  const openImageWorkbench = useCallback(() => {
    reset();
    lastRunRef.current = null;
    setImageWorkbenchOpen(true);
  }, [reset]);

  const closeImageWorkbench = useCallback(() => {
    reset();
    lastRunRef.current = null;
    setImageWorkbenchOpen(false);
  }, [reset]);

  const startVideoServer = useCallback(() => {
    // Browser/LAN users can't start the host server over IPC — the host keeps
    // opencut running and the WebUI reverse-proxies it. Probe its health first so
    // a stopped host surfaces the card's error state instead of a raw 502 inside
    // the iframe.
    if (!isElectronDesktop()) {
      setVideoServer({ state: 'starting' });
      void fetch('/workbench/video/api/health')
        .then((r) =>
          setVideoServer(
            r.ok ? { state: 'ready' } : { state: 'error', error: 'Video workbench is not available on the server' }
          )
        )
        .catch(() => setVideoServer({ state: 'error', error: 'Video workbench is not available on the server' }));
      return;
    }
    setVideoServer({ state: 'starting' });
    void ipcBridge.videostudio.start
      .invoke()
      .then((videoStatus) => {
        setVideoServer(videoStatus.running ? { state: 'ready' } : { state: 'error', error: videoStatus.error });
      })
      .catch((err: unknown) => {
        setVideoServer({ state: 'error', error: err instanceof Error ? err.message : String(err) });
      });
  }, []);

  const openVideoWorkbench = useCallback(() => {
    reset();
    lastRunRef.current = null;
    setVideoWorkbenchOpen(true);
    startVideoServer();
  }, [reset, startVideoServer]);

  const closeVideoWorkbench = useCallback(() => {
    reset();
    lastRunRef.current = null;
    setVideoWorkbenchOpen(false);
    // Stop the spawned opencut dev server so it doesn't keep running in the
    // background. No-op for a reused/standalone server (only our spawned child
    // is killed; a reused server leaves `child` null in videostudioBridge).
    void ipcBridge.videostudio.stop.invoke();
  }, [reset]);

  const handleRun = useCallback(
    (tool: ToolDef, agent: AgentMetadata | null, values: ToolFormValues) => {
      lastRunRef.current = { tool, agent, values };
      void run(tool, agent, values);
    },
    [run]
  );

  const handleRegenerate = useCallback(() => {
    const last = lastRunRef.current;
    if (last) void run(last.tool, last.agent, last.values);
  }, [run]);

  const handleOpenConversation = useCallback(
    (conversationId: string) => {
      void navigate(`/conversation/${conversationId}`);
    },
    [navigate]
  );

  const renderImageWorkbench = () => {
    return (
      <div className='flex flex-col gap-16px'>
        <div className='flex flex-col gap-16px lg:flex-row lg:items-end lg:justify-between'>
          <div className='flex min-w-0 items-start gap-14px'>
            {isWorkbenchMode && (
              <Button className='mt-5px' shape='circle' icon={<Left />} onClick={closeImageWorkbench} />
            )}
            <div className='centaur-mark h-52px w-52px shrink-0'>
              <Picture size={26} />
            </div>
            <div className='min-w-0'>
              <div className='centaur-eyebrow'>CENTAUR · IMAGE WORKBENCH</div>
              <div className='mt-2px text-26px font-900 leading-32px' style={{ color: 'var(--centaur-ink)' }}>
                {t('toolbox.imageWorkbench.title')}
              </div>
              <div className='mt-5px max-w-760px text-14px leading-21px' style={{ color: 'var(--centaur-ink-soft)' }}>
                {t('toolbox.imageWorkbench.subtitle')}
              </div>
            </div>
          </div>
        </div>

        <div
          className='centaur-card relative w-full overflow-hidden'
          style={{ height: '78vh', minHeight: 520, padding: 0, borderRadius: 'var(--centaur-radius-sm)' }}
        >
          <WebviewHost
            url={workbenchUrl}
            id='centaur-image-workbench'
            partition='persist:centaur-image-workbench'
            className='h-full w-full'
            style={{ height: '100%', minHeight: 520 }}
          />
        </div>
      </div>
    );
  };

  const renderVideoWorkbench = () => {
    return (
      <div className='flex flex-col gap-16px'>
        <div className='flex flex-col gap-16px lg:flex-row lg:items-end lg:justify-between'>
          <div className='flex min-w-0 items-start gap-14px'>
            {isWorkbenchMode && (
              <Button className='mt-5px' shape='circle' icon={<Left />} onClick={closeVideoWorkbench} />
            )}
            <div className='centaur-mark h-52px w-52px shrink-0'>
              <EditMovie size={26} />
            </div>
            <div className='min-w-0'>
              <div className='centaur-eyebrow'>CENTAUR · VIDEO WORKBENCH</div>
              <div className='mt-2px text-26px font-900 leading-32px' style={{ color: 'var(--centaur-ink)' }}>
                {t('toolbox.videoWorkbench.title')}
              </div>
              <div className='mt-5px max-w-760px text-14px leading-21px' style={{ color: 'var(--centaur-ink-soft)' }}>
                {t('toolbox.videoWorkbench.subtitle')}
              </div>
            </div>
          </div>
        </div>

        <div
          className='centaur-card relative w-full overflow-hidden'
          style={{ height: '78vh', minHeight: 520, padding: 0, borderRadius: 'var(--centaur-radius-sm)' }}
        >
          {videoServer.state === 'ready' ? (
            <WebviewHost
              url={VIDEO_WORKBENCH_URL}
              id='centaur-video-workbench'
              partition='persist:centaur-video-workbench'
              controlRef={videoControlRef}
              className='h-full w-full'
              style={{ height: '100%', minHeight: 520 }}
            />
          ) : (
            <div
              className='flex h-full w-full flex-col items-center justify-center gap-12px'
              style={{ minHeight: 520 }}
            >
              {videoServer.state === 'starting' ? (
                <>
                  <Spin size={28} />
                  <div className='text-14px' style={{ color: 'var(--centaur-ink-soft)' }}>
                    {t('toolbox.videoWorkbench.starting')}
                  </div>
                </>
              ) : (
                <>
                  <div className='max-w-420px text-center text-14px' style={{ color: 'var(--centaur-ink-soft)' }}>
                    {t('toolbox.videoWorkbench.startFailed')}
                  </div>
                  <Button onClick={startVideoServer}>{t('toolbox.videoWorkbench.retry')}</Button>
                </>
              )}
            </div>
          )}
          {/* Floating, collapsible AI assistant — overlays the editor, does not resize it. */}
          <VideoAgentChat control={videoControlRef} />
        </div>
      </div>
    );
  };

  return (
    <div className='centaur-brand w-full min-h-full box-border overflow-y-auto'>
      <div className='mx-auto flex w-full max-w-1280px box-border flex-col gap-20px p-24px'>
        {videoWorkbenchOpen ? (
          renderVideoWorkbench()
        ) : imageWorkbenchOpen ? (
          renderImageWorkbench()
        ) : !activeTool ? (
          <>
            <div className='flex flex-col gap-16px lg:flex-row lg:items-end lg:justify-between'>
              <div className='flex min-w-0 items-start gap-14px'>
                <div className='centaur-mark h-52px w-52px shrink-0'>{headerIcon}</div>
                <div className='min-w-0'>
                  <div className='centaur-eyebrow'>{headerEyebrow}</div>
                  <div className='mt-2px text-26px font-900 leading-32px' style={{ color: 'var(--centaur-ink)' }}>
                    {headerTitle}
                  </div>
                  <div
                    className='mt-5px max-w-680px text-14px leading-21px'
                    style={{ color: 'var(--centaur-ink-soft)' }}
                  >
                    {headerSubtitle}
                  </div>
                </div>
              </div>
              <Input
                allowClear
                className='w-full lg:!w-360px'
                value={query}
                onChange={setQuery}
                placeholder={searchPlaceholder}
                prefix={<Search size={14} fill='currentColor' />}
              />
            </div>

            <div className='grid grid-cols-1 gap-14px md:grid-cols-3'>
              {statCards.map((stat) => (
                <div
                  key={stat.label}
                  className='centaur-card p-16px'
                  style={{ borderRadius: 'var(--centaur-radius-sm)' }}
                >
                  <div className='flex items-center justify-between gap-10px'>
                    <span className='centaur-eyebrow' style={{ color: 'var(--centaur-ink-mute)' }}>
                      {stat.label}
                    </span>
                    <div
                      className='flex h-32px w-32px items-center justify-center rounded-10px'
                      style={{ background: stat.surface, color: stat.tone }}
                    >
                      {stat.icon}
                    </div>
                  </div>
                  <div className='mt-12px text-28px font-900 leading-32px' style={{ color: 'var(--centaur-ink)' }}>
                    {stat.count}
                  </div>
                </div>
              ))}
            </div>

            <div className='flex flex-wrap items-center gap-8px'>
              {categoryOptions.map((item) => {
                const active = category === item.key;
                return (
                  <Button
                    key={item.key}
                    size='small'
                    type={active ? 'primary' : 'text'}
                    className='!rounded-full !px-14px'
                    style={
                      active
                        ? { boxShadow: 'var(--centaur-shadow-clay)' }
                        : {
                            background: 'var(--centaur-card)',
                            color: 'var(--centaur-ink-soft)',
                            border: '1px solid var(--centaur-line)',
                          }
                    }
                    onClick={() => setCategory(item.key)}
                  >
                    {item.label} · {item.count}
                  </Button>
                );
              })}
            </div>

            {showImageWorkbenchCard || showVideoWorkbenchCard || filteredTools.length > 0 ? (
              <div className='grid grid-cols-1 gap-16px md:grid-cols-2 xl:grid-cols-3'>
                {showImageWorkbenchCard && (
                  <WorkbenchCard
                    title={t('toolbox.imageWorkbench.title')}
                    desc={t('toolbox.imageWorkbench.cardDesc')}
                    icon={<Picture size={24} />}
                    meta={t('toolbox.categories.image')}
                    chips={[
                      t('toolbox.tools.textToImage.title'),
                      t('toolbox.tools.imageEdit.title'),
                      t('toolbox.tools.poster.title'),
                      t('toolbox.tools.product.title'),
                    ]}
                    onOpen={openImageWorkbench}
                  />
                )}
                {showVideoWorkbenchCard && (
                  <WorkbenchCard
                    title={t('toolbox.videoWorkbench.title')}
                    desc={t('toolbox.videoWorkbench.cardDesc')}
                    icon={<EditMovie size={24} />}
                    meta={t('toolbox.videoWorkbench.category')}
                    chips={[]}
                    onOpen={openVideoWorkbench}
                  />
                )}
                {filteredTools.map((tool) => (
                  <ToolCard key={tool.id} tool={tool} onOpen={openTool} />
                ))}
              </div>
            ) : (
              <div className='centaur-card py-44px'>
                <Empty description={emptyDescription} />
              </div>
            )}
          </>
        ) : (
          <>
            <div className='centaur-card sticky top-0 z-2 p-16px' style={{ borderRadius: 'var(--centaur-radius-sm)' }}>
              <div className='flex flex-col gap-14px sm:flex-row sm:items-center sm:justify-between'>
                <div className='flex min-w-0 items-center gap-12px'>
                  <Button shape='circle' icon={<Left />} onClick={closeTool} />
                  <div
                    className='flex h-44px w-44px shrink-0 items-center justify-center rounded-14px'
                    style={{ background: 'var(--centaur-clay-tint)', color: 'var(--centaur-clay-deep)' }}
                  >
                    <ToolIcon name={activeTool.icon} size={22} />
                  </div>
                  <div className='min-w-0'>
                    <div className='truncate text-18px font-700 leading-24px' style={{ color: 'var(--centaur-ink)' }}>
                      {getToolTitle(activeTool, t)}
                    </div>
                    <div className='mt-3px truncate text-13px' style={{ color: 'var(--centaur-ink-soft)' }}>
                      {getToolDesc(activeTool, t)}
                    </div>
                  </div>
                </div>
                <span
                  className='inline-flex shrink-0 items-center rounded-8px px-9px py-2px text-12px font-500'
                  style={{ background: 'var(--centaur-bg-warm)', color: 'var(--centaur-ink-soft)' }}
                >
                  {t(`toolbox.categories.${activeTool.category}`)}
                </span>
              </div>
            </div>
            {readinessAlert}
            <div className='grid grid-cols-1 gap-20px lg:grid-cols-[400px_minmax(0,1fr)] lg:items-start'>
              <div className='w-full'>
                <ToolForm
                  tool={activeTool}
                  agents={agents}
                  running={status === 'running'}
                  disabled={!toolReady}
                  onRun={handleRun}
                />
              </div>
              <ResultPanel
                status={status}
                result={result}
                error={error}
                onOpenConversation={handleOpenConversation}
                onRegenerate={handleRegenerate}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ToolboxPage;
