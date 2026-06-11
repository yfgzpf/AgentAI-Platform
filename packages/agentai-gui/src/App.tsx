/**
 * App.tsx — AgentAI Platform 主布局
 * =========================================================================
 * 布局: [SessionSidebar | Chat (旧版完整功能) | RightPanel]
 * 功能: 时间线 (Reasonix) + 三模式 (只读/规划/自动) + FrameworkSwitch
 * =========================================================================
 */
import React, { useState } from 'react';
import { Layout, ConfigProvider, Button, Space, Avatar, Typography, Dropdown, Tag, theme } from 'antd';
import {
  RobotOutlined, MessageOutlined, AppstoreOutlined, SettingOutlined,
  PictureOutlined, VideoCameraOutlined, GithubOutlined, EditOutlined,
  UserOutlined, LogoutOutlined, BulbOutlined, SafetyOutlined,
} from '@ant-design/icons';
import { ChatView } from './components/ChatView';
import { FrameworkSwitch } from './components/FrameworkSwitch';
import { SkillLibrary } from './components/SkillLibrary';
import { Settings } from './components/Settings';
import { ImageGen } from './components/ImageGen';
import { VideoGen } from './components/VideoGen';
import { Editor } from './components/Editor';
import { Onboarding } from './components/Onboarding';
import { RightPanel } from './components/RightPanel';
import { SessionSidebar } from './components/SessionSidebar';
import { QQBotPanel } from './components/QQBotPanel';
import { CleanerPanel } from './components/CleanerPanel';
import { useProfileStore } from './store';

const { Sider, Content, Header } = Layout;
const { Title, Text } = Typography;

type View = 'chat' | 'image' | 'video' | 'skills' | 'editor' | 'settings' | 'qq' | 'cleaner';

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
    { key: 'qq', icon: <RobotOutlined />, label: 'QQ Bot' },
    { key: 'cleaner', icon: <SafetyOutlined />, label: '智能清理' },
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
        <Header style={{
          display: 'flex', alignItems: 'center', padding: '0 16px',
          background: '#0a0a0a', borderBottom: '1px solid #1f1f1f',
          boxShadow: '0 1px 8px rgba(79,70,229,0.08)',
        }}>
          <Space>
            <Avatar size={32} style={{
              background: 'linear-gradient(135deg, #4F46E5 0%, #9333EA 100%)',
              boxShadow: '0 0 16px rgba(79,70,229,0.4)',
            }} icon={<RobotOutlined />} />
            <Title level={4} style={{ margin: 0, color: '#fff' }}>AgentAI Platform</Title>
            <Text type="secondary" style={{ fontSize: 12 }}>v0.2.0</Text>
          </Space>
          <div style={{ flex: 1 }} />
          <Space>
            <Tag color="cyan">Hi, {profile?.name || '你'}</Tag>
            <Dropdown
              menu={{
                items: [
                  {
                    key: 'edit',
                    label: '改名',
                    icon: <UserOutlined />,
                    onClick: () => {
                      const newName = window.prompt('新名字', profile?.name || '');
                      if (newName && newName.trim()) {
                        setProfile({ name: newName.trim(), onboardedAt: profile?.onboardedAt || Date.now(), language: 'zh' });
                      }
                    },
                  },
                  { key: 'reset', label: '重新引导', onClick: () => clearProfile() },
                  { type: 'divider' },
                  { key: 'logout', label: '退出登录', icon: <LogoutOutlined />, danger: true, onClick: () => clearProfile() },
                ],
              }}
            >
              <Avatar size={32} style={{ background: '#10B981', cursor: 'pointer', boxShadow: '0 0 8px rgba(16,185,129,0.3)' }}>
                {profile?.name?.charAt(0).toUpperCase() || <UserOutlined />}
              </Avatar>
            </Dropdown>
            <Button type="text" icon={<GithubOutlined />} href="https://github.com/" target="_blank" />
          </Space>
        </Header>

        <Layout>
          {/* 左侧: Framework 切换 + 快速信息 */}
          <Sider width={260} style={{ background: '#141414', borderRight: '1px solid #1f1f1f' }}>
            <FrameworkSwitch />
            <div style={{ padding: 16, color: '#888', fontSize: 12 }}>
              <p style={{ margin: 0 }}>学自 OpenClaw + Hermes + Reasonix 3 框架, 自创 4 大新概念</p>
              <p style={{ margin: '8px 0 0' }}>主模型: Agnes AI (多模态教学 + DeepSeek / OpenAI)</p>
            </div>
            {/* 时间线 / 会话列表 */}
            <SessionSidebar />
          </Sider>

          {/* 中间: 内容区 */}
          <Content style={{ background: '#0f0f0f', overflowY: 'auto', boxShadow: '0 0 60px rgba(79,70,229,0.04), 0 0 20px rgba(79,70,229,0.02)' }}>
            {view === 'chat' && <ChatView />}
            {view === 'image' && <ImageGen />}
            {view === 'video' && <VideoGen />}
            {view === 'editor' && <Editor />}
            {view === 'skills' && <SkillLibrary />}
            {view === 'settings' && <Settings />}
            {view === 'qq' && <QQBotPanel />}
            {view === 'cleaner' && <CleanerPanel />}
          </Content>

          {/* 右侧: 工作区 + 模型 + 状态 */}
          {view === 'chat' && (
            <Sider width={280} style={{ background: '#0f0f0f', borderLeft: '1px solid #1f1f1f' }}>
              <RightPanel />
            </Sider>
          )}
        </Layout>
      </Layout>

      <Onboarding open={!profile} />
    </ConfigProvider>
  );
};
