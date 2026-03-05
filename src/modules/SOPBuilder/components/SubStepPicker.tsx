/**
 * SubStepPicker — 从其他 SOP 模板浏览并复制子步骤
 *
 * 布局：左侧模板列表 → 右侧展开每个 Check 的子步骤 → 勾选复制
 */
import React, { useState, useMemo } from 'react';
import {
  Modal, Table, Checkbox, Typography,
  Tag, Empty, Input, Alert,
} from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import type { SOPTemplate, SOPSubStep } from '../../../types';
import { generateId } from '../../../utils';

const { Text } = Typography;

interface SelectableSubStep extends SOPSubStep {
  _templateName: string;
  _checkName:    string;
  _uniqueKey:    string;
}

interface Props {
  open:         boolean;
  allTemplates: SOPTemplate[];   // 已排除当前正在编辑的模板
  onOk:         (subSteps: SOPSubStep[]) => void;
  onCancel:     () => void;
}

const SubStepPicker: React.FC<Props> = ({ open, allTemplates, onOk, onCancel }) => {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(new Set());
  const [searchText, setSearchText] = useState('');

  const selectedTemplate = allTemplates.find((t) => t.id === selectedTemplateId);

  // 当前模板下所有可选子步骤（带来源信息）
  const allSubSteps = useMemo((): SelectableSubStep[] => {
    if (!selectedTemplate) return [];
    const result: SelectableSubStep[] = [];
    selectedTemplate.checks.forEach((check) => {
      if ((check.subSteps?.length ?? 0) > 0) {
        (check.subSteps ?? []).forEach((ss) => {
          result.push({
            ...ss,
            _templateName: selectedTemplate.name,
            _checkName:    check.name,
            _uniqueKey:    `${check.id}::${ss.id}`,
          });
        });
      } else if (check.command) {
        // 单命令 check 也可作为子步骤导入
        result.push({
          id:            check.id,
          order:         1,
          name:          check.name,
          description:   check.description,
          command:       check.command,
          captureVar:    undefined,
          capturePattern: undefined,
          expectedNormal: check.expectedNormal,
          abnormalSigns:  check.abnormalSigns,
          _templateName:  selectedTemplate.name,
          _checkName:     check.name,
          _uniqueKey:     `${check.id}::__single`,
        });
      }
    });
    return result;
  }, [selectedTemplate]);

  const filteredSteps = useMemo(() => {
    if (!searchText.trim()) return allSubSteps;
    const q = searchText.toLowerCase();
    return allSubSteps.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.command.toLowerCase().includes(q) ||
        s._checkName.toLowerCase().includes(q)
    );
  }, [allSubSteps, searchText]);

  const handleOk = () => {
    const selected = filteredSteps.filter((s) => checkedKeys.has(s._uniqueKey));
    const subSteps: SOPSubStep[] = selected.map((s) => ({
      id:             generateId(),
      order:          0, // will be reordered by caller
      name:           s.name,
      description:    s.description,
      command:        s.command,
      captureVar:     s.captureVar,
      capturePattern: s.capturePattern,
      expectedNormal: s.expectedNormal,
      abnormalSigns:  s.abnormalSigns,
      timeoutMs:      s.timeoutMs,
    }));
    onOk(subSteps);
    setCheckedKeys(new Set());
    setSearchText('');
  };

  const handleCancel = () => {
    setCheckedKeys(new Set());
    setSearchText('');
    onCancel();
  };

  const toggleAll = (checked: boolean) => {
    if (checked) {
      setCheckedKeys(new Set(filteredSteps.map((s) => s._uniqueKey)));
    } else {
      setCheckedKeys(new Set());
    }
  };

  const columns = [
    {
      title: (
        <Checkbox
          indeterminate={
            checkedKeys.size > 0 && checkedKeys.size < filteredSteps.length
          }
          checked={
            filteredSteps.length > 0 && checkedKeys.size === filteredSteps.length
          }
          onChange={(e) => toggleAll(e.target.checked)}
        />
      ),
      width: 36,
      render: (_: unknown, rec: SelectableSubStep) => (
        <Checkbox
          checked={checkedKeys.has(rec._uniqueKey)}
          onChange={(e) => {
            const next = new Set(checkedKeys);
            if (e.target.checked) next.add(rec._uniqueKey);
            else next.delete(rec._uniqueKey);
            setCheckedKeys(next);
          }}
        />
      ),
    },
    {
      title: '来源检查步骤',
      dataIndex: '_checkName',
      width: 140,
      render: (v: string) => <Tag style={{ fontSize: 11 }}>{v}</Tag>,
    },
    {
      title: '子步骤名称',
      dataIndex: 'name',
      width: 140,
      render: (v: string) => <Text strong style={{ fontSize: 12 }}>{v}</Text>,
    },
    {
      title: '命令',
      dataIndex: 'command',
      ellipsis: { showTitle: false },
      render: (v: string) => (
        <Text
          style={{ fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 11 }}
          ellipsis={{ tooltip: v }}
        >
          {v}
        </Text>
      ),
    },
    {
      title: '捕获变量',
      dataIndex: 'captureVar',
      width: 90,
      render: (v: string) =>
        v ? <Tag color="blue" style={{ fontSize: 10 }}>{v}</Tag> : null,
    },
  ];

  const selectedCount = checkedKeys.size;

  return (
    <Modal
      title="从其他 SOP 导入子步骤"
      open={open}
      onOk={handleOk}
      onCancel={handleCancel}
      okText={selectedCount > 0 ? `导入选中 (${selectedCount})` : '导入'}
      okButtonProps={{ disabled: selectedCount === 0 }}
      cancelText="取消"
      width={820}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 16 }}>
        {/* 左侧：模板选择 */}
        <div>
          <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
            选择来源模板
          </Text>
          {allTemplates.length === 0 ? (
            <Empty description="暂无其他模板" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {allTemplates.map((t) => {
                const subStepCount = t.checks.reduce(
                  (acc, c) => acc + (c.subSteps?.length || (c.command ? 1 : 0)),
                  0
                );
                return (
                  <div
                    key={t.id}
                    onClick={() => {
                      setSelectedTemplateId(t.id);
                      setCheckedKeys(new Set());
                    }}
                    style={{
                      padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                      border: `1px solid ${selectedTemplateId === t.id ? '#3b82f6' : '#3e3e42'}`,
                      background: selectedTemplateId === t.id ? '#1e3a5f' : '#2d2d30',
                    }}
                  >
                    <Text style={{ fontSize: 12, color: selectedTemplateId === t.id ? '#3b82f6' : undefined }}>
                      {t.name}
                    </Text>
                    <div style={{ marginTop: 2 }}>
                      <Tag color="default" style={{ fontSize: 10 }}>{t.category}</Tag>
                      <Text type="secondary" style={{ fontSize: 10, marginLeft: 4 }}>
                        {subStepCount} 个步骤
                      </Text>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 右侧：子步骤列表 */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text strong style={{ fontSize: 12 }}>
              {selectedTemplate ? `「${selectedTemplate.name}」的子步骤` : '请选择左侧模板'}
            </Text>
            {selectedCount > 0 && (
              <Tag color="blue">{selectedCount} 个已选</Tag>
            )}
          </div>

          {selectedTemplate && (
            <Input
              size="small"
              prefix={<SearchOutlined />}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="搜索步骤名称或命令"
              allowClear
              style={{ marginBottom: 8 }}
            />
          )}

          {!selectedTemplate ? (
            <Empty description="请先选择左侧模板" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : filteredSteps.length === 0 ? (
            <Empty description="此模板暂无子步骤" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <Table
              dataSource={filteredSteps}
              columns={columns}
              rowKey="_uniqueKey"
              size="small"
              pagination={false}
              scroll={{ y: 320 }}
            />
          )}

          {selectedCount > 0 && (
            <Alert
              type="info" showIcon={false} style={{ marginTop: 8, fontSize: 11 }}
              message={
                `已选 ${selectedCount} 个子步骤，点击「导入」后将追加到当前检查步骤末尾。` +
                '捕获变量定义将一并复制，可在目标步骤中修改变量名以避免冲突。'
              }
            />
          )}
        </div>
      </div>
    </Modal>
  );
};

export default SubStepPicker;
