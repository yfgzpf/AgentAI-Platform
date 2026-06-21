/**
 * x-agent — 主应用
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
import { ConfigProvider, App as AntApp, theme, Tooltip, Dropdown, Tag, Modal, Button } from 'antd';
import {
  MessageOutlined, EditOutlined, PictureOutlined, VideoCameraOutlined,
  CodeOutlined, AppstoreOutlined, RobotOutlined, MessageOutlined as QQIcon,
  SettingOutlined, BgColorsOutlined, UserOutlined, ThunderboltOutlined,
  ExperimentOutlined, PartitionOutlined, SmileOutlined, GithubOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined, InfoCircleOutlined, BulbOutlined,
  LeftOutlined, RightOutlined, SunOutlined, MoonOutlined,
} from '@ant-design/icons';
import { ChatView } from './components/ChatView';
import { WritePage } from './components/WritePage';
import { ImageGen } from './components/ImageGen';
import { VideoGen } from './components/VideoGen';
import { Model3DGen } from './components/Model3DGen';
import { Editor } from './components/Editor';
import { Settings } from './components/Settings';
import { QQBotPanel } from './components/QQBotPanel';
import { CleanerPanel } from './components/CleanerPanel';
import { SkillLibrary } from './components/SkillLibrary';
import { WechatSetup } from './components/WechatSetup';
import { RightPanel } from './components/RightPanel';
import { SessionSidebar } from './components/SessionSidebar';
import { GuideModal } from './components/GuideModal';
import { StatusBar } from './components/StatusBar';
import { Onboarding } from './components/Onboarding';
import { useProfileStore, UserProfile } from './store';
import { useModeStore, MODE_CONFIG, MODE_ORDER } from './store/modeStore';
import { useFontSizeStore, FONT_SIZE_MAP, type FontSize } from './store';
import { ModelSelector } from './components/ModelSelector';
import { gatewayFallback } from './services/GatewayFallback';

/* ════════════════ 9 个 PAGES (图标 + 标签 + 渲染) ════════════════ */
type PageKey = 'chat' | 'write' | 'image' | 'video' | '3d' | 'editor' | 'skills' | 'cleaner' | 'qq' | 'wechat' | 'settings';

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
  { key: 'chat',     label: '对话',     icon: <MessageOutlined />,    comp: ChatView,      group: 'core',   desc: '智能对话 · 多模型 · 工具调用' },
  { key: 'editor',   label: '编辑器',   icon: <CodeOutlined />,       comp: Editor,        group: 'core',   desc: '代码编辑 · 改写 · 文件管理' },
  { key: 'image',    label: '生图',     icon: <PictureOutlined />,    comp: ImageGen,      group: 'media',  desc: '文生图 · 多风格 · 多尺寸' },
  { key: 'video',    label: '生视频',   icon: <VideoCameraOutlined />,comp: VideoGen,      group: 'media',  desc: '文生视频 · 图生视频 · 首尾帧' },
  { key: '3d',       label: '3D建模',   icon: <AppstoreOutlined />,   comp: Model3DGen,    group: 'media',  desc: '文/图生3D · 混元 · 豆包' },
  { key: 'write',    label: '写作',     icon: <EditOutlined />,       comp: WritePage,     group: 'media',  desc: '长文写作 · 模板 · 一键导出' },
  { key: 'skills',   label: '技能库',   icon: <AppstoreOutlined />,   comp: SkillLibrary,  group: 'system', desc: '25+ 技能 · 7 分类' },
  { key: 'cleaner',  label: '智能清理', icon: <ThunderboltOutlined />,comp: CleanerPanel,  group: 'system', desc: '扫描 / 分类 / 安全清理' },
  { key: 'qq',       label: 'QQ Bot',   icon: <QQIcon />,             comp: QQBotPanel,    group: 'system', desc: '反向 WS · 自动回复' },
  { key: 'wechat',   label: '微信',     icon: <SmileOutlined />,      comp: WechatSetup,   group: 'system', desc: 'ClawBot 插件 · 扫码绑定' },
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

