/**
 * schedulerStore — SOP 定时任务状态管理
 *
 * 持久化策略：
 *   tasks    → localStorage（长期保存）
 *   runLogs  → localStorage（保留最近 MAX_LOGS 条，滚动覆盖）
 *
 * 与外部模块的交互：
 *   - useSSHStore.executeSOPPlanForScheduler  ← 调度执行
 *   - useSOPStore.templates                  ← 读取 SOP 模板
 *   - cronMatches / getNextCronRun           ← cron 计算（utils）
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SOPScheduledTask, SOPScheduleRunLog } from '../../../types';
import { generateId } from '../../../utils';

const MAX_LOGS = 200; // 最多保留最近 200 条执行记录

interface SchedulerStore {
  tasks:   SOPScheduledTask[];
  runLogs: SOPScheduleRunLog[];

  addTask:    (data: Omit<SOPScheduledTask, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateTask: (id: string, data: Partial<SOPScheduledTask>) => void;
  deleteTask: (id: string) => void;
  toggleTask: (id: string) => void;

  addRunLog:    (log: SOPScheduleRunLog) => void;
  updateRunLog: (id: string, data: Partial<SOPScheduleRunLog>) => void;
  clearRunLogs: (taskId?: string) => void;   // taskId 为空则清空全部
}

export const useSchedulerStore = create<SchedulerStore>()(
  persist(
    (set) => ({
      tasks:   [],
      runLogs: [],

      addTask: (data) => {
        const id  = generateId();
        const now = Date.now();
        set((s) => ({
          tasks: [...s.tasks, { ...data, id, createdAt: now, updatedAt: now }],
        }));
        return id;
      },

      updateTask: (id, data) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id ? { ...t, ...data, updatedAt: Date.now() } : t
          ),
        })),

      deleteTask: (id) =>
        set((s) => ({
          tasks:   s.tasks.filter((t) => t.id !== id),
          runLogs: s.runLogs.filter((l) => l.taskId !== id),
        })),

      toggleTask: (id) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id ? { ...t, enabled: !t.enabled, updatedAt: Date.now() } : t
          ),
        })),

      addRunLog: (log) =>
        set((s) => {
          const logs = [log, ...s.runLogs].slice(0, MAX_LOGS);
          return { runLogs: logs };
        }),

      updateRunLog: (id, data) =>
        set((s) => ({
          runLogs: s.runLogs.map((l) => (l.id === id ? { ...l, ...data } : l)),
        })),

      clearRunLogs: (taskId) =>
        set((s) => ({
          runLogs: taskId
            ? s.runLogs.filter((l) => l.taskId !== taskId)
            : [],
        })),
    }),
    {
      name: 'devutility-sop-scheduler',
      partialize: (s) => ({ tasks: s.tasks, runLogs: s.runLogs }),
    }
  )
);
