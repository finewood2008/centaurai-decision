import React from 'react';
import { Button } from '@arco-design/web-react';
import { Book, Inbox, Local, ArrowLeft } from '@icon-park/react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { PersonalWorkspaceView } from '../../types';

type Props = {
  active: PersonalWorkspaceView;
  counts: Record<PersonalWorkspaceView, number>;
  onChange: (view: PersonalWorkspaceView) => void;
};

const ITEMS: Array<{ key: PersonalWorkspaceView; icon: React.ReactNode }> = [
  { key: 'drafts', icon: <Inbox size={17} /> },
  { key: 'assets', icon: <Local size={17} /> },
  { key: 'knowledge', icon: <Book size={17} /> },
];

const PersonalWorkspaceSidebar: React.FC<Props> = ({ active, counts, onChange }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <aside className='w-220px shrink-0 border-r border-r-solid border-r-[var(--color-border-2)] bg-[var(--color-fill-1)] flex flex-col min-h-0'>
      <div className='px-14px py-14px border-b border-b-solid border-b-[var(--color-border-2)] flex items-center gap-8px'>
        <Button
          type='text'
          size='mini'
          icon={<ArrowLeft size={17} />}
          onClick={() => navigate(-1)}
          aria-label={t('contentHub.actions.back')}
        />
        <span className='centaur-title centaur-title-sm truncate'>{t('contentHub.workspace.title')}</span>
      </div>
      <nav className='flex-1 overflow-y-auto p-8px'>
        {ITEMS.map((item) => (
          <Button
            key={item.key}
            type='text'
            long
            onClick={() => onChange(item.key)}
            className={classNames(
              '!h-40px !justify-start !px-10px rd-8px mb-3px',
              active === item.key ? '!bg-[var(--color-fill-3)] !text-t-primary font-[500]' : '!text-t-secondary'
            )}
          >
            <span className='flex w-full items-center gap-9px'>
              {item.icon}
              <span>{t(`contentHub.workspace.${item.key}`)}</span>
              <span className='ml-auto text-11px text-t-tertiary'>{counts[item.key]}</span>
            </span>
          </Button>
        ))}
      </nav>
    </aside>
  );
};

export default PersonalWorkspaceSidebar;
