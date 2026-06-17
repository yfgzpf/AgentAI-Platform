/**
 * ApprovalCard — AI 自主修改审批卡片
 * ----------------------------------------------------
 * 当 SelfModifier 提出代码修改提案且 requireHumanApproval=true 时，
 * 前端展示此卡片让用户批准/拒绝
 * v2: 添加"信任此命令"按钮，后续相同命令自动跳过审批
 */
import React, { useState } from 'react';
import { Card, Button, Tag, Space, Tooltip, Checkbox, message } from 'antd';
import { CheckOutlined, CloseOutlined, DiffOutlined, SafetyOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { GATEWAY_HTTP } from '../services/config';

export interface ApprovalProposal {
  id: string;
  type: 'modify' | 'delete' | 'create' | 'execute' | 'send_message' | 'desktop_control' | 'network';
  filePath?: string;
  summary: string;
  diff?: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  proposedBy: string;
  ts: number;
  violations?: string[];
  /** 扩展: 操作详情 (如微信消息内容、桌面操作描述) */
  details?: string;
  /** 扩展: 工具名称 */
  toolName?: string;
}

interface Props {
  proposal: ApprovalProposal;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}

const RISK_COLORS: Record<string, string> = {
  low: 'green',
  medium: 'orange',
  high: 'red',
  critical: 'magenta',
};

/** 将文件路径转为路径模式 (取目录前缀 + **) */
function pathToPattern(filePath: string): string {
  if (!filePath || filePath === 'unknown') return '*';
  // 取到包级目录: packages/agentai-gui/src/... → packages/agentai-gui/**
  const parts = filePath.replace(/\\/g, '/').split('/');
  if (parts.length >= 2 && parts[0] === 'packages') {
    return parts.slice(0, 2).join('/') + '/**';
  }
  if (parts.length >= 2) {
    return parts.slice(0, 2).join('/') + '/**';
  }
  return '*';
}

export const ApprovalCard: React.FC<Props> = ({ proposal, onApprove, onReject }) => {
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null);
  const [trustChecked, setTrustChecked] = useState(false);

  const handleApprove = () => {
    setLoading('approve');
    // 如果勾选了"信任此命令"，先保存白名单
    if (trustChecked && proposal.toolName && proposal.filePath) {
      const pathPattern = pathToPattern(proposal.filePath);
      fetch(GATEWAY_HTTP + '/v1/trusted-commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName: proposal.toolName, pathPattern }),
      }).then(r => {
        if (r.ok) message.success(`已信任 ${proposal.toolName} → ${pathPattern}`);
      }).catch(() => {});
    }
    setTimeout(() => onApprove(proposal.id), 50);
  };

  const handleReject = () => {
    setLoading('reject');
    setTimeout(() => onReject(proposal.id), 50);
  };

  return (
    <Card
      size="small"
      style={{
        margin: '8px 0',
        borderLeft: `3px solid ${RISK_COLORS[proposal.riskLevel] || '#888'}`,
        background: '#141414',
      }}
      title={
        <Space>
          <SafetyOutlined />
          <span>{proposal.type === 'send_message' ? '消息发送审批' : proposal.type === 'desktop_control' ? '桌面操作审批' : proposal.type === 'delete' ? '文件删除审批' : proposal.type === 'execute' ? '命令执行审批' : 'AI 代码修改审批'}</span>
          <Tag color={RISK_COLORS[proposal.riskLevel]}>{proposal.riskLevel.toUpperCase()}</Tag>
          {proposal.toolName && <Tag>{proposal.toolName}</Tag>}
        </Space>
      }
      extra={
        <Space>
          <Button
            size="small"
            type="primary"
            icon={<CheckOutlined />}
            loading={loading === 'approve'}
            disabled={loading !== null && loading !== 'approve'}
            onClick={handleApprove}
          >
            批准
          </Button>
          <Button
            size="small"
            danger
            icon={<CloseOutlined />}
            loading={loading === 'reject'}
            disabled={loading !== null && loading !== 'reject'}
            onClick={handleReject}
          >
            拒绝
          </Button>
        </Space>
      }
    >
      <div style={{ fontSize: 12, color: '#aaa', marginBottom: 4 }}>
        <Tag>{proposal.type}</Tag>
        {proposal.filePath && <span style={{ fontFamily: 'monospace' }}>{proposal.filePath}</span>}
      </div>
      <div style={{ fontSize: 13, color: '#ddd', marginBottom: 8 }}>
        {proposal.summary}
      </div>
      {proposal.details && (
        <div style={{ fontSize: 12, color: '#bbb', marginBottom: 8, padding: '4px 8px', background: '#0d0d0d', borderRadius: 4 }}>
          {proposal.details}
        </div>
      )}
      {proposal.violations && proposal.violations.length > 0 && (
        <div style={{ fontSize: 11, color: '#f87171', marginBottom: 4 }}>
          违规项: {proposal.violations.join(', ')}
        </div>
      )}
      {proposal.diff && (
        <pre style={{
          fontSize: 11, background: '#0d0d0d', color: '#aaa',
          padding: 6, borderRadius: 4, maxHeight: 120, overflow: 'auto',
          margin: 0,
        }}>
          {proposal.diff}
        </pre>
      )}
      {/* 信任此命令选项 */}
      <div style={{
        marginTop: 8, padding: '6px 8px',
        background: 'rgba(79,70,229,0.06)', borderRadius: 4,
        border: '1px solid rgba(79,70,229,0.15)',
      }}>
        <Checkbox
          checked={trustChecked}
          onChange={e => setTrustChecked(e.target.checked)}
          style={{ fontSize: 11, color: '#aaa' }}
        >
          <Tooltip title={`信任后，相同工具(${proposal.toolName || '?'})对相同目录的操作将自动跳过审批`}>
            <span>信任此命令，后续不再提示</span>
          </Tooltip>
        </Checkbox>
        {trustChecked && proposal.filePath && (
          <div style={{ fontSize: 10, color: '#666', marginTop: 2, marginLeft: 22 }}>
            白名单: {proposal.toolName} → {pathToPattern(proposal.filePath)}
          </div>
        )}
      </div>
    </Card>
  );
};
