/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import UsersModalContent from '@/renderer/components/settings/SettingsModal/contents/UsersModalContent';
import SettingsPageWrapper from './components/SettingsPageWrapper';

const UsersSettings: React.FC = () => {
  return (
    <SettingsPageWrapper>
      <UsersModalContent />
    </SettingsPageWrapper>
  );
};

export default UsersSettings;