/** 从 localStorage 直接读取缓存的用户身份 (绕过 zustand persist 异步 hydration) */
function getLocalProfile(): UserProfile | null {
  try {
    const raw = localStorage.getItem('agentai-user-profile');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // zustand persist v4 格式: { state: { profile: ... } }
    return parsed?.state?.profile || parsed?.profile || null;
  } catch { return null; }
}

export const App: React.FC = () => {
  const [page, setPage] = useState<PageKey>('chat');
  const { profile, setProfile } = useProfileStore();
  const { mode, setMode } = useModeStore();
  const [themeStyle, setThemeStyle] = useState<ThemeStyle>('graphite');
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [rightPanelVisible, setRightPanelVisible] = useState(true);
  const [guideVisible, setGuideVisible] = useState(false);
  const { fontSize, setFontSize } = useFontSizeStore();

  /* --- 主题 + 字体大小应用 --- */
  useEffect(() => {
    const root = document.documentElement;
    const dark = THEME_OPTIONS.find(t => t.value === themeStyle)?.value === 'graphite' || themeStyle === 'midnight' || themeStyle === 'ember';
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    root.setAttribute('data-theme-style', themeStyle);

    // 字体大小
    const fontCfg = FONT_SIZE_MAP[fontSize] || FONT_SIZE_MAP.medium;
    root.style.setProperty('--font-scale', String(fontCfg.scale));
    root.style.setProperty('--font-base', fontCfg.cssBase);
    root.style.fontSize = fontCfg.cssBase;
  }, [themeStyle, fontSize]);

  /* --- 启动网关健康检测 + 同步工作目录 --- */
  useEffect(() => {
    gatewayFallback.start();

    // 从网关同步工作目录
    (async () => {
      try {
        const base = gatewayFallback.url;
        const resp = await fetch(base + '/v1/health');
        if (resp.ok) {
          const data = await resp.json();
          if (data.cwd) {
            const existing = localStorage.getItem('agentai.workspace');
            // 只在以下情况覆盖: localStorage 为空, 或路径不存在
            if (!existing || existing === 'C:\\') {
              localStorage.setItem('agentai.workspace', data.cwd);
              console.log('[workspace] synced from gateway:', data.cwd);
            }
          }
        }
      } catch {}
    })();

    return () => gatewayFallback.stop();
  }, []);

  /* --- 监听侧栏跨组件导航事件 (技能/设置) --- */
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ page?: PageKey }>;
      const target = ce.detail?.page;
      if (target && PAGES.some(p => p.key === target)) {
        setPage(target);
      }
    };
    window.addEventListener('agentai:navigate', handler);
    return () => window.removeEventListener('agentai:navigate', handler);
  }, []);

  /* --- 启动时决定是否弹 Onboarding ---
   * 策略:
   *   1. 检查 localStorage 是否已有用户身份 (zustand persist key: agentai-user-profile)
   *   2. 有 → 弹窗询问是否沿用原有身份
   *   3. 无 → 直接进入 Onboarding 欢迎设置
   *   4. sessionStorage 缓存本次会话决定, 不重复弹
   *
   * 注意: zustand/persist 的 hydration 是异步的, 初始渲染时 profile 为 null,
   * 所以必须直接用 localStorage 检测, 不能依赖 useProfileStore() 的初始值。
   */
  const [showOnboarding, setShowOnboarding] = useState(() => {
    if (sessionStorage.getItem('agentai.onboarded')) return false;
    const stored = getLocalProfile();
    return !stored?.name || !stored?.industry;
  });
  const [showReusePrompt, setShowReusePrompt] = useState(() => {
    if (sessionStorage.getItem('agentai.onboarded')) return false;
    const stored = getLocalProfile();
    return !!stored?.name && !!stored?.industry;
  });

  /* --- 启动时从 localStorage 主动 hydrate zustand profile ---
   * zustand/persist 的 hydration 是异步的, 组件首次渲染时 profile 为 null。
   * 即使 zustand 后续会自行 rehydrate, 这里提前写入确保所有子组件
   * 在首次渲染时就能读到正确的 profile, 避免"游客"显示和异常跳转。
   */
  useEffect(() => {
    const stored = getLocalProfile();
    if (stored?.name && stored?.industry && !profile) {
      setProfile(stored);
    }
  }, []); // 仅首次执行

  const handleOnboardFinish = useCallback((name: string) => {
    setProfile({
      name: name.trim(),
      onboardedAt: Date.now(),
      language: 'zh',
    });
    sessionStorage.setItem('agentai.onboarded', '1');
    setShowOnboarding(false);
  }, [setProfile]);

  const handleReuseIdentity = useCallback(() => {
    sessionStorage.setItem('agentai.onboarded', '1');
    setShowReusePrompt(false);
  }, []);

  const handleResetIdentity = useCallback(() => {
    setShowReusePrompt(false);
    setShowOnboarding(true);
  }, []);

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
      <AntApp>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg)' }}>
        {/* ═══ 1. TitleBar ═══ */}
        <div className="app-titlebar">
          {/* 品牌 */}
          <div className="app-brand">
            <img src="/logo-xagent.svg" alt="x-agent"
              style={{ width: 28, height: 28, borderRadius: 6, marginRight: 8 }} />
            <div className="app-brand-text">
              <span className="app-brand-name">x-agent</span>
              <span className="app-brand-tag">v0.4.0 · alpha</span>
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

          {/* 模型选择 (TitleBar) */}
          <div style={{ marginRight: 8 }}>
            <ModelSelector mode="minimal" />
          </div>

          {/* 显示设置 (主题 + 字体) */}
          <Tooltip title="主题 & 字体大小">
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  {
                    key: 'theme-group',
                    type: 'group',
                    label: <span style={{ fontSize: 11, color: 'var(--muted-2)' }}>主题</span>,
                    children: THEME_OPTIONS.map(t => ({
                      key: `theme-${t.value}`,
                      label: (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
                          <span style={{ width: 16, height: 16, borderRadius: 4, background: t.swatch, border: '1px solid var(--border)' }} />
                          <span style={{ fontSize: 12 }}>{t.label}</span>
                          {themeStyle === t.value && <span style={{ marginLeft: 'auto', color: 'var(--accent)' }}>✓</span>}
                        </div>
                      ),
                      onClick: () => setThemeStyle(t.value),
                    })),
                  },
                  { type: 'divider' },
                  {
                    key: 'font-group',
                    type: 'group',
                    label: <span style={{ fontSize: 11, color: 'var(--muted-2)' }}>字体大小</span>,
                    children: (['small', 'medium', 'large', 'xlarge'] as FontSize[]).map(f => ({
                      key: `font-${f}`,
                      label: (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
                          <span style={{
                            fontSize: f === 'small' ? 11 : f === 'medium' ? 13 : f === 'large' ? 15 : 17,
                            color: 'var(--fg-2)',
                          }}>Aa</span>
                          <span style={{ fontSize: 12 }}>{FONT_SIZE_MAP[f].label}</span>
                          {fontSize === f && <span style={{ marginLeft: 'auto', color: 'var(--accent)' }}>✓</span>}
                        </div>
                      ),
                      onClick: () => setFontSize(f),
                    })),
                  },
                ],
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
                {isDark ? <SunOutlined style={{ fontSize: 15 }} /> : <MoonOutlined style={{ fontSize: 15 }} />}
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
                  {sidebarVisible ? <LeftOutlined style={{ fontSize: 13 }} /> : <RightOutlined style={{ fontSize: 13 }} />}
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
                  {rightPanelVisible ? <RightOutlined style={{ fontSize: 13 }} /> : <LeftOutlined style={{ fontSize: 13 }} />}
                </span>
              </Tooltip>
            </>
          )}

          {/* GitHub 仓库 */}
          <Tooltip title="GitHub 仓库">
            <a href="https://github.com/yfgzpf/AgentAI-Platform" target="_blank" rel="noopener noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 30, height: 30, borderRadius: 6, cursor: 'pointer',
                color: 'var(--muted-2)', transition: 'all 0.15s ease', marginLeft: 4,
                textDecoration: 'none',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--accent)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--muted-2)'; }}
            >
              <GithubOutlined style={{ fontSize: 16 }} />
            </a>
          </Tooltip>

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
              <SessionSidebar onGuideClick={() => setGuideVisible(true)} />
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

      {/* ═══ 5. 使用指南 Modal ═══ */}
      {guideVisible && <GuideModal onClose={() => setGuideVisible(false)} />}

      {/* ═══ 6. 沿用身份确认弹窗 ═══ */}
      {showReusePrompt && <ReuseIdentityPrompt
        profile={profile}
        onReuse={handleReuseIdentity}
        onReset={handleResetIdentity}
      />}

      {/* ═══ 7. Onboarding Modal (首次启动) ═══ */}
      {showOnboarding && <OnboardingWrapper onFinish={handleOnboardFinish} />}

      </AntApp>
    </ConfigProvider>
  );
};

