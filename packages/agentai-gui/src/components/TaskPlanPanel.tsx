/**
 * TaskPlanPanel — 任务计划面板 (参考 WorkBuddy 专家团队模式)
 *
 * 展示 AI 当前正在执行的任务计划（从 taskOrchestratorStore 实时获取）
 *
 * 设计改进 (参考 WorkBuddy):
 *   - 专家团队视图: 显示子智能体分配情况
 *   - 紧凑的任务列表: 每个任务一行, 状态清晰
 *   - 完成后显示总结卡片
 *   - 子智能体调用显示为 "专家" 分配
 *   - 实时状态更新动画
 *   - 任务耗时统计
 */

import React, { useState, useEffect } from 'react';
import { Card, Space, Typography, Progress, Empty, Tag, Tooltip, Timeline } from 'antd';
import {
  CheckCircleOutlined,
  LoadingOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  TeamOutlined,
  RobotOutlined,
  ThunderboltOutlined,
  CheckCircleFilled,
  ArrowRightOutlined,
  FileTextOutlined,
  CodeOutlined,
  BulbOutlined,
} from '@ant-design/icons';
import { useTaskOrchestrator } from '../store/taskOrchestratorStore';

const { Text } = Typography;

/** 任务状态图标 */
const STATUS_ICON: Record<string, React.ReactNode> = {
  success: <CheckCircleOutlined style={{ color: 'var(--success)', fontSize: 12 }} />,
  running: <LoadingOutlined style={{ color: 'var(--accent)', fontSize: 12 }} />,
  failed: <CloseCircleOutlined style={{ color: 'var(--danger)', fontSize: 12 }} />,
  pending: <ClockCircleOutlined style={{ color: 'var(--muted)', fontSize: 12 }} />,
};

/** 任务状态颜色 */
const STATUS_COLOR: Record<string, string> = {
  success: 'var(--success)',
  running: 'var(--accent)',
  failed: 'var(--danger)',
  pending: 'var(--muted)',
};

/** 任务状态标签 */
const STATUS_LABEL: Record<string, string> = {
  success: '已完成',
  running: '进行中',
  failed: '失败',
  pending: '等待中',
};

/**
 * 单个任务行组件 (紧凑风格 + 实时状态动画)
 */
const TaskRow: React.FC<{
  stage: {
    key: string;
    label: string;
    status: string;
    assignee?: string; // 子智能体/专家类型
    duration?: number;
  };
  index: number;
}> = ({ stage, index }) => {
  const isRunning = stage.status === 'running';
  const isSubagent = !!stage.assignee;

  // 根据阶段key推断图标
  const getStageIcon = () => {
    const key = stage.key.toLowerCase();
    if (key.includes('plan') || key.includes('规划')) return <BulbOutlined style={{ fontSize: 10 }} />;
    if (key.includes('code') || key.includes('implement') || key.includes('实现')) return <CodeOutlined style={{ fontSize: 10 }} />;
    if (key.includes('file') || key.includes('edit') || key.includes('修改')) return <FileTextOutlined style={{ fontSize: 10 }} />;
    return null;
  };

  const stageIcon = getStageIcon();

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 10px', borderRadius: 6,
        background: isRunning ? 'var(--accent-soft)' : 'transparent',
        borderLeft: isRunning ? '3px solid var(--accent)' : '3px solid transparent',
        transition: 'all 0.2s ease',
        fontSize: 'var(--ui-font-size, 12px)',
        opacity: stage.status === 'pending' ? 0.6 : 1,
      }}
    >
      {/* 序号 + 图标 */}
      <span style={{
        width: 20, height: 20, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: isRunning ? 'var(--accent)' : 'var(--bg-2)',
        color: isRunning ? '#fff' : 'var(--muted-2)',
        fontSize: 10, fontWeight: 600, flexShrink: 0,
      }}>
        {index + 1}
        {stageIcon && <span style={{ marginLeft: -14, position: 'absolute' }}>{stageIcon}</span>}
      </span>

      {/* 状态图标 */}
      <span style={{ flexShrink: 0 }}>
        {isRunning ? (
          <LoadingOutlined style={{ color: 'var(--accent)', fontSize: 12, animation: 'spin 1s linear infinite' }} />
        ) : (
          STATUS_ICON[stage.status] || STATUS_ICON.pending
        )}
      </span>

      {/* 任务名称 */}
      <span style={{
        flex: 1,
        fontWeight: isRunning ? 600 : 400,
        color: stage.status === 'failed' ? 'var(--danger)' : 'var(--fg-2)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {stage.label}
      </span>

      {/* 子智能体/专家标签 - 使用自创头像图标 */}
      {isSubagent && (
        <Tag
          color="purple"
          style={{ margin: 0, fontSize: 9, lineHeight: '16px', padding: '0 6px' }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 3 }}>
            <circle cx="12" cy="8" r="4" fill="#a78bfa" opacity="0.9"/>
            <path d="M12 14c-4 0-7 2-7 5v1h14v-1c0-3-3-5-7-5z" fill="#a78bfa" opacity="0.7"/>
            <circle cx="18" cy="6" r="2.5" fill="#7c3aed" opacity="0.8"/>
            <path d="M18 10c-1.5 0-2.5.8-2.5 2v.5h5V12c0-1.2-1-2-2.5-2z" fill="#7c3aed" opacity="0.6"/>
          </svg>
          {stage.assignee}
        </Tag>
      )}

      {/* 耗时 */}
      {stage.duration != null && stage.status !== 'pending' && (
        <span style={{ color: 'var(--muted-2)', fontSize: 10, flexShrink: 0 }}>
          {(stage.duration / 1000).toFixed(1)}s
        </span>
      )}

      {/* 状态文字 */}
      <span style={{
        color: STATUS_COLOR[stage.status],
        fontSize: 10, fontWeight: 500, flexShrink: 0,
      }}>
        {STATUS_LABEL[stage.status]}
      </span>
    </div>
  );
};

