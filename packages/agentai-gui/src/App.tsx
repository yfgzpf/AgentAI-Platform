import React, { useState } from 'react';
import { Layout, ConfigProvider, theme, Button, Space, Avatar, Typography, Dropdown, Tag } from 'antd';
import {
  RobotOutlined, MessageOutlined, AppstoreOutlined, SettingOutlined,
  PictureOutlined, VideoCameraOutlined, GithubOutlined, EditOutlined,
  UserOutlined, LogoutOutlined,
} from '@ant-design/icons';
import { Chat } from './components/Chat';
import { FrameworkSwitch } from './components/FrameworkSwitch';
import { SkillLibrary } from './components/SkillLibrary';
import { Settings } from './components/Settings';
import { ImageGen } from './components/ImageGen';
import { VideoGen } from './components/VideoGen';
import { Editor } from './components/Editor';
import { Onboarding } from './components/Onboarding';
import { useProfileStore } from './store';

const { Sider, Content, Header } = Layout;
const { Title, Text } = Typography;

type View = 'chat' | 'image' | 'video' | 'skills' | 'editor' | 'settings';

export const App: React.FC = () => {
  const [view, setView] = useState<View>('chat');
  const { profile, clearProfile, setProfile } = useProfileStore();

  const navItems: { key: View; icon: React.ReactNode; label: string }[] = [
    { key: 'chat', icon: <MessageOutlined />, label: '对话' },
    { key: 'image', icon: <PictureOutlined />, label: '生图' },
    { key: 'video', icon: <VideoCameraOutlined />, label: '生视频' },
    { key: 'editor', icon: <EditOutlined />, label: '代码编辑器' },
    { key: 'skills', icon: <AppstoreOutlined />, label: '技能库' },
    { key: 'settings', icon: <SettingOutlined />, label: '设置' },
  ];

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
            <Tag color="cyan">Hi, {profile?.name || '你'}</Tag>
            <Dropdown
              menu={{
                items: [
                  {
                    key: 'edit',
                    label: '✏️ 改名',
                    icon: <UserOutlined />,
                    onClick: () => {
                      const newName = window.prompt('新名字', profile?.name || '');
                      if (newName && newName.trim()) {
                        setProfile({
                          name: newName.trim(),
                          onboardedAt: profile?.onboardedAt || Date.now(),
                          language: 'zh',
                        });
                      }
                    },
                  },
                  {
                    key: 'reset',
                    label: '🔄 重新引导',
                    onClick: () => clearProfile(),
                  },
                  { type: 'divider' },
                  {
                    key: 'logout',
                    label: '退出登录',
                    icon: <LogoutOutlined />,
                    danger: true,
                    onClick: () => clearProfile(),
                  },
                ],
              }}
            >
              <Avatar
                size={32}
                style={{ background: '#10B981', cursor: 'pointer' }}
              >
                {profile?.name?.charAt(0).toUpperCase() || <UserOutlined />}
              </Avatar>
            </Dropdown>
            <Button type="text" icon={<GithubOutlined />} href="https://github.com/" target="_blank" />
          </Space>
        </Header>

        <Layout>
          {/* 左侧主导航 */}
          <Sider width={56} style={{ background: '#0a0a0a', borderRight: '1px solid #1f1f1f' }}>
            <Space direction="vertical" style={{ width: '100%', padding: '8px 0' }} size={4}>
              {navItems.map(item => (
                <Button
                  key={item.key}
                  type={view === item.key ? 'primary' : 'text'}
                  icon={item.icon}
                  block
                  style={{ height: 40 }}
                  onClick={() => setView(item.key)}
                  title={item.label}
                />
              ))}
            </Space>
          </Sider>

          {/* 框架切换侧栏 */}
          {view === 'chat' && (
            <Sider width={260} style={{ background: '#141414', borderRight: '1px solid #1f1f1f' }}>
              <FrameworkSwitch />
              <div style={{ padding: 16, color: '#888', fontSize: 12 }}>
                <p style={{ margin: 0 }}>💡 学自 OpenClaw + Hermes + Reasonix 3 框架, 自创 4 大新概念</p>
                <p style={{ margin: '8px 0 0' }}>🎯 主模型: Agnes AI (备: DeepSeek / OpenAI)</p>
              </div>
            </Sider>
          )}

          {/* 主内容区 */}
          <Content style={{ background: '#0f0f0f', overflowY: 'auto' }}>
            {view === 'chat' && <Chat />}
            {view === 'image' && <ImageGen />}
            {view === 'video' && <VideoGen />}
            {view === 'editor' && <Editor />}
            {view === 'skills' && <SkillLibrary />}
            {view === 'settings' && <Settings />}
          </Content>
        </Layout>
      </Layout>

      {/* 首次启动引导: 没 profile 就弹 */}
      <Onboarding open={!profile} />
    </ConfigProvider>
  );
};
