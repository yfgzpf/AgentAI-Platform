/**
 * NotificationPanel — 通知中心面板
 * 
 * 核心功能:
 *   1. 实时消息推送 (SSE/WebSocket)
 *   2. 通知历史管理
 *   3. 多渠道配置 (Webhook/邮件/桌面)
 *   4. 智能告警规则
 */

import React, { useState, useEffect, useCallback } from 'react';
import { 
  List, Badge, Button, Card, Tag, Space, Typography, 
  Tabs, Empty, Switch, Select, Form, Input, message,
  Popconfirm, Divider
} from 'antd';
import { 
  BellOutlined, CheckCircleOutlined, DeleteOutlined,
  SettingOutlined, MailOutlined, DesktopOutlined,
  GlobalOutlined, RobotOutlined, ThunderboltOutlined,
  ClearOutlined
} from '@ant-design/icons';
import { GATEWAY_HTTP } from '../services/config';

const { Text, Title } = Typography;
const { TabPane } = Tabs;
const { Option } = Select;

interface Notification {
  id: string;
  title: string;
  content: string;
  type: 'info' | 'success' | 'warning' | 'error';
  source: string;
  timestamp: string;
  read: boolean;
  link?: string;
}

interface NotificationConfig {
  desktop: boolean;
  email: boolean;
  webhook: boolean;
  emailAddress?: string;
  webhookUrl?: string;
  rules: {
    taskComplete: boolean;
    taskFailed: boolean;
    newLead: boolean;
    systemAlert: boolean;
  };
}

