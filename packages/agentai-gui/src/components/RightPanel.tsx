/**
 * RightPanel - 右侧信息面板
 *   - 工作区目录设置
 *   - 模型选择器
 *   - Agent 状态 (provider / 熔断)
 *   - 会话信息
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Card, Input, Button, Tag, Progress, Divider, Typography, Space, Tooltip, Badge } from 'antd';
import {
  FolderOpenOutlined, SettingOutlined, ApiOutlined, ThunderboltOutlined,
  ReloadOutlined, CheckCircleFilled, CloseCircleFilled, ClockCircleFilled,
  RobotOutlined, InfoCircleOutlined,
} from '@ant-design/icons';
import { ModelSelector } from './ModelSelector';
import { useProfileStore, useSettingsStore } from '../store';
import { useModelStore } from '../store/modelStore';

const { Text, Paragraph } = Typography;

export const RightPanel: React.FC = () => {
  const { profile, setProfile } = useProfileStore();
  const { provider } = useSettingsStore();
  const { activeModelId } = useModelStore();

  const [workspace, setWorkspace] = useState(profile?.workspace || '');
  const [editingWs, setEditingWs] = useState(false);
  const [gatewayStatus, setGatewayStatus] = useState<'online' | 'offline' | 'checking'>('checking');
  const [statsExpanded, setStatsExpanded] = useState(false);

  // 检测 Gateway 在线状态
  const checkGateway = useCallback(async () => {
    setGatewayStatus('checking');
    try {
      const r = await fetch('/api/health', { signal: AbortSignal.timeout(3000) });
      setGatewayStatus(r.ok ? 'online' : 'offline');
    } catch {
      setGatewayStatus('offline');
    }
  }, []);

  useEffect(() => { checkGateway(); }, [checkGateway]);

  // 保存工作区
  const saveWorkspace = () => {
    if (profile) {
      setProfile({ ...profile, workspace });
    }
    setEditingWs(false);
  };

  return (
    <div style={{ padding: '12px 12px 12px 0', height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, background: '#0f0f0f' }}>
      {/* 工作区目录 */}
      <Card
        size="small"
        title={<span><FolderOpenOutlined /> 工作区</span>}
        style={{ borderRadius: 10, background: '#141414', border: '1px solid #262626' }}
      >
        {editingWs ? (
          <div>
            <Input
              size="small"
              value={workspace}
              onChange={e => setWorkspace(e.target.value)}
              placeholder="输入项目目录路径..."
              style={{ marginBottom: 8 }}
            />
            <Space>
              <Button size="small" type="primary" onClick={saveWorkspace}>保存</Button>
              <Button size="small" onClick={() => setEditingWs(false)}>取消</Button>
            </Space>
          </div>
        ) : (
          <div>
            <div
              style={{ padding: '6px 8px', background: '#1a1a1a', borderRadius: 6, fontSize: 12, color: '#888', marginBottom: 6, cursor: 'pointer', fontFamily: 'monospace' }}
              onClick={() => setEditingWs(true)}
            >
              {workspace || '未设置 —— 点击设置'}
            </div>
            <Button size="small" icon={<SettingOutlined />} onClick={() => setEditingWs(true)} type="link">
              更改
            </Button>
          </div>
        )}
      </Card>

      {/* 模型选择器 */}
      <Card
        size="small"
        title={<span><ApiOutlined /> 模型</span>}
        style={{ borderRadius: 10, background: '#141414', border: '1px solid #262626' }}
      >
        <ModelSelector />
      </Card>

      {/* Gateway 状态 */}
      <Card
        size="small"
        title={<span><ThunderboltOutlined /> 系统状态</span>}
        style={{ borderRadius: 10, background: '#141414', border: '1px solid #262626' }}
        extra={
          <Button size="small" type="text" icon={<ReloadOutlined />} onClick={checkGateway} loading={gatewayStatus === 'checking'} />
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 12, color: '#888' }}>Gateway</Text>
            <Badge
              status={gatewayStatus === 'online' ? 'success' : gatewayStatus === 'offline' ? 'error' : 'processing'}
              text={gatewayStatus === 'online' ? '在线' : gatewayStatus === 'offline' ? '离线' : '检测中'}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 12, color: '#888' }}>当前模型</Text>
            <Tag color="blue" style={{ fontSize: 10 }}>{provider || '自动'}</Tag>
          </div>
        </div>
      </Card>

      {/* 功能预告 */}
      <Card
        size="small"
        title={<span><InfoCircleOutlined /> 快捷提示</span>}
        style={{ borderRadius: 10, background: '#141414', border: '1px solid #262626' }}
      >
        <div style={{ fontSize: 11, color: '#666', lineHeight: 1.8 }}>
          <div> 只读模式: 纯对话，不执行工具</div>
          <div> 规划模式: 先规划再执行</div>
          <div> 自动模式: 智能推理 + 工具</div>
          <Divider style={{ margin: '6px 0', borderColor: '#262626' }} />
          <div style={{ color: '#52c41a' }}> 4 个免费模型可用</div>
          <div style={{ color: '#fa8c16' }}> DeepSeek / OpenAI 付费</div>
        </div>
      </Card>
    </div>
  );
};
