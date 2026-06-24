/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Picture, Plus, Right } from '@icon-park/react';
import { Tooltip } from '@arco-design/web-react';
import classNames from 'classnames';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { cleanupSiderTooltips } from '@renderer/utils/ui/siderTooltip';
import { blurActiveElement } from '@renderer/utils/ui/focus';
import SiderItem from '../SiderItem';
import SiderWorkbenchEntry from './SiderWorkbenchEntry';

/** Opens the embedded 半人马 AI 图形工作台 (centaurai-image) directly, not the hub. */
const WORKBENCH_ROUTE = '/workbench?app=image';

type SiderTooltipProps = React.ComponentProps<typeof Tooltip>;

interface WorkbenchSiderSectionProps {
  isMobile: boolean;
  collapsed: boolean;
  pathname: string;
  siderTooltipProps: Partial<SiderTooltipProps>;
  onSessionClick?: () => void;
}

/**
 * 「AI工作台」sider section — sits just below the 智囊团 (TeamSiderSection). The
 * section header carries a ➕ that opens the embedded 半人马 AI 图形工作台; the
 * single listed entry is the same workbench. Both desktop and LAN/WebUI browsers
 * use it (the page falls back to an <iframe> in a browser).
 */
const WorkbenchSiderSection: React.FC<WorkbenchSiderSectionProps> = ({
  isMobile,
  collapsed,
  pathname,
  siderTooltipProps,
  onSessionClick,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isActive = pathname.startsWith('/workbench');

  const [expanded, setExpanded] = useState<boolean>(
    () => (localStorage.getItem('workbench-section-expanded') ?? 'true') === 'true'
  );
  useEffect(() => {
    localStorage.setItem('workbench-section-expanded', String(expanded));
  }, [expanded]);

  const openWorkbench = useCallback(() => {
    cleanupSiderTooltips();
    blurActiveElement();
    Promise.resolve(navigate(WORKBENCH_ROUTE)).catch(console.error);
    if (onSessionClick) onSessionClick();
  }, [navigate, onSessionClick]);

  if (collapsed) {
    return (
      <SiderWorkbenchEntry
        isMobile={isMobile}
        isActive={isActive}
        collapsed={collapsed}
        siderTooltipProps={siderTooltipProps as SiderTooltipProps}
        onClick={openWorkbench}
      />
    );
  }

  return (
    <div className='shrink-0 flex flex-col gap-2px'>
      <div
        className='group/label sider-section-label flex items-center px-12px h-28px select-none sticky top-0 z-10 mt-8px cursor-pointer'
        onClick={() => setExpanded((v) => !v)}
      >
        <span className='text-14px text-t-tertiary sider-section-title group-hover/label:text-t-primary transition-colors font-[500] leading-none'>
          {t('toolbox.workbench.title')}
        </span>
        <span className='ml-2px flex items-center justify-center opacity-0 group-hover/label:opacity-100 transition-opacity text-t-tertiary shrink-0'>
          <Right
            theme='outline'
            size={12}
            className={classNames('transition-transform duration-150', { 'rotate-90': expanded })}
          />
        </span>
        <Tooltip content={t('toolbox.imageWorkbench.title')} position='top'>
          <div
            className='ml-auto -mr-4px size-20px rd-4px flex items-center justify-center hover:bg-fill-4 transition-all shrink-0 cursor-pointer text-t-secondary hover:text-t-primary'
            onClick={(e) => {
              e.stopPropagation();
              openWorkbench();
            }}
          >
            <Plus
              theme='outline'
              size='14'
              fill='currentColor'
              className='block leading-none'
              style={{ lineHeight: 0 }}
            />
          </div>
        </Tooltip>
      </div>
      {expanded && (
        <SiderItem
          icon={<Picture theme='outline' size='16' fill='currentColor' />}
          name={t('toolbox.imageWorkbench.title')}
          selected={isActive}
          onClick={openWorkbench}
        />
      )}
    </div>
  );
};

export default WorkbenchSiderSection;
