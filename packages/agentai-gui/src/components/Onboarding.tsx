/**
 * Onboarding Wizard - 首次启动引导
 * 收集用户名称 + 选择主要用途 + (可选) 配密钥
 * 完成后写入 useProfileStore, 整个应用记住
 */
import React, { useState } from 'react';
import { Modal, Input, Button, Space, Typography, Radio, Card, Avatar, Tag, message } from 'antd';
import { UserOutlined, RocketOutlined, SmileOutlined, CodeOutlined, PictureOutlined, MessageOutlined, RightOutlined } from '@ant-design/icons';
import { useProfileStore } from '../store';

const { Title, Paragraph, Text } = Typography;

interface OnboardProps {
  open: boolean;
  onClose?: () => void;
  /** 完成引导时回调, 父组件决定后续动作 (写 store / reload / 关闭 modal) */
  onFinish?: (name: string) => void;
}

type Step = 'welcome' | 'name' | 'useCase' | 'key' | 'done';

const USE_CASES = [
  { key: 'chat', label: '💬 日常聊天', icon: <MessageOutlined />, desc: '问问题, 写文案, 翻译' },
  { key: 'image', label: '🎨 生图创作', icon: <PictureOutlined />, desc: 'AI 画图, 封面, 头像' },
  { key: 'code', label: '💻 写代码', icon: <CodeOutlined />, desc: '调试, 重构, 解释' },
  { key: 'auto', label: '🤖 全自动', icon: <RocketOutlined />, desc: 'Agent + 工具全开' },
];

const SUGGEST_NAMES = ['小明', 'Alex', 'Lisa', '张工', 'Sarah', '老王', '游客'];

