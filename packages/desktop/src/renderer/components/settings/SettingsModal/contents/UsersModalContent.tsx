/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IUserRecord } from '@/common/adapter/ipcBridge';
import { ipcBridge } from '@/common';
import { Button, Input, Message, Modal, Popconfirm, Table, Tag, Typography } from '@arco-design/web-react';
import { Delete, Plus, Refresh, User } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

const UsersModalContent: React.FC = () => {
  const { t } = useTranslation();
  const [users, setUsers] = useState<IUserRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await ipcBridge.users.list.invoke();
      setUsers(data);
    } catch (err) {
      console.error('Failed to load users:', err);
      Message.error(t('settings.users.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const handleCreate = async () => {
    if (!newUsername.trim()) {
      Message.warning(t('settings.users.usernameRequired'));
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      Message.warning(t('settings.users.passwordMinLength'));
      return;
    }

    setCreateLoading(true);
    try {
      await ipcBridge.users.create.invoke({
        username: newUsername.trim(),
        password: newPassword,
      });
      Message.success(t('settings.users.createSuccess'));
      setCreateVisible(false);
      setNewUsername('');
      setNewPassword('');
      void loadUsers();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('settings.users.createFailed');
      Message.error(msg);
    } finally {
      setCreateLoading(false);
    }
  };

  const handleDelete = async (userId: string, username: string) => {
    try {
      if (username === 'admin') {
        Message.warning(t('settings.users.cannotDeleteAdmin'));
        return;
      }
      await ipcBridge.users.delete.invoke({ user_id: userId });
      Message.success(t('settings.users.deleteSuccess'));
      void loadUsers();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('settings.users.deleteFailed');
      Message.error(msg);
    }
  };

  const handleResetPassword = async (userId: string) => {
    try {
      const result = await ipcBridge.users.resetPassword.invoke({ user_id: userId });
      Message.success({
        content: `${t('settings.users.passwordReset')}: ${result.new_password}`,
        duration: 10000,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('settings.users.resetFailed');
      Message.error(msg);
    }
  };

  const formatDate = (ts: number | null) => {
    if (!ts) return '-';
    return new Date(ts).toLocaleString();
  };

  const columns = [
    {
      title: t('settings.users.username'),
      dataIndex: 'username',
      render: (name: string, record: IUserRecord) => (
        <span className='flex items-center gap-8px'>
          <User theme='outline' size='16' />
          <Text>{name}</Text>
          {record.id === 'system_default_user' && (
            <Tag color='arcoblue' size='small'>
              {t('settings.users.admin')}
            </Tag>
          )}
        </span>
      ),
    },
    {
      title: t('settings.users.createdAt'),
      dataIndex: 'created_at',
      render: (ts: number) => formatDate(ts),
    },
    {
      title: t('settings.users.lastLogin'),
      dataIndex: 'last_login',
      render: (ts: number | null) => formatDate(ts),
    },
    {
      title: t('settings.users.actions'),
      width: 200,
      render: (_: unknown, record: IUserRecord) => (
        <div className='flex items-center gap-8px'>
          <Button type='text' size='small' onClick={() => handleResetPassword(record.id)}>
            {t('settings.users.resetPassword')}
          </Button>
          {record.username !== 'admin' && (
            <Popconfirm title={t('settings.users.deleteConfirm')} onOk={() => handleDelete(record.id, record.username)}>
              <Button type='text' size='small' status='danger' icon={<Delete />}>
                {t('settings.users.delete')}
              </Button>
            </Popconfirm>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className='flex flex-col h-full'>
      <div className='flex items-center justify-between mb-16px'>
        <div>
          <h3 className='text-16px font-600 text-t-primary m-0'>{t('settings.users.title')}</h3>
          <p className='text-12px text-t-tertiary mt-4px m-0'>{t('settings.users.description')}</p>
        </div>
        <div className='flex items-center gap-8px'>
          <Button icon={<Refresh />} onClick={loadUsers} loading={loading}>
            {t('settings.users.refresh')}
          </Button>
          <Button type='primary' icon={<Plus />} onClick={() => setCreateVisible(true)}>
            {t('settings.users.createUser')}
          </Button>
        </div>
      </div>

      <Table columns={columns} data={users} loading={loading} rowKey='id' size='small' pagination={false} />

      <Modal
        visible={createVisible}
        onCancel={() => {
          setCreateVisible(false);
          setNewUsername('');
          setNewPassword('');
        }}
        title={t('settings.users.createUser')}
        onOk={handleCreate}
        confirmLoading={createLoading}
      >
        <div className='flex flex-col gap-16px py-8px'>
          <div>
            <label className='text-14px text-t-primary mb-4px block'>{t('settings.users.username')}</label>
            <Input
              placeholder={t('settings.users.usernamePlaceholder')}
              value={newUsername}
              onChange={setNewUsername}
            />
          </div>
          <div>
            <label className='text-14px text-t-primary mb-4px block'>{t('settings.users.password')}</label>
            <Input.Password
              placeholder={t('settings.users.passwordPlaceholder')}
              value={newPassword}
              onChange={setNewPassword}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default UsersModalContent;