export const NotificationPanel: React.FC = () => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [config, setConfig] = useState<NotificationConfig>({
    desktop: true,
    email: false,
    webhook: false,
    rules: {
      taskComplete: true,
      taskFailed: true,
      newLead: true,
      systemAlert: true,
    },
  });
  const [activeTab, setActiveTab] = useState('all');

  // 获取通知列表
  const fetchNotifications = useCallback(async () => {
    try {
      const response = await fetch(`${GATEWAY_HTTP}/v1/notifications?limit=50`);
      if (response.ok) {
        const data = await response.json();
        setNotifications(data.notifications || []);
        setUnreadCount(data.notifications?.filter((n: Notification) => !n.read).length || 0);
      }
    } catch (error) {
      console.error('获取通知失败:', error);
      // 使用示例数据
      setNotifications([
        {
          id: '1',
          title: 'RPA任务执行成功',
          content: '微信客户跟进任务已完成，成功发送32条消息',
          type: 'success',
          source: 'rpa',
          timestamp: '2026-07-17 15:30:00',
          read: false,
        },
        {
          id: '2',
          title: '新线索提醒',
          content: '收到新的高价值线索：张先生，评分85分',
          type: 'info',
          source: 'lead',
          timestamp: '2026-07-17 14:20:00',
          read: false,
        },
        {
          id: '3',
          title: '系统告警',
          content: 'API调用频率接近限制，请留意用量',
          type: 'warning',
          source: 'system',
          timestamp: '2026-07-17 12:00:00',
          read: true,
        },
        {
          id: '4',
          title: '定时任务失败',
          content: '数据备份任务执行失败，请检查网络连接',
          type: 'error',
          source: 'scheduler',
          timestamp: '2026-07-17 10:00:00',
          read: true,
        },
      ]);
      setUnreadCount(2);
    }
  }, []);

  // 获取配置
  const fetchConfig = useCallback(async () => {
    try {
      const response = await fetch(`${GATEWAY_HTTP}/v1/notifications/config`);
      if (response.ok) {
        const data = await response.json();
        setConfig(data.config || config);
      }
    } catch (error) {
      console.error('获取配置失败:', error);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    fetchConfig();
    
    // 建立SSE连接
    const eventSource = new EventSource(`${GATEWAY_HTTP}/v1/notifications/stream`);
    eventSource.onmessage = (event) => {
      const notification = JSON.parse(event.data);
      setNotifications(prev => [notification, ...prev]);
      setUnreadCount(prev => prev + 1);
    };

    return () => {
      eventSource.close();
    };
  }, [fetchNotifications, fetchConfig]);

  // 标记已读
  const markAsRead = async (id: string) => {
    try {
      await fetch(`${GATEWAY_HTTP}/v1/notifications/${id}/read`, { method: 'POST' });
      setNotifications(prev => 
        prev.map(n => n.id === id ? { ...n, read: true } : n)
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (error) {
      console.error('标记已读失败:', error);
    }
  };

  // 标记全部已读
  const markAllAsRead = async () => {
    try {
      await fetch(`${GATEWAY_HTTP}/v1/notifications/read-all`, { method: 'POST' });
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
      message.success('已全部标记为已读');
    } catch (error) {
      message.error('操作失败');
    }
  };

  // 删除通知
  const deleteNotification = async (id: string) => {
    try {
      await fetch(`${GATEWAY_HTTP}/v1/notifications/${id}`, { method: 'DELETE' });
      setNotifications(prev => prev.filter(n => n.id !== id));
      message.success('删除成功');
    } catch (error) {
      message.error('删除失败');
    }
  };

  // 清空所有通知
  const clearAll = async () => {
    try {
      await fetch(`${GATEWAY_HTTP}/v1/notifications/clear`, { method: 'POST' });
      setNotifications([]);
      setUnreadCount(0);
      message.success('已清空所有通知');
    } catch (error) {
      message.error('操作失败');
    }
  };

  // 保存配置
  const saveConfig = async () => {
    try {
      await fetch(`${GATEWAY_HTTP}/v1/notifications/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      });
      message.success('配置保存成功');
    } catch (error) {
      message.error('保存失败');
    }
  };

  // 过滤通知
  const filteredNotifications = notifications.filter(n => {
    if (activeTab === 'all') return true;
    if (activeTab === 'unread') return !n.read;
    if (activeTab === 'system') return n.source === 'system';
    if (activeTab === 'business') return ['lead', 'rpa', 'scheduler'].includes(n.source);
    return true;
  });

  const getIcon = (type: string) => {
    switch (type) {
      case 'success': return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
      case 'warning': return <ThunderboltOutlined style={{ color: '#faad14' }} />;
      case 'error': return <RobotOutlined style={{ color: '#f5222d' }} />;
      default: return <BellOutlined style={{ color: '#1890ff' }} />;
    }
  };

  const getTagColor = (source: string) => {
    switch (source) {
      case 'system': return 'red';
      case 'lead': return 'green';
      case 'rpa': return 'blue';
      case 'scheduler': return 'purple';
      default: return 'default';
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <Card
        title={
          <Space>
            <BellOutlined />
            <span>通知中心</span>
            {unreadCount > 0 && (
              <Badge count={unreadCount} style={{ backgroundColor: '#f5222d' }} />
            )}
          </Space>
        }
        extra={
          <Space>
            <Button 
              icon={<CheckCircleOutlined />} 
              onClick={markAllAsRead}
              disabled={unreadCount === 0}
            >
              全部已读
            </Button>
            <Popconfirm
              title="确定清空所有通知？"
              onConfirm={clearAll}
            >
              <Button icon={<ClearOutlined />} danger>
                清空
              </Button>
            </Popconfirm>
          </Space>
        }
      >
        <Tabs activeKey={activeTab} onChange={setActiveTab}>
          <TabPane tab="全部" key="all" />
          <TabPane tab={<span>未读 <Badge count={unreadCount} size="small" /></span>} key="unread" />
          <TabPane tab="系统" key="system" />
          <TabPane tab="业务" key="business" />
          <TabPane tab={<span><SettingOutlined /> 设置</span>} key="settings" />
        </Tabs>

        {activeTab === 'settings' ? (
          <Form layout="vertical" style={{ maxWidth: 600 }}>
            <Title level={5}>通知渠道</Title>
            <Form.Item label="桌面通知">
              <Switch 
                checked={config.desktop} 
                onChange={v => setConfig({ ...config, desktop: v })}
              />
            </Form.Item>
            <Form.Item label="邮件通知">
              <Space>
                <Switch 
                  checked={config.email} 
                  onChange={v => setConfig({ ...config, email: v })}
                />
                {config.email && (
                  <Input 
                    placeholder="邮箱地址" 
                    value={config.emailAddress}
                    onChange={e => setConfig({ ...config, emailAddress: e.target.value })}
                    style={{ width: 300 }}
                  />
                )}
              </Space>
            </Form.Item>
            <Form.Item label="Webhook通知">
              <Space>
                <Switch 
                  checked={config.webhook} 
                  onChange={v => setConfig({ ...config, webhook: v })}
                />
                {config.webhook && (
                  <Input 
                    placeholder="Webhook URL" 
                    value={config.webhookUrl}
                    onChange={e => setConfig({ ...config, webhookUrl: e.target.value })}
                    style={{ width: 400 }}
                  />
                )}
              </Space>
            </Form.Item>

            <Divider />

            <Title level={5}>通知规则</Title>
            <Form.Item label="任务完成">
              <Switch 
                checked={config.rules.taskComplete} 
                onChange={v => setConfig({ ...config, rules: { ...config.rules, taskComplete: v } })}
              />
            </Form.Item>
            <Form.Item label="任务失败">
              <Switch 
                checked={config.rules.taskFailed} 
                onChange={v => setConfig({ ...config, rules: { ...config.rules, taskFailed: v } })}
              />
            </Form.Item>
            <Form.Item label="新线索">
              <Switch 
                checked={config.rules.newLead} 
                onChange={v => setConfig({ ...config, rules: { ...config.rules, newLead: v } })}
              />
            </Form.Item>
            <Form.Item label="系统告警">
              <Switch 
                checked={config.rules.systemAlert} 
                onChange={v => setConfig({ ...config, rules: { ...config.rules, systemAlert: v } })}
              />
            </Form.Item>

            <Button type="primary" onClick={saveConfig}>
              保存配置
            </Button>
          </Form>
        ) : (
          <List
            dataSource={filteredNotifications}
            renderItem={item => (
              <List.Item
                style={{ 
                  backgroundColor: item.read ? 'transparent' : '#f0f5ff',
                  padding: '12px 16px',
                  cursor: 'pointer'
                }}
                onClick={() => markAsRead(item.id)}
                actions={[
                  <Button 
                    icon={<DeleteOutlined />} 
                    size="small" 
                    danger
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteNotification(item.id);
                    }}
                  />
                ]}
              >
                <List.Item.Meta
                  avatar={getIcon(item.type)}
                  title={
                    <Space>
                      <Text strong style={{ opacity: item.read ? 0.6 : 1 }}>
                        {item.title}
                      </Text>
                      <Tag color={getTagColor(item.source)}>
                        {item.source}
                      </Tag>
                      {!item.read && <Badge status="processing" />}
                    </Space>
                  }
                  description={
                    <Space direction="vertical" size={0}>
                      <Text type="secondary" style={{ opacity: item.read ? 0.6 : 1 }}>
                        {item.content}
                      </Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {item.timestamp}
                      </Text>
                    </Space>
                  }
                />
              </List.Item>
            )}
            locale={{ emptyText: <Empty description="暂无通知" /> }}
          />
        )}
      </Card>
    </div>
  );
};

export default NotificationPanel;
