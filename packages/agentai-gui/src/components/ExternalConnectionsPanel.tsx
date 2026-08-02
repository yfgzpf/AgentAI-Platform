import React, { useState, useEffect } from 'react';
import { Switch, Card, Row, Col, Tag, Space, Typography, message, Button, Divider } from 'antd';
import { MobileOutlined, BookOutlined, FieldBinaryOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

/**
 * ExternalConnectionsPanel - 外部连接管理面板
 * 
 * 统一管理所有外部设备/服务连接:
 * 1. Android 设备 (Another MCP Server)
 * 2. SketchUp 3D 建模
 * 3. 微信公众号自动化
 * 
 * 每个连接都有独立的开关, 支持运行时启用/禁用。
 */
export const ExternalConnectionsPanel: React.FC = () => {
  const [connections, setConnections] = useState<Array<{
    id: string;
    name: string;
    icon: React.ReactNode;
    description: string;
    enabled: boolean;
    status: 'online' | 'offline' | 'error';
    details?: string;
  }>>([
    {
      id: 'android',
      name: 'Android 设备控制',
      icon: <MobileOutlined />,
      description: '通过 Another MCP Server 控制 Android 手机, AI 可操作任何 App (微信/抖音/小红书/快手等)',
      enabled: false,
      status: 'offline',
      details: '需要 Another 桌面应用运行中 (localhost:7070)',
    },
    {
      id: 'sketchup',
      name: 'SketchUp 3D 建模',
      icon: <FieldBinaryOutlined />,
      description: '让 AI 直接操控 SketchUp 进行建模操作 (创建几何体/设置材质/布尔运算)',
      enabled: false,
      status: 'offline',
      details: '需要安装 sketchup-mcp2 + Ruby 扩展 + SketchUp 已打开',
    },
    {
      id: 'wechat-automation',
      name: '微信公众号自动化',
      icon: <BookOutlined />,
      description: 'AI 全自动运营公众号: 对标拆解 → 写稿 → deAI → 质量闸门 → 排版配图 → 发布草稿箱',
      enabled: false,
      status: 'offline',
      details: '需要 DeepSeek API Key + 公众号 AppID/AppSecret',
    },
  ]);

  // 从后端获取实际连接状态
  const fetchConnectionStatus = async () => {
    try {
      const response = await fetch('/api/external-connections/status');
      if (response.ok) {
        const data = await response.json();
        setConnections(prev => prev.map(conn => ({
          ...conn,
          enabled: data[conn.id]?.enabled ?? conn.enabled,
          status: data[conn.id]?.status ?? conn.status,
        })));
      }
    } catch (error) {
      console.warn('[ExternalConnectionsPanel] Failed to fetch status:', error);
    }
  };

  useEffect(() => {
    fetchConnectionStatus();
    // 每 30 秒刷新一次状态
    const interval = setInterval(fetchConnectionStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const toggleConnection = async (id: string, enabled: boolean) => {
    try {
      const response = await fetch('/api/external-connections/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, enabled }),
      });
      
      if (response.ok) {
        setConnections(prev => prev.map(conn => 
          conn.id === id ? { ...conn, enabled, status: enabled ? 'online' : 'offline' } : conn
        ));
        message.success(enabled ? `已启用 ${id}` : `已禁用 ${id}`);
      } else {
        message.error('切换失败');
      }
    } catch (error) {
      console.error('[ExternalConnectionsPanel] Toggle failed:', error);
      message.error('切换失败');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'green';
      case 'offline': return 'default';
      case 'error': return 'red';
      default: return 'default';
    }
  };

  return (
    <div style={{ padding: '24px' }}>
      <Title level={3}>
        外部连接管理
        <Tag color="blue" style={{ marginLeft: 12 }}>External Connections</Tag>
      </Title>
      <Text type="secondary">统一管理所有外部设备和服务的连接状态</Text>
      
      <Divider />
      
      <Row gutter={[16, 16]}>
        {connections.map((conn) => (
          <Col span={8} key={conn.id}>
            <Card
              title={
                <Space>
                  {conn.icon}
                  {conn.name}
                  <Tag color={getStatusColor(conn.status)}>
                    {conn.status === 'online' ? '在线' : conn.status === 'offline' ? '离线' : '错误'}
                  </Tag>
                </Space>
              }
              size="small"
              extra={
                <Switch
                  checked={conn.enabled}
                  onChange={(checked) => toggleConnection(conn.id, checked)}
                  checkedChildren="开"
                  unCheckedChildren="关"
                />
              }
            >
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                <Text>{conn.description}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>{conn.details}</Text>
              </Space>
            </Card>
          </Col>
        ))}
      </Row>
      
      <Divider />
      
      <Card title="连接说明" size="small">
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div>
            <Text strong>Android 设备控制:</Text>
            <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 20 }}>
              <li>通用手机自动化: AI 可操作任何 App (微信/抖音/小红书/快手等)</li>
              <li>支持截图、点击、滑动、输入、按键等操作</li>
              <li>需要安装 Another 桌面应用并连接 Android 设备</li>
            </ul>
          </div>
          
          <div>
            <Text strong>SketchUp 3D 建模:</Text>
            <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 20 }}>
              <li>AI 直接操控 SketchUp 进行建模操作</li>
              <li>支持创建几何体、设置材质、布尔运算、导出文件</li>
              <li>适合建筑/室内/家具设计行业用户</li>
            </ul>
          </div>
          
          <div>
            <Text strong>微信公众号自动化:</Text>
            <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 20 }}>
              <li>AI 全自动运营公众号完整流水线</li>
              <li>对标拆解 → 选题判断 → AI 写初稿 → deAI 去指纹 → 质量闸门 → 排版配图 → 发布</li>
              <li>适合自媒体运营和内容创作者</li>
            </ul>
          </div>
        </Space>
      </Card>
    </div>
  );
};
