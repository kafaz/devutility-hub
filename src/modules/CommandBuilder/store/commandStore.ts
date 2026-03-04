import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CommandTemplate, VariableConfig, StringSnippet } from '../../../types';
import {
  generateId,
  extractTemplateVariables,
  inferVariableType,
} from '../../../utils';

// 参数值历史: key = `${templateId}::${varName}`, value = 最近10条
type ParamHistory = Record<string, string[]>;

const PARAM_HISTORY_MAX = 10;

interface CommandStore {
  templates: CommandTemplate[];
  snippets: StringSnippet[];
  selectedTemplateId: string | null;
  variableValues: Record<string, string>;
  paramHistory: ParamHistory;

  addTemplate: (
    data: Omit<CommandTemplate, 'id' | 'createdAt' | 'updatedAt'>
  ) => void;
  updateTemplate: (id: string, data: Partial<CommandTemplate>) => void;
  deleteTemplate: (id: string) => void;
  selectTemplate: (id: string | null) => void;
  setVariableValue: (name: string, value: string) => void;
  commitVariableHistory: () => void; // 执行/复制时提交当前值到历史
  resetVariableValues: () => void;
  clearParamHistory: (templateId: string, varName?: string) => void;
  getVarHistory: (templateId: string, varName: string) => string[];

  addSnippet: (data: Omit<StringSnippet, 'id'>) => void;
  deleteSnippet: (id: string) => void;

  importTemplates: (templates: CommandTemplate[]) => void;
}

