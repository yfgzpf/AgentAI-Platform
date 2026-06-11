/**
 * 真设置页 - 密钥管理 / 框架选择 / 模型选择 / 启动 wizard 入口
 */
import React, { useState, useEffect } from 'react';
import { Card, Input, Button, Space, Tag, Alert, Form, message, Tabs, Descriptions } from 'antd';
import { KeyOutlined, SaveOutlined, ApiOutlined, SettingOutlined, ThunderboltOutlined, RobotOutlined } from '@ant-design/icons';
import { ModelSelector } from './ModelSelector';
import { useSettingsStore, useFrameworkStore } from '../store';

const httpUrl = () => ((window as any).__AGENTAI_GATEWAY__ || 'ws://127.0.0.1:18789').replace(/^ws/, 'http');

export const Settings: React.FC = () => {
  const { provider, hasKey, setProvider, setHasKey } = useSettingsStore();
  const { active, setActive, abRatio, setAbRatio } = useFrameworkStore();
  const [apiKey, setApiKey] = useState('');
  const [keyStatus, setKeyStatus] = useState<{ ok: boolean; masked: string; envVar: string } | null>(null);

  // QQ Bot 状态
  const [qqStatus, setQQStatus] = useState<{ online: boolean; lastSeen: number; messageCount: number; sessionId: string }>({
    online: false, lastSeen: 0, messageCount: 0, sessionId: '',
  });

  // 从 gateway 拉取 key 状态 (避免前端存真实 key)
  const loadKeyStatus = async () => {
    try {
      const r = await fetch(httpUrl() + '/v1/settings/keys');
      if (r.ok) {
        const data = await r.json();
        setKeyStatus(data);
        setHasKey(data.ok);
      }
    } catch {
      setKeyStatus({ ok: false, masked: 'gateway 离线', envVar: provider === 'agentai' ? 'AGENTAI_API_KEY' : `${provider.toUpperCase()}_API_KEY` });
    }
  };

  useEffect(() => {
    loadKeyStatus();
    const t = setInterval(loadKeyStatus, 10000);

    // QQ Bot 状态轮询
    const loadQQStatus = async () => {
      try {
        const r = await fetch(httpUrl() + '/v1/qq/status');
        if (r.ok) setQQStatus(await r.json());
      } catch { /* gateway offline */ }
    };
    loadQQStatus();
    const q = setInterval(loadQQStatus, 5000);

    return () => { clearInterval(t); clearInterval(q); };
  }, [provider]);

  const saveKey = async () => {
    if (!apiKey.trim()) {
      message.warning('请输入 API key');
      return;
    }
    // 真保存走 gateway (写到 .env)
    try {
      const r = await fetch(httpUrl() + '/v1/settings/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey }),
      });
      if (r.ok) {
        message.success('✅ Key 已保存到 .env (AES-256-GCM 加密)');
        setApiKey('');
        loadKeyStatus();
      } else {
        const err = await r.json();
        message.error('保存失败: ' + (err.error || r.status));
      }
    } catch (e: any) {
      message.error('保存失败: ' + e.message);
    }
  };

  return (
    <div style={{ padding: 24, color: '#fff', maxWidth: 900, margin: '0 auto' }}>
      <h2><SettingOutlined /> AgentAI Platform 设置</h2>

      <Tabs
        defaultActiveKey="llm"
        items={[
          {
            key: 'llm',
            label: <span><ApiOutlined /> LLM 模型</span>,
            children: (
              <Card>
                <Space direction="vertical" style={{ width: '100%' }} size={16}>
                  <ModelSelector />
                  <Alert
                    type="info"
                    message="模型路由规则 (5 维评分)"
                    description={
                      <ul style={{ marginBottom: 0, paddingLeft: 18 }}>
                        <li>【免费】Cline: DS Flash (速度快, 通用对话)</li>
                        <li>【免费】Cline: MiniMax M3 (社交闲聊, 无工具)</li>
                        <li>【免费】Cline: 小米 MiMo (1M 上下文, 多模态)</li>
                        <li>【免费】Agnes AI (主模型, 工具+多模态)</li>
                        <li>【付费】DeepSeek Pro (强力推理, 架构/安全场景)</li>
                        <li>【付费】GPT-4o mini (兜底)</li>
                      </ul>
                    }
                  />
                </Space>
              </Card>
            ),
          },
          {
            key: 'keys',
            label: <span><KeyOutlined /> 密钥管理</span>,
            children: (
              <Card>
                <Space direction="vertical" style={{ width: '100%' }} size={16}>
                  <Alert
                    type="warning"
                    message="密钥安全"
                    description="密钥保存到项目根目录 .env, 用 AES-256-GCM 加密, 不上传任何服务器"
                  />
                  {keyStatus && (
                    <Descriptions size="small" column={1} bordered>
                      <Descriptions.Item label="当前 provider">{provider}</Descriptions.Item>
                      <Descriptions.Item label="Key 状态">
                        {keyStatus.ok ? <Tag color="success">✓ 已配置</Tag> : <Tag color="error">✗ 未配置</Tag>}
                      </Descriptions.Item>
                      <Descriptions.Item label="Key 预览">{keyStatus.masked}</Descriptions.Item>
                      <Descriptions.Item label="环境变量名">
                        <code>{keyStatus.envVar}</code>
                      </Descriptions.Item>
                    </Descriptions>
                  )}
                  <Form layout="vertical">
                    <Form.Item label={`新 ${provider.toUpperCase()}_API_KEY`}>
                      <Input.Password
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="sk-..."
                        prefix={<KeyOutlined />}
                      />
                    </Form.Item>
                    <Form.Item>
                      <Button type="primary" icon={<SaveOutlined />} onClick={saveKey}>
                        保存到 .env
                      </Button>
                    </Form.Item>
                  </Form>
                </Space>
              </Card>
            ),
          },
          {
            key: 'framework',
            label: <span><ThunderboltOutlined /> 框架切换</span>,
            children: (
              <Card>
                <Space direction="vertical" style={{ width: '100%' }} size={16}>
                  <div>
                    <div style={{ color: '#888', marginBottom: 8 }}>当前框架</div>
                    <Space>
                      <Button
                        type={active === 'openclaw' ? 'primary' : 'default'}
                        onClick={() => setActive('openclaw')}
                      >
                        OpenClaw (学自 ZhiY.AI)
                      </Button>
                      <Button
                        type={active === 'hermes' ? 'primary' : 'default'}
                        onClick={() => setActive('hermes')}
                        style={active === 'hermes' ? { background: '#9333EA', borderColor: '#9333EA' } : undefined}
                      >
                        Hermes (学自 30+ 平台)
                      </Button>
                    </Space>
                  </div>
                  <div>
                    <div style={{ color: '#888' }}>A/B 灰度: {(abRatio * 100).toFixed(0)}% → {active}</div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={abRatio}
                      onChange={(e) => setAbRatio(parseFloat(e.target.value))}
                      style={{ width: '100%' }}
                    />
                  </div>
                  <Alert
                    type="info"
                    message="自创整合说明"
                    description={
                      <ul style={{ marginBottom: 0, paddingLeft: 18 }}>
                        <li>不是照搬 OpenClaw, 是学它系统提示含工具描述的写法</li>
                        <li>不是照搬 Hermes, 是学它 30+ 平台的网关 + 工具注册模式</li>
                        <li>融合 Reasonix 的 Cache-First + 4 步修复</li>
                        <li>4 大自创: 中文注入扫描 / 风险门 / 反思门 / 智能路由</li>
                      </ul>
                    }
                  />
                </Space>
              </Card>
            ),
          },
          {
            key: 'qq',
            label: <span><RobotOutlined /> QQ Bot</span>,
            children: (
              <Card>
                <Space direction="vertical" style={{ width: '100%' }} size={16}>
                  <Space>
                    {qqStatus.online ? (
                      <Tag color="success">已连接</Tag>
                    ) : (
                      <Tag color="default">未连接</Tag>
                    )}
                    {qqStatus.sessionId && (
                      <span style={{ color: '#888', fontSize: 12 }}>
                        Session: {qqStatus.sessionId}
                      </span>
                    )}
                  </Space>
                  {qqStatus.online && (
                    <Descriptions size="small" column={1} bordered>
                      <Descriptions.Item label="消息数">{qqStatus.messageCount}</Descriptions.Item>
                      <Descriptions.Item label="上次心跳">
                        {new Date(qqStatus.lastSeen).toLocaleTimeString()}
                      </Descriptions.Item>
                    </Descriptions>
                  )}
                  <Alert
                    type="info"
                    message="QQ 机器人说明"
                    description={
                      <ul style={{ marginBottom: 0, paddingLeft: 18 }}>
                        <li>QQ Bot 作为独立进程运行, 通过 HTTP 调 Gateway</li>
                        <li>启动: <code>AGENTAI_QQ_APPID=xxx AGENTAI_QQ_SECRET=xxx pnpm --filter agentai-qqbot dev</code></li>
                        <li>使用 QQ 官方机器人 API (非 go-cqhttp)</li>
                        <li>支持私聊/群聊, 远程命令 (/help /new /abort /model 等)</li>
                        <li>获取 AppID/Secret: <a href="https://q.qq.com/" target="_blank">QQ 开放平台</a></li>
                      </ul>
                    }
                  />
                </Space>
              </Card>
            ),
          },
          {
            key: 'about',
            label: <span>关于</span>,
            children: (
              <Card>
                <Descriptions column={1} bordered>
                  <Descriptions.Item label="项目">AgentAI Platform v0.1.0-alpha.1</Descriptions.Item>
                  <Descriptions.Item label="桌面壳">Tauri 2.0 (5-10MB)</Descriptions.Item>
                  <Descriptions.Item label="Gateway">Node.js + Socket.io (18789)</Descriptions.Item>
                  <Descriptions.Item label="VSCode 扩展">.vsix 18.9 KB</Descriptions.Item>
                  <Descriptions.Item label="QQ 机器人">独立 agentai-qqbot 包</Descriptions.Item>
                  <Descriptions.Item label="多模态">Agnes Image 2.1 + Video v2.0</Descriptions.Item>
                  <Descriptions.Item label="3 框架参照">ZhiY.AI + Hermes + Reasonix</Descriptions.Item>
                </Descriptions>
              </Card>
            ),
          },
        ]}
      />
    </div>
  );
};
