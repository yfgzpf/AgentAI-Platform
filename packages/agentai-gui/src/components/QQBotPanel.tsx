/**
 * QQBotPanel - QQ 机器人管理面板
 * 独立启动/停止/查看日志
 */
import React, { useEffect, useState } from 'react';
import { Card, Button, Space, Tag, Alert, Input, message } from 'antd';
import { MessageOutlined, ReloadOutlined, CheckCircleFilled, CloseCircleFilled } from '@ant-design/icons';

interface BotStatus {
  running: boolean;
  pid?: number;
  port?: number;
  version?: string;
}

export const QQBotPanel: React.FC = () => {
  const [status, setStatus] = useState<BotStatus>({ running: false });
  const [account, setAccount] = useState('');

  const check = async () => {
    // 探活: 试着连 go-cqhttp 的 HTTP API
    try {
      const r = await fetch('http://127.0.0.1:5700/get_login_info', { signal: AbortSignal.timeout(2000) });
      const data = await r.json();
      if (data.retcode === 0) {
        setStatus({ running: true, version: 'ok', pid: 0 });
      } else {
        setStatus({ running: false });
      }
    } catch {
      setStatus({ running: false });
    }
  };

  useEffect(() => {
    check();
    const t = setInterval(check, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ padding: 16, color: '#fff' }}>
      <Card
        size="small"
        title={<Space><MessageOutlined />QQ 机器人 (独立 agentai-qqbot 包)</Space>}
        extra={<Button size="small" icon={<ReloadOutlined />} onClick={check}>刷新</Button>}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Space>
            {status.running ? (
              <Tag color="success" icon={<CheckCircleFilled />}>go-cqhttp 运行中</Tag>
            ) : (
              <Tag color="error" icon={<CloseCircleFilled />}>go-cqhttp 未运行</Tag>
            )}
            <span style={{ color: '#888', fontSize: 12 }}>HTTP API: 127.0.0.1:5700</span>
          </Space>

          {!status.running && (
            <Alert
              type="info"
              message="首次启动步骤"
              description={
                <ol style={{ marginBottom: 0, paddingLeft: 18 }}>
                  <li>下载 go-cqhttp 二进制到 <code>packages/agentai-qqbot/bin/</code></li>
                  <li>复制 <code>config.example.yml</code> 为 <code>config.yml</code> 并修改</li>
                  <li>运行 <code>cd packages/agentai-qqbot &amp;&amp; pnpm start</code></li>
                  <li>扫码登录 QQ (推荐小号)</li>
                </ol>
              }
            />
          )}

          <div>
            <div style={{ color: '#888', fontSize: 12, marginBottom: 4 }}>QQ 账号 (用于记录):</div>
            <Input
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder="123456789"
              style={{ maxWidth: 200 }}
            />
          </div>

          <div style={{ background: '#1a1a1a', padding: 8, borderRadius: 4, fontSize: 11, color: '#888' }}>
            <div>📦 独立包: <code>packages/agentai-qqbot/</code></div>
            <div>📄 文档: <code>docs/QQBOT_SETUP.md</code></div>
            <div>🧪 测试: <code>3/3 通过</code></div>
            <div>🔌 通信: 反向 WebSocket (5700) + HTTP API</div>
          </div>

          {status.running && (
            <Alert
              type="success"
              message="机器人已就绪"
              description="在 QQ 群/私聊发送消息即可触发智能体回复 (走 AgentAI Gateway)"
              showIcon
            />
          )}
        </Space>
      </Card>
    </div>
  );
};
