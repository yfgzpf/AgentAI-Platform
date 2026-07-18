/**
 * TaskPlanPanel — 任务计划面板
 * 
 * 功能:
 *   1. 展示AI任务计划
 *   2. 任务步骤追踪
 *   3. 执行状态监控
 */

import React, { useState } from 'react';
import { Card, Steps, List, Tag, Space, Typography, Progress } from 'antd';
import { CheckCircleOutlined, LoadingOutlined, ClockCircleOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;
const { Step } = Steps;

interface TaskStep {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  description?: string;
}

interface TaskPlan {
  id: string;
  title: string;
  steps: TaskStep[];
  progress: number;
}

export const TaskPlanPanel: React.FC = () => {
  const [currentPlan] = useState<TaskPlan>({
    id: '1',
    title: '自动化营销任务',
    steps: [
      { id: '1', title: '获取线索列表', status: 'completed', description: '成功获取32个新线索' },
      { id: '2', title: '评分筛选', status: 'completed', description: '筛选出8个高价值线索' },
      { id: '3', title: '发送微信消息', status: 'running', description: '正在发送...' },
      { id: '4', title: '记录跟进', status: 'pending' },
    ],
    progress: 60,
  });

  const getIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
      case 'running': return <LoadingOutlined style={{ color: '#1890ff' }} />;
      case 'failed': return <ClockCircleOutlined style={{ color: '#f5222d' }} />;
      default: return <ClockCircleOutlined style={{ color: '#999' }} />;
    }
  };

  const currentStepIndex = currentPlan.steps.findIndex(s => s.status === 'running');

  return (
    <Card title="任务执行计划" size="small">
      <Space direction="vertical" style={{ width: '100%' }}>
        <Title level={5}>{currentPlan.title}</Title>
        <Progress percent={currentPlan.progress} status="active" />
        <Steps
          direction="vertical"
          size="small"
          current={currentStepIndex}
        >
          {currentPlan.steps.map(step => (
            <Step
              key={step.id}
              title={step.title}
              description={step.description}
              icon={getIcon(step.status)}
            />
          ))}
        </Steps>
      </Space>
    </Card>
  );
};

export default TaskPlanPanel;
