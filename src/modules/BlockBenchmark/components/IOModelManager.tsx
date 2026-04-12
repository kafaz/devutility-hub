import { DeleteOutlined, DownloadOutlined, UploadOutlined } from '@ant-design/icons';
import { Button, Card, Empty, message, Space, Table, Typography } from 'antd';
import React, { useRef } from 'react';
import { type IOModelConfig, useBenchmarkStore } from '../store/benchmarkStore';

const { Text, Title } = Typography;

const IOModelManager: React.FC = () => {
  const { savedModels, removeModel, setModels } = useBenchmarkStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    if (savedModels.length === 0) {
      message.warning('没有可导出的模板。');
      return;
    }
    const dataStr = JSON.stringify(savedModels, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `io_models_export_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    message.success('模板导出成功！');
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target?.result as string;
        const parsed = JSON.parse(text) as IOModelConfig[];
        if (Array.isArray(parsed) && parsed.every(m => m.id && m.name && m.io_model)) {
          setModels(parsed);
          message.success(`成功导入 ${parsed.length} 个模板`);
        } else {
          message.error('导入文件格式不正确，不是有效的 IO 模型数组。');
        }
      } catch (err: any) {
        message.error('解析 JSON 失败: ' + err.message);
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const columns = [
    { title: '模板名称', dataIndex: 'name', key: 'name' },
    { title: 'IO 引擎', dataIndex: 'io_model', key: 'io_model' },
    { title: 'Block Size', dataIndex: 'block_size', key: 'block_size' },
    { 
      title: '其他参数', 
      key: 'others',
      render: (_: any, r: IOModelConfig) => {
        let details = [];
        if (r.concurrency) details.push(`并发: ${r.concurrency}`);
        if (r.fio_engine) details.push(`Fio引擎: ${r.fio_engine}`);
        if (r.workload_profile) details.push(`RW: ${r.workload_profile}`);
        return <Text style={{ fontSize: 12 }}>{details.join(' | ')}</Text>;
      }
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: IOModelConfig) => (
        <Button danger type="text" icon={<DeleteOutlined />} onClick={() => removeModel(record.id)}>删除</Button>
      )
    }
  ];

  return (
    <Card size="small" title={<Title level={5} style={{ margin: 0 }}>自定义 IO 模型管理器</Title>} extra={
      <Space>
        {/* hidden file input for import */}
        <input 
          type="file" 
          accept="application/json" 
          ref={fileInputRef} 
          style={{ display: 'none' }} 
          onChange={handleImport}
        />
        <Button icon={<UploadOutlined />} onClick={() => fileInputRef.current?.click()}>导入 (Import)</Button>
        <Button icon={<DownloadOutlined />} onClick={handleExport}>导出 (Export)</Button>
      </Space>
    }>
      {savedModels.length === 0 ? (
        <Empty description="暂无预定义或导入的 IO 模型，可前往「压力与混沌测试」中新建保存。" />
      ) : (
        <Table 
          dataSource={savedModels} 
          columns={columns} 
          rowKey="id" 
          size="small" 
          pagination={{ pageSize: 5 }}
        />
      )}
    </Card>
  );
};

export default IOModelManager;
