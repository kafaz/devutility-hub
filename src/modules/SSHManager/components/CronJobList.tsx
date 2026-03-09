import { ClockCircleOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Popconfirm, Space, Switch, Table, Tag, Typography } from 'antd';
import React, { useState } from 'react';
import type { CronJob } from '../../../types';
import { useCronStore } from '../store/cronStore';
import CronJobEditor from './CronJobEditor';

const { Text } = Typography;

const CronJobList: React.FC = () => {
  const { jobs, toggleJob, deleteJob } = useCronStore();
  const [editingJob, setEditingJob] = useState<CronJob | null | 'new'>(null);

  const columns = [
    {
      title: '任务名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => <Text strong>{text}</Text>,
    },
    {
      title: '执行规则',
      dataIndex: 'cronExpr',
      key: 'cronExpr',
      render: (expr: string) => (
        <Tag color="geekblue" icon={<ClockCircleOutlined />}>
          {expr}
        </Tag>
      ),
    },
    {
      title: '目标数',
      key: 'targets',
      render: (_: any, record: CronJob) => {
        const groups = record.targetGroupIds.length;
        const sessions = record.targetSessions.length;
        if (groups === 0 && sessions === 0) return <Text type="secondary">无</Text>;
        return (
          <Space size={4}>
            {groups > 0 && <Tag color="orange">{groups} 会话组</Tag>}
            {sessions > 0 && <Tag color="blue">{sessions} 节点</Tag>}
          </Space>
        );
      },
    },
    {
      title: '下次执行时间',
      dataIndex: 'nextRunAt',
      key: 'nextRunAt',
      render: (time?: number) => time ? new Date(time).toLocaleString() : <Text type="secondary">-</Text>,
    },
    {
      title: '状态',
      key: 'enabled',
      render: (_: any, record: CronJob) => (
        <Switch
          checked={record.enabled}
          onChange={(checked) => toggleJob(record.id, checked)}
          checkedChildren="启用"
          unCheckedChildren="停用"
          size="small"
        />
      ),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: CronJob) => (
        <Space size="middle">
          <Button
            type="text"
            icon={<EditOutlined />}
            size="small"
            onClick={() => setEditingJob(record)}
          />
          <Popconfirm
            title="确认删除该定时任务？"
            onConfirm={() => deleteJob(record.id)}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button type="text" danger icon={<DeleteOutlined />} size="small" />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: '0 12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <Text strong style={{ fontSize: 16 }}>定时任务 (Cron)</Text>
          <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
            在这里配置的定时任务依赖当前页面的运行。如果关闭或刷新页面，任务将暂停。
          </Text>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setEditingJob('new')}
        >
          新建定时任务
        </Button>
      </div>

      <Table
        columns={columns}
        dataSource={jobs}
        rowKey="id"
        pagination={false}
        size="small"
      />

      <CronJobEditor
        open={!!editingJob}
        initialValue={editingJob === 'new' ? undefined : editingJob}
        onCancel={() => setEditingJob(null)}
        onSave={() => setEditingJob(null)}
      />
    </div>
  );
};

export default CronJobList;
