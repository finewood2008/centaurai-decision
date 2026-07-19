import { useCallback, useEffect, useRef, useState } from 'react';
import { uploadKnowledgeFile, waitForKnowledgeJob } from './knowledgeApi';

export type KnowledgeUploadPhase = 'queued' | 'uploading' | 'indexing' | 'done' | 'error';

export type KnowledgeUploadTask = {
  id: string;
  file: File;
  name: string;
  progress: number;
  phase: KnowledgeUploadPhase;
  error?: string;
  docId?: string;
};

const MAX_CONCURRENT_UPLOADS = 2;
let uploadSequence = 0;

export function useKnowledgeUploads(onChanged: () => void) {
  const [tasks, setTasks] = useState<KnowledgeUploadTask[]>([]);
  const queueRef = useRef<string[]>([]);
  const activeRef = useRef(0);
  const mountedRef = useRef(true);
  const tasksRef = useRef<KnowledgeUploadTask[]>([]);
  const pumpRef = useRef<() => void>(() => undefined);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  const commit = useCallback((updater: (current: KnowledgeUploadTask[]) => KnowledgeUploadTask[]) => {
    if (!mountedRef.current) return;
    setTasks((current) => {
      const next = updater(current);
      tasksRef.current = next;
      return next;
    });
  }, []);

  const run = useCallback(
    async (id: string) => {
      const task = tasksRef.current.find((item) => item.id === id);
      if (!task) return;
      commit((current) =>
        current.map((item) =>
          item.id === id ? { ...item, phase: 'uploading', progress: 0, error: undefined, docId: undefined } : item
        )
      );
      try {
        const result = await uploadKnowledgeFile(task.file, (progress) => {
          commit((current) => current.map((item) => (item.id === id ? { ...item, progress } : item)));
        });
        if (result.queued) {
          if (!result.doc_id) throw new Error('KNOWLEDGE_INDEX_INVALID_RESPONSE');
          commit((current) =>
            current.map((item) =>
              item.id === id ? { ...item, phase: 'indexing', progress: 95, docId: result.doc_id } : item
            )
          );
          await waitForKnowledgeJob(result.doc_id);
        }
        commit((current) => current.map((item) => (item.id === id ? { ...item, phase: 'done', progress: 100 } : item)));
      } catch (error) {
        commit((current) =>
          current.map((item) =>
            item.id === id
              ? { ...item, phase: 'error', error: error instanceof Error ? error.message : 'KNOWLEDGE_UPLOAD_FAILED' }
              : item
          )
        );
      } finally {
        activeRef.current = Math.max(0, activeRef.current - 1);
        onChanged();
        pumpRef.current();
      }
    },
    [commit, onChanged]
  );

  pumpRef.current = () => {
    while (activeRef.current < MAX_CONCURRENT_UPLOADS && queueRef.current.length) {
      const id = queueRef.current.shift();
      if (!id) break;
      activeRef.current += 1;
      void run(id);
    }
  };

  const enqueue = useCallback(
    (file: File) => {
      const id = `knowledge-upload-${Date.now()}-${uploadSequence++}`;
      const task: KnowledgeUploadTask = { id, file, name: file.name, progress: 0, phase: 'queued' };
      tasksRef.current = [...tasksRef.current, task];
      setTasks(tasksRef.current);
      queueRef.current.push(id);
      queueMicrotask(() => pumpRef.current());
    },
    [setTasks]
  );

  const retry = useCallback(
    (id: string) => {
      if (!tasksRef.current.some((item) => item.id === id && item.phase === 'error')) return;
      commit((current) =>
        current.map((item) => (item.id === id ? { ...item, phase: 'queued', progress: 0, error: undefined } : item))
      );
      queueRef.current.push(id);
      queueMicrotask(() => pumpRef.current());
    },
    [commit]
  );

  const dismiss = useCallback(
    (id: string) => {
      commit((current) => current.filter((item) => item.id !== id || !['done', 'error'].includes(item.phase)));
    },
    [commit]
  );

  return { tasks, enqueue, retry, dismiss };
}
