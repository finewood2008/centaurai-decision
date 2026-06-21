/**
 * MineSubTabs — secondary view switcher inside the 我的产物 section:
 * 全部 / 按会话 / 按类型.
 */
import React from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import type { HubMineView } from '../types';

type MineSubTabsProps = {
  active: HubMineView;
  onChange: (view: HubMineView) => void;
};

const VIEWS: { key: HubMineView; labelKey: string }[] = [
  { key: 'all', labelKey: 'contentHub.mineView.all' },
  { key: 'byConversation', labelKey: 'contentHub.mineView.byConversation' },
  { key: 'byType', labelKey: 'contentHub.mineView.byType' },
];

const MineSubTabs: React.FC<MineSubTabsProps> = ({ active, onChange }) => {
  const { t } = useTranslation();

  return (
    <div className='flex items-center gap-6px'>
      {VIEWS.map((item) => (
        <button
          key={item.key}
          onClick={() => onChange(item.key)}
          className={classNames(
            'px-10px py-4px rd-6px text-12px cursor-pointer transition-colors',
            active === item.key ? 'bg-fill-3 text-t-primary font-[500]' : 'bg-fill-2 text-t-secondary hover:bg-fill-3'
          )}
        >
          {t(item.labelKey)}
        </button>
      ))}
    </div>
  );
};

export default MineSubTabs;