export const Onboarding: React.FC<OnboardProps> = ({ open, onClose, onFinish }) => {
  const { setProfile } = useProfileStore();
  const [step, setStep] = useState<Step>('welcome');
  const [name, setName] = useState('');
  const [useCase, setUseCase] = useState('chat');
  const [apiKey, setApiKey] = useState('');
  const [skipKey, setSkipKey] = useState(false);

  const finish = () => {
    if (!name.trim()) {
      message.warning('名字还是写一下吧~');
      return;
    }
    setProfile({
      name: name.trim(),
      onboardedAt: Date.now(),
      language: 'zh',
    });
    message.success(`欢迎, ${name.trim()}!`);
    setStep('done');
    if (onFinish) {
      // 父组件接管后续动作 (默认走 reload)
      onFinish(name.trim());
    } else {
      setTimeout(() => {
        window.location.reload();
      }, 1200);
    }
  };

  const saveKey = async () => {
    if (!apiKey.trim()) {
      setSkipKey(true);
      finish();
      return;
    }
    try {
      const httpUrl = ((window as any).__AGENTAI_GATEWAY__ || 'ws://127.0.0.1:18789').replace(/^ws/, 'http');
      const r = await fetch(httpUrl + '/v1/settings/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'agentai', apiKey }),
      });
      if (r.ok) {
        message.success('✅ 密钥已保存, 你可以随时在 设置 → 密钥管理 改');
        finish();
      } else {
        message.error('保存失败, 但可以稍后在设置页填');
        finish();
      }
    } catch {
      finish();
    }
  };

  return (
    <Modal
      open={open}
      footer={null}
      closable={false}
      maskClosable={false}
      width={560}
      centered
      styles={{ body: { padding: 0 } }}
    >
      {step === 'welcome' && (
        <div style={{ padding: 32, textAlign: 'center' }}>
          <Avatar size={80} style={{ background: 'linear-gradient(135deg, #4F46E5 0%, #9333EA 100%)' }} icon={<RocketOutlined />} />
          <Title level={2} style={{ marginTop: 16, color: '#fff' }}>欢迎使用 AgentAI Platform</Title>
          <Paragraph style={{ color: '#888', fontSize: 14 }}>
            融合 3 大智能体框架 · 支持生图生视频 · VSCode/QQ/Tauri 全平台
          </Paragraph>
          <Space size={12} style={{ marginTop: 16 }} wrap>
            <Tag color="blue">Hermes</Tag>
            <Tag color="purple">OpenClaw</Tag>
            <Tag color="cyan">Reasonix Cache</Tag>
            <Tag color="green">Agnes 2.0</Tag>
          </Space>
          <div style={{ marginTop: 24 }}>
            <Button type="primary" size="large" icon={<RightOutlined />} onClick={() => setStep('name')}>
              开始 (10 秒)
            </Button>
          </div>
          <div style={{ marginTop: 16, color: '#666', fontSize: 11 }}>所有数据存本机 localStorage, 不上传</div>
        </div>
      )}

      {step === 'name' && (
        <div style={{ padding: 32 }}>
          <Title level={3}><SmileOutlined /> 先认识一下</Title>
          <Paragraph style={{ color: '#888' }}>你希望我叫你什么? (我会记住, 之后在所有地方用这个名字跟你说话)</Paragraph>
          <Input
            size="large"
            prefix={<UserOutlined />}
            placeholder="输入名字, 例如: 小明"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onPressEnter={() => name.trim() && setStep('useCase')}
            maxLength={20}
            autoFocus
            style={{ marginBottom: 12 }}
          />
          <Space wrap>
            <Text type="secondary" style={{ fontSize: 12 }}>懒得想? 选一个:</Text>
            {SUGGEST_NAMES.map(n => (
              <Button key={n} size="small" onClick={() => setName(n)}>{n}</Button>
            ))}
          </Space>
          <div style={{ marginTop: 24, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
            <Button onClick={() => setStep('welcome')}>上一步</Button>
            <Button type="primary" disabled={!name.trim()} onClick={() => setStep('useCase')}>
              下一步
            </Button>
          </div>
        </div>
      )}

      {step === 'useCase' && (
        <div style={{ padding: 32 }}>
          <Title level={3}>你主要想用 <Tag color="cyan">{name}</Tag> 来做什么?</Title>
          <Paragraph style={{ color: '#888' }}>我会根据你的选择准备推荐 (可随时在设置改)</Paragraph>
          <Radio.Group value={useCase} onChange={(e) => setUseCase(e.target.value)} style={{ width: '100%' }}>
            <Space direction="vertical" style={{ width: '100%' }} size={12}>
              {USE_CASES.map(uc => (
                <Card
                  key={uc.key}
                  hoverable
                  size="small"
                  onClick={() => setUseCase(uc.key)}
                  style={{
                    border: useCase === uc.key ? '2px solid #4F46E5' : '1px solid #333',
                    background: useCase === uc.key ? '#1a1a3a' : '#141414',
                  }}
                >
                  <Radio value={uc.key} style={{ display: 'none' }} />
                  <Space>
                    <span style={{ fontSize: 24 }}>{uc.icon}</span>
                    <div>
                      <div style={{ fontSize: 15, color: '#fff' }}>{uc.label}</div>
                      <div style={{ fontSize: 12, color: '#888' }}>{uc.desc}</div>
                    </div>
                  </Space>
                </Card>
              ))}
            </Space>
          </Radio.Group>
          <div style={{ marginTop: 24, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
            <Button onClick={() => setStep('name')}>上一步</Button>
            <Button type="primary" onClick={() => setStep('key')}>下一步</Button>
          </div>
        </div>
      )}

      {step === 'key' && (
        <div style={{ padding: 32 }}>
          <Title level={3}>🔑 配置 API 密钥 (可选)</Title>
          <Paragraph style={{ color: '#888' }}>
            没有 key 也可以用, 只不过 AI 会用 stub 回答。
            推荐填一个 <a href="https://agnes-ai.com" target="_blank" style={{ color: '#4F46E5' }}>Agnes AI</a> 的免费 key (RPM 20 之内永久免费)。
          </Paragraph>
          <Input.Password
            size="large"
            placeholder="sk-... (留空跳过, 稍后在设置填)"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            prefix={<UserOutlined />}
          />
          <div style={{ marginTop: 8, color: '#666', fontSize: 11 }}>
            ✅ AES-256-GCM 加密存本机 <code>.env</code>, 不上传任何服务器
          </div>
          <div style={{ marginTop: 24, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
            <Button onClick={() => setStep('useCase')}>上一步</Button>
            <Space>
              <Button onClick={() => { setSkipKey(true); finish(); }}>跳过</Button>
              <Button type="primary" onClick={saveKey}>
                {apiKey.trim() ? '保存并完成' : '跳过并完成'}
              </Button>
            </Space>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div style={{ padding: 32, textAlign: 'center' }}>
          <Avatar size={80} style={{ background: 'linear-gradient(135deg, #10B981 0%, #4F46E5 100%)' }} icon={<SmileOutlined />} />
          <Title level={2} style={{ marginTop: 16, color: '#fff' }}>
            {name}, 准备好了!
          </Title>
          <Paragraph style={{ color: '#888' }}>
            {skipKey || !apiKey
              ? '你随时可以在 设置 → 密钥管理 加 key, 现在先用 stub 体验界面'
              : '密钥已配, 所有功能立即可用'}
          </Paragraph>
          <Tag color="green">正在加载主界面...</Tag>
        </div>
      )}
    </Modal>
  );
};
