/**
 * useScheduler — 全局 Cron 调度 Hook
 *
 * 设计原则：
 *   - 挂载在 AppLayout，应用存活期间持续运行
 *   - 每 10 秒检查一次，精度为分钟级（标准 cron 最小粒度）
 *   - 用 lastFiredMinute Map 保证同一分钟内不重复触发
 *   - 每个任务的执行是 fire-and-forget 异步流程，不阻塞轮询
 *   - 调用 sshStore.executeSOPPlanForScheduler（不干扰手动 SSH 操作）
 *
 * 浏览器限制：页面标签关闭/休眠时调度暂停，再次激活时从当前时间重新计算。
 */
import { useEffect, useRef } from 'react';
import { useSchedulerStore } from '../store/schedulerStore';
import { useSSHStore } from '../../SSHManager/store/sshStore';
import { useSOPStore } from '../../SOPBuilder/store/sopStore';
import {
  cronMatches,
  getNextCronRun,
  buildPlanStepsFromTemplate,
  generateId,
} from '../../../utils';
import type { SOPScheduledTask, SOPScheduleRunLog } from '../../../types';

// ─── 单次任务执行 ──────────────────────────────────────────────────────────

async function executeTask(task: SOPScheduledTask): Promise<void> {
  const { addRunLog, updateRunLog, updateTask } = useSchedulerStore.getState();
  const { sessions, executeSOPPlanForScheduler } = useSSHStore.getState();
  const { templates } = useSOPStore.getState();

  // 构造节点分配列表
  const assignments: Array<{
    sessionId:    string;
    templateId:   string;
    varValues:    Record<string, string>;
  }> = task.mode === 'broadcast'
    ? (task.broadcastSessionIds ?? []).map((sid) => ({
        sessionId:  sid,
        templateId: task.broadcastTemplateId ?? '',
        varValues:  task.broadcastVarValues ?? {},
      }))
    : (task.nodeAssignments ?? []).map((a) => ({
        sessionId:  a.sessionId,
        templateId: a.templateId,
        varValues:  a.varValues ?? {},
      }));

  if (assignments.length === 0) return;

  // 构造运行日志（初始状态）
  const runId = generateId();
  const runLog: SOPScheduleRunLog = {
    id:          runId,
    taskId:      task.id,
    taskName:    task.name,
    startedAt:   Date.now(),
    mode:        task.mode,
    nodeResults: assignments.map((a) => {
      const sess   = sessions.find((s) => s.id === a.sessionId);
      const tmpl   = templates.find((t) => t.id === a.templateId);
      return {
        sessionId:    a.sessionId,
        sessionName:  sess?.name ?? a.sessionId,
        templateId:   a.templateId,
        templateName: tmpl?.name ?? '未知模板',
        status:       'running' as const,
        stepsTotal:   tmpl?.checks?.length ?? 0,
        stepsFailed:  0,
      };
    }),
    status: 'running',
  };
  addRunLog(runLog);

  // 更新任务状态
  updateTask(task.id, {
    lastRunAt:     runLog.startedAt,
    lastRunStatus: 'running',
    nextRunAt:     getNextCronRun(task.cronExpr)?.getTime(),
  });

  // 并行向所有节点发送执行计划
  const settledResults = await Promise.allSettled(
    assignments.map(async (a) => {
      const sess = sessions.find((s) => s.id === a.sessionId);
      if (!sess || sess.status !== 'connected') {
        return {
          sessionId:   a.sessionId,
          status:      'skipped' as const,
          error:       '会话未连接，已跳过',
          stepsFailed: 0,
          stepsTotal:  0,
        };
      }

      const tmpl = templates.find((t) => t.id === a.templateId);
      if (!tmpl) {
        return {
          sessionId:   a.sessionId,
          status:      'failed' as const,
          error:       `模板 "${a.templateId}" 不存在`,
          stepsFailed: 0,
          stepsTotal:  0,
        };
      }

      const steps = buildPlanStepsFromTemplate(tmpl, a.varValues);
      if (steps.length === 0) {
        return {
          sessionId:   a.sessionId,
          status:      'success' as const,
          stepsTotal:  0,
          stepsFailed: 0,
        };
      }

      const result = await executeSOPPlanForScheduler(a.sessionId, steps);
      const stepsFailed = Object.values(result.results).filter(
        (r) => r.status === 'failed'
      ).length;

      return {
        sessionId:   a.sessionId,
        status:      (result.success && stepsFailed === 0 ? 'success'
                       : result.success                  ? 'partial'
                                                         : 'failed') as SOPScheduleRunLog['nodeResults'][0]['status'],
        stepsTotal:  steps.length,
        stepsFailed,
        error:       result.error,
      };
    })
  );

  // 汇总节点结果
  const nodeResults = runLog.nodeResults.map((nr, idx) => {
    const settled = settledResults[idx];
    if (settled.status === 'fulfilled') {
      return { ...nr, ...settled.value };
    }
    return { ...nr, status: 'failed' as const, error: String(settled.reason) };
  });

  const overallStatus: SOPScheduleRunLog['status'] =
    nodeResults.every((r) => r.status === 'success' || r.status === 'skipped')
      ? 'success'
      : nodeResults.some((r) => r.status === 'success')
      ? 'partial'
      : 'failed';

  updateRunLog(runId, {
    finishedAt:  Date.now(),
    nodeResults,
    status:      overallStatus,
  });

  updateTask(task.id, { lastRunStatus: overallStatus });
}

// ─── Hook 本体 ────────────────────────────────────────────────────────────

export function useScheduler(): void {
  // taskId → 最后触发的分钟 epoch（防止同一分钟内重复触发）
  const lastFiredMinute = useRef(new Map<string, number>());

  useEffect(() => {
    const tick = () => {
      const now          = new Date();
      const minuteEpoch  = Math.floor(Date.now() / 60_000);
      const { tasks }    = useSchedulerStore.getState();

      for (const task of tasks) {
        if (!task.enabled) continue;
        if ((lastFiredMinute.current.get(task.id) ?? -1) >= minuteEpoch) continue;
        if (!cronMatches(task.cronExpr, now)) continue;

        lastFiredMinute.current.set(task.id, minuteEpoch);
        void executeTask(task); // fire-and-forget
      }
    };

    tick(); // 初始立即执行一次（处理刚好在整分钟打开页面的场景）
    const timer = setInterval(tick, 10_000); // 每 10 秒轮询
    return () => clearInterval(timer);
  }, []); // 空依赖：仅挂载一次
}
