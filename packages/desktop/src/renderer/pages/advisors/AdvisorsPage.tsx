/**
 * AdvisorsPage — Full-page catalog of AI industry advisors (agency experts)
 * grouped by department. Clicking an advisor starts a new conversation.
 */
import React, { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import { useAssistantList } from '@/renderer/hooks/assistant';
import { groupAgencyByCategory } from '@/renderer/pages/settings/AssistantSettings/assistantUtils';
import {
  DEFAULT_SME_DEPARTMENT,
  orderSmeDepartments,
  resolveAgencyCategoryKey,
  resolveExpertDepartment,
} from '@/renderer/pages/settings/AssistantSettings/advisorTaxonomy';
import AssistantAvatar from '@/renderer/pages/settings/AssistantSettings/AssistantAvatar';
import type { AssistantListItem } from '@/renderer/pages/settings/AssistantSettings/types';
import { Button, Empty, Input } from '@arco-design/web-react';
import { CheckOne, CloseSmall, Peoples, Search } from '@icon-park/react';
import { useState } from 'react';

const ALL_DEPARTMENTS = '__all__';

const ROLE_TOKEN_NAMES: Record<string, string> = {
  account: '客户',
  analyst: '分析',
  architect: '架构',
  automation: '自动化',
  brand: '品牌',
  business: '业务',
  cloud: '云平台',
  content: '内容',
  conversion: '转化',
  copywriter: '文案',
  creative: '创意',
  data: '数据',
  database: '数据库',
  designer: '设计',
  developer: '开发',
  devops: '运维',
  engineer: '工程',
  frontend: '前端',
  growth: '增长',
  lifecycle: '生命周期',
  manager: '管理',
  marketing: '营销',
  media: '媒体',
  operations: '运营',
  performance: '效果',
  planner: '规划',
  product: '产品',
  qa: '质量',
  research: '研究',
  researcher: '研究',
  sales: '销售',
  security: '安全',
  seo: 'SEO',
  social: '社媒',
  strategist: '策略',
  strategy: '战略',
  success: '成功',
  support: '支持',
  test: '测试',
  tester: '测试',
  ux: '体验',
  writer: '写作',
};

function buildChineseAdvisorDescription(advisor: AssistantListItem): string {
  const categoryKey = resolveAgencyCategoryKey(advisor.id);
  const department = resolveExpertDepartment(advisor.id) ?? '行业';
  const roleTokens = advisor.id
    .replace(/^agency-/, '')
    .split('-')
    .filter((token) => token !== categoryKey && !categoryKey?.split('-').includes(token))
    .map((token) => ROLE_TOKEN_NAMES[token])
    .filter(Boolean);
  const role = roleTokens.length > 0 ? roleTokens.join('') : '专业';
  return `${department}${role}专家，提供问题诊断、方案建议与落地路径。`;
}

function hasCjkText(value: string | undefined): boolean {
  return Boolean(value && /[\u3400-\u9fff]/.test(value));
}

function getAdvisorDisplayText(advisor: AssistantListItem, localeKey: string): { name: string; desc: string } {
  const name = advisor.name_i18n?.[localeKey] || advisor.name_i18n?.['zh-CN'] || advisor.name;
  const localizedDesc = advisor.description_i18n?.[localeKey] || advisor.description_i18n?.['zh-CN'];
  if (localeKey.startsWith('zh')) {
    return { name, desc: hasCjkText(localizedDesc) ? localizedDesc! : buildChineseAdvisorDescription(advisor) };
  }
  return {
    name,
    desc:
      localizedDesc ||
      advisor.description_i18n?.['en-US'] ||
      advisor.description ||
      buildChineseAdvisorDescription(advisor),
  };
}

const AdvisorsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { assistants: fullAssistants } = useAssistantList();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [activeDepartment, setActiveDepartment] = useState<string>(DEFAULT_SME_DEPARTMENT);

  const localeKey = useMemo(() => {
    const lang = i18n.language;
    if (lang.startsWith('zh')) return 'zh-CN';
    if (lang.startsWith('en')) return 'en-US';
    return 'zh-CN';
  }, [i18n.language]);

  const advisors = useMemo(() => fullAssistants.filter((a) => a.id.startsWith('agency-')), [fullAssistants]);
  // Only enabled experts are surfaced in the catalog. Experts toggled off in
  // settings are hidden entirely; a category whose experts are all disabled
  // drops out of the department tabs (groupAgencyByCategory omits empty groups).
  const enabledAdvisors = useMemo(() => advisors.filter((a) => a.enabled !== false), [advisors]);

  const allAgencyGroups = useMemo(() => groupAgencyByCategory(enabledAdvisors), [enabledAdvisors]);
  const departmentNames = useMemo(() => orderSmeDepartments(Object.keys(allAgencyGroups)), [allAgencyGroups]);

  // If the active department vanished (all its experts were disabled), fall
  // back to the "all" tab so the user isn't left on an empty, unhighlighted tab.
  useEffect(() => {
    if (activeDepartment === ALL_DEPARTMENTS) return;
    if (!departmentNames.includes(activeDepartment)) setActiveDepartment(ALL_DEPARTMENTS);
  }, [departmentNames, activeDepartment]);

  const filteredAdvisors = useMemo(() => {
    const source = activeDepartment === ALL_DEPARTMENTS ? enabledAdvisors : (allAgencyGroups[activeDepartment] ?? []);
    if (!searchQuery.trim()) return source;
    const q = searchQuery.trim().toLowerCase();
    return source.filter((a) => {
      const { name, desc } = getAdvisorDisplayText(a, localeKey);
      return (name + ' ' + desc).toLowerCase().includes(q);
    });
  }, [activeDepartment, enabledAdvisors, allAgencyGroups, searchQuery, localeKey]);

  const agencyGroups = useMemo(() => groupAgencyByCategory(filteredAdvisors), [filteredAdvisors]);

  const isSearchVisible = searchExpanded || searchQuery.length > 0;

  const handleSelectAdvisor = (advisor: AssistantListItem) => {
    navigate('/guid', {
      state: {
        preselectAssistantKey: `custom:${advisor.id}`,
      },
    });
  };

  const renderCard = (advisor: AssistantListItem) => {
    const { name, desc } = getAdvisorDisplayText(advisor, localeKey);
    return (
      <div
        key={advisor.id}
        data-testid={`advisor-card-${advisor.id}`}
        className='centaur-card centaur-liftable group relative box-border flex h-140px w-full cursor-pointer flex-col items-center overflow-hidden px-12px pt-16px pb-12px'
        style={{ borderRadius: 'var(--centaur-radius-sm)' }}
        onClick={() => handleSelectAdvisor(advisor)}
      >
        <div className='centaur-rail absolute left-0 top-0 h-3px w-full opacity-0 transition-opacity group-hover:opacity-100' />
        {/* Avatar — fixed-height row so names line up across all cards */}
        <div className='relative flex h-44px w-44px shrink-0 items-center justify-center'>
          <AssistantAvatar assistant={advisor} avatarImageMap={{}} size={44} />
        </div>
        {/* Name — single line, fixed height */}
        <div
          className='mt-8px h-20px w-full truncate text-center text-14px font-700 leading-20px'
          style={{ color: 'var(--centaur-ink)' }}
        >
          {name}
        </div>
        {/* Description — fixed 2-line height */}
        <div
          className='mt-4px h-32px w-full overflow-hidden break-words text-center text-12px leading-16px line-clamp-2'
          style={{ color: 'var(--centaur-ink-mute)' }}
        >
          {desc}
        </div>
      </div>
    );
  };

  const renderDeptSection = (title: string, deptAdvisors: AssistantListItem[]) => {
    if (deptAdvisors.length === 0) return null;
    return (
      <section key={title} className='space-y-12px'>
        <div
          className='sticky top-0 z-10 flex items-center gap-10px py-8px'
          style={{ background: 'var(--centaur-bg)' }}
        >
          <span className='h-14px w-3px shrink-0 rounded-full' style={{ background: 'var(--centaur-clay)' }} />
          <div className='text-15px font-700' style={{ color: 'var(--centaur-ink)' }}>
            {title}
          </div>
          <span
            className='inline-flex items-center rounded-full px-8px py-1px text-11px font-500'
            style={{ background: 'var(--centaur-gold-tint)', color: 'var(--centaur-gold-deep)' }}
          >
            {deptAdvisors.length}
          </span>
          <div className='h-1px flex-1' style={{ background: 'var(--centaur-line)' }} />
        </div>
        <div className='grid grid-cols-2 gap-14px md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6'>
          {deptAdvisors.map(renderCard)}
        </div>
      </section>
    );
  };

  const groupNames = Object.keys(agencyGroups);

  const statPills: Array<{ key: string; label: string; icon?: React.ReactNode }> = [
    { key: 'departments', label: t('advisors.stats.departments', { count: departmentNames.length }) },
    {
      key: 'enabled',
      label: t('advisors.stats.enabled', { count: enabledAdvisors.length }),
      icon: <CheckOne size={12} fill='currentColor' />,
    },
  ];

  return (
    <div className='centaur-brand size-full flex flex-col'>
      <div className='shrink-0 px-24px pt-24px pb-14px'>
        <div className='centaur-card px-20px py-18px'>
          <div className='flex flex-col gap-16px lg:flex-row lg:items-end lg:justify-between'>
            <div className='flex min-w-0 items-start gap-14px'>
              <div className='centaur-mark h-52px w-52px shrink-0'>
                <Peoples size={26} />
              </div>
              <div className='min-w-0'>
                <div className='centaur-eyebrow'>CENTAUR · ADVISORS</div>
                <h1 className='centaur-title m-0 mt-2px text-26px leading-32px' style={{ color: 'var(--centaur-ink)' }}>
                  {t('advisors.title')}
                </h1>
                <p
                  className='m-0 mt-5px max-w-680px text-14px leading-21px'
                  style={{ color: 'var(--centaur-ink-soft)' }}
                >
                  {t('advisors.subtitle')}
                </p>
                <div className='mt-12px flex flex-wrap items-center gap-8px'>
                  {statPills.map((pill) => (
                    <span
                      key={pill.key}
                      className='inline-flex items-center gap-4px rounded-full px-10px py-3px text-12px font-500'
                      style={{ background: 'var(--centaur-bg-warm)', color: 'var(--centaur-ink-soft)' }}
                    >
                      {pill.icon}
                      {pill.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className='flex items-center gap-10px'>
              {isSearchVisible && (
                <Input
                  allowClear
                  autoFocus
                  value={searchQuery}
                  onChange={setSearchQuery}
                  className='!w-260px'
                  placeholder={t('advisors.searchPlaceholder')}
                  prefix={<Search size={14} fill='currentColor' />}
                />
              )}
              <Button
                type={isSearchVisible ? 'secondary' : 'text'}
                size='small'
                className='!rounded-10px !h-34px !w-34px !p-0 flex items-center justify-center'
                style={{ background: 'var(--centaur-bg-warm)', color: 'var(--centaur-ink-soft)' }}
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
        </div>
        <div className='mt-14px flex gap-8px overflow-x-auto pb-2px'>
          {[
            { key: ALL_DEPARTMENTS, label: t('advisors.departments.all'), count: enabledAdvisors.length },
            ...departmentNames.map((name) => ({ key: name, label: name, count: allAgencyGroups[name]?.length ?? 0 })),
          ].map((dept) => {
            const active = activeDepartment === dept.key;
            return (
              <Button
                key={dept.key}
                type={active ? 'primary' : 'text'}
                size='small'
                className='!rounded-full shrink-0 !px-14px'
                style={
                  active
                    ? { boxShadow: 'var(--centaur-shadow-clay)' }
                    : {
                        background: 'var(--centaur-card)',
                        color: 'var(--centaur-ink-soft)',
                        border: '1px solid var(--centaur-line)',
                      }
                }
                onClick={() => setActiveDepartment(dept.key)}
              >
                {dept.label} · {dept.count}
              </Button>
            );
          })}
        </div>
      </div>

      <AionScrollArea className='flex-1 min-h-0 px-24px pb-24px'>
        {groupNames.length > 0 ? (
          <div className='space-y-24px'>{groupNames.map((name) => renderDeptSection(name, agencyGroups[name]))}</div>
        ) : (
          <div className='centaur-card py-44px'>
            <Empty description={advisors.length > 0 ? t('advisors.emptySearch') : t('advisors.empty')} />
          </div>
        )}
      </AionScrollArea>
    </div>
  );
};

export default AdvisorsPage;
