export type DiagnosticWorkbenchView = 'flow' | 'config' | 'history';

export interface DiagnosticWorkbenchSection {
  id: string;
  title: string;
  description: string;
}

export interface EvidenceDrawerSummaryInput {
  id: string;
  title: string;
}

export interface EvidenceDrawerSummary {
  count: number;
  recentTitles: string[];
}

const SECTION_MAP: Record<DiagnosticWorkbenchView, DiagnosticWorkbenchSection[]> = {
  flow: [
    {
      id: 'context',
      title: '定位上下文',
      description: '收口标题、症状、目标会话、结构化上下文和一次性 C 代码绑定。',
    },
    {
      id: 'execution',
      title: '执行与采集',
      description: '只保留当前 Playbook、召回与执行编排入口，以及运行状态提示。',
    },
    {
      id: 'evidence',
      title: '关键证据',
      description: '集中展示首个异常、证据簇、关键时序和证据篮摘要。',
    },
    {
      id: 'conclusion',
      title: '诊断结论',
      description: '保留当前 run 的摘要、根因假设、建议动作和可参考案例。',
    },
  ],
  config: [
    {
      id: 'playbook',
      title: 'Playbook 与 Agent 配置',
      description: '维护 collection steps、analysis rules、business actions 与场景元信息。',
    },
    {
      id: 'library',
      title: '场景命令库',
      description: '维护命令库、复用命令模板，并把建议命令加入 Playbook。',
    },
    {
      id: 'policy',
      title: '命令白名单策略',
      description: '查看和编辑命令白名单与固定安全规则。',
    },
  ],
  history: [
    {
      id: 'runs',
      title: '历史 Run',
      description: '浏览最近归档与知识库记录。',
    },
    {
      id: 'detail',
      title: 'Run 详情',
      description: '查看完整报告、findings、采集结果、业务动作和参考案例。',
    },
  ],
};

export function getDiagnosticWorkbenchSections(view: DiagnosticWorkbenchView) {
  return SECTION_MAP[view];
}

export function buildEvidenceDrawerSummary(items: EvidenceDrawerSummaryInput[]): EvidenceDrawerSummary {
  const normalized = Array.isArray(items) ? items : [];
  return {
    count: normalized.length,
    recentTitles: normalized
      .slice()
      .reverse()
      .slice(0, 3)
      .map((item) => item.title),
  };
}
