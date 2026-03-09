import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { GitRepoSource } from '../../../types';
import { generateId } from '../../../utils';

interface SOPGitStore {
  sources: GitRepoSource[];

  addSource:    (data: Omit<GitRepoSource, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateSource: (id: string, data: Partial<GitRepoSource>) => void;
  deleteSource: (id: string) => void;
  /** 同步结束后写入结果（含时间戳） */
  setLastResult: (id: string, result: NonNullable<GitRepoSource['lastResult']>) => void;
}

export const useSOPGitStore = create<SOPGitStore>()(
  persist(
    (set) => ({
      sources: [],

      addSource: (data) => {
        const id  = generateId();
        const now = Date.now();
        set((s) => ({
          sources: [
            ...s.sources,
            { ...data, id, createdAt: now, updatedAt: now },
          ],
        }));
        return id;
      },

      updateSource: (id, data) => {
        set((s) => ({
          sources: s.sources.map((src) =>
            src.id === id ? { ...src, ...data, updatedAt: Date.now() } : src
          ),
        }));
      },

      deleteSource: (id) => {
        set((s) => ({ sources: s.sources.filter((src) => src.id !== id) }));
      },

      setLastResult: (id, result) => {
        set((s) => ({
          sources: s.sources.map((src) =>
            src.id === id
              ? { ...src, lastSynced: Date.now(), lastResult: result }
              : src
          ),
        }));
      },
    }),
    { name: 'devutility-sop-git' }
  )
);
