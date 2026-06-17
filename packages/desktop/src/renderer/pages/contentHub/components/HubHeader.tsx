/**
 * HubHeader — Content Hub page header: back button, title, count, search box.
 */
import React from 'react';
import { Input } from '@arco-design/web-react';
import { ArrowLeft, Search } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

type HubHeaderProps = {
  count: number;
  search: string;
  onSearchChange: (value: string) => void;
};

const HubHeader: React.FC<HubHeaderProps> = ({ count, search, onSearchChange }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className='flex items-center gap-12px px-20px py-14px border-b border-[var(--color-border-2)] shrink-0'>
      <button onClick={() => navigate(-1)} className='p-4px cursor-pointer text-t-secondary hover:text-t-primary'>
        <ArrowLeft size='18' />
      </button>
      <span className='text-16px font-semibold'>{t('contentHub.title')}</span>
      <span className='text-12px text-t-secondary'>({count})</span>
      <div className='flex-1' />
      <Input
        prefix={<Search size='14' />}
        placeholder={t('contentHub.search.placeholder')}
        value={search}
        onChange={onSearchChange}
        size='small'
        style={{ width: 200 }}
        allowClear
      />
    </div>
  );
};

export default HubHeader;
