/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen, Share } from '@icon-park/react';
import RecentFiles from './RecentFiles';
import RecentSharedFiles from './RecentSharedFiles';
import styles from '../index.module.css';

interface HomeRightRailProps {
  onViewAllFiles: () => void;
  onViewAllShared: () => void;
}

const HomeRightRail: React.FC<HomeRightRailProps> = ({ onViewAllFiles, onViewAllShared }) => {
  const { t } = useTranslation();

  return (
    <aside className={styles.homeRightRail}>
      <div className={styles.homeRightRailSection}>
        <header className={styles.homeRightRailHeader}>
          <FolderOpen theme='outline' size={14} />
          <span>{t('guid.recentFiles.title', { defaultValue: 'Recent files' })}</span>
        </header>
        <RecentFiles variant='vertical' onViewAll={onViewAllFiles} />
      </div>
      <div className={styles.homeRightRailSection}>
        <header className={styles.homeRightRailHeader}>
          <Share theme='outline' size={14} />
          <span>{t('contentHub.tabs.shared')}</span>
        </header>
        <RecentSharedFiles onViewAll={onViewAllShared} />
      </div>
    </aside>
  );
};

export default HomeRightRail;
