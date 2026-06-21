/**
 * TypeFilterBar — 图片 / 文档 / 代码 segmented filter for the 按类型 view.
 */
import React from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import type { HubFileKind } from '../types';

type TypeFilterBarProps = {
  value: HubFileKind;
  onChange: (kind: HubFileKind) => void;
};

const KINDS: { key: HubFileKind; labelKey: string }[] = [
  { key: 'all', labelKey: 'contentHub.type.all' },
  { key: 'image', labelKey: 'contentHub.type.image' },
  { key: 'document', labelKey: 'contentHub.type.document' },
  { key: 'code', labelKey: 'contentHub.type.code' },
  { key: 'other', labelKey: 'contentHub.type.other' },
];

const TypeFilterBar: React.FC<TypeFilterBarProps> = ({ value, onChange }) => {
  const { t } = useTranslation();

  return (
    <div className='flex items-center gap-6px'>
      {KINDS.map((item) => (
        <button
          key={item.key}
          onClick={() => onChange(item.key)}
          className={classNames(
            'px-10px py-4px rd-6px text-12px cursor-pointer transition-colors',
            value === item.key ? 'bg-fill-3 text-t-primary font-[500]' : 'bg-fill-2 text-t-secondary hover:bg-fill-3'
          )}
        >
          {t(item.labelKey)}
        </button>
      ))}
    </div>
  );
};

export default TypeFilterBar;
