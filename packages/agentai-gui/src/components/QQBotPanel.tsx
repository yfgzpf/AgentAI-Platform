import React, { useState, useEffect, useRef } from 'react';
import { Card, Input, Button, Tag, Space, Steps, Typography, message, Alert } from 'antd';
import { io, type Socket } from 'socket.io-client';
import { GATEWAY_HTTP } from '../services/config';

const { Text } = Typography;

export const QQBotPanel: React.FC = () => {
  const [status, setStatus] = useState<'offline' | 'online' | 'connecting'>('offline');
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [messageCount, setMessageCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const sockRef = useRef<Socket | null>(null);

  // 初始状态检查 + socket.io 实时状态推送
  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch(`${GATEWAY_HTTP}/v1/qq/status`);
        const data = await r.json();
        setStatus(data.online ? 'online' : 'offline');
        setMessageCount(data.messageCount || 0);
      } catch { setStatus('offline'); }
    };
    check();

    // socket.io 实时状态
    const httpUrl = GATEWAY_HTTP;
    const sock = io(httpUrl, { transports: ['websocket', 'polling'] });
    sockRef.current = sock;

    sock.on('qq:status', (data: any) => {
      setStatus(data.online ? 'online' : 'offline');
      setMessageCount(data.messageCount || 0);
    });

    return () => { sock.disconnect(); };
  }, []);

  const handleConnect = async () => {
    if (!appId.trim() || !appSecret.trim()) {
      message.warning('请填写 AppID 和 AppSecret');
      return;
    }
    setStatus('connecting');
    setErrorMsg('');
    try {
      const resp = await fetch(`${GATEWAY_HTTP}/v1/qq/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: appId.trim(), appSecret: appSecret.trim() }),
      });
      const data = await resp.json();
      if (resp.ok && data.ok) {
        setStatus('online');
        message.success(data.message || 'QQ Bot 已连接');
      } else {
        setStatus('offline');
        setErrorMsg(data.error || '连接失败');
        message.error(data.error || '连接失败');
      }
    } catch (err: any) {
      setStatus('offline');
      setErrorMsg('连接超时: ' + err.message);
      message.error('连接超时');
    }
  };

  const handleDisconnect = async () => {
    try {
      await fetch(`${GATEWAY_HTTP}/v1/qq/destroy`, { method: 'POST' });
      setStatus('offline');
      message.success('已断开连接');
    } catch { /* ignore */ }
  };

  return (
    <div style={{ padding: 24, maxWidth: 600, margin: '0 auto' }}>
      <Typography.Title level={3}>QQ Bot 配置</Typography.Title>

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <Tag color={status === 'online' ? 'green' : status === 'connecting' ? 'blue' : 'red'}>
            {status === 'online' ? '已连接' : status === 'connecting' ? '连接中' : '离线'}
          </Tag>
          {status === 'online' && <Text type="secondary">已处理 {messageCount} 条消息</Text>}
        </div>

        {errorMsg && (
          <Alert
            type="error"
            message={errorMsg}
            style={{ marginBottom: 12 }}
            showIcon
            closable
            onClose={() => setErrorMsg('')}
          />
        )}

        <Space direction="vertical" style={{ width: '100%' }}>
          <Input placeholder="AppID" value={appId} onChange={e => setAppId(e.target.value)} />
          <Input.Password placeholder="AppSecret" value={appSecret} onChange={e => setAppSecret(e.target.value)} />
          {status === 'online' ? (
            <Button danger onClick={handleDisconnect}>断开连接</Button>
          ) : (
            <Button type="primary" onClick={handleConnect} loading={status === 'connecting'}>连接</Button>
          )}
        </Space>
      </Card>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Text type="secondary">
          提示: 连接成功后，QQ 消息将实时显示在对话窗口中。AI 也可通过 <Text code>connect_qq_bot</Text> 工具自主连接。
        </Text>
      </Card>

      <Steps
        direction="vertical"
        current={1}
        items={[
          { title: '创建 QQ 机器人', description: '前往 q.qq.com 创建机器人应用' },
          { title: '填写 AppID / AppSecret', description: '在 Bot 管理后台获取' },
          { title: '开启权限', description: '在管理后台开启 "C2C消息" 和 "群聊@消息" 权限' },
          { title: '点击连接', description: '配置完成后点击连接按钮 — 或让 AI 帮你连接' },
        ]}
      />
    </div>
  );
};
