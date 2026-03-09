import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
    SOPCheck, SOPCheckResult,
    SOPInstance,
    SOPSubStepResult,
    SOPTemplate,
} from '../../../types';
import { generateId, parseSOPTemplatesFromMarkdown, renderTemplate } from '../../../utils';

interface SOPStore {
  templates: SOPTemplate[];
  instances: SOPInstance[];
  activeInstanceId: string | null;

  // 模板操作
  addTemplate: (data: Omit<SOPTemplate, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateTemplate: (id: string, data: Partial<SOPTemplate>) => void;
  deleteTemplate: (id: string) => void;
  // 从 Markdown 批量导入模板（跳过重名模板）
  importTemplatesFromMarkdown: (md: string) => { imported: number; skipped: number };
  // 从 JSON 批量导入模板
  importTemplatesFromJSON: (templates: SOPTemplate[]) => { imported: number; skipped: number };

  // 实例操作
  startInstance: (templateId: string, incidentTitle: string) => string;
  setActiveInstance: (id: string | null) => void;
  updateCheckResult: (instanceId: string, checkId: string, data: Partial<SOPCheckResult>) => void;
  // 追加单条子步骤结果（SSH 自动执行时实时写入）
  appendSubStepResult: (
    instanceId: string,
    checkId: string,
    result: SOPSubStepResult
  ) => void;
  addExtraCheck: (instanceId: string, check: Omit<SOPCheckResult, 'checkId'>) => void;
  updateDiagnosis: (instanceId: string, field: keyof SOPInstance['diagnosis'], value: string) => void;
  updateWhiteboard: (instanceId: string, snapshot: string, svg: string) => void;
  setInstanceStatus: (instanceId: string, status: SOPInstance['status']) => void;
  deleteInstance: (id: string) => void;
  renderCheckCommand: (instanceId: string, checkId: string, varValues: Record<string, string>) => void;
  updatePlaceholderValues: (instanceId: string, values: Record<string, string>) => void;
}

// ======================== 内置 SOP 模板 ========================

const defaultTemplates: SOPTemplate[] = [
  {
    id: 'sop-service-down',
    name: '服务不可用排查',
    category: '服务异常',
    description: '适用于服务突发不可用、请求超时、502/503 场景',
    diagnosisHints: `**常见根因**\n- 进程 OOM 被 kill\n- 依赖服务（DB/Redis/MQ）连接耗尽\n- 磁盘满导致写入阻塞\n- 部署引入了不兼容变更`,
    checks: [
      {
        id: 'c1',
        order: 1,
        name: '检查进程状态',
        description: '确认服务进程是否存在、状态是否正常',
        command: 'ps aux | grep ${service_name} | grep -v grep',
        expectedNormal: '能看到进程 PID，状态为 S（sleeping）或 R（running）',
        abnormalSigns: '无输出 = 进程不存在；Z = 僵尸进程',
      },
      {
        id: 'c2',
        order: 2,
        name: '检查端口监听',
        description: '确认服务端口是否在监听',
        command: 'ss -tlnp | grep ${port}',
        expectedNormal: '能看到 LISTEN 状态',
        abnormalSigns: '无输出说明端口未监听，进程可能已退出',
      },
      {
        id: 'c3',
        order: 3,
        name: '查看最近错误日志',
        description: '从日志中获取 ERROR 及上下文',
        command: 'grep -C 5 "ERROR\\|Exception\\|FATAL" ${log_file} | tail -100',
        expectedNormal: '无 ERROR 输出',
        abnormalSigns: '关注 OOM / Connection refused / Timeout 等关键字',
      },
      {
        id: 'c4',
        order: 4,
        name: '检查系统资源',
        description: '确认 CPU / 内存 / 磁盘是否有瓶颈',
        command: 'top -bn1 | head -20 && df -h && free -h',
        expectedNormal: 'CPU < 80%，内存可用 > 20%，磁盘使用 < 85%',
        abnormalSigns: '磁盘满 100% 是常见故障根因',
      },
      {
        id: 'c5',
        order: 5,
        name: '检查系统日志（OOM）',
        description: '确认是否有 OOM Killer 触发记录',
        command: 'dmesg | grep -i "oom\\|kill" | tail -20',
        expectedNormal: '无输出',
        abnormalSigns: '有 oom-killer 触发记录说明内存耗尽',
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'sop-slow-response',
    name: '服务响应慢排查',
    category: '性能劣化',
    description: '适用于 P99 延迟突增、接口超时增多场景',
    diagnosisHints: `**常见根因**\n- GC Stop-The-World 过于频繁\n- 数据库慢查询（缺少索引 / 大数据量扫描）\n- 线程池耗尽，请求排队等待\n- 下游依赖响应变慢（级联超时）`,
    checks: [
      {
        id: 'c1',
        order: 1,
        name: '查看 CPU 使用情况',
        description: '定位高 CPU 进程和线程',
        command: 'top -Hp ${pid} | head -30',
        expectedNormal: '无明显高 CPU 线程',
        abnormalSigns: '某线程 CPU 持续 > 90% 可能是死循环或 GC',
      },
      {
        id: 'c2',
        order: 2,
        name: '查看 GC 日志',
        description: '确认 Full GC 是否频繁',
        command: 'grep -E "Full GC|GC pause" ${gc_log} | tail -30',
        expectedNormal: 'Full GC 次数低，单次时间 < 500ms',
        abnormalSigns: 'Full GC 每分钟多次，或 STW 超过 1s',
      },
      {
        id: 'c3',
        order: 3,
        name: '检查线程池队列',
        description: '查看线程池积压情况（需接入 actuator 或 metrics）',
        command: 'curl -s http://localhost:${port}/actuator/metrics/executor.queued | python3 -m json.tool',
        expectedNormal: '队列长度接近 0',
        abnormalSigns: '队列持续增长说明消费速度跟不上生产速度',
      },
      {
        id: 'c4',
        order: 4,
        name: '抓取慢查询',
        description: '从数据库获取最近的慢查询记录',
        command: 'mysql -h ${db_host} -u ${db_user} -p${db_pass} -e "SELECT * FROM information_schema.processlist WHERE time > 3 ORDER BY time DESC LIMIT 20;"',
        expectedNormal: '无长时间运行的查询',
        abnormalSigns: '有 time > 10s 的查询说明存在慢 SQL',
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'sop-network',
    name: '网络连通性排查',
    category: '网络问题',
    description: '适用于服务间调用超时、连接被拒绝场景',
    diagnosisHints: `**常见根因**\n- 防火墙/安全组规则阻断\n- DNS 解析失败或返回错误 IP\n- 目标服务端口未监听\n- 网络路由异常`,
    checks: [
      {
        id: 'c1',
        order: 1,
        name: 'Ping 连通性',
        description: '基础网络层连通性验证',
        command: 'ping -c 4 ${target_host}',
        expectedNormal: '4/4 packets received，延迟正常',
        abnormalSigns: '100% packet loss = 网络不通',
      },
      {
        id: 'c2',
        order: 2,
        name: '端口连通性',
        description: '验证目标端口是否可达',
        command: 'telnet ${target_host} ${target_port} || nc -zv ${target_host} ${target_port}',
        expectedNormal: 'Connected to ... 或 open',
        abnormalSigns: 'Connection refused = 端口未监听；timeout = 被防火墙拦截',
      },
      {
        id: 'c3',
        order: 3,
        name: 'DNS 解析',
        description: '验证域名解析是否正确',
        command: 'nslookup ${target_host} && dig ${target_host}',
        expectedNormal: '解析到预期 IP 地址',
        abnormalSigns: 'NXDOMAIN = 域名不存在；解析到错误 IP = DNS 污染',
      },
      {
        id: 'c4',
        order: 4,
        name: '路由追踪',
        description: '定位网络断点在哪一跳',
        command: 'traceroute -n ${target_host}',
        expectedNormal: '每跳延迟逐渐增加，最终到达目标',
        abnormalSigns: '某跳开始 *** 说明该节点丢包或阻断',
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

// 确保所有默认模板的 checks 都有 subSteps 字段（兼容旧数据）
defaultTemplates.forEach((t) => {
  t.checks.forEach((c) => { if (!c.subSteps) c.subSteps = []; });
});

// 初始化实例的 checkResults（基于模板的 checks，兼容历史脏数据）
function initCheckResults(checks: SOPCheck[] | undefined): SOPCheckResult[] {
  return (checks ?? []).map((c) => ({
    checkId:        c.id,
    checkName:      c.name,
    command:        c.command,
    output:         '',
    conclusion:     '',
    status:         'pending',
    // 创建实例时快照子步骤，后续模板修改不影响已有实例
    subSteps:       (c.subSteps ?? []).map((s) => ({ ...s })),
    subStepResults: [],
  }));
}

export const useSOPStore = create<SOPStore>()(
  persist(
    (set, get) => ({
      templates: defaultTemplates,
      instances: [],
      activeInstanceId: null,

      addTemplate: (data) => {
        const id = generateId();
        const now = Date.now();
        set((s) => ({
          templates: [
            ...s.templates,
            { ...data, id, createdAt: now, updatedAt: now },
          ],
        }));
        return id;
      },

      updateTemplate: (id, data) => {
        set((s) => ({
          templates: s.templates.map((t) =>
            t.id === id ? { ...t, ...data, updatedAt: Date.now() } : t
          ),
        }));
      },

      deleteTemplate: (id) => {
        set((s) => ({
          templates: s.templates.filter((t) => t.id !== id),
        }));
      },

      importTemplatesFromMarkdown: (md) => {
        const parsed = parseSOPTemplatesFromMarkdown(md);
        let imported = 0;
        let skipped = 0;
        const now = Date.now();
        set((s) => {
          const existingNames = new Set(s.templates.map((t) => t.name));
          const newTemplates: SOPTemplate[] = [];
          parsed.forEach((data) => {
            if (existingNames.has(data.name)) {
              skipped++;
            } else {
              newTemplates.push({ ...data, id: generateId(), createdAt: now, updatedAt: now });
              existingNames.add(data.name);
              imported++;
            }
          });
          return { templates: [...s.templates, ...newTemplates] };
        });
        return { imported, skipped };
      },

      importTemplatesFromJSON: (templates) => {
        let imported = 0;
        let skipped = 0;
        const now = Date.now();
        set((s) => {
          const existingIds = new Set(s.templates.map((t) => t.id));
          const newTemplates: SOPTemplate[] = [];
          for (const raw of templates) {
            // 跳过无效对象（null、非对象、缺少必要字段）
            if (!raw || typeof raw !== 'object') continue;
            if (!raw.name || typeof raw.name !== 'string') continue;
            if (existingIds.has(raw.id)) { skipped++; continue; }

            // 规范化：确保 checks 是合法数组，子步骤同样合法
            const checks: SOPCheck[] = Array.isArray(raw.checks) ? raw.checks : [];
            checks.forEach((c) => { if (!Array.isArray(c.subSteps)) c.subSteps = []; });

            newTemplates.push({
              ...raw,
              id:        raw.id        || generateId(),
              createdAt: raw.createdAt || now,
              updatedAt: raw.updatedAt || now,
              checks,
            });
            existingIds.add(raw.id);
            imported++;
          }
          return { templates: [...s.templates, ...newTemplates] };
        });
        return { imported, skipped };
      },

      startInstance: (templateId, incidentTitle) => {
        const template = get().templates.find((t) => t.id === templateId);
        if (!template) return '';
        const id = generateId();
        const instance: SOPInstance = {
          id,
          templateId,
          templateName: template.name,
          incidentTitle,
          status: 'investigating',
          checkResults: initCheckResults(template.checks),
          extraChecks: [],
          variables: template.variables ? JSON.parse(JSON.stringify(template.variables)) : [],
          diagnosis: {
            phenomenon: '',
            rootCause: '',
            solution: '',
            prevention: '',
          },
          createdAt: Date.now(),
        };
        set((s) => ({
          instances: [instance, ...s.instances],
          activeInstanceId: id,
        }));
        return id;
      },

      setActiveInstance: (id) => set({ activeInstanceId: id }),

      updateCheckResult: (instanceId, checkId, data) => {
        set((s) => ({
          instances: s.instances.map((inst) => {
            if (inst.id !== instanceId) return inst;
            return {
              ...inst,
              checkResults: inst.checkResults.map((r) =>
                r.checkId === checkId ? { ...r, ...data } : r
              ),
            };
          }),
        }));
      },

      appendSubStepResult: (instanceId, checkId, result) => {
        set((s) => ({
          instances: s.instances.map((inst) => {
            if (inst.id !== instanceId) return inst;
            return {
              ...inst,
              checkResults: inst.checkResults.map((r) => {
                if (r.checkId !== checkId) return r;
                const subStepResults = [...(r.subStepResults ?? []), result];
                // 聚合输出：所有子步骤 stdout 合并
                const output = subStepResults
                  .map((sr) => `[${sr.name}]\n${sr.stdout}`)
                  .join('\n\n');
                // 若有任一子步骤 exit ≠ 0，检查步骤标记为异常
                const hasFailure = subStepResults.some((sr) => sr.exitCode !== 0);
                const allDone = subStepResults.length === (r.subSteps?.length || 0);
                return {
                  ...r,
                  subStepResults,
                  output,
                  status: hasFailure
                    ? 'abnormal'
                    : allDone
                    ? 'normal'
                    : r.status,
                };
              }),
            };
          }),
        }));
      },

      addExtraCheck: (instanceId, check) => {
        const checkId = generateId();
        set((s) => ({
          instances: s.instances.map((inst) => {
            if (inst.id !== instanceId) return inst;
            return {
              ...inst,
              extraChecks: [
                ...inst.extraChecks,
                { ...check, checkId, status: 'pending',
                  subSteps: check.subSteps ?? [],
                  subStepResults: check.subStepResults ?? [] },
              ],
            };
          }),
        }));
      },

      updateDiagnosis: (instanceId, field, value) => {
        set((s) => ({
          instances: s.instances.map((inst) => {
            if (inst.id !== instanceId) return inst;
            return {
              ...inst,
              diagnosis: { ...inst.diagnosis, [field]: value },
            };
          }),
        }));
      },

      updateWhiteboard: (instanceId, snapshot, svg) => {
        set((s) => ({
          instances: s.instances.map((inst) => {
            if (inst.id !== instanceId) return inst;
            return {
              ...inst,
              whiteboardSnapshot: snapshot,
              whiteboardSvg: svg,
            };
          }),
        }));
      },

      setInstanceStatus: (instanceId, status) => {
        set((s) => ({
          instances: s.instances.map((inst) => {
            if (inst.id !== instanceId) return inst;
            return {
              ...inst,
              status,
              resolvedAt: status === 'resolved' ? Date.now() : inst.resolvedAt,
            };
          }),
        }));
      },

      deleteInstance: (id) => {
        set((s) => ({
          instances: s.instances.filter((i) => i.id !== id),
          activeInstanceId:
            s.activeInstanceId === id ? null : s.activeInstanceId,
        }));
      },

      renderCheckCommand: (instanceId, checkId, varValues) => {
        set((s) => ({
          instances: s.instances.map((inst) => {
            if (inst.id !== instanceId) return inst;
            return {
              ...inst,
              checkResults: inst.checkResults.map((r) => {
                if (r.checkId !== checkId) return r;
                const template = s.templates
                  .find((t) => t.id === inst.templateId)
                  ?.checks.find((c) => c.id === checkId);
                if (!template) return r;
                return {
                  ...r,
                  command: renderTemplate(template.command, varValues),
                };
              }),
            };
          }),
        }));
      },

      updatePlaceholderValues: (instanceId, values) => {
        set((s) => ({
          instances: s.instances.map((inst) =>
            inst.id === instanceId
              ? { ...inst, placeholderValues: { ...inst.placeholderValues, ...values } }
              : inst
          ),
        }));
      },
    }),
    {
      name: 'devutility-sop',
      partialize: (state) => ({
        templates: state.templates,
        instances: state.instances,
        activeInstanceId: state.activeInstanceId,
      }),
    }
  )
);
