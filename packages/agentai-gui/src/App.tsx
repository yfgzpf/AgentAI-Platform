/**
 * AgentAI Platform — 主应用
 * UI 架构: 4 层沉浸式
 *   1. TitleBar       品牌 / 全局模式切换 / 主题切换 / 用户名
 *   2. Sidebar (56px) 9 个主功能图标导航
 *   3. Main           三栏: SessionSidebar(可选) + Center + RightPanel(可选)
 *   4. StatusBar      Gateway 状态 / 工具数 / 模式 / Token 用量
 *
 * 接入: Onboarding (首次启动) + StatusBar (底部)
 * 主题: 5 套 (dark/light/porcelain/midnight/ember)
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ConfigProvider, theme, Tooltip, Dropdown, Tag } from 'antd';
import {
  MessageOutlined, EditOutlined, PictureOutlined, VideoCameraOutlined,
  CodeOutlined, AppstoreOutlined, RobotOutlined, MessageOutlined as QQIcon,
  SettingOutlined, BgColorsOutlined, UserOutlined, ThunderboltOutlined,
  ExperimentOutlined, PartitionOutlined, SmileOutlined,
} from '@ant-design/icons';
import { ChatView } from './components/ChatView';
import { WritePage } from './components/WritePage';
import { ImageGen } from './components/ImageGen';
import { VideoGen } from './components/VideoGen';
import { Editor } from './components/Editor';
import { Settings } from './components/Settings';
import { QQBotPanel } from './components/QQBotPanel';
import { CleanerPanel } from './components/CleanerPanel';
import { SkillLibrary } from './components/SkillLibrary';
import { RightPanel } from './components/RightPanel';
import { SessionSidebar } from './components/SessionSidebar';
import { StatusBar } from './components/StatusBar';
import { Onboarding } from './components/Onboarding';
import { useProfileStore } from './store';
import { useModeStore } from './store/modeStore';

/* ════════════════ 9 个 PAGES (图标 + 标签 + 渲染) ════════════════ */
type PageKey = 'chat' | 'write' | 'image' | 'video' | 'editor' | 'skills' | 'cleaner' | 'qq' | 'settings';

interface PageMeta {
  key: PageKey;
  label: string;
  icon: React.ReactNode;
  comp: React.FC;
  /** 在 Sidebar 出现时排序分组 */
  group: 'core' | 'media' | 'system';
  /** 描述, 悬浮 tooltip 用 */
  desc: string;
  /** 右上角小徽章 (可选) */
  badge?: string;
}

const PAGES: PageMeta[] = [
  { key: 'chat',     label: '对话',     icon: <MessageOutlined />,    comp: ChatView,      group: 'core',   desc: 'AI 智能对话 · 多模型 · 工具调用' },
  { key: 'editor',   label: '编辑器',   icon: <CodeOutlined />,       comp: Editor,        group: 'core',   desc: 'VSCode 风格代码编辑 · AI 改写' },
  { key: 'image',    label: '生图',     icon: <PictureOutlined />,    comp: ImageGen,      group: 'media',  desc: '文生图 · Agnes 2.1 Flash',  badge: 'AI' },
  { key: 'video',    label: '生视频',   icon: <VideoCameraOutlined />,comp: VideoGen,      group: 'media',  desc: '文生视频 · 5s 短视频' },
  { key: 'write',    label: '写作',     icon: <EditOutlined />,       comp: WritePage,     group: 'media',  desc: '长文写作 · 模板 · 一键导出' },
  { key: 'skills',   label: '技能库',   icon: <AppstoreOutlined />,   comp: SkillLibrary,  group: 'system', desc: '25+ 技能 · 7 分类' },
  { key: 'cleaner',  label: '智能清理', icon: <ThunderboltOutlined />,comp: CleanerPanel,  group: 'system', desc: '扫描 / 分类 / 安全清理' },
  { key: 'qq',       label: 'QQ Bot',   icon: <QQIcon />,             comp: QQBotPanel,    group: 'system', desc: '反向 WS · 自动回复' },
  { key: 'settings', label: '设置',     icon: <SettingOutlined />,    comp: Settings,      group: 'system', desc: '密钥 · 框架 · 模型 · 主题' },
];

/* ════════════════ 主题 (5 套) ════════════════ */
type ThemeStyle = 'graphite' | 'sandstone' | 'porcelain' | 'midnight' | 'ember';
type ThemeMode = 'dark' | 'light';

