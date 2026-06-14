/**
 * ExpertListPanel — Renders agency experts grouped by department with
 * enable/disable toggles and edit buttons.
 */
import {
  groupAgencyByCategory,
  resolveAvatarImageSrc,
  type AssistantListFilter,
} from '@/renderer/pages/settings/AssistantSettings/assistantUtils';
import type { AssistantListItem } from '@/renderer/pages/settings/AssistantSettings/types';
import AssistantAvatar from '@/renderer/pages/settings/AssistantSettings/AssistantAvatar';
import { Button, Input, Switch } from '@arco-design/web-react';
import { Search, SettingOne, CloseSmall } from '@icon-park/react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

type ExpertListPanelProps = {
  assistants: AssistantListItem[];
  localeKey: string;
  onEdit: (assistant: AssistantListItem) => void;
  onToggleEnabled: (assistant: AssistantListItem, checked: boolean) => void;
};

const ExpertListPanel: React.FC<ExpertListPanelProps> = ({ assistants, localeKey, onEdit, onToggleEnabled }) => {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchExpanded, setSearchExpanded] = useState(false);

  const filteredAssistants = useMemo(() => {
    if (!searchQuery.trim()) return assistants;
    const q = searchQuery.trim().toLowerCase();
    return assistants.filter((a) => {
      const name = a.name_i18n?.[localeKey] || a.name;
      const desc = a.description_i18n?.[localeKey] || a.description || '';
      return (name + ' ' + desc).toLowerCase().includes(q);
    });
  }, [assistants, searchQuery, localeKey]);

  const agencyGroups = useMemo(() => groupAgencyByCategory(filteredAssistants), [filteredAssistants]);

  const isSearchVisible = searchExpanded || searchQuery.length > 0;

  const renderCard = (assistant: AssistantListItem) => {
    const zhName = assistant.name_i18n?.['zh-CN'] || assistant.name;
    return (
      <div
        key={assistant.id}
        data-testid={`expert-card-${assistant.id}`}
        className='group border border-solid rounded-16px px-16px py-14px flex items-center justify-between cursor-pointer transition-all duration-180 hover:border-[var(--color-primary-light-4)] hover:bg-bg-1 border-[var(--color-neutral-3)] bg-fill-0'
        onClick={() => onEdit(assistant)}
      >
        <div className='flex items-center gap-12px min-w-0 flex-1'>
          <AssistantAvatar assistant={assistant} avatarImageMap={{}} size={36} />
          <div className='min-w-0 flex-1'>
            <div className='flex items-center gap-6px'>
              <span className='text-14px font-medium text-t-primary truncate'>{zhName}</span>
            </div>
            <div className='text-12px text-t-tertiary truncate mt-2px'>
              {assistant.description_i18n?.[localeKey] || assistant.description || assistant.name}
            </div>
          </div>
        </div>
        <div className='flex items-center gap-8px flex-shrink-0 ml-12px'>
          <Switch
            size='small'
            checked={assistant.enabled !== false}
            onChange={(checked) => onToggleEnabled(assistant, checked)}
            onClick={(e) => e.stopPropagation()}
            data-testid={`switch-expert-${assistant.id}`}
          />
          <Button
            type='text'
            size='small'
            icon={<SettingOne size={16} />}
            onClick={(e) => {
              e.stopPropagation();
              onEdit(assistant);
            }}
            className='!text-t-tertiary hover:!text-t-primary'
          />
        </div>
      </div>
    );
  };

  const renderDeptSection = (title: string, deptAssistants: AssistantListItem[]) => {
    if (deptAssistants.length === 0) return null;
    const allEnabled = deptAssistants.every((a) => a.enabled !== false);
    return (
      <div key={title} className='space-y-12px'>
        <div className='flex items-center justify-between px-4px'>
          <div className='flex items-center gap-8px text-13px font-medium text-t-secondary'>
            {title}
            <span className='text-t-tertiary'>({deptAssistants.length})</span>
          </div>
          <Button
            size='mini'
            type='outline'
            onClick={() => deptAssistants.forEach((a) => onToggleEnabled(a, !allEnabled))}
          >
            {allEnabled ? '全部停用' : '全部启用'}
          </Button>
        </div>
        <div className='space-y-12px'>{deptAssistants.map(renderCard)}</div>
      </div>
    );
  };

  const groupNames = Object.keys(agencyGroups);

  return (
    <div className='py-2'>
      <div className='bg-fill-2 rounded-24px p-20px'>
        <div className='flex flex-col gap-14px mb-20px'>
          <div className='flex gap-12px items-start justify-between'>
            <div className='min-w-0'>
              <h2 className='m-0 text-28px font-700 leading-[1.1] text-t-primary'>专家</h2>
            </div>
          </div>
          <div className='flex gap-12px items-end justify-between'>
            <div className='min-w-0 max-w-[760px] space-y-6px'>
              <p className='m-0 text-14px text-t-secondary leading-relaxed'>
                管理各领域专业专家，按部门分组。启用后可在主页「专家」tab 中使用，提供专业知识问答。
              </p>
            </div>
            <div className='flex items-center gap-10px text-12px text-t-tertiary'>
              <Button
                type={isSearchVisible ? 'secondary' : 'text'}
                size='small'
                data-testid='btn-expert-search-toggle'
                className='!rounded-10px !h-34px !w-34px !p-0 flex items-center justify-center !text-t-secondary hover:!bg-fill-1 hover:!text-t-primary'
                icon={
                  isSearchVisible ? (
                    <CloseSmall size={16} fill='currentColor' />
                  ) : (
                    <Search size={16} fill='currentColor' />
                  )
                }
                onClick={() => {
                  if (isSearchVisible) {
                    setSearchExpanded(false);
                    setSearchQuery('');
                    return;
                  }
                  setSearchExpanded(true);
                }}
              />
            </div>
          </div>
          {isSearchVisible && (
            <Input
              allowClear
              autoFocus
              value={searchQuery}
              onChange={setSearchQuery}
              data-testid='input-expert-search'
              className='!bg-[var(--color-bg-2)]'
              placeholder='搜索专家...'
              prefix={<Search size={14} fill='currentColor' />}
            />
          )}
          <div className='text-13px text-t-tertiary'>
            共 {groupNames.length} 个部门，{assistants.length} 位专家
            {filteredAssistants.length !== assistants.length && <span>（筛选后 {filteredAssistants.length} 位）</span>}
          </div>
        </div>

        {groupNames.length > 0 ? (
          <div className='space-y-20px'>{groupNames.map((name) => renderDeptSection(name, agencyGroups[name]))}</div>
        ) : (
          <div className='text-center text-t-secondary py-12px'>暂无导入的专家。请在终端运行导入脚本添加。</div>
        )}
      </div>
    </div>
  );
};

export default ExpertListPanel;
