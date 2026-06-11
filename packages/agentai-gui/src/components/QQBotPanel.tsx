import React, { useState, useEffect } from 'react';
import { Card, Input, Button, Tag, Space, Steps, Typography, message, Alert } from 'antd';
import { apiGet } from '../services/api';

const { Text, Paragraph } = Typography;

export const QQBotPanel: React.FC = () => {
  const [status, setStatus] = useState<'offline' | 'online' | 'connecting'>('offline');
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [messageCount, setMessageCount] = useState(0);

  useEffect(() => {
    const check = async () => {
      try {
        const r = await apiGet('/v1/qq/status');
        setStatus(r.online ? 'online' : 'offline');
        setMessageCount(r.messageCount || 0);
      } catch { setStatus('offline'); }
    };
    check();
    const t = setInterval(check, 10000);
    return () => clearInterval(t);
  }, []);

  const handleConnect = async () => {
    if (!appId.trim() || !appSecret.trim()) { message.warning('请填写 AppID 和 AppSecret'); return; }
    setStatus('connecting');
    try {
      const resp = await fetch('/v1/qq/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: appId.trim(), appSecret: appSecret.trim() }),
      });
      if (resp.ok) { setStatus('online'); message.success('QQ Bot 已连接'); }
      else { setStatus('offline'); message.error('连接失败'); }
    } catch { setStatus('offline'); message.error('连接超时'); }
  };

  return (
    <div style={{ padding: 24, maxWidth: 600, margin: '0 auto' }}>
      <Typography.Title level={3}>🤖 QQ Bot 配置</Typography.Title>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <Tag color={status === 'online' ? 'green' : status === 'connecting' ? 'blue' : 'red'}>
            {status === 'online' ? '已连接' : status === 'connecting' ? '连接中' : '离线'}
          </Tag>
          {status === 'online' && <Text type="secondary">已处理 {messageCount} 条消息</Text>}
        </div>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input placeholder="AppID" value={appId} onChange={e => setAppId(e.target.value)} />
          <Input.Password placeholder="AppSecret" value={appSecret} onChange={e => setAppSecret(e.target.value)} />
          <Button type="primary" onClick={handleConnect} loading={status === 'connecting'}>连接</Button>
        </Space>
      </Card>
      <Steps
        direction="vertical"
        current={1}
        items={[
          { title: '创建 QQ 机器人', description: '前往 qq.qq.com 创建机器人应用' },
          { title: '填写 AppID / AppSecret', description: '在 Bot 管理后台获取' },
          { title: '启动服务', description: '配置完成后点击连接按钮' },
        ]}
      />
    </div>
  );
};
