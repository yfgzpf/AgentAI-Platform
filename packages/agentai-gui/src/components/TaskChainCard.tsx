/**
 * TaskChainCard — 任务链进度卡片
 * ----------------------------------------------------
 * 展示 AI 自动创建的任务链 (动态阶段, 由意图决定)
 * 不同任务类型有不同流程: 审查→探索/分析/总结, 开发→规划/实现/测试/报告
 *
 * v2: 支持 needsApproval 模式 — 规划模式下显示「确认执行」按钮
 */
import React, { useState } from 'react';
import { Card, Tag, Space, Progress, Button } from 'antd';
import {
  ThunderboltOutlined, CodeOutlined, CheckCircleOutlined,
  SyncOutlined, FileTextOutlined, LoadingOutlined,
  SearchOutlined, BulbOutlined, RocketOutlined,
  DatabaseOutlined, ToolOutlined, EyeOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';

export type StageStatus = 'pending' | 'running' | 'success' | 'failed';

interface ChainStageDef {
  key: string;
  label: string;
  icon: React.ReactNode;
}

// 动态阶段图标映射 (按key匹配)
const STAGE_ICON_MAP: Record<string, { label: string; icon: React.ReactNode }> = {
  plan: { label: '规划', icon: <ThunderboltOutlined /> },
  explore: { label: '探索', icon: <SearchOutlined /> },
  analyze: { label: '分析', icon: <EyeOutlined /> },
  implement: { label: '实现', icon: <CodeOutlined /> },
  solve: { label: '执行', icon: <CodeOutlined /> },
  execute: { label: '执行', icon: <ToolOutlined /> },
  test: { label: '测试', icon: <CheckCircleOutlined /> },
  verify: { label: '验证', icon: <CheckCircleOutlined /> },
  fix: { label: '修复', icon: <SyncOutlined /> },
  refactor: { label: '重构', icon: <SyncOutlined /> },
  report: { label: '报告', icon: <FileTextOutlined /> },
  search: { label: '搜索', icon: <SearchOutlined /> },
  organize: { label: '整理', icon: <DatabaseOutlined /> },
  generate: { label: '生成', icon: <RocketOutlined /> },
  deploy: { label: '部署', icon: <RocketOutlined /> },
  prepare: { label: '准备', icon: <BulbOutlined /> },
  read: { label: '读取', icon: <DatabaseOutlined /> },
  process: { label: '处理', icon: <ToolOutlined /> },
  output: { label: '输出', icon: <FileTextOutlined /> },
  understand: { label: '理解', icon: <BulbOutlined /> },
};

// 默认固定阶段 (向后兼容)
const DEFAULT_STAGES: ChainStageDef[] = [
  { key: 'plan', label: '规划', icon: <ThunderboltOutlined /> },
  { key: 'solve', label: '执行', icon: <CodeOutlined /> },
  { key: 'verify', label: '验证', icon: <CheckCircleOutlined /> },
  { key: 'report', label: '报告', icon: <FileTextOutlined /> },
];

const STATUS_TAG: Record<StageStatus, { color: string; text: string }> = {
  pending: { color: 'default', text: '等待' },
  running: { color: 'processing', text: '执行中' },
  success: { color: 'success', text: '完成' },
  failed: { color: 'error', text: '失败' },
};

interface Props {
  chainId?: string;
  goal?: string;
  currentStage?: string;
  /** 动态阶段列表 (来自后端 inferStages) */
  stages?: Array<{ key: string; label?: string; status?: StageStatus }>;
  /** 总数 / 完成数 */
  completed?: number;
  total?: number;
  /** 是否需要用户确认后执行 (规划模式) */
  needsApproval?: boolean;
  /** 确认执行回调 */
  onApprove?: () => void;
  /** 取消/拒绝回调 */
  onReject?: () => void;
}

/** 将后端动态stages转换为前端ChainStageDef */
function resolveStageDefs(stages?: Array<{ key: string; label?: string }>): ChainStageDef[] {
  if (!stages || stages.length === 0) return DEFAULT_STAGES;
  return stages.map(s => {
    const mapped = STAGE_ICON_MAP[s.key];
    return {
      key: s.key,
      label: s.label || mapped?.label || s.key,
      icon: mapped?.icon || <CodeOutlined />,
    };
  });
}

export const TaskChainCard: React.FC<Props> = ({
  chainId, goal,
  currentStage,
  stages,
  completed = 0, total,
  needsApproval = false,
  onApprove,
  onReject,
}) => {
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null);
  const stageDefs = resolveStageDefs(stages);
  const totalStages = total || stageDefs.length;
  const pct = Math.round((completed / (totalStages || 1)) * 100);

  // 根据currentStage计算每个stage的status
  const currentIdx = stageDefs.findIndex(s => s.key === currentStage);
  const stageStatuses = stageDefs.map((s, i) => {
    if (stages?.[i]?.status) return stages[i].status!;
    if (i < currentIdx) return 'success' as StageStatus;
    if (i === currentIdx) return 'running' as StageStatus;
    return 'pending' as StageStatus;
  });

  const handleApprove = () => {
    setLoading('approve');
    setTimeout(() => onApprove?.(), 50);
  };

  const handleReject = () => {
    setLoading('reject');
    setTimeout(() => onReject?.(), 50);
  };

  return (
    <Card
      size="small"
      style={{
        margin: '0 16px 8px',
        background: needsApproval
          ? 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)'
          : 'linear-gradient(135deg, #0d1117 0%, #161b22 100%)',
        border: needsApproval ? '1px solid #e8a838' : '1px solid #30363d',
      }}
      title={
        <Space size={4}>
          {needsApproval ? <ExclamationCircleOutlined style={{ color: '#e8a838' }} /> : <ThunderboltOutlined style={{ color: '#58a6ff' }} />}
          <span style={{ fontSize: 12, fontWeight: 600 }}>
            {needsApproval ? '任务规划 — 等待确认' : '任务编排'}
          </span>
          {chainId && <Tag style={{ fontSize: 9 }}>#{chainId.slice(0, 8)}</Tag>}
          {needsApproval && <Tag color="orange" style={{ fontSize: 9 }}>需审批</Tag>}
        </Space>
      }
    >
      {/* Goal */}
      {goal && (
        <div style={{ fontSize: 12, color: '#c9d1d9', marginBottom: 8, lineHeight: 1.4 }}>
          {goal.length > 80 ? goal.slice(0, 80) + '...' : goal}
        </div>
      )}

      {/* Progress bar */}
      <Progress
        percent={pct}
        size="small"
        strokeColor={needsApproval ? '#e8a838' : '#58a6ff'}
        trailColor={needsApproval ? 'rgba(232,168,56,0.12)' : 'rgba(88,166,255,0.12)'}
        style={{ marginBottom: 8 }}
      />

      {/* Stage indicators */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {stageDefs.map((def, i) => {
          const status = STATUS_TAG[stageStatuses[i]] || STATUS_TAG.pending;
          const isActive = def.key === currentStage;
          return (
            <Tag
              key={def.key}
              color={status.color}
              style={{
                opacity: stageStatuses[i] === 'pending' ? 0.5 : 1,
                border: isActive ? `1px solid ${needsApproval ? '#e8a838' : '#58a6ff'}` : undefined,
                margin: 0,
                fontSize: 10,
              }}
            >
              {def.icon}
              <span style={{ marginLeft: 2 }}>{def.label}</span>
              {stageStatuses[i] === 'running' && <LoadingOutlined style={{ marginLeft: 3, fontSize: 9 }} />}
            </Tag>
          );
        })}
      </div>

      {/* 审批按钮区域 — 仅 needsApproval=true 时显示 */}
      {needsApproval && (
        <div style={{
          marginTop: 12,
          paddingTop: 10,
          borderTop: '1px solid rgba(232,168,56,0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 12, color: '#e8a838' }}>
            📋 此任务规划需要确认后执行
          </span>
          <Space>
            <Button
              size="small"
              onClick={handleReject}
              loading={loading === 'reject'}
              disabled={loading !== null && loading !== 'reject'}
            >
              取消
            </Button>
            <Button
              size="small"
              type="primary"
              icon={<CheckCircleOutlined />}
              onClick={handleApprove}
              loading={loading === 'approve'}
              disabled={loading !== null && loading !== 'approve'}
              style={{ background: '#238636', borderColor: '#238636' }}
            >
              确认执行
            </Button>
          </Space>
        </div>
      )}
    </Card>
  );
};
