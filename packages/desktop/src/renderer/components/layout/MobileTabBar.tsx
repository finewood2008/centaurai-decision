/**
 * @license
 * Copyright 2025 CentaurAI (centaurai.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useLayoutContext } from '@renderer/hooks/context/LayoutContext';
import { cleanupSiderTooltips } from '@renderer/utils/ui/siderTooltip';
import { blurActiveElement } from '@renderer/utils/ui/focus';
import classNames from 'classnames';
import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import styles from './MobileTabBar.module.css';

// Icon components — inline SVGs to avoid extra dependencies
const ChatIcon: React.FC<{ active: boolean }> = ({ active: _active }) => (
  <svg
    width='24'
    height='24'
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth='2'
    strokeLinecap='round'
    strokeLinejoin='round'
  >
    <path d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' />
  </svg>
);

const ScheduledIcon: React.FC<{ active: boolean }> = ({ active: _active }) => (
  <svg
    width='24'
    height='24'
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth='2'
    strokeLinecap='round'
    strokeLinejoin='round'
  >
    <circle cx='12' cy='12' r='10' />
    <polyline points='12 6 12 12 16 14' />
  </svg>
);

const WorkbenchIcon: React.FC<{ active: boolean }> = ({ active: _active }) => (
  <svg
    width='24'
    height='24'
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth='2'
    strokeLinecap='round'
    strokeLinejoin='round'
  >
    <rect x='3' y='7' width='18' height='13' rx='2' />
    <path d='M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' />
    <path d='M3 13h18' />
    <path d='M12 12v2' />
  </svg>
);

const SettingsIcon: React.FC<{ active: boolean }> = ({ active: _active }) => (
  <svg
    width='24'
    height='24'
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth='2'
    strokeLinecap='round'
    strokeLinejoin='round'
  >
    <circle cx='12' cy='12' r='3' />
    <path d='M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' />
  </svg>
);

interface TabDef {
  key: string;
  label: string;
  icon: React.FC<{ active: boolean }>;
  path: string;
}

const tabs: TabDef[] = [
  { key: 'chat', label: 'Chat', icon: ChatIcon, path: '/guid' },
  { key: 'scheduled', label: 'Tasks', icon: ScheduledIcon, path: '/scheduled' },
  { key: 'appstore', label: 'Apps', icon: WorkbenchIcon, path: '/appstore' },
  { key: 'settings', label: 'Settings', icon: SettingsIcon, path: '/settings/model' },
];

const MobileTabBar: React.FC = () => {
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const siderCollapsed = layout?.siderCollapsed ?? true;
  const setSiderCollapsed = layout?.setSiderCollapsed;
  const location = useLocation();
  const navigate = useNavigate();

  if (!isMobile) return null;

  const getActiveKey = (): string => {
    if (location.pathname.startsWith('/scheduled')) return 'scheduled';
    if (
      location.pathname.startsWith('/appstore') ||
      location.pathname.startsWith('/workbench') ||
      location.pathname.startsWith('/toolbox')
    )
      return 'appstore';
    if (location.pathname.startsWith('/settings')) return 'settings';
    // chat covers /guid, /conversation, /team
    return 'chat';
  };

  const activeKey = getActiveKey();

  const handleTabPress = (tab: TabDef) => {
    cleanupSiderTooltips();
    blurActiveElement();

    // If the side sider is open, close it
    if (!siderCollapsed && setSiderCollapsed) {
      setSiderCollapsed(true);
    }

    // Navigate to the tab path
    navigate(tab.path);
  };

  return (
    <nav
      className={styles.tabBar}
      style={{
        paddingBottom: `env(safe-area-inset-bottom, 8px)`,
      }}
    >
      {tabs.map((tab) => {
        const isActive = activeKey === tab.key;
        const Icon = tab.icon;
        return (
          <button
            key={tab.key}
            type='button'
            className={classNames(styles.tab, isActive && styles.tabActive)}
            onClick={() => handleTabPress(tab)}
            aria-label={tab.label}
            aria-current={isActive ? 'page' : undefined}
          >
            <Icon active={isActive} />
            <span className={styles.label}>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
};

export default MobileTabBar;
