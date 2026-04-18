import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateId } from '../../../utils';

export type EvidenceSourceType =
  | 'first_anomaly'
  | 'finding'
  | 'collection_step'
  | 'business_action'
  | 'session_log';

export interface LockedEvidence {
  id: string;
  sourceId?: string;
  sourceType: EvidenceSourceType;
  title: string;
  summary: string;
  content: string;
  lookupText?: string;
  command?: string;
  sessionLabel?: string;
  tags: string[];
  createdAt: number;
}

interface EvidenceStore {
  lockedEvidence: LockedEvidence[];
  addEvidence: (item: Omit<LockedEvidence, 'id' | 'createdAt'> & { id?: string }) => void;
  removeEvidence: (id: string) => void;
  clearEvidence: () => void;
}

function makeFingerprint(item: Omit<LockedEvidence, 'id' | 'createdAt'> & { id?: string }) {
  return [
    item.sourceType,
    item.sourceId || '',
    item.title,
    item.command || '',
    item.content.slice(0, 240),
  ].join('::');
}

export const useEvidenceStore = create<EvidenceStore>()(
  persist(
    (set, get) => ({
      lockedEvidence: [],

      addEvidence: (item) => {
        const fingerprint = makeFingerprint(item);
        const exists = get().lockedEvidence.some((entry) => makeFingerprint(entry) === fingerprint);
        if (exists) return;

        set((state) => ({
          lockedEvidence: [
            {
              ...item,
              id: item.id || generateId(),
              createdAt: Date.now(),
            },
            ...state.lockedEvidence,
          ].slice(0, 200),
        }));
      },

      removeEvidence: (id) => set((state) => ({
        lockedEvidence: state.lockedEvidence.filter((item) => item.id !== id),
      })),

      clearEvidence: () => set({ lockedEvidence: [] }),
    }),
    {
      name: 'devutility-diagnostic-evidence',
      partialize: (state) => ({ lockedEvidence: state.lockedEvidence }),
    }
  )
);
