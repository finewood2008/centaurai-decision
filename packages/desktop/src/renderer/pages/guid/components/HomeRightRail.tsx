/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen } from '@icon-park/react';
import RecentFiles from './RecentFiles';
import styles from '../index.module.css';

interface HomeRightRailProps {
  onViewAllFiles: () => void;
}

const HomeRightRail: React.FC<HomeRightRailProps> = ({ onViewAllFiles }) => {
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
    </aside>
  );
};

export default HomeRightRail;
