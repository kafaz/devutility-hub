import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Form, Input, InputNumber, Switch, Typography } from 'antd';
import React from 'react';
import { SHELL_VAR_NAME_PATTERN } from '../shellVars';

const { Text } = Typography;

interface Props {
  fieldName: string;
  title: string;
  description: string;
  addLabel?: string;
}

const shellVarRules = [
  {
    validator: (_: unknown, value?: string) => {
      if (!value || SHELL_VAR_NAME_PATTERN.test(value)) {
        return Promise.resolve();
      }
      return Promise.reject(new Error('变量名需符合 Shell 变量命名规范：字母或下划线开头，只能包含字母、数字、下划线'));
    },
  },
];

const InitCommandListEditor: React.FC<Props> = ({
  fieldName,
  title,
  description,
  addLabel = '添加初始化命令',
}) => (
  <>
    <div style={{ marginBottom: 8 }}>
      <Text strong>{title}</Text>
      <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
        {description}
      </Text>
      <Text type="secondary" style={{ display: 'block', fontSize: 11, marginTop: 2 }}>
        填写“变量名”后，命令结果会同时进入连接上下文，并自动 export 到当前 SSH shell，后续可直接在终端里使用。
      </Text>
    </div>

    <Form.List name={fieldName}>
      {(fields, { add, remove }) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {fields.map((field) => (
            <div
              key={field.key}
              style={{
                border: '1px solid #d9d9d9',
                borderRadius: 8,
                padding: 12,
                display: 'grid',
                gap: 8,
              }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 96px auto', gap: 8 }}>
                <Form.Item
                  {...field}
                  name={[field.name, 'name']}
                  label="名称"
                  rules={[{ required: true, message: '请输入名称' }]}
                  style={{ marginBottom: 0 }}
                >
                  <Input placeholder="例如：获取构建版本" />
                </Form.Item>
                <Form.Item
                  {...field}
                  name={[field.name, 'timeout']}
                  label="超时(ms)"
                  style={{ marginBottom: 0 }}
                >
                  <InputNumber min={1000} step={1000} style={{ width: '100%' }} />
                </Form.Item>
                <div style={{ display: 'flex', alignItems: 'end' }}>
                  <Button danger icon={<MinusCircleOutlined />} onClick={() => remove(field.name)}>
                    删除
                  </Button>
                </div>
              </div>

              <Form.Item
                {...field}
                name={[field.name, 'command']}
                label="命令"
                rules={[{ required: true, message: '请输入命令' }]}
                style={{ marginBottom: 0 }}
              >
                <Input.TextArea rows={2} placeholder="例如：cat /etc/os-release | grep ^VERSION_ID=" />
              </Form.Item>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Form.Item
                  {...field}
                  name={[field.name, 'captureVar']}
                  label="变量名 / Shell 变量"
                  rules={shellVarRules}
                  style={{ marginBottom: 0 }}
                >
                  <Input placeholder="例如：os_version" />
                </Form.Item>
                <Form.Item
                  {...field}
                  name={[field.name, 'capturePattern']}
                  label="提取正则"
                  style={{ marginBottom: 0 }}
                >
                  <Input placeholder={'例如：VERSION_ID="?([^"]+)"?'} />
                </Form.Item>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 8 }}>
                <Form.Item
                  {...field}
                  name={[field.name, 'parallelGroup']}
                  label="并行组 (可选)"
                  style={{ marginBottom: 0 }}
                >
                  <Input placeholder="相同组名的命令将并行执行" />
                </Form.Item>
                <Form.Item
                  {...field}
                  name={[field.name, 'continueOnFailure']}
                  label="失败后继续"
                  valuePropName="checked"
                  initialValue
                  style={{ marginBottom: 0 }}
                >
                  <Switch checkedChildren="继续" unCheckedChildren="停止" />
                </Form.Item>
              </div>
            </div>
          ))}

          <Button
            type="dashed"
            icon={<PlusOutlined />}
            onClick={() => add({ timeout: 15000, continueOnFailure: true })}
          >
            {addLabel}
          </Button>
        </div>
      )}
    </Form.List>
  </>
);

export default InitCommandListEditor;
