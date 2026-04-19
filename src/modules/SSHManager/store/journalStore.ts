/**
 * Session Journal Store — 会话执行日志
 *
 * 记录每个 SSH 会话中发生的所有操作，包括：
 *   - sop_step:    SOP exec_plan 执行的步骤（自动入库）
 *   - quick_exec:  execCommandOnSession 单条命令（自动入库）
 *   - manual_cmd:  用户在终端手动输入的命令（键盘截收入库）
 *   - note:        用户主动添加的文字备注
 *   - snapshot:    用户触发的终端缓冲区快照
 *   - session_evt: 连接/断开事件
 *
 * 持久化到 localStorage，每个会话最多保留 500 条。
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateId } from '../../../utils';

// ─── 类型 ──────────────────────────────────────────────────────────────────

export type JournalEntryType =
  | 'prepare_step' // 登录后预处理步骤
  | 'sop_step'     // SOP 步骤自动记录
  | 'quick_exec'   // 快速执行命令
  | 'manual_cmd'   // 终端手动输入命令
  | 'note'         // 用户文字备注
  | 'snapshot'     // 终端快照
  | 'session_evt'; // 连接/断开事件

export interface JournalEntry {
  id:          string;
  sessionId:   string;
  sessionName: string;
  type:        JournalEntryType;
  timestamp:   number;

  // 命令相关（sop_step / quick_exec / manual_cmd）
  command?:      string;
  output?:       string;         // 原始输出 / 处理后输出
  exitCode?:     number;
  durationMs?:   number;
  statusReason?: string;         // 正则判断依据
  capturedVar?:  { name: string; value: string };

  // SOP 关联
  prepareProfileName?: string;
  prepareStepName?: string;
  sopStepName?:   string;
  sopInstanceId?: string;
  sopNodeName?:   string;        // 多节点执行时的节点标识（会话名称）

  // 节点信息（执行命令时的目标主机，管理 IP）
  nodeHost?:      string;        // 如 192.168.1.100
  nodePort?:      number;        // 如 22
  nodeUser?:      string;        // 如 root

  // 备注 / 快照内容
  content?: string;

  // 事件标题（session_evt）
  eventTitle?: string;
}

// ─── Store ─────────────────────────────────────────────────────────────────

const MAX_ENTRIES_PER_SESSION = 500;

interface JournalStore {
  // key = sessionId → entries（按时间升序）
  journals: Record<string, JournalEntry[]>;

  addEntry:     (entry: Omit<JournalEntry, 'id'>) => string;
  deleteEntry:  (sessionId: string, entryId: string) => void;
  clearSession: (sessionId: string) => void;
  clearAll:     () => void;

  // 批量写入 SOP 多节点执行结果
  addSOPNodeResults: (
    results: Array<{
      sessionId:   string;
      sessionName: string;
      nodeHost?:   string;   // 管理 IP
      nodePort?:   number;
      nodeUser?:   string;
      steps: Array<{
        name:       string;
        command:    string;
        output:     string;
        exitCode:   number;
        durationMs: number;
        statusReason?: string;
        capturedVar?:  { name: string; value: string };
      }>;
      instanceId: string;
    }>
  ) => void;
}

export const useJournalStore = create<JournalStore>()(
  persist(
    (set, get) => ({
      journals: {},

      addEntry: (entry) => {
        const id = generateId();
        set((s) => {
          const existing = s.journals[entry.sessionId] ?? [];
          // 超出上限时丢弃最旧的记录
          const trimmed = existing.length >= MAX_ENTRIES_PER_SESSION
            ? existing.slice(existing.length - MAX_ENTRIES_PER_SESSION + 1)
            : existing;
          return {
            journals: {
              ...s.journals,
              [entry.sessionId]: [...trimmed, { ...entry, id }],
            },
          };
        });
        return id;
      },

      deleteEntry: (sessionId, entryId) => {
        set((s) => ({
          journals: {
            ...s.journals,
            [sessionId]: (s.journals[sessionId] ?? []).filter((e) => e.id !== entryId),
          },
        }));
      },

      clearSession: (sessionId) => {
        set((s) => {
          const next = { ...s.journals };
          delete next[sessionId];
          return { journals: next };
        });
      },

      clearAll: () => set({ journals: {} }),

      // 多节点 SOP 执行结束后批量写入（含节点 IP 信息）
      addSOPNodeResults: (results) => {
        const { addEntry } = get();
        const now = Date.now();
        results.forEach((node) => {
          node.steps.forEach((step, i) => {
            addEntry({
              sessionId:    node.sessionId,
              sessionName:  node.sessionName,
              type:         'sop_step',
              timestamp:    now + i,
              command:      step.command,
              output:       step.output,
              exitCode:     step.exitCode,
              durationMs:   step.durationMs,
              statusReason: step.statusReason,
              capturedVar:  step.capturedVar,
              sopStepName:  step.name,
              sopInstanceId: node.instanceId,
              sopNodeName:  node.sessionName,
              // 节点信息（管理 IP）
              nodeHost:     node.nodeHost,
              nodePort:     node.nodePort,
              nodeUser:     node.nodeUser,
            });
          });
        });
      },
    }),
    {
      name: 'devutility-session-journals',
      partialize: (s) => ({ journals: s.journals }),
    }
  )
);