export const TaskPlanPanel: React.FC = () => {
  const activeTask = useTaskOrchestrator((s) => s.activeTask);
  const [lastUpdate, setLastUpdate] = useState(Date.now());

  // 监听任务变化，更新时间戳以触发重新渲染
  useEffect(() => {
    if (activeTask) {
      setLastUpdate(Date.now());
    }
  }, [activeTask?.stages, activeTask?.status]);

  if (!activeTask) {
    return (
      <Card
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <TeamOutlined style={{ color: 'var(--accent)' }} />
            任务执行计划
          </span>
        }
        size="small"
        style={{ borderRadius: 'var(--radius-md)' }}
      >
        <Empty description="暂无活跃任务" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </Card>
    );
  }

  const stages = activeTask.stages || [];
  const completedCount = stages.filter((s) => s.status === 'success').length;
  const runningCount = stages.filter((s) => s.status === 'running').length;
  const failedCount = stages.filter((s) => s.status === 'failed').length;
  const progress = stages.length > 0 ? Math.round((completedCount / stages.length) * 100) : 0;
  const isCompleted = activeTask.status === 'success' || (completedCount === stages.length && stages.length > 0);
  const isFailed = activeTask.status === 'failed' || failedCount > 0;

  // 检测是否有子智能体参与 (通过 key 前缀判断)
  const hasSubagents = stages.some(s => s.key.startsWith('subagent:'));

  // 计算总耗时 (使用 durationMs 如果可用)
  const totalDuration = stages.reduce((sum, s) => sum + ((s as any).durationMs || 0), 0);
  const currentRunningStage = stages.find(s => s.status === 'running');

  return (
    <Card
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <TeamOutlined style={{ color: isCompleted ? 'var(--success)' : isFailed ? 'var(--danger)' : 'var(--accent)' }} />
          {isCompleted ? '任务完成' : isFailed ? '任务失败' : '任务执行计划'}
          {hasSubagents && (
            <Tooltip title="专家团队协作模式">
              <Tag color="purple" style={{ marginLeft: 4, fontSize: 9, lineHeight: '16px', padding: '0 6px' }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 2 }}>
                  <circle cx="12" cy="8" r="4" fill="#a78bfa" opacity="0.9"/>
                  <path d="M12 14c-4 0-7 2-7 5v1h14v-1c0-3-3-5-7-5z" fill="#a78bfa" opacity="0.7"/>
                  <circle cx="18" cy="6" r="2.5" fill="#7c3aed" opacity="0.8"/>
                  <path d="M18 10c-1.5 0-2.5.8-2.5 2v.5h5V12c0-1.2-1-2-2.5-2z" fill="#7c3aed" opacity="0.6"/>
                </svg>
                 团队
              </Tag>
            </Tooltip>
          )}
        </span>
      }
      size="small"
      style={{ borderRadius: 'var(--radius-md)' }}
    >
      <Space direction="vertical" style={{ width: '100%' }} size={8}>
        {/* 目标描述 */}
        <Text style={{ fontSize: 'var(--ui-font-size, 12px)', fontWeight: 500, color: 'var(--fg)', display: 'block' }}>
          {activeTask.goal || '任务进行中'}
        </Text>

        {/* 当前阶段提示 */}
        {currentRunningStage && (
          <div style={{
            padding: '4px 8px',
            background: 'var(--accent-soft)',
            borderRadius: 4,
            fontSize: 11,
            color: 'var(--accent)',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}>
            <LoadingOutlined style={{ fontSize: 10 }} />
            正在执行: {currentRunningStage.label}
          </div>
        )}

        {/* 进度条 */}
        <Progress
          percent={progress}
          status={isFailed ? 'exception' : isCompleted ? 'success' : 'active'}
          size="small"
          strokeColor={isCompleted ? 'var(--success)' : isFailed ? 'var(--danger)' : undefined}
          showInfo={false}
        />

        {/* 统计信息 */}
        <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'var(--muted-2)' }}>
          <span>共 {stages.length} 个子任务</span>
          <span style={{ color: 'var(--success)' }}>{completedCount} 已完成</span>
          {runningCount > 0 && <span style={{ color: 'var(--accent)' }}>{runningCount} 进行中</span>}
          {failedCount > 0 && <span style={{ color: 'var(--danger)' }}>{failedCount} 失败</span>}
          {totalDuration > 0 && <span>总耗时 {(totalDuration / 1000).toFixed(1)}s</span>}
          {hasSubagents && (
            <span style={{ color: 'var(--violet)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="8" r="4" fill="#a78bfa" opacity="0.9"/>
                <path d="M12 14c-4 0-7 2-7 5v1h14v-1c0-3-3-5-7-5z" fill="#a78bfa" opacity="0.7"/>
              </svg>
              专家团队
            </span>
          )}
        </div>

        {/* 任务列表 */}
        {stages.length > 0 && (
          <div style={{
            maxHeight: 300, overflowY: 'auto',
            display: 'flex', flexDirection: 'column', gap: 2,
          }}>
            {stages.map((stage, idx) => (
              <TaskRow key={stage.key} stage={stage as any} index={idx} />
            ))}
          </div>
        )}

        {stages.length === 0 && (
          <Empty description="等待任务规划..." image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}

        {/* 完成总结 */}
        {isCompleted && (
          <div style={{
            marginTop: 8, padding: '8px 12px', borderRadius: 6,
            background: 'rgba(34,197,94,0.08)',
            border: '1px solid rgba(34,197,94,0.2)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--success)', fontSize: 12, fontWeight: 600 }}>
              <CheckCircleFilled />
              任务完成 · {completedCount}/{stages.length} 子任务成功
              {totalDuration > 0 && <span style={{ marginLeft: 8, fontSize: 10, opacity: 0.8 }}>· 总耗时 {(totalDuration / 1000).toFixed(1)}s</span>}
            </div>
          </div>
        )}

        {/* 失败总结 */}
        {isFailed && !isCompleted && (
          <div style={{
            marginTop: 8, padding: '8px 12px', borderRadius: 6,
            background: 'rgba(255,77,79,0.08)',
            border: '1px solid rgba(255,77,79,0.2)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--danger)', fontSize: 12, fontWeight: 600 }}>
              <CloseCircleOutlined />
              任务失败 · {completedCount}/{stages.length} 子任务成功
            </div>
          </div>
        )}
      </Space>
    </Card>
  );
};

export default TaskPlanPanel;
