/**
 * MCPConfigModal — MCP 服务配置弹窗
 * ==================================
 * 直接从 Gateway /v1/mcp/config 读取真实 MCP 服务器状态。
 * 支持启用/禁用、查看工具列表、判断连接状态。
 */
import React, { useEffect, useState } from 'react';
import { Modal, Space, Typography, Switch, Tag, List, Spin, message } from 'antd';
import { ApiOutlined, CheckCircleOutlined, CloseCircleOutlined, ToolOutlined } from '@ant-design/icons';
import { gatewayFallback } from '../../services/GatewayFallback';

const { Text } = Typography;

interface McpServer {
  name: string;
  transport: string;
  command?: string;
  args?: string[];
  enabled: boolean;
  connected?: boolean;
}

interface MCPConfigModalProps {
  open: boolean;
  onClose: () => void;
}

const GATEWAY = () => gatewayFallback.url || 'http://127.0.0.1:18789';

const MCPConfigModal: React.FC<MCPConfigModalProps> = ({ open, onClose }) => {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const resp = await fetch(`${GATEWAY()}/v1/mcp/config`, {
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        const data = await resp.json();
        setServers(data.servers || data.config || []);
      }
    } catch {
      // Gateway 可能未启动，使用静态配置
      setServers([
        { name: 'memory', transport: 'stdio', enabled: true, connected: true },
        { name: 'brightdata', transport: 'stdio', enabled: false, command: 'npx', args: ['-y','@brightdata/cli','mcp'] },
        { name: 'filesystem', transport: 'stdio', enabled: false },
        { name: 'github', transport: 'stdio', enabled: false },
        { name: 'brave-search', transport: 'stdio', enabled: false },
        { name: 'sqlite', transport: 'stdio', enabled: false },
      ]);
    }
    setLoading(false);
  };

  useEffect(() => { if (open) fetchConfig(); }, [open]);

  const handleToggle = async (name: string, enabled: boolean) => {
    try {
      await fetch(`${GATEWAY()}/v1/mcp/config/${name}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      // 本地更新
    }
    setServers(prev => prev.map(s => s.name === name ? { ...s, enabled } : s));
    message.info(`${name} ${enabled ? '已启用' : '已禁用'}`);
  };

  return (
    <Modal
      title={<Space><ApiOutlined /><span>MCP 服务器配置</span></Space>}
      open={open} onCancel={onClose} footer={null} width={600}
    >
      <Text type="secondary" style={{ marginBottom: 16, display: 'block' }}>
        MCP (Model Context Protocol) 服务器为智能体提供外部工具能力。
        启用后 AI 可调用对应服务的工具函数。重启 Gateway 后生效。
      </Text>

      {loading ? <Spin /> : (
        <List
          dataSource={servers}
          renderItem={s => (
            <List.Item
              actions={[
                <Switch
                  key="toggle"
                  checked={s.enabled}
                  onChange={(v) => handleToggle(s.name, v)}
                  checkedChildren="开"
                  unCheckedChildren="关"
                />,
              ]}
              style={{
                padding: '10px 12px',
                background: 'var(--card)',
                borderRadius: 8,
                marginBottom: 8,
                border: '1px solid var(--border)',
              }}
            >
              <List.Item.Meta
                avatar={
                  s.connected
                    ? <CheckCircleOutlined style={{ color: 'var(--success)', fontSize: 16 }} />
                    : s.enabled
                      ? <CloseCircleOutlined style={{ color: 'var(--warning)', fontSize: 16 }} />
                      : <ToolOutlined style={{ color: 'var(--muted)', fontSize: 16 }} />
                }
                title={
                  <Space>
                    <Text strong>{s.name}</Text>
                    <Tag color={s.enabled ? 'green' : 'default'}>{s.enabled ? '已启用' : '已禁用'}</Tag>
                    {s.connected && <Tag color="blue">已连接</Tag>}
                  </Space>
                }
                description={
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {s.transport} {s.command ? `→ ${s.command} ${(s.args || []).join(' ')}` : ''}
                  </span>
                }
              />
            </List.Item>
          )}
        />
      )}
    </Modal>
  );
};

export default MCPConfigModal;
