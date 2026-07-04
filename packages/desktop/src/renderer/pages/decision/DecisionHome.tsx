/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * DecisionHome — the landing shell for the `decision` build target.
 *
 * A boss-facing "决策作战室" home: a greeting, a prominent "发起决策会议" CTA, the
 * decisions currently in progress (existing 智囊团 sessions), an intelligence inbox
 * placeholder (LAN relay from the Team edition arrives in a later phase), and quick
 * stats for the decision archive + advisory council. Every action funnels the boss
 * into the war-room (the existing /team/:id meeting view).
 *
 * Only mounted in the Decision edition (gated in Router by IS_DECISION).
 */
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Empty, Input } from '@arco-design/web-react';
import {
  Analysis,
  Audit,
  Checklist,
  Command,
  Crown,
  FileText,
  Lightning,
  Peoples,
  Radar,
  Right,
  Scale,
  Share,
  Target,
  Workbench,
  Robot,
} from '@icon-park/react';
import TeamCreateModal from '@renderer/pages/team/components/TeamCreateModal';
import { useTeamList } from '@renderer/pages/team/hooks/useTeamList';
import { useAssistantList } from '@/renderer/hooks/assistant';
import type { TTeam } from '@/common/types/team/teamTypes';
import styles from './DecisionHome.module.css';

