import { Input, Modal, Form, Select } from 'antd';
import React from 'react';
import type { ConsistencyCheck } from '../types';

const { TextArea } = Input;

interface Props {
  open: boolean;
  initial?: ConsistencyCheck;
  onOk: (check: Omit<ConsistencyCheck, 'id' | 'triggeredAt'>) => void;
  onCancel: () => void;
}

const CHECK_TYPES = [
  { label: 'CRC 校验', value: 'crc' },
  { label: 'LBA 范围比对', value: 'lba_range' },
  { label: '元数据一致性', value: 'metadata' },
  { label: '自定义', value: 'custom' },
];

const AnalysisCheckModal: React.FC<Props> = ({ open, initial, onOk, onCancel }) => {
  const [form] = Form.useForm();

  React.useEffect(() => {
    if (open) {
      form.setFieldsValue(initial ?? { checkType: 'custom', nodeIds: [], params: {}, cmdTemplate: '' });
    }
  }, [open, initial, form]);

  const handleOk = () => {
    form.validateFields().then((vals) => {
      onOk({
        name: vals.name,
        checkType: vals.checkType,
        nodeIds: vals.nodeIds ?? [],
        cmdTemplate: vals.cmdTemplate,
        params: vals.params ?? {},
        status: 'pending',
      });
      form.resetFields();
    });
  };

  return (
    <Modal title={initial ? '编辑检测规则' : '新建检测规则'} open={open} onOk={handleOk} onCancel={onCancel} width={640}>
      <Form form={form} layout="vertical">
        <Form.Item label="名称" name="name" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item label="类型" name="checkType" rules={[{ required: true }]}>
          <Select options={CHECK_TYPES} />
        </Form.Item>
        <Form.Item label="命令模板" name="cmdTemplate" rules={[{ required: true }]}>
          <TextArea rows={2} placeholder="在各节点执行的命令，输出将被比对" />
        </Form.Item>
        <Form.Item label="目标节点" name="nodeIds">
          <Select mode="tags" placeholder="输入节点ID" />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default AnalysisCheckModal;
