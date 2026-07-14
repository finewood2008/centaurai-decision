/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import classNames from 'classnames';
import React from 'react';
import { useLocation } from 'react-router-dom';
import { usePreviewContext } from '../context/PreviewContext';
import PreviewPanel from './PreviewPanel/PreviewPanel';

type PreviewHostProps = {
  mode?: 'floating' | 'inline';
  className?: string;
  panelClassName?: string;
  style?: React.CSSProperties;
  dragHandle?: React.ReactNode;
  /** Floating host should not duplicate the conversation layout's inline host. */
  excludeConversationRoutes?: boolean;
};

function isConversationPreviewRoute(pathname: string): boolean {
  return (
    pathname === '/conversation' ||
    pathname.startsWith('/conversation/') ||
    pathname === '/team' ||
    pathname.startsWith('/team/')
  );
}

const PreviewHost: React.FC<PreviewHostProps> = ({
  mode = 'floating',
  className,
  panelClassName,
  style,
  dragHandle,
  excludeConversationRoutes = false,
}) => {
  const { isOpen } = usePreviewContext();
  const layout = useLayoutContext();
  const { pathname } = useLocation();

  if (!isOpen) return null;
  if (excludeConversationRoutes && isConversationPreviewRoute(pathname)) return null;

  if (mode === 'inline') {
    return (
      <div className={className} style={style}>
        {dragHandle}
        <div className={panelClassName ?? 'h-full w-full overflow-hidden rounded-[15px]'}>
          <PreviewPanel />
        </div>
      </div>
    );
  }

  const isMobile = Boolean(layout?.isMobile);

  return (
    <aside
      className={classNames(
        'fixed z-30 rounded-[16px] border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-1)] shadow-[0_18px_60px_rgba(15,23,42,0.18)] p-8px',
        isMobile ? 'left-8px right-8px top-8px bottom-8px' : 'right-12px top-12px bottom-12px max-w-[calc(100vw-24px)]',
        className
      )}
      style={
        isMobile
          ? style
          : {
              width: 'min(720px, max(360px, 44vw), calc(100vw - 24px))',
              ...style,
            }
      }
    >
      <div className={panelClassName ?? 'h-full min-h-0 overflow-hidden rounded-[15px]'}>
        <PreviewPanel />
      </div>
    </aside>
  );
};

export default PreviewHost;