const THEME_OPTIONS: { value: ThemeStyle; label: string; swatch: string }[] = [
  { value: 'graphite',  label: '石墨 (默认)', swatch: 'linear-gradient(135deg, #1a1a22 0%, #2a1f1a 100%)' },
  { value: 'midnight',  label: '午夜紫',     swatch: 'linear-gradient(135deg, #16162a 0%, #2a1a4a 100%)' },
  { value: 'ember',     label: '余烬橙',     swatch: 'linear-gradient(135deg, #1f1815 0%, #4a2a18 100%)' },
  { value: 'sandstone', label: '砂岩 (亮)',  swatch: 'linear-gradient(135deg, #f5f1ea 0%, #e8d8b8 100%)' },
  { value: 'porcelain', label: '瓷白 (亮)',  swatch: 'linear-gradient(135deg, #fafafa 0%, #e0e0e8 100%)' },
];

/* ════════════════ App 主组件 ════════════════ */
export const App: React.FC = () => {
  const [page, setPage] = useState<PageKey>('chat');
  const { profile, setProfile } = useProfileStore();
  const { mode, setMode } = useModeStore();
  const [themeStyle, setThemeStyle] = useState<ThemeStyle>('graphite');
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [rightPanelVisible, setRightPanelVisible] = useState(true);

  /* --- 主题应用 --- */
  useEffect(() => {
    const root = document.documentElement;
    const dark = THEME_OPTIONS.find(t => t.value === themeStyle)?.value === 'graphite' || themeStyle === 'midnight' || themeStyle === 'ember';
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    root.setAttribute('data-theme-style', themeStyle);
  }, [themeStyle]);

  /* --- 启动时决定是否弹 Onboarding --- */
  const showOnboarding = !profile?.onboardedAt;

  const handleOnboardFinish = useCallback((name: string) => {
    setProfile({
      name: name.trim(),
      onboardedAt: Date.now(),
      language: 'zh',
    });
    setTimeout(() => window.location.reload(), 600);
  }, [setProfile]);

  /* --- 当前页 meta --- */
  const currentPage = useMemo(() => PAGES.find(p => p.key === page) || PAGES[0], [page]);

  /* --- Sidebar 仅在 chat 显示会话侧栏 --- */
  const showSessionSidebar = page === 'chat' && sidebarVisible;
  const showRightPanel = page === 'chat' && rightPanelVisible;

  /* --- 配置 antd 主题 (跟随 light/dark) --- */
  const isDark = ['graphite', 'midnight', 'ember'].includes(themeStyle);
  const accentColor = themeStyle === 'midnight' ? '#8b6bff' : themeStyle === 'ember' ? '#ff6b3d' : '#CD7A3A';

  /* ════════════════ 渲染 ════════════════ */
  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: { colorPrimary: accentColor, borderRadius: 8 },
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg)' }}>
        {/* ═══ 1. TitleBar ═══ */}
        <div className="app-titlebar">
          {/* 品牌 */}
          <div className="app-brand">
            <span className="app-brand-mark">◆</span>
            <div className="app-brand-text">
              <span className="app-brand-name">AgentAI</span>
              <span className="app-brand-tag">v0.1.0 · alpha</span>
            </div>
          </div>

          {/* 主导航 Tab (水平) */}
          <div style={{ display: 'flex', gap: 2, flex: 1, marginLeft: 16, overflow: 'auto' }}>
            {PAGES.map(p => (
              <span
                key={p.key}
                onClick={() => setPage(p.key)}
                className={`app-tab ${page === p.key ? 'active' : ''}`}
                data-testid={`nav-${p.key}`}
              >
                {p.icon}
                <span>{p.label}</span>
                {p.badge && <Tag color="orange" style={{ marginLeft: 4, fontSize: 9, padding: '0 4px', lineHeight: '14px' }}>{p.badge}</Tag>}
              </span>
            ))}
          </div>

          {/* 模式切换 */}
          <Tooltip title="运行模式 (影响工具调用)">
            <div style={{ display: 'flex', gap: 2, background: 'var(--panel)', borderRadius: 6, padding: 2, marginRight: 8 }}>
              {(['auto', 'planning', 'readonly'] as const).map(m => (
                <span key={m} onClick={() => setMode(m)}
                  style={{
                    padding: '3px 10px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
                    background: mode === m ? 'var(--accent)' : 'transparent',
                    color: mode === m ? '#fff' : 'var(--muted)', fontWeight: mode === m ? 600 : 400,
                    transition: 'all 0.15s ease',
                  }}>
                  {m === 'auto' ? '自动' : m === 'planning' ? '规划' : '只读'}
                </span>
              ))}
            </div>
          </Tooltip>

          {/* 主题切换 */}
          <Tooltip title="切换主题 (5 套)">
            <Dropdown
              trigger={['click']}
              menu={{
                items: THEME_OPTIONS.map(t => ({
                  key: t.value,
                  label: (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
                      <span style={{ width: 16, height: 16, borderRadius: 4, background: t.swatch, border: '1px solid var(--border)' }} />
                      <span style={{ fontSize: 12 }}>{t.label}</span>
                    </div>
                  ),
                  onClick: () => setThemeStyle(t.value),
                })),
              }}
            >
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 30, height: 30, borderRadius: 6, cursor: 'pointer',
                color: 'var(--muted-2)', transition: 'all 0.15s ease',
              }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--card-hover)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                <BgColorsOutlined style={{ fontSize: 16 }} />
              </span>
            </Dropdown>
          </Tooltip>

          {/* 侧栏开关 (chat 页专用) */}
          {page === 'chat' && (
            <>
              <Tooltip title="左侧会话栏">
                <span onClick={() => setSidebarVisible(v => !v)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 30, height: 30, borderRadius: 6, cursor: 'pointer',
                    color: sidebarVisible ? 'var(--accent)' : 'var(--muted-2)',
                    background: sidebarVisible ? 'var(--accent-soft)' : 'transparent',
                    transition: 'all 0.15s ease', marginLeft: 4,
                  }}>
                  <PartitionOutlined style={{ fontSize: 16 }} />
                </span>
              </Tooltip>
              <Tooltip title="右侧信息栏">
                <span onClick={() => setRightPanelVisible(v => !v)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 30, height: 30, borderRadius: 6, cursor: 'pointer',
                    color: rightPanelVisible ? 'var(--accent)' : 'var(--muted-2)',
                    background: rightPanelVisible ? 'var(--accent-soft)' : 'transparent',
                    transition: 'all 0.15s ease',
                  }}>
                  <ExperimentOutlined style={{ fontSize: 16 }} />
                </span>
              </Tooltip>
            </>
          )}

          {/* 用户名 */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px',
            background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, marginLeft: 4,
          }}>
            <UserOutlined style={{ fontSize: 12, color: 'var(--muted)' }} />
            <span style={{ fontSize: 12, color: 'var(--fg-2)', fontWeight: 500 }}>
              {profile?.name || '游客'}
            </span>
          </div>
        </div>

        {/* ═══ 2. 面包屑 (当前页 + 描述) ═══ */}
        <div className="app-breadcrumb">
          <span className="app-breadcrumb-sep">●</span>
          <span className="app-breadcrumb-current">{currentPage.label}</span>
          <span style={{ color: 'var(--muted-2)' }}>·</span>
          <span style={{ color: 'var(--muted)' }}>{currentPage.desc}</span>
        </div>

        {/* ═══ 3. 主区: 三栏 ═══ */}
        <div className="app-main fade-in" key={page /* 切页时重启动画 */}>
          {/* Left: 会话侧栏 (仅 chat) */}
          {showSessionSidebar && (
            <div style={{ width: 244, borderRight: '1px solid var(--border)', background: 'var(--panel)', overflow: 'auto', flexShrink: 0 }}>
              <SessionSidebar />
            </div>
          )}

          {/* Center: 当前页 */}
          <div className="app-content">
            <currentPage.comp />
          </div>

          {/* Right: 信息面板 (仅 chat) */}
          {showRightPanel && (
            <div style={{ width: 320, borderLeft: '1px solid var(--border)', background: 'var(--panel)', overflow: 'auto', flexShrink: 0 }}>
              <RightPanel />
            </div>
          )}
        </div>

        {/* ═══ 4. StatusBar ═══ */}
        <div className="app-statusbar">
          <StatusBar />
        </div>
      </div>

      {/* ═══ 5. Onboarding Modal (首次启动) ═══ */}
      {showOnboarding && <OnboardingWrapper onFinish={handleOnboardFinish} />}
    </ConfigProvider>
  );
};

/* ════════════════ Onboarding 包装 ════════════════
 * 把原 Onboarding 组件的 finish() 拆成 onFinish prop, 避免内部 reload
 */
const OnboardingWrapper: React.FC<{ onFinish: (name: string) => void }> = ({ onFinish }) => {
  const [open, setOpen] = useState(true);
  return (
    <Onboarding open={open} onClose={() => setOpen(false)} onFinish={(name) => { onFinish(name); setOpen(false); }} />
  );
};
