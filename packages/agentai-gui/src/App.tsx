import { useState } from 'react';
import { Button, Input, Card, Space, Typography } from 'antd';
import { ThunderboltOutlined, SendOutlined } from '@ant-design/icons';
import io from 'socket.io-client';

const { Title, Paragraph } = Typography;

const socket = io('http://127.0.0.1:18789', { transports: ['websocket'] });

export default function App() {
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([
    { role: 'assistant', content: '👋 你好! 我是 AgentAI 助手。' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  socket.on('chat:reply', (data) => {
    setMessages((prev) => [...prev, { role: 'assistant', content: data.content }]);
    setLoading(false);
  });

  const send = () => {
    if (!input.trim() || loading) return;
    const userMsg = { role: 'user', content: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    socket.emit('chat', userMsg);
  };

  return (
    <div style={{ minHeight: '100vh', background: '#F9FAFB', padding: 24 }}>
      <Card style={{ maxWidth: 800, margin: '0 auto' }}>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div style={{ textAlign: 'center' }}>
            <ThunderboltOutlined style={{ fontSize: 48, color: '#4F46E5' }} />
            <Title level={2} style={{ marginTop: 16, color: '#4F46E5' }}>
              AgentAI Platform
            </Title>
            <Paragraph type="secondary">v0.1.0-alpha.1 · 阶段 1 脚手架</Paragraph>
          </div>

          <Card
            size="small"
            style={{ minHeight: 300, maxHeight: 500, overflowY: 'auto', background: '#FAFAFA' }}
          >
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  textAlign: m.role === 'user' ? 'right' : 'left',
                  marginBottom: 12,
                }}
              >
                <div
                  style={{
                    display: 'inline-block',
                    padding: '8px 12px',
                    borderRadius: 8,
                    background: m.role === 'user' ? '#4F46E5' : '#FFFFFF',
                    color: m.role === 'user' ? '#FFFFFF' : '#111827',
                    maxWidth: '70%',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                  }}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ color: '#6B7280', fontSize: 12 }}>AgentAI 正在思考...</div>
            )}
          </Card>

          <Space.Compact style={{ width: '100%' }}>
            <Input
              size="large"
              placeholder="输入消息, 按 Enter 发送"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPressEnter={send}
              disabled={loading}
            />
            <Button
              type="primary"
              size="large"
              icon={<SendOutlined />}
              onClick={send}
              disabled={loading}
            >
              发送
            </Button>
          </Space.Compact>
        </Space>
      </Card>
    </div>
  );
}