function greetingSlot(): 'morning' | 'afternoon' | 'evening' | 'night' {
  const hour = new Date().getHours();
  if (hour < 6) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

const SUGGESTION_KEYS = ['market', 'product', 'budget', 'crisis'] as const;
const COUNCIL_SEATS = [
  { key: 'strategy', icon: Command },
  { key: 'growth', icon: Target },
  { key: 'risk', icon: Audit },
  { key: 'finance', icon: Scale },
  { key: 'market', icon: Radar },
  { key: 'synthesis', icon: Analysis },
] as const;
const FEED_ITEMS = [
  { key: 'marketSignal', source: 'workbench', icon: Workbench, tone: 'team' },
  { key: 'salesDigest', source: 'agent', icon: Robot, tone: 'agent' },
  { key: 'riskAlert', source: 'automation', icon: Lightning, tone: 'automation' },
] as const;

const DecisionHome: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { teams } = useTeamList();
  const { assistants } = useAssistantList();
  const [createVisible, setCreateVisible] = useState(false);
  const [decisionDraft, setDecisionDraft] = useState('');
  const [createInitialName, setCreateInitialName] = useState('');

  const greeting = t(`decision.greeting.${greetingSlot()}`);

  const advisorCount = useMemo(
    () => assistants.filter((a) => a.id.startsWith('agency-') && a.enabled !== false).length,
    [assistants]
  );

  const sortedTeams = useMemo(() => teams.toSorted((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0)), [teams]);
  const recent = sortedTeams.slice(0, 5);

  const openTeam = (id: string) => {
    Promise.resolve(navigate(`/team/${id}`)).catch(console.error);
  };

  const startDecision = (initialName?: string) => {
    const next = (initialName ?? decisionDraft).trim();
    setCreateInitialName(next);
    setCreateVisible(true);
  };

  const handleCreated = (team: TTeam) => {
    setCreateVisible(false);
    setDecisionDraft('');
    setCreateInitialName('');
    openTeam(team.id);
  };

  return (
    <div className={`centaur-brand ${styles.root}`}>
      <section className={styles.hero}>
        <div className={styles.heroMain}>
          <div className={styles.eyebrowRow}>
            <span className='centaur-mark'>
              <Crown theme='outline' size='14' fill='currentColor' />
            </span>
            <span className={styles.eyebrow}>{t('decision.hero.eyebrow')}</span>
          </div>
          <h1 className={styles.heroTitle}>{t('decision.hero.title')}</h1>
          <p className={styles.heroSubtitle}>{t('decision.hero.subtitle')}</p>

          <div className={styles.commandPanel}>
            <div className={styles.commandHead}>
              <div>
                <div className={styles.commandLabel}>{greeting}</div>
                <div className={styles.commandTitle}>{t('decision.hero.commandTitle')}</div>
              </div>
              <span className={styles.commandStatus}>{t('decision.hero.commandStatus')}</span>
            </div>
            <Input.TextArea
              value={decisionDraft}
              onChange={setDecisionDraft}
              autoSize={{ minRows: 2, maxRows: 4 }}
              className={styles.commandInput}
              placeholder={t('decision.hero.placeholder')}
            />
            <div className={styles.commandActions}>
              <div className={styles.commandHint}>{t('decision.hero.commandHint')}</div>
              <Button
                type='primary'
                size='large'
                icon={<Crown theme='outline' size='16' fill='currentColor' />}
                onClick={() => startDecision()}
              >
                {t('decision.hero.cta')}
              </Button>
            </div>
          </div>

          <div className={styles.suggestions}>
            {SUGGESTION_KEYS.map((key) => (
              <Button
                key={key}
                type='outline'
                className={styles.suggestion}
                onClick={() => startDecision(t(`decision.hero.examples.${key}`))}
              >
                {t(`decision.hero.examples.${key}`)}
              </Button>
            ))}
          </div>
        </div>

        <aside className={styles.councilPanel}>
          <div className={styles.councilTop}>
            <div>
              <div className={styles.councilLabel}>{t('decision.council.title')}</div>
              <div className={styles.councilTitle}>{t('decision.council.subtitle')}</div>
            </div>
            <div className={styles.councilCount}>{t('decision.advisors.count', { count: advisorCount })}</div>
          </div>
          <div className={styles.seatGrid}>
            {COUNCIL_SEATS.map(({ key, icon: Icon }) => (
              <div key={key} className={styles.seat}>
                <Icon theme='outline' size='18' fill='currentColor' />
                <span>{t(`decision.council.seats.${key}`)}</span>
              </div>
            ))}
          </div>
          <div className={styles.councilFlow}>
            <span>{t('decision.council.flow.issue')}</span>
            <Right theme='outline' size='13' fill='currentColor' />
            <span>{t('decision.council.flow.debate')}</span>
            <Right theme='outline' size='13' fill='currentColor' />
            <span>{t('decision.council.flow.verdict')}</span>
          </div>
        </aside>
      </section>

      <div className={styles.dashboard}>
        <section className={styles.recentPanel}>
          <div className={styles.cardHead}>
            <div>
              <span className={styles.cardTitle}>{t('decision.recent.title')}</span>
              <p className={styles.cardDesc}>{t('decision.recent.desc')}</p>
            </div>
            {recent.length > 0 && <span className={styles.badge}>{recent.length}</span>}
          </div>
          {recent.length === 0 ? (
            <Empty className={styles.empty} description={t('decision.recent.empty')} />
          ) : (
            <div className={styles.list}>
              {recent.map((team) => (
                <Button key={team.id} long type='text' className={styles.row} onClick={() => openTeam(team.id)}>
                  <span className={styles.rowIcon}>
                    <Checklist theme='outline' size='14' fill='currentColor' />
                  </span>
                  <span className={styles.rowName}>{team.name}</span>
                  <span className={styles.rowEnter}>
                    {t('decision.enter')}
                    <Right />
                  </span>
                </Button>
              ))}
            </div>
          )}
        </section>

        <section className={styles.verdictPanel}>
          <div className={styles.verdictHeader}>
            <span className={styles.cardTitle}>{t('decision.verdict.title')}</span>
            <span className={styles.verdictBadge}>{t('decision.verdict.badge')}</span>
          </div>
          <div className={styles.verdictSteps}>
            <div>
              <span>{t('decision.verdict.steps.debate')}</span>
              <strong>{t('decision.verdict.steps.debateDesc')}</strong>
            </div>
            <div>
              <span>{t('decision.verdict.steps.options')}</span>
              <strong>{t('decision.verdict.steps.optionsDesc')}</strong>
            </div>
            <div>
              <span>{t('decision.verdict.steps.archive')}</span>
              <strong>{t('decision.verdict.steps.archiveDesc')}</strong>
            </div>
          </div>
        </section>
      </div>

      <section className={styles.feedPanel}>
        <div className={styles.feedHeader}>
          <div>
            <div className={styles.feedEyebrow}>
              <Share theme='outline' size='14' fill='currentColor' />
              <span>{t('decision.feed.eyebrow')}</span>
            </div>
            <h2 className={styles.feedTitle}>{t('decision.feed.title')}</h2>
            <p className={styles.feedDesc}>{t('decision.feed.desc')}</p>
          </div>
          <div className={styles.feedStatus}>
            <span className={styles.feedBadge}>{t('decision.feed.mockBadge')}</span>
            <span className={styles.feedSyncState}>{t('decision.feed.action')}</span>
          </div>
        </div>
        <div className={styles.feedList}>
          {FEED_ITEMS.map(({ key, source, icon: Icon, tone }) => (
            <article key={key} className={styles.feedItem}>
              <div className={`${styles.feedIcon} ${styles[`feedIcon_${tone}`]}`}>
                <Icon theme='outline' size='16' fill='currentColor' />
              </div>
              <div className={styles.feedBody}>
                <div className={styles.feedMeta}>
                  <span>{t(`decision.feed.sources.${source}`)}</span>
                  <span>{t(`decision.feed.items.${key}.time`)}</span>
                </div>
                <h3>{t(`decision.feed.items.${key}.title`)}</h3>
                <p>{t(`decision.feed.items.${key}.body`)}</p>
                <div className={styles.feedTags}>
                  <span>{t(`decision.feed.items.${key}.tag`)}</span>
                  <strong>{t('decision.feed.previewOnly')}</strong>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <div className={styles.stats}>
        <div className={styles.stat}>
          <FileText className={styles.statIcon} theme='outline' />
          <div className={styles.statText}>
            <div className={styles.statTitle}>{t('decision.archive.title')}</div>
            <div className={styles.statDesc}>{t('decision.archive.desc')}</div>
          </div>
          <div className={styles.statValue}>{t('decision.archive.count', { count: teams.length })}</div>
        </div>
        <Button
          className={`${styles.stat} ${styles.statInteractive}`}
          type='text'
          onClick={() => Promise.resolve(navigate('/advisors')).catch(console.error)}
        >
          <Peoples className={styles.statIcon} theme='outline' />
          <div className={styles.statText}>
            <div className={styles.statTitle}>{t('decision.advisors.title')}</div>
            <div className={styles.statDesc}>{t('decision.advisors.desc')}</div>
          </div>
          <div className={styles.statValue}>{t('decision.advisors.count', { count: advisorCount })}</div>
        </Button>
      </div>

      <TeamCreateModal
        visible={createVisible}
        initialName={createInitialName}
        onClose={() => {
          setCreateVisible(false);
          setCreateInitialName('');
        }}
        onCreated={handleCreated}
      />
    </div>
  );
};

export default DecisionHome;
