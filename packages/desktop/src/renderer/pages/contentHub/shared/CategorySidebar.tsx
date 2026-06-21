/**
 * CategorySidebar — "全员可见 + 按分类" navigation for the shared library.
 */
import React from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import type { SharedCategoryEntry } from '@/common/adapter/ipcBridge';

type CategorySidebarProps = {
  categories: SharedCategoryEntry[];
  total: number;
  selected: string | undefined;
  onSelect: (key: string | undefined) => void;
};

const Row: React.FC<{ active: boolean; label: string; count: number; onClick: () => void }> = ({
  active,
  label,
  count,
  onClick,
}) => (
  <div
    onClick={onClick}
    className={classNames(
      'flex items-center justify-between px-10px py-6px rd-6px text-13px cursor-pointer transition-colors',
      active ? 'bg-fill-3 text-t-primary font-[500]' : 'text-t-secondary hover:bg-fill-2'
    )}
  >
    <span className='truncate'>{label}</span>
    <span className='text-11px text-t-secondary ml-8px'>{count}</span>
  </div>
);

const CategorySidebar: React.FC<CategorySidebarProps> = ({ categories, total, selected, onSelect }) => {
  const { t } = useTranslation();

  return (
    <div className='w-160px shrink-0 border-r border-[var(--color-border-2)] p-8px overflow-y-auto'>
      <div className='text-11px text-t-secondary px-10px py-4px'>{t('contentHub.shared.categories')}</div>
      <Row
        active={selected == null}
        label={t('contentHub.shared.all')}
        count={total}
        onClick={() => onSelect(undefined)}
      />
      {categories.map((c) => (
        <Row
          key={c.key}
          active={selected === c.key}
          label={c.label || t('contentHub.shared.uncategorized')}
          count={c.count}
          onClick={() => onSelect(c.key)}
        />
      ))}
    </div>
  );
};

export default CategorySidebar;