/* ════════════════ Onboarding 包装 ════════════════
 * 把原 Onboarding 组件的 finish() 拆成 onFinish prop, 避免内部 reload
 */
const OnboardingWrapper: React.FC<{ onFinish: (name: string) => void }> = ({ onFinish }) => {
  const [open, setOpen] = useState(true);
  return (
    <Onboarding open={open} onClose={() => { /* 不可跳过 */ }} onFinish={(name) => { onFinish(name); setOpen(false); }} />
  );
};

/* ════════════════ 沿用身份确认 ════════════════
 * 检测到已有用户身份时，询问是否沿用
 */
const ReuseIdentityPrompt: React.FC<{
  profile: any;
  onReuse: () => void;
  onReset: () => void;
}> = ({ profile: propProfile, onReuse, onReset }) => {
  // 使用 localStorage 数据作为 fallback (zustand profile 可能未 hydration)
  const displayProfile = (propProfile?.name && propProfile?.industry) ? propProfile : getLocalProfile();
  const industryLabel = displayProfile?.industry || '通用';
  const name = displayProfile?.name || '用户';
  return (
    <Modal
      open={true}
      closable={false}
      maskClosable={false}
      footer={null}
      centered
      width={420}
      styles={{ body: { padding: 0 } }}
    >
      <div style={{ padding: 32, textAlign: 'center' }}>
        <div style={{
          width: 56, height: 56, borderRadius: 14, margin: '0 auto',
          background: 'var(--card)', border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <UserOutlined style={{ fontSize: 24, color: 'var(--accent)' }} />
        </div>
        <div style={{ marginTop: 16, fontSize: 16, fontWeight: 600, color: 'var(--fg)' }}>
          欢迎回来, {name}
        </div>
        <div style={{ marginTop: 8, fontSize: 13, color: 'var(--muted-2)', lineHeight: 1.6 }}>
          检测到你的身份信息:<br />
          <span style={{ color: 'var(--fg)' }}>{name}</span> · <span style={{ color: 'var(--accent)' }}>{industryLabel}</span>
        </div>
        <div style={{ marginTop: 24, display: 'flex', gap: 10, justifyContent: 'center' }}>
          <Button
            size="large"
            onClick={onReset}
            style={{ borderRadius: 8, minWidth: 120 }}
          >
            重新设置
          </Button>
          <Button
            type="primary"
            size="large"
            onClick={onReuse}
            style={{ borderRadius: 8, minWidth: 120, background: 'var(--accent)', borderColor: 'var(--accent)' }}
          >
            沿用原有身份
          </Button>
        </div>
      </div>
    </Modal>
  );
};
