/**
 * 远程环境按钮 - 放在 Composer 底部栏
 * 位置: 语音图标旁边
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Tooltip, Dropdown, Badge, Modal, Form, Input, Select, message } from 'antd';
import { CloudServerOutlined, PlusOutlined, DisconnectOutlined, CheckCircleOutlined, GlobalOutlined, DesktopOutlined, CodeOutlined } from '@ant-design/icons';
import { GATEWAY_HTTP } from '../services/config';

interface RemoteEnvironment {
  id: string;
  name: string;
  type: 'ssh' | 'wsl' | 'docker';
  workingDirectory: string;
  defaultShell?: string;
  envVars?: Record<string, string>;
  isFavorite: boolean;
  lastUsed: number;
  ssh?: {
    host: string;
    port: number;
    username: string;
    authType: 'password' | 'key' | 'agent';
    password?: string;
    privateKey?: string;
  };
  wsl?: {
    distribution: string;
    user?: string;
  };
  docker?: {
    image: string;
    workingDir?: string;
    volumes?: string[];
    env?: Record<string, string>;
  };
}

interface ConnectionState {
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  currentDirectory?: string;
  latency?: number;
}

export const RemoteEnvironmentButton: React.FC = () => {
  const [environments, setEnvironments] = useState<RemoteEnvironment[]>([]);
  const [connections, setConnections] = useState<Map<string, ConnectionState>>(new Map());
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();

  // 加载环境列表
  const loadEnvironments = useCallback(async () => {
    try {
      const res = await fetch(`${GATEWAY_HTTP}/v1/remote/environments`);
      const data = await res.json();
      if (data.success) {
        setEnvironments(data.environments);
      }
    } catch (e) {
      console.warn('[Remote] Failed to load environments:', e);
    }
  }, []);

  // 检查连接状态
  const checkConnections = useCallback(async () => {
    for (const env of environments) {
      try {
        const res = await fetch(`${GATEWAY_HTTP}/v1/remote/status/${env.id}`);
        const data = await res.json();
        setConnections(prev => new Map(prev).set(env.id, data.state || { status: 'disconnected' }));
      } catch (e) {
        setConnections(prev => new Map(prev).set(env.id, { status: 'disconnected' }));
      }
    }
  }, [environments]);

  useEffect(() => {
    loadEnvironments();
    const interval = setInterval(checkConnections, 5000);
    return () => clearInterval(interval);
  }, [loadEnvironments, checkConnections]);

  // 连接环境
  const connect = async (envId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${GATEWAY_HTTP}/v1/remote/connect/${envId}`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        message.success('已连接到远程环境');
        setConnections(prev => new Map(prev).set(envId, data.state));
      } else {
        message.error(data.error || '连接失败');
      }
    } catch (e: any) {
      message.error('连接失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  // 断开连接
  const disconnect = async (envId: string) => {
    setLoading(true);
    try {
      await fetch(`${GATEWAY_HTTP}/v1/remote/disconnect/${envId}`, { method: 'POST' });
      setConnections(prev => new Map(prev).set(envId, { status: 'disconnected' }));
      message.success('已断开连接');
    } catch (e) {
      message.error('断开失败');
    } finally {
      setLoading(false);
    }
  };

  // 创建环境
  const createEnvironment = async (values: any) => {
    setLoading(true);
    try {
      const env: Partial<RemoteEnvironment> = {
        name: values.name,
        type: values.type,
        workingDirectory: values.workingDirectory,
        defaultShell: 'bash',
        envVars: {},
      };

      if (values.type === 'ssh') {
        env.ssh = {
          host: values.host,
          port: values.port || 22,
          username: values.username,
          authType: values.authType,
          password: values.password,
          privateKey: values.privateKey,
        };
      } else if (values.type === 'wsl') {
        env.wsl = {
          distribution: values.distribution,
          user: values.username,
        };
      } else if (values.type === 'docker') {
        env.docker = {
          image: values.image,
          workingDir: values.workingDirectory,
          volumes: [],
          env: {},
        };
      }

      const res = await fetch(`${GATEWAY_HTTP}/v1/remote/environments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(env),
      });
      const data = await res.json();
      if (data.success) {
        message.success('环境已创建');
        setModalOpen(false);
        form.resetFields();
        loadEnvironments();
      } else {
        message.error(data.error || '创建失败');
      }
    } catch (e: any) {
      message.error('创建失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  // 获取当前连接的环境
  const connectedEnv = environments.find(env => connections.get(env.id)?.status === 'connected');

  const getIcon = (type: string) => {
    switch (type) {
      case 'ssh': return <GlobalOutlined />;
      case 'wsl': return <DesktopOutlined />;
      case 'docker': return <CodeOutlined />;
      default: return <CloudServerOutlined />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'connected': return '#52c41a';
      case 'connecting': return '#faad14';
      case 'error': return '#f5222d';
      default: return '#8c8c8c';
    }
  };

  const menuItems = [
    ...environments.map(env => {
      const conn = connections.get(env.id);
      const isConnected = conn?.status === 'connected';
      return {
        key: env.id,
        label: (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
            {getIcon(env.type)}
            <span style={{ flex: 1 }}>{env.name}</span>
            <Badge
              status={isConnected ? 'success' : 'default'}
              text={isConnected ? '已连接' : '未连接'}
            />
            {isConnected ? (
              <DisconnectOutlined
                style={{ color: '#f5222d', cursor: 'pointer' }}
                onClick={(e) => { e.stopPropagation(); disconnect(env.id); }}
              />
            ) : (
              <CheckCircleOutlined
                style={{ color: '#52c41a', cursor: 'pointer' }}
                onClick={(e) => { e.stopPropagation(); connect(env.id); }}
              />
            )}
          </div>
        ),
        onClick: () => !isConnected && connect(env.id),
      };
    }),
    { type: 'divider' as const },
    {
      key: 'add',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <PlusOutlined /> 新建环境
        </span>
      ),
      onClick: () => setModalOpen(true),
    },
  ];

  return (
    <>
      <Dropdown
        menu={{ items: menuItems }}
        placement="topLeft"
        trigger={['click']}
      >
        <Tooltip title={connectedEnv ? `远程: ${connectedEnv.name}` : '远程环境'}>
          <button
            className="icon-btn-sm"
            style={{
              color: connectedEnv ? '#52c41a' : 'var(--muted-2)',
              position: 'relative',
            }}
          >
            <CloudServerOutlined style={{ fontSize: 14 }} />
            {connectedEnv && (
              <span
                style={{
                  position: 'absolute',
                  bottom: 2,
                  right: 2,
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: '#52c41a',
                }}
              />
            )}
          </button>
        </Tooltip>
      </Dropdown>

      {/* 创建环境弹窗 */}
      <Modal
        title="新建远程环境"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={loading}
        width={500}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={createEnvironment}
          initialValues={{ type: 'ssh', port: 22, workingDirectory: '/home/user' }}
        >
          <Form.Item
            name="name"
            label="环境名称"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input placeholder="例如: 阿里云开发机" />
          </Form.Item>

          <Form.Item
            name="type"
            label="类型"
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { value: 'ssh', label: 'SSH 服务器', icon: <GlobalOutlined /> },
                { value: 'wsl', label: 'WSL', icon: <DesktopOutlined /> },
                { value: 'docker', label: 'Docker 容器', icon: <CodeOutlined /> },
              ]}
            />
          </Form.Item>

          <Form.Item
            noStyle
            shouldUpdate={(prev, curr) => prev.type !== curr.type}
          >
            {({ getFieldValue }) => {
              const type = getFieldValue('type');
              if (type === 'ssh') {
                return (
                  <>
                    <Form.Item name="host" label="主机" rules={[{ required: true }]}>
                      <Input placeholder="192.168.1.100 或 example.com" />
                    </Form.Item>
                    <Form.Item name="port" label="端口">
                      <Input type="number" />
                    </Form.Item>
                    <Form.Item name="username" label="用户名" rules={[{ required: true }]}>
                      <Input placeholder="root" />
                    </Form.Item>
                    <Form.Item name="authType" label="认证方式">
                      <Select
                        options={[
                          { value: 'password', label: '密码' },
                          { value: 'key', label: 'SSH 密钥' },
                          { value: 'agent', label: 'SSH Agent' },
                        ]}
                      />
                    </Form.Item>
                    <Form.Item noStyle shouldUpdate={(prev, curr) => prev.authType !== curr.authType}>
                      {({ getFieldValue }) => {
                        const authType = getFieldValue('authType');
                        if (authType === 'password') {
                          return (
                            <Form.Item name="password" label="密码">
                              <Input.Password />
                            </Form.Item>
                          );
                        } else if (authType === 'key') {
                          return (
                            <Form.Item name="privateKey" label="私钥">
                              <Input.TextArea rows={4} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" />
                            </Form.Item>
                          );
                        }
                        return null;
                      }}
                    </Form.Item>
                  </>
                );
              } else if (type === 'wsl') {
                return (
                  <>
                    <Form.Item name="distribution" label="发行版">
                      <Input placeholder="Ubuntu-22.04" />
                    </Form.Item>
                    <Form.Item name="username" label="用户名（可选）">
                      <Input placeholder="默认用户" />
                    </Form.Item>
                  </>
                );
              } else if (type === 'docker') {
                return (
                  <>
                    <Form.Item name="image" label="镜像" rules={[{ required: true }]}>
                      <Input placeholder="node:18-alpine" />
                    </Form.Item>
                  </>
                );
              }
              return null;
            }}
          </Form.Item>

          <Form.Item
            name="workingDirectory"
            label="工作目录"
            rules={[{ required: true }]}
          >
            <Input placeholder="/home/user/projects" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default RemoteEnvironmentButton;