const defaultTemplates: CommandTemplate[] = [
  {
    id: 'tpl-1',
    name: 'SSH 远程登录',
    category: '网络连接',
    description: '通过 SSH 登录远程主机',
    template: 'ssh ${user}@${host} -p ${port}',
    variables: [
      { name: 'user', label: '用户名', type: 'text', required: true, defaultValue: 'root', placeholder: 'root' },
      { name: 'host', label: '主机地址', type: 'text', required: true, placeholder: '192.168.1.1' },
      { name: 'port', label: '端口', type: 'number', required: true, defaultValue: '22', placeholder: '22' },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'tpl-2',
    name: 'SCP 文件传输',
    category: '文件操作',
    description: '从远程主机拷贝文件到本地',
    template: 'scp ${user}@${host}:${remote_path} ${local_path}',
    variables: [
      { name: 'user', label: '用户名', type: 'text', required: true, defaultValue: 'root' },
      { name: 'host', label: '主机地址', type: 'text', required: true, placeholder: '192.168.1.1' },
      { name: 'remote_path', label: '远程路径', type: 'path', required: true, placeholder: '/var/log/app.log' },
      { name: 'local_path', label: '本地路径', type: 'path', required: true, placeholder: './' },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'tpl-3',
    name: 'grep 日志过滤',
    category: '日志分析',
    description: '从日志文件中过滤关键词',
    template: 'grep -n "${keyword}" ${file_path} | tail -${lines}',
    variables: [
      { name: 'keyword', label: '关键词', type: 'text', required: true, placeholder: 'ERROR' },
      { name: 'file_path', label: '文件路径', type: 'path', required: true, placeholder: '/var/log/app.log' },
      { name: 'lines', label: '显示行数', type: 'number', required: true, defaultValue: '100' },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'tpl-4',
    name: 'Docker 运行容器',
    category: 'Docker',
    description: '启动一个 Docker 容器',
    template:
      'docker run -d --name ${container_name} -p ${host_port}:${container_port} ${image}:${tag}',
    variables: [
      { name: 'container_name', label: '容器名称', type: 'text', required: true, placeholder: 'my-app' },
      { name: 'host_port', label: '宿主机端口', type: 'number', required: true, placeholder: '8080' },
      { name: 'container_port', label: '容器端口', type: 'number', required: true, placeholder: '8080' },
      { name: 'image', label: '镜像名', type: 'text', required: true, placeholder: 'nginx' },
      { name: 'tag', label: 'Tag', type: 'text', required: true, defaultValue: 'latest' },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'tpl-5',
    name: 'find 文件查找',
    category: '文件操作',
    description: '在指定目录下查找文件',
    template: 'find ${dir} -name "${pattern}" -type f -mtime -${days}',
    variables: [
      { name: 'dir', label: '目录', type: 'path', required: true, defaultValue: '.' },
      { name: 'pattern', label: '文件名模式', type: 'text', required: true, placeholder: '*.log' },
      { name: 'days', label: '最近天数', type: 'number', required: true, defaultValue: '7' },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

export const useCommandStore = create<CommandStore>()(
  persist(
    (set, get) => ({
      templates: defaultTemplates,
      snippets: [],
      selectedTemplateId: null,
      variableValues: {},
      paramHistory: {},

      addTemplate: (data) => {
        const now = Date.now();
        const id = generateId();
        // 自动从模板字符串推断变量
        const existingNames = new Set(data.variables.map((v) => v.name));
        const detectedVars = extractTemplateVariables(data.template);
        const autoVars: VariableConfig[] = detectedVars
          .filter((n) => !existingNames.has(n))
          .map((n) => ({
            name: n,
            label: n,
            type: inferVariableType(n),
            required: true,
          }));
        set((s) => ({
          templates: [
            ...s.templates,
            {
              ...data,
              id,
              variables: [...data.variables, ...autoVars],
              createdAt: now,
              updatedAt: now,
            },
          ],
        }));
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
          selectedTemplateId:
            s.selectedTemplateId === id ? null : s.selectedTemplateId,
        }));
      },

      selectTemplate: (id) => {
        const template = get().templates.find((t) => t.id === id);
        const initialValues: Record<string, string> = {};
        if (template) {
          template.variables.forEach((v) => {
            initialValues[v.name] = v.defaultValue ?? '';
          });
        }
        set({ selectedTemplateId: id, variableValues: initialValues });
      },

      setVariableValue: (name, value) => {
        set((s) => ({
          variableValues: { ...s.variableValues, [name]: value },
        }));
      },

      // 将当前所有变量值写入历史记录（在复制命令时触发）
      commitVariableHistory: () => {
        const { selectedTemplateId, variableValues } = get();
        if (!selectedTemplateId) return;
        set((s) => {
          const next = { ...s.paramHistory };
          Object.entries(variableValues).forEach(([varName, val]) => {
            if (!val) return;
            const key = `${selectedTemplateId}::${varName}`;
            const existing = next[key] ?? [];
            // 去重，新值放最前
            const deduped = [val, ...existing.filter((v) => v !== val)].slice(
              0,
              PARAM_HISTORY_MAX
            );
            next[key] = deduped;
          });
          return { paramHistory: next };
        });
      },

      resetVariableValues: () => {
        const template = get().templates.find(
          (t) => t.id === get().selectedTemplateId
        );
        const initialValues: Record<string, string> = {};
        if (template) {
          template.variables.forEach((v) => {
            initialValues[v.name] = v.defaultValue ?? '';
          });
        }
        set({ variableValues: initialValues });
      },

      clearParamHistory: (templateId, varName) => {
        set((s) => {
          const next = { ...s.paramHistory };
          if (varName) {
            delete next[`${templateId}::${varName}`];
          } else {
            Object.keys(next)
              .filter((k) => k.startsWith(`${templateId}::`))
              .forEach((k) => delete next[k]);
          }
          return { paramHistory: next };
        });
      },

      getVarHistory: (templateId, varName) => {
        return get().paramHistory[`${templateId}::${varName}`] ?? [];
      },

      addSnippet: (data) => {
        set((s) => ({
          snippets: [...s.snippets, { ...data, id: generateId() }],
        }));
      },

      deleteSnippet: (id) => {
        set((s) => ({
          snippets: s.snippets.filter((sn) => sn.id !== id),
        }));
      },

      importTemplates: (templates) => {
        set((s) => ({
          templates: [
            ...s.templates,
            ...templates.filter(
              (t) => !s.templates.some((existing) => existing.id === t.id)
            ),
          ],
        }));
      },
    }),
    {
      name: 'devutility-commands',
      partialize: (state) => ({
        templates: state.templates,
        snippets: state.snippets,
        paramHistory: state.paramHistory,
      }),
    }
  )
);
