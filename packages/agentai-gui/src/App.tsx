import React, { useState } from 'react';
import { Layout, ConfigProvider, theme, Button, Space, Avatar, Typography } from 'antd';
import { RobotOutlined, MessageOutlined, AppstoreOutlined, SettingOutlined, GithubOutlined } from '@ant-design/icons';
import { Chat } from './components/Chat';
import { FrameworkSwitch } from './components/FrameworkSwitch';
import { SkillLibrary } from './components/SkillLibrary';

const { Sider, Content, Header } = Layout;
const { Title, Text } = Typography;

type View = 'chat' | 'skills' | 'settings';

export const App: React.FC = () => {
  const [view, setView] = useState<View>('chat');

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#4F46E5',
          colorInfo: '#4F46E5',
          colorSuccess: '#10B981',
          borderRadius: 8,
        },
      }}
    >
      <Layout style={{ height: '100vh' }}>
        <Header style={{ display: 'flex', alignItems: 'center', padding: '0 16px', background: '#0a0a0a', borderBottom: '1px solid #1f1f1f' }}>
          <Space>
            <Avatar size={32} style={{ background: 'linear-gradient(135deg, #4F46E5 0%, #9333EA 100%)' }} icon={<RobotOutlined />} />
            <Title level={4} style={{ margin: 0, color: '#fff' }}>AgentAI Platform</Title>
            <Text type="secondary" style={{ fontSize: 12 }}>v0.1.0-alpha</Text>
          </Space>
          <div style={{ flex: 1 }} />
          <Space>
            <Button type="text" icon={<GithubOutlined />} href="https://github.com/" target="_blank" />
          </Space>
        </Header>

        <Layout>
          {/* 左侧主导航 */}
          <Sider width={56} style={{ background: '#0a0a0a', borderRight: '1px solid #1f1f1f' }}>
            <Space direction="vertical" style={{ width: '100%', padding: '8px 0' }} size={4}>
              <Button type={view === 'chat' ? 'primary' : 'text'} icon={<MessageOutlined />} block style={{ height: 40 }} onClick={() => setView('chat')} />
              <Button type={view === 'skills' ? 'primary' : 'text'} icon={<AppstoreOutlined />} block style={{ height: 40 }} onClick={() => setView('skills')} />
              <Button type={view === 'settings' ? 'primary' : 'text'} icon={<SettingOutlined />} block style={{ height: 40 }} onClick={() => setView('settings')} />
            </Space>
          </Sider>

          {/* 框架切换侧栏 */}
          <Sider width={260} style={{ background: '#141414', borderRight: '1px solid #1f1f1f' }}>
            <FrameworkSwitch />
            <div style={{ padding: 16, color: '#888', fontSize: 12 }}>
              <p style={{ margin: 0 }}>💡 学自 OpenClaw + Hermes + Reasonix 3 框架, 自创 4 大新概念</p>
            </div>
          </Sider>

          {/* 主内容区 */}
          <Content style={{ background: '#0f0f0f' }}>
            {view === 'chat' && <Chat />}
            {view === 'skills' && <SkillLibrary />}
            {view === 'settings' && (
              <div style={{ padding: 24, color: '#fff' }}>
                <Title level={3}>设置 (阶段 2 落地)</Title>
                <Text type="secondary">首启动 wizard + 密钥管理 + LLM 切换 即将上线 (Week 3)</Text>
              </div>
            )}
          </Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
};
