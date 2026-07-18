/**
 * AIToolCallPanel — AI工具调用面板
 * 
 * 功能:
 *   1. 查看AI工具调用历史
 *   2. 工具执行结果展示
 *   3. 工具性能统计
 */

import React, { useState } from 'react';
import { Card, Table, Tag, Space, Typography } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, ClockCircleOutlined } from '@ant-design/icons';

const { Title } = Typography;

interface ToolCall {
  id: string;
  toolName: string;
  params: string;
  result: 'success' | 'failed';
  duration: number;
  timestamp: string;
}

export const AIToolCallPanel: React.FC = () => {
  const [calls] = useState<ToolCall[]>([
    { id: '1', toolName: 'read_file', params: '{"path": "/src/App.tsx"}', result: 'success', duration: 120, timestamp: '2026-07-17 15:30:00' },
    { id: '2', toolName: 'write_file', params: '{"path": "/src/index.ts"}', result: 'success', duration: 150, timestamp: '2026-07-17 15:29:00' },
    { id: '3', toolName: 'search_skills', params: '{"query": "automation"}', result: 'success', duration: 800, timestamp: '2026-07-17 15:25:00' },
  ]);

  const columns = [
    { title: '工具', dataIndex: 'toolName', key: 'toolName' },
    { title: '参数', dataIndex: 'params', key: 'params', ellipsis: true },
    { 
      title: '结果', 
      dataIndex: 'result', 
      key: 'result',
      render: (result: string) => (
        result === 'success' 
          ? <Tag icon={<CheckCircleOutlined />} color="success">成功</Tag>
          : <Tag icon={<CloseCircleOutlined />} color="error">失败</Tag>
      )
    },
    { title: '耗时(ms)', dataIndex: 'duration', key: 'duration' },
    { title: '时间', dataIndex: 'timestamp', key: 'timestamp' },
  ];

  return (
    <Card title="工具调用记录" style={{ margin: 24 }}>
      <Table columns={columns} dataSource={calls} rowKey="id" size="small" />
    </Card>
  );
};

export default AIToolCallPanel;
