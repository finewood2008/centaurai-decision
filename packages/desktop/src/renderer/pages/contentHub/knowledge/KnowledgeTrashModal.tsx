import React, { useCallback, useEffect, useState } from 'react';
import { Button, Empty, Message, Modal, Spin } from '@arco-design/web-react';
import { Undo } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { formatSize } from '@/renderer/pages/guid/components/RecentFiles';
import { fetchKnowledgeTrash, restoreKnowledgeTrash, type KnowledgeTrashEntry } from './knowledgeApi';

type KnowledgeTrashModalProps = {
  visible: boolean;
  onCancel: () => void;
  onRestored: () => void;
};

const KnowledgeTrashModal: React.FC<KnowledgeTrashModalProps> = ({ visible, onCancel, onRestored }) => {
  const { t } = useTranslation();
  const [items, setItems] = useState<KnowledgeTrashEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await fetchKnowledgeTrash());
    } catch {
      Message.error(t('contentHub.knowledge.trashLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (visible) void load();
  }, [load, visible]);

  const restore = async (item: KnowledgeTrashEntry) => {
    setRestoring(item.id);
    try {
      await restoreKnowledgeTrash(item.id);
      Message.success(t('contentHub.knowledge.restoreSuccess'));
      await load();
      onRestored();
    } catch {
      Message.error(t('contentHub.knowledge.restoreFailed'));
    } finally {
      setRestoring(undefined);
    }
  };

  return (
    <Modal
      title={t('contentHub.knowledge.trashTitle')}
      visible={visible}
      onCancel={onCancel}
      footer={null}
      unmountOnExit
    >
      <Spin loading={loading} className='w-full'>
        {!items.length && !loading ? (
          <Empty description={t('contentHub.knowledge.trashEmpty')} />
        ) : (
          <div className='max-h-480px overflow-y-auto flex flex-col gap-8px'>
            {items.map((item) => (
              <div
                key={item.id}
                className='flex items-center gap-12px rd-8px border border-solid border-b-base px-12px py-10px'
              >
                <div className='min-w-0 flex-1'>
                  <div className='truncate text-13px text-t-primary'>{item.file_name}</div>
                  <div className='truncate text-11px text-t-secondary'>
                    {formatSize(item.size)} · {item.deleted_at}
                  </div>
                </div>
                <Button
                  size='small'
                  type='text'
                  icon={<Undo size={14} />}
                  loading={restoring === item.id}
                  onClick={() => void restore(item)}
                >
                  {t('contentHub.knowledge.restore')}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Spin>
    </Modal>
  );
};

export default KnowledgeTrashModal;
