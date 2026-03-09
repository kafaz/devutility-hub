/**
 * GitRepoConfig — Git 仓库 SOP 源管理弹窗
 *
 * 功能：
 *   1. 新增 / 编辑 / 删除 Git 仓库源配置（URL、分支、路径、PAT Token）
 *   2. 针对每个源单独触发「同步」操作：
 *      - 调用本地代理服务 POST /api/sop/git-sync
 *      - 将返回的 .md / .json 文件解析并批量导入 SOP 模板库
 *   3. 展示每个源的上次同步时间和结果（新增 N / 跳过 N / 错误）
 *
 * 与外部模块的交互：
 *   - useSOPGitStore  ← 持久化 Git 源配置（localStorage）
 *   - useSOPStore     ← 调用 importTemplatesFromMarkdown / importTemplatesFromJSON
 *   - server/index.js ← POST /api/sop/git-sync  REST 端点（Node.js 代理）
 */

import React, { useState } from 'react';
import {
  Modal, Button, Table, Space, Tag, Tooltip, Popconfirm,
  Form, Input, Switch, message, Typography, Badge,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined,
  SyncOutlined, CheckCircleOutlined, ExclamationCircleOutlined,
  GithubOutlined,
} from '@ant-design/icons';
import type { GitRepoSource } from '../../../types';
import { useSOPGitStore } from '../store/sopGitStore';
import { useSOPStore } from '../store/sopStore';
import { generateId } from '../../../utils';
import type { SOPTemplate } from '../../../types';

const { Text } = Typography;

// 代理服务地址，与 SSHManager 保持一致
const PROXY_BASE = 'http://127.0.0.1:3001';

interface Props {
  open: boolean;
  onClose: () => void;
}

// ─── 表单字段 ────────────────────────────────────────────────────────────────

interface SourceFormValues {
  name: string;
  url: string;
  branch: string;
  path: string;
  token?: string;
  enabled: boolean;
}

// ─── 单源同步逻辑（调用代理，解析文件，导入模板） ───────────────────────────

