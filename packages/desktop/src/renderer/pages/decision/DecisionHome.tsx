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
import { Button, Empty } from '@arco-design/web-react';
import { Plus, Right, FileText, Peoples, Communication } from '@icon-park/react';
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

const DecisionHome: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { teams } = useTeamList();
  const { assistants } = useAssistantList();
  const [createVisible, setCreateVisible] = useState(false);

  const greeting = t(`decision.greeting.${greetingSlot()}`);

  const advisorCount = useMemo(
    () => assistants.filter((a) => a.id.startsWith('agency-') && a.enabled !== false).length,
    [assistants]
  );

  const sortedTeams = useMemo(() => [...teams].sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0)), [teams]);
  const ongoing = sortedTeams.slice(0, 6);

  const openTeam = (id: string) => {
    Promise.resolve(navigate(`/team/${id}`)).catch(console.error);
  };

  const handleCreated = (team: TTeam) => {
    setCreateVisible(false);
    openTeam(team.id);
  };

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <h1 className={styles.greeting}>{greeting}</h1>
          <p className={styles.subtitle}>{t('decision.subtitle')}</p>
        </div>
        <Button type='primary' size='large' icon={<Plus />} onClick={() => setCreateVisible(true)}>
          {t('decision.startMeeting')}
        </Button>
      </header>

      <div className={styles.grid}>
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <span className={styles.cardTitle}>{t('decision.ongoing.title')}</span>
            {ongoing.length > 0 && <span className={styles.badge}>{ongoing.length}</span>}
          </div>
          {ongoing.length === 0 ? (
            <Empty className={styles.empty} description={t('decision.ongoing.empty')} />
          ) : (
            <div className={styles.list}>
              {ongoing.map((team) => (
                <Button key={team.id} long type='text' className={styles.row} onClick={() => openTeam(team.id)}>
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

        <section className={styles.card}>
          <div className={styles.cardHead}>
            <span className={styles.cardTitle}>{t('decision.intel.title')}</span>
            <span className={styles.tag}>
              <Communication className={styles.tagIcon} />
              {t('decision.intel.tag')}
            </span>
          </div>
          <Empty className={styles.empty} description={t('decision.intel.empty')} />
        </section>
      </div>

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
          className={styles.stat}
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

      <TeamCreateModal visible={createVisible} onClose={() => setCreateVisible(false)} onCreated={handleCreated} />
    </div>
  );
};

export default DecisionHome;
