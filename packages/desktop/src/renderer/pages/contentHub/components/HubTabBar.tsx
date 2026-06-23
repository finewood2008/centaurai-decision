/**
 * HubTabBar — top-level section switcher: 我的产物 / 共享库 / 知识库.
 */
import React from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import type { HubSection } from '../types';

type HubTabBarProps = {
  active: HubSection;
  onChange: (section: HubSection) => void;
};

const SECTIONS: { key: HubSection; labelKey: string }[] = [
  { key: 'mine', labelKey: 'contentHub.tabs.mine' },
  { key: 'shared', labelKey: 'contentHub.tabs.shared' },
  { key: 'nas', labelKey: 'contentHub.tabs.nas' },
  { key: 'knowledge', labelKey: 'contentHub.tabs.knowledge' },
];

const HubTabBar: React.FC<HubTabBarProps> = ({ active, onChange }) => {
  const { t } = useTranslation();

  return (
    <div className='flex items-center gap-4px px-16px pt-12px shrink-0'>
      {SECTIONS.map((section) => (
        <button
          key={section.key}
          onClick={() => onChange(section.key)}
          className={classNames(
            'px-12px py-6px rd-8px text-13px cursor-pointer transition-colors',
            active === section.key
              ? 'bg-fill-3 text-t-primary font-[500]'
              : 'text-t-secondary hover:bg-fill-2 hover:text-t-primary'
          )}
        >
          {t(section.labelKey)}
        </button>
      ))}
    </div>
  );
};

export default HubTabBar;
