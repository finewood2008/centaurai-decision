/**
 * ShareToTeamModal — confirm sharing an artifact to the LAN shared library,
 * optionally tagging it with a category.
 */
import React, { useState } from 'react';
import { Modal, Input } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { FileEntry } from '../types';

type ShareToTeamModalProps = {
  file: FileEntry | null;
  loading: boolean;
  onConfirm: (category: string) => void;
  onCancel: () => void;
};

const ShareToTeamModal: React.FC<ShareToTeamModalProps> = ({ file, loading, onConfirm, onCancel }) => {
  const { t } = useTranslation();
  const [category, setCategory] = useState('');

  return (
    <Modal
      visible={file != null}
      title={t('contentHub.actions.shareToTeam')}
      onOk={() => onConfirm(category.trim())}
      onCancel={onCancel}
      confirmLoading={loading}
      afterClose={() => setCategory('')}
      autoFocus
      unmountOnExit
    >
      <div className='flex flex-col gap-12px'>
        <div className='text-13px text-t-secondary truncate'>{file?.name}</div>
        <Input
          value={category}
          onChange={setCategory}
          placeholder={t('contentHub.shared.categories')}
          allowClear
          onPressEnter={() => onConfirm(category.trim())}
        />
        <div className='text-11px text-t-secondary'>{t('contentHub.shared.allVisible')}</div>
      </div>
    </Modal>
  );
};

export default ShareToTeamModal;
