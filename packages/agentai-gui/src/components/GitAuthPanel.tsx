/**
 * Git 授权配置面板 — 管理 SSH Key / HTTPS Token / Git 用户信息
 */

import React, { useState, useEffect } from 'react';
import { Modal, Form, Input, Button, Card, Alert, Tabs, Typography, Space, message, Radio, List, Tag, Tooltip } from 'antd';
import { KeyOutlined, GlobalOutlined, UserOutlined, CopyOutlined, CheckCircleOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';

const { Text, Title } = Typography;
const { TabPane } = Tabs;

interface GitAuthConfig {
  type: 'ssh' | 'https_token';
  name: string;
  isDefault: boolean;
  host?: string;
  username?: string;
  sshPublicKey?: string;
}

interface GitUser {
  name: string;
  email: string;
}

interface GitAuthPanelProps {
  visible: boolean;
  onClose: () => void;
}

export const GitAuthPanel: React.FC<GitAuthPanelProps> = ({ visible, onClose }) => {
  const [configs, setConfigs] = useState<GitAuthConfig[]>([]);
  const [gitUser, setGitUser] = useState<GitUser>({ name: '', email: '' });
  const [hasSSHKey, setHasSSHKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('ssh');
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // 表单
  const [sshForm] = Form.useForm();
  const [tokenForm] = Form.useForm();
  const [userForm] = Form.useForm();

  // 加载配置
  const loadConfigs = async () => {
    try {
      const res = await fetch('/v1/git/auth');
      const data = await res.json();
      if (data.success) {
        setConfigs(data.configs);
        setGitUser(data.gitUser);
        setHasSSHKey(data.hasSSHKey);
        userForm.setFieldsValue(data.gitUser);
      }
    } catch (e) {
      message.error('加载配置失败');
    }
  };

  useEffect(() => {
    if (visible) {
      loadConfigs();
    }
  }, [visible]);

  // 生成 SSH Key
  const handleGenerateSSH = async (values: { name: string; email: string }) => {
    setLoading(true);
    try {
      const res = await fetch('/v1/git/auth/ssh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (data.success) {
        message.success('SSH Key 生成成功');
        setPublicKey(data.publicKey);
        loadConfigs();
        sshForm.resetFields();
      } else {
        message.error(data.error || '生成失败');
      }
    } catch (e) {
      message.error('请求失败');
    }
    setLoading(false);
  };

  // 添加 Token
  const handleAddToken = async (values: { name: string; host: string; username: string; token: string }) => {
    setLoading(true);
    try {
      const res = await fetch('/v1/git/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (data.success) {
        message.success('Token 保存成功');
        loadConfigs();
        tokenForm.resetFields();
      } else {
        message.error(data.error || '保存失败');
      }
    } catch (e) {
      message.error('请求失败');
    }
    setLoading(false);
  };

  // 配置 Git 用户
  const handleSetUser = async (values: GitUser) => {
    setLoading(true);
    try {
      const res = await fetch('/v1/git/auth/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (data.success) {
        message.success('Git 用户信息已配置');
        setGitUser(values);
      } else {
        message.error(data.error || '配置失败');
      }
    } catch (e) {
      message.error('请求失败');
    }
    setLoading(false);
  };

  // 删除配置
  const handleDelete = async (name: string) => {
    try {
      const res = await fetch(`/v1/git/auth/${name}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        message.success('已删除');
        loadConfigs();
      }
    } catch (e) {
      message.error('删除失败');
    }
  };

  // 设置默认
  const handleSetDefault = async (name: string) => {
    try {
      const res = await fetch('/v1/git/auth/default', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (data.success) {
        message.success('默认配置已更新');
        loadConfigs();
      }
    } catch (e) {
      message.error('设置失败');
    }
  };

  // 获取公钥
  const handleGetPublicKey = async () => {
    try {
      const res = await fetch('/v1/git/auth/public-key');
      const data = await res.json();
      if (data.success) {
        setPublicKey(data.publicKey);
      }
    } catch (e) {
      message.error('获取公钥失败');
    }
  };

  // 测试认证
  const handleTestAuth = async () => {
    setLoading(true);
    setTestResult(null);
    try {
      const res = await fetch('/v1/git/auth/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'github.com' }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch (e) {
      setTestResult({ success: false, message: '测试请求失败' });
    }
    setLoading(false);
  };

  // 复制到剪贴板
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    message.success('已复制');
  };

  return (
    <Modal
      title={<><KeyOutlined /> Git 授权配置</>}
      open={visible}
      onCancel={onClose}
      width={700}
      footer={null}
    >
      <Tabs activeKey={activeTab} onChange={setActiveTab}>
        <TabPane tab={<><KeyOutlined /> SSH Key</>} key="ssh">
          <Space direction="vertical" style={{ width: '100%' }}>
            {/* 现有配置列表 */}
            {configs.filter(c => c.type === 'ssh').length > 0 && (
              <Card size="small" title="已配置的 SSH Key">
                <List
                  dataSource={configs.filter(c => c.type === 'ssh')}
                  renderItem={item => (
                    <List.Item
                      actions={[
                        !item.isDefault && (
                          <Button size="small" onClick={() => handleSetDefault(item.name)}>
                            设为默认
                          </Button>
                        ),
                        <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(item.name)}>
                          删除
                        </Button>,
                      ]}
                    >
                      <List.Item.Meta
                        title={
                          <Space>
                            {item.name}
                            {item.isDefault && <Tag color="blue">默认</Tag>}
                          </Space>
                        }
                        description={item.sshPublicKey?.slice(0, 60) + '...'}
                      />
                    </List.Item>
                  )}
                />
              </Card>
            )}

            {/* 生成新 Key */}
            <Card size="small" title="生成新的 SSH Key">
              <Form form={sshForm} onFinish={handleGenerateSSH} layout="vertical">
                <Form.Item name="name" label="Key 名称" rules={[{ required: true }]}>
                  <Input placeholder="例如: github-work" />
                </Form.Item>
                <Form.Item name="email" label="邮箱" rules={[{ required: true, type: 'email' }]}>
                  <Input placeholder="your@email.com" />
                </Form.Item>
                <Button type="primary" htmlType="submit" loading={loading} icon={<PlusOutlined />}>
                  生成 SSH Key
                </Button>
              </Form>
            </Card>

            {/* 显示公钥 */}
            {(publicKey || hasSSHKey) && (
              <Card size="small" title="SSH 公钥">
                {!publicKey && hasSSHKey && (
                  <Button onClick={handleGetPublicKey}>查看公钥</Button>
                )}
                {publicKey && (
                  <>
                    <Alert
                      message="将此公钥添加到 GitHub/GitLab"
                      description={
                        <>
                          GitHub: Settings → SSH and GPG keys → New SSH key<br />
                          GitLab: Preferences → SSH Keys
                        </>
                      }
                      type="info"
                      showIcon
                      style={{ marginBottom: 8 }}
                    />
                    <Input.TextArea
                      value={publicKey}
                      readOnly
                      rows={4}
                      style={{ fontFamily: 'monospace', fontSize: 12 }}
                    />
                    <Button icon={<CopyOutlined />} onClick={() => copyToClipboard(publicKey)} style={{ marginTop: 8 }}>
                      复制公钥
                    </Button>
                  </>
                )}
              </Card>
            )}
          </Space>
        </TabPane>

        <TabPane tab={<><GlobalOutlined /> HTTPS Token</>} key="token">
          <Space direction="vertical" style={{ width: '100%' }}>
            {/* 现有 Token 列表 */}
            {configs.filter(c => c.type === 'https_token').length > 0 && (
              <Card size="small" title="已配置的 Token">
                <List
                  dataSource={configs.filter(c => c.type === 'https_token')}
                  renderItem={item => (
                    <List.Item
                      actions={[
                        !item.isDefault && (
                          <Button size="small" onClick={() => handleSetDefault(item.name)}>
                            设为默认
                          </Button>
                        ),
                        <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(item.name)}>
                          删除
                        </Button>,
                      ]}
                    >
                      <List.Item.Meta
                        title={
                          <Space>
                            {item.name}
                            {item.isDefault && <Tag color="blue">默认</Tag>}
                          </Space>
                        }
                        description={`${item.host} / ${item.username}`}
                      />
                    </List.Item>
                  )}
                />
              </Card>
            )}

            {/* 添加新 Token */}
            <Card size="small" title="添加 Personal Access Token">
              <Alert
                message="获取 Token"
                description={
                  <>
                    GitHub: Settings → Developer settings → Personal access tokens<br />
                    GitLab: Preferences → Access Tokens
                  </>
                }
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
              />
              <Form form={tokenForm} onFinish={handleAddToken} layout="vertical">
                <Form.Item name="name" label="配置名称" rules={[{ required: true }]}>
                  <Input placeholder="例如: github-token" />
                </Form.Item>
                <Form.Item name="host" label="Git 托管平台" rules={[{ required: true }]}>
                  <Input placeholder="github.com 或 gitlab.com" />
                </Form.Item>
                <Form.Item name="username" label="用户名" rules={[{ required: true }]}>
                  <Input placeholder="GitHub/GitLab 用户名" />
                </Form.Item>
                <Form.Item name="token" label="Personal Access Token" rules={[{ required: true }]}>
                  <Input.Password placeholder="ghp_xxxxxxxxxxxx" />
                </Form.Item>
                <Button type="primary" htmlType="submit" loading={loading} icon={<PlusOutlined />}>
                  保存 Token
                </Button>
              </Form>
            </Card>
          </Space>
        </TabPane>

        <TabPane tab={<><UserOutlined /> Git 用户</>} key="user">
          <Card>
            <Alert
              message="配置 Git 提交者信息"
              description="这将设置 git config --global user.name 和 user.email"
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />
            <Form form={userForm} onFinish={handleSetUser} layout="vertical">
              <Form.Item name="name" label="用户名" rules={[{ required: true }]}>
                <Input placeholder="Your Name" />
              </Form.Item>
              <Form.Item name="email" label="邮箱" rules={[{ required: true, type: 'email' }]}>
                <Input placeholder="your@email.com" />
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={loading}>
                保存配置
              </Button>
            </Form>

            {gitUser.name && (
              <div style={{ marginTop: 16, padding: 12, background: 'var(--panel)', borderRadius: 4 }}>
                <Text type="secondary">当前配置:</Text><br />
                <Text strong>{gitUser.name}</Text> &lt;{gitUser.email}&gt;
              </div>
            )}
          </Card>
        </TabPane>

        <TabPane tab={<><CheckCircleOutlined /> 测试</>} key="test">
          <Card>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Text>测试与 GitHub 的 SSH 连接:</Text>
              <Button onClick={handleTestAuth} loading={loading} type="primary">
                测试连接
              </Button>

              {testResult && (
                <Alert
                  message={testResult.success ? '连接成功' : '连接失败'}
                  description={testResult.message}
                  type={testResult.success ? 'success' : 'error'}
                  showIcon
                />
              )}

              <div style={{ marginTop: 16 }}>
                <Title level={5}>常见问题</Title>
                <ul>
                  <li>Permission denied: 检查 SSH key 是否已添加到 GitHub/GitLab</li>
                  <li>Could not resolve hostname: 检查网络连接</li>
                  <li>Authentication failed: 检查 Token 是否过期或被撤销</li>
                </ul>
              </div>
            </Space>
          </Card>
        </TabPane>
      </Tabs>
    </Modal>
  );
};

export default GitAuthPanel;
