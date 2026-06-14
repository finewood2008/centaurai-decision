import React from 'react';
import DownloadClientModalContent from '@/renderer/components/settings/SettingsModal/contents/DownloadClientModalContent';
import SettingsPageWrapper from './components/SettingsPageWrapper';

/**
 * Local Client settings page (LAN / browser users only).
 *
 * Lets browser users download the native client installer — in any available
 * version — bundled inside the server. Registered in the settings sider as
 * 'client' and routed at /settings/client; hidden on the desktop admin.
 */
const ClientSettings: React.FC = () => {
  return (
    <SettingsPageWrapper>
      <DownloadClientModalContent />
    </SettingsPageWrapper>
  );
};

export default ClientSettings;