async function syncSource(
  source: GitRepoSource,
  importMarkdown: (md: string) => { imported: number; skipped: number },
  importJSON: (tpls: SOPTemplate[]) => { imported: number; skipped: number }
): Promise<{ imported: number; skipped: number; files: number; error?: string }> {
  let resp: Response;
  try {
    resp = await fetch(`${PROXY_BASE}/api/sop/git-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url:    source.url,
        branch: source.branch || 'main',
        path:   source.path   || '',
        token:  source.token  || undefined,
      }),
    });
  } catch (e) {
    throw new Error(`无法连接本地代理服务（请确认 server 已启动）: ${(e as Error).message}`);
  }

  const data = await resp.json();
  if (!data.ok) throw new Error(data.error ?? '同步失败');

  const files: { name: string; relativePath: string; content: string; ext: string }[] = data.files;
  let totalImported = 0;
  let totalSkipped  = 0;

  for (const file of files) {
    try {
      if (file.ext === 'md') {
        const r = importMarkdown(file.content);
        totalImported += r.imported;
        totalSkipped  += r.skipped;
      } else if (file.ext === 'json') {
        let parsed: unknown;
        try { parsed = JSON.parse(file.content); } catch { continue; }

        // 支持两种 JSON 格式：单个模板对象 or 模板数组
        const tpls: SOPTemplate[] = Array.isArray(parsed)
          ? (parsed as SOPTemplate[])
          : [parsed as SOPTemplate];

        // 确保每个模板有合法 id（防止重复 id 冲突）
        const normalised = tpls.map((t) => ({
          ...t,
          id:        t.id        || generateId(),
          createdAt: t.createdAt || Date.now(),
          updatedAt: t.updatedAt || Date.now(),
        }));

        const r = importJSON(normalised);
        totalImported += r.imported;
        totalSkipped  += r.skipped;
      }
    } catch { /* 单文件解析失败不影响其余文件 */ }
  }

  return { imported: totalImported, skipped: totalSkipped, files: files.length };
}

// ─── 主组件 ──────────────────────────────────────────────────────────────────

const GitRepoConfig: React.FC<Props> = ({ open, onClose }) => {
  const { sources, addSource, updateSource, deleteSource, setLastResult } = useSOPGitStore();
  const { importTemplatesFromMarkdown, importTemplatesFromJSON } = useSOPStore();

  const [messageApi, contextHolder] = message.useMessage();

  // 编辑弹窗状态
  const [editOpen, setEditOpen]             = useState(false);
  const [editingSource, setEditingSource]   = useState<GitRepoSource | null>(null);
  const [form]                              = Form.useForm<SourceFormValues>();

  // 每个源独立的同步 loading 状态
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());

  // ── 同步操作 ────────────────────────────────────────────────────────────────

  const handleSync = async (src: GitRepoSource) => {
    setSyncingIds((prev) => new Set(prev).add(src.id));
    try {
      const result = await syncSource(src, importTemplatesFromMarkdown, importTemplatesFromJSON);
      setLastResult(src.id, result);
      messageApi.success(
        `「${src.name}」同步完成：读取 ${result.files} 个文件，` +
        `新增 ${result.imported} 个模板${result.skipped > 0 ? `，跳过 ${result.skipped} 个` : ''}`
      );
    } catch (e) {
      const errMsg = (e as Error).message;
      setLastResult(src.id, { imported: 0, skipped: 0, files: 0, error: errMsg });
      messageApi.error(`「${src.name}」同步失败：${errMsg}`);
    } finally {
      setSyncingIds((prev) => { const s = new Set(prev); s.delete(src.id); return s; });
    }
  };

  // ── 一键同步所有启用的源 ────────────────────────────────────────────────────

  const handleSyncAll = async () => {
    const enabled = sources.filter((s) => s.enabled);
    if (enabled.length === 0) {
      messageApi.warning('没有已启用的 Git 源');
      return;
    }
    await Promise.all(enabled.map(handleSync));
  };

  // ── 表单提交（新增 or 编辑） ────────────────────────────────────────────────

  const handleFormOk = async () => {
    const values = await form.validateFields();
    if (editingSource) {
      updateSource(editingSource.id, values);
      messageApi.success('配置已更新');
    } else {
      addSource({ ...values, branch: values.branch || 'main', path: values.path || '' });
      messageApi.success('已添加 Git 源');
    }
    setEditOpen(false);
    form.resetFields();
  };

  const openAdd = () => {
    setEditingSource(null);
    form.resetFields();
    form.setFieldsValue({ branch: 'main', enabled: true });
    setEditOpen(true);
  };

  const openEdit = (src: GitRepoSource) => {
    setEditingSource(src);
    form.setFieldsValue({
      name:    src.name,
      url:     src.url,
      branch:  src.branch,
      path:    src.path,
      token:   src.token ?? '',
      enabled: src.enabled,
    });
    setEditOpen(true);
  };

  // ── 表格列定义 ──────────────────────────────────────────────────────────────

  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, rec: GitRepoSource) => (
        <Space size={6}>
          <GithubOutlined style={{ color: '#a1a1aa' }} />
          <Text strong style={{ fontSize: 13 }}>{name}</Text>
          {!rec.enabled && <Tag color="default" style={{ fontSize: 10 }}>已禁用</Tag>}
        </Space>
      ),
    },
    {
      title: '仓库地址',
      dataIndex: 'url',
      key: 'url',
      render: (url: string, rec: GitRepoSource) => (
        <div>
          <Text style={{ fontSize: 12 }} ellipsis={{ tooltip: url }}>{url}</Text>
          <div>
            <Tag style={{ fontSize: 10, marginTop: 2 }}>{rec.branch}</Tag>
            {rec.path && <Tag style={{ fontSize: 10 }} color="blue">{rec.path}</Tag>}
            {rec.token && <Tag style={{ fontSize: 10 }} color="gold">私有仓库</Tag>}
          </div>
        </div>
      ),
    },
    {
      title: '上次同步',
      key: 'lastSync',
      width: 160,
      render: (_: unknown, rec: GitRepoSource) => {
        if (!rec.lastResult && !rec.lastSynced) {
          return <Text type="secondary" style={{ fontSize: 12 }}>从未同步</Text>;
        }
        const r = rec.lastResult;
        const time = rec.lastSynced
          ? new Date(rec.lastSynced).toLocaleString('zh-CN', { hour12: false })
          : '';
        if (r?.error) {
          return (
            <Tooltip title={r.error}>
              <Badge status="error" />
              <Text type="danger" style={{ fontSize: 11, marginLeft: 4 }}>失败</Text>
              <div><Text type="secondary" style={{ fontSize: 10 }}>{time}</Text></div>
            </Tooltip>
          );
        }
        return (
          <div>
            <Space size={4}>
              <CheckCircleOutlined style={{ color: '#22c55e', fontSize: 12 }} />
              <Text style={{ fontSize: 11 }}>
                +{r?.imported ?? 0} 新增，跳过 {r?.skipped ?? 0}
              </Text>
            </Space>
            <div><Text type="secondary" style={{ fontSize: 10 }}>{time}</Text></div>
          </div>
        );
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (_: unknown, rec: GitRepoSource) => (
        <Space size={4}>
          <Tooltip title="立即同步">
            <Button
              size="small"
              type="primary"
              ghost
              icon={<SyncOutlined spin={syncingIds.has(rec.id)} />}
              disabled={!rec.enabled || syncingIds.has(rec.id)}
              onClick={() => handleSync(rec)}
            />
          </Tooltip>
          <Tooltip title="编辑配置">
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => openEdit(rec)}
            />
          </Tooltip>
          <Popconfirm
            title="删除此 Git 源？"
            description="已导入的模板不受影响"
            onConfirm={() => { deleteSource(rec.id); messageApi.success('已删除'); }}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // ── 渲染 ────────────────────────────────────────────────────────────────────

  return (
    <>
      {contextHolder}

      <Modal
        title={
          <Space>
            <GithubOutlined />
            Git 仓库 SOP 源管理
          </Space>
        }
        open={open}
        onCancel={onClose}
        footer={
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Button
              icon={<SyncOutlined />}
              onClick={handleSyncAll}
              disabled={sources.filter((s) => s.enabled).length === 0}
            >
              同步全部启用源
            </Button>
            <Space>
              <Button onClick={openAdd} icon={<PlusOutlined />} type="primary">
                添加 Git 源
              </Button>
              <Button onClick={onClose}>关闭</Button>
            </Space>
          </Space>
        }
        width={780}
        styles={{ body: { padding: '16px 0' } }}
      >
        {sources.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <ExclamationCircleOutlined style={{ fontSize: 32, color: '#a1a1aa', marginBottom: 12 }} />
            <div>
              <Text type="secondary">尚未配置任何 Git 仓库源</Text>
            </div>
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                点击「添加 Git 源」填写仓库 URL、分支和路径，即可批量加载 SOP 模板
              </Text>
            </div>
          </div>
        ) : (
          <Table
            dataSource={sources}
            columns={columns}
            rowKey="id"
            size="small"
            pagination={false}
          />
        )}
      </Modal>

      {/* 新增 / 编辑 Git 源表单弹窗 */}
      <Modal
        title={editingSource ? '编辑 Git 源' : '添加 Git 源'}
        open={editOpen}
        onOk={handleFormOk}
        onCancel={() => { setEditOpen(false); form.resetFields(); }}
        okText={editingSource ? '保存' : '添加'}
        cancelText="取消"
        width={520}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          style={{ marginTop: 12 }}
          initialValues={{ branch: 'main', path: '', enabled: true }}
        >
          <Form.Item
            name="name"
            label="显示名称"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input placeholder="例：公司 SOP 仓库" />
          </Form.Item>

          <Form.Item
            name="url"
            label="仓库 URL"
            rules={[
              { required: true, message: '请输入仓库地址' },
              {
                validator: (_, v) => {
                  try { new URL(v); return Promise.resolve(); }
                  catch { return Promise.reject('请输入合法的 URL'); }
                },
              },
            ]}
          >
            <Input placeholder="https://github.com/org/sop-templates.git" />
          </Form.Item>

          <Form.Item
            name="branch"
            label="分支"
            rules={[{ required: true, message: '请输入分支名' }]}
          >
            <Input placeholder="main" />
          </Form.Item>

          <Form.Item
            name="path"
            label="仓库内路径（留空表示根目录）"
            tooltip="只读取该路径下（含子目录）的 .md 和 .json 文件"
          >
            <Input placeholder="sops/templates" />
          </Form.Item>

          <Form.Item
            name="token"
            label="Personal Access Token（私有仓库鉴权，可选）"
            tooltip="GitHub PAT 需要 repo:read 权限；GitLab 填写 read_repository Token"
          >
            <Input.Password placeholder="ghp_xxxxxxxxxxxx" autoComplete="off" />
          </Form.Item>

          <Form.Item name="enabled" label="启用此源" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default GitRepoConfig;
