import parser from 'cron-parser';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CronJob } from '../../../types';
import { generateId } from '../../../utils';

interface CronStore {
  jobs: CronJob[];
  addJob: (data: Omit<CronJob, 'id' | 'createdAt' | 'lastRunAt' | 'nextRunAt'>) => string;
  updateJob: (id: string, data: Partial<CronJob>) => void;
  deleteJob: (id: string) => void;
  toggleJob: (id: string, enabled: boolean) => void;
  evaluateJobs: () => CronJob[];
}

export const useCronStore = create<CronStore>()(
  persist(
    (set, get) => ({
      jobs: [],

      addJob: (data) => {
        const id = generateId();
        const now = Date.now();
        let nextRunAt: number | undefined;
        if (data.enabled) {
          try {
            const interval = parser.parse(data.cronExpr, { currentDate: new Date(now) });
            nextRunAt = interval.next().getTime();
          } catch {
            console.error('Failed to parse cron expression:', data.cronExpr);
          }
        }
        
        set((s) => ({
          jobs: [...s.jobs, { ...data, id, createdAt: now, nextRunAt }],
        }));
        return id;
      },

      updateJob: (id, data) => {
        set((s) => ({
          jobs: s.jobs.map((j) => {
            if (j.id !== id) return j;
            const updated = { ...j, ...data };
            if (updated.enabled) {
              try {
                const interval = parser.parse(updated.cronExpr, { currentDate: new Date() });
                updated.nextRunAt = interval.next().getTime();
              } catch {
                console.error('Failed to parse cron expression:', updated.cronExpr);
              }
            } else {
              updated.nextRunAt = undefined;
            }
            return updated;
          }),
        }));
      },

      deleteJob: (id) => {
        set((s) => ({
          jobs: s.jobs.filter((j) => j.id !== id),
        }));
      },

      toggleJob: (id, enabled) => {
        get().updateJob(id, { enabled });
      },

      evaluateJobs: () => {
        const now = Date.now();
        const { jobs } = get();

        const jobsToRun: CronJob[] = [];
        const nextJobs = jobs.map((job) => {
          if (!job.enabled || !job.nextRunAt) return job;
          
          if (now >= job.nextRunAt) {
            jobsToRun.push(job);
            try {
              const interval = parser.parse(job.cronExpr, { currentDate: new Date(now) });
              return { ...job, lastRunAt: now, nextRunAt: interval.next().getTime() };
            } catch {
              return { ...job, enabled: false, nextRunAt: undefined };
            }
          }
          return job;
        });

        if (jobsToRun.length > 0) {
          set({ jobs: nextJobs });
        }
        
        return jobsToRun;
      },
    }),
    {
      name: 'devutility-cron',
    }
  )
);
