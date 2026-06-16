/**
 * HubTabBar — top-level dimension switcher for the Content Hub.
 */
import React from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import type { HubTab } from '../types';

type HubTabBarProps = {
  active: HubTab;
  onChange: (tab: HubTab) => void;
};

const TABS: { key: HubTab; labelKey: string }[] = [
  { key: 'mine', labelKey: 'contentHub.tabs.mine' },
  { key: 'byConversation', labelKey: 'contentHub.tabs.byConversation' },
  { key: 'byType', labelKey: 'contentHub.tabs.byType' },
  { key: 'shared', labelKey: 'contentHub.tabs.shared' },
];

const HubTabBar: React.FC<HubTabBarProps> = ({ active, onChange }) => {
  const { t } = useTranslation();

  return (
    <div className='flex items-center gap-4px px-16px pt-12px shrink-0'>
      {TABS.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={classNames(
            'px-12px py-6px rd-8px text-13px cursor-pointer transition-colors',
            active === tab.key
              ? 'bg-fill-3 text-t-primary font-[500]'
              : 'text-t-secondary hover:bg-fill-2 hover:text-t-primary'
          )}
        >
          {t(tab.labelKey)}
        </button>
      ))}
    </div>
  );
};

export default HubTabBar;
