import { Button, Card, Col, Divider, Form, Input, message, Row, Select, Switch } from 'antd';
import React, { useState } from 'react';
import { useBenchmarkStore, type IOModelConfig } from '../store/benchmarkStore';
import IOModelManager from './IOModelManager';

const TaskDispatcher: React.FC = () => {
  const [form] = Form.useForm();
  const { agents, startTask, savedModels, addModel } = useBenchmarkStore();
  const [taskMode, setTaskMode] = useState<'io' | 'chaos'>('io');

  // Used for dynamic IO fields
  const currentIoModel = Form.useWatch('io_model', form);

  const onFinish = async (values: any) => {
    try {
      const payload: any = {
        agent_id: values.agent_id,
        business_name: values.business_name,
      };

      if (taskMode === 'io') {
        payload.task_type = 'WRITE_TEST';
        payload.dispatch_count = 1;
        payload.params = {
          device: values.device,
          volume_id: values.volume_id,
          lba: String(values.lba),
          block_size: String(values.block_size),
          io_model: values.io_model,
          concurrency: String(values.concurrency),
          iterations: String(values.iterations),
          read_verify: values.read_verify ? 'true' : 'false',
        };

        if (values.io_model === 'fio') {
          payload.params.fio_engine = values.fio_engine;
          payload.params.workload_profile = values.workload_profile;
          payload.params.iodepth = String(values.iodepth);
        }
      } else {
        payload.task_type = 'CHAOS_INJECT';
        payload.params = {
          type: values.chaos_type,
          duration_ms: String(values.duration_ms),
          device: values.device, // fallback if needed
          expected_iops_max: String(values.expected_iops_max || ''),
          expected_bandwidth_mbps_max: String(values.expected_bandwidth_mbps_max || ''),
          expected_p99_latency_ms_max: String(values.expected_p99_latency_ms_max || ''),
        };
      }

      // remove empty expectation strings
      Object.keys(payload.params).forEach((key) => {
         if (payload.params[key] === '') delete payload.params[key];
      });

      await startTask(payload);
      message.success('Task dispatcher payload sent successfully!');
    } catch (e: any) {
       message.error('Failed to dispatch task: ' + e.message);
    }
  };

  const handleSaveModel = () => {
    const vals = form.getFieldsValue();
    if (!vals.business_name || !vals.io_model) {
      message.warning('请确保填入业务名称和选择了一个IO模型以作保存依据');
      return;
    }
    const modelParams: IOModelConfig = {
      id: vals.business_name + '_' + Date.now(),
      name: vals.business_name,
      io_model: vals.io_model,
      block_size: vals.block_size,
      concurrency: vals.concurrency,
      iterations: vals.iterations,
      fio_engine: vals.fio_engine,
      workload_profile: vals.workload_profile,
      iodepth: vals.iodepth,
    };
    addModel(modelParams);
    message.success('自定义 IO 模型已保存到仓库！');
  };

  const handleLoadModel = (modelId: string) => {
    const model = savedModels.find(m => m.id === modelId);
    if (!model) return;
    form.setFieldsValue(model);
    message.info(`已加载 ${model.name}`);
  };

  return (
    <Card bordered={false} bodyStyle={{ padding: 0 }}>
      {/* Top Section: Custom IO Model Import/Export UI */}
      <IOModelManager />
      <Divider />

      <div style={{ marginBottom: 16, display: 'flex', gap: 16 }}>
        <Select 
          value={taskMode} 
          onChange={setTaskMode} 
          style={{ width: 200 }}
          options={[
            { label: '分布式写与仲裁测试', value: 'io' },
            { label: '故障混沌与业务期望', value: 'chaos' },
          ]}
        />
        {taskMode === 'io' && savedModels.length > 0 && (
          <Select 
            placeholder="应用已保存的 IO 模型"
            style={{ width: 220 }}
            onChange={handleLoadModel}
            options={savedModels.map(m => ({ label: m.name, value: m.id }))}
          />
        )}
      </div>

      <Form form={form} layout="vertical" onFinish={onFinish} initialValues={{
         business_name: 'test-case-01',
         lba: '0',
         block_size: '4096',
         io_model: 'sync',
         concurrency: '8',
         iterations: '64',
         read_verify: true,
         chaos_type: 'network_delay',
         duration_ms: '1000'
      }}>
        <Row gutter={16}>
          <Col span={8}>
            <Form.Item label="目标 Agent/节点" name="agent_id" rules={[{ required: true }]}>
              <Select options={agents.map(a => ({ label: `${a.id} (${a.status})`, value: a.id }))} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="业务名称 (Business Name)" name="business_name" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          </Col>
        </Row>

        {taskMode === 'io' ? (
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item label="目标块设备" name="device" rules={[{ required: true }]}>
                <Input placeholder="/dev/sdb" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="Volume ID (仲裁窗口共享)" name="volume_id" rules={[{ required: true }]}>
                <Input placeholder="shared-vol-01" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="LBA 起点" name="lba">
                <Input type="number" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="Block Size (Bytes)" name="block_size">
                <Input type="number" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="IO 模型" name="io_model">
                <Select options={[
                  { label: 'Sync', value: 'sync' },
                  { label: 'Direct', value: 'direct' },
                  { label: 'Simulated', value: 'simulated' },
                  { label: 'FIO', value: 'fio' },
                ]} />
              </Form.Item>
            </Col>
            <Col span={4}>
               <Form.Item label="并发数" name="concurrency">
                <Input type="number" />
              </Form.Item>
            </Col>
             <Col span={4}>
               <Form.Item label="迭代次数 (重复IO)" name="iterations">
                <Input type="number" />
              </Form.Item>
            </Col>
            
            {currentIoModel === 'fio' && (
              <>
                <Col span={8}>
                  <Form.Item label="FIO 引擎" name="fio_engine">
                    <Select options={[
                      { label: 'libaio', value: 'libaio' },
                      { label: 'io_uring', value: 'io_uring' },
                      { label: 'psync', value: 'psync' },
                    ]} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="读写负载特征 (Workload)" name="workload_profile">
                    <Select options={[
                      { label: 'randread', value: 'randread' },
                      { label: 'randwrite', value: 'randwrite' },
                      { label: 'read', value: 'read' },
                      { label: 'write', value: 'write' },
                      { label: 'randrw (混合)', value: 'randrw' },
                    ]} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="队列深度 (iodepth)" name="iodepth">
                    <Input type="number" placeholder="e.g. 32" />
                  </Form.Item>
                </Col>
              </>
            )}

            <Col span={24}>
               <Form.Item label="强制 LBA 一致性校验 (Read Verify)" name="read_verify" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>
        ) : (
          <Row gutter={16}>
             <Col span={8}>
              <Form.Item label="混沌注入类型" name="chaos_type">
                <Select options={[
                  { label: '网络延迟 (network_delay)', value: 'network_delay' },
                  { label: 'IO 卡顿 (io_stuck)', value: 'io_stuck' },
                ]} />
              </Form.Item>
            </Col>
             <Col span={8}>
              <Form.Item label="持续时间 (ms)" name="duration_ms">
                <Input type="number" />
              </Form.Item>
            </Col>
             <Col span={8}>
              <Form.Item label="作用块设备 (当为 IO 故障时)" name="device">
                <Input placeholder="/dev/sdb" />
              </Form.Item>
            </Col>

            {/* Expectations */}
            <Col span={24}>
              <Card size="small" title="控制面断言预期 (Expectations)">
                 <Row gutter={16}>
                   <Col span={8}>
                      <Form.Item label="最大允许 IOPS (expected_iops_max)" name="expected_iops_max">
                        <Input type="number" placeholder="e.g. 5000" />
                      </Form.Item>
                   </Col>
                   <Col span={8}>
                      <Form.Item label="最大带宽 MB/s (expected_bandwidth_mbps_max)" name="expected_bandwidth_mbps_max">
                        <Input type="number" />
                      </Form.Item>
                   </Col>
                   <Col span={8}>
                      <Form.Item label="最大 P99 延迟 (expected_p99_latency_ms_max)" name="expected_p99_latency_ms_max">
                        <Input type="number" />
                      </Form.Item>
                   </Col>
                 </Row>
              </Card>
            </Col>
          </Row>
        )}

        <div style={{ display: 'flex', gap: 12 }}>
          <Button type="primary" htmlType="submit">分发执行任务</Button>
          {taskMode === 'io' && (
            <Button onClick={handleSaveModel}>存为自定义 IO 模型</Button>
          )}
        </div>
      </Form>
    </Card>
  );
};

export default TaskDispatcher;
