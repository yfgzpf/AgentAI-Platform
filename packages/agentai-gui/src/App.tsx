/**
 * PulseFlow Studio — 主应用
 * UI 架构: 4 层沉浸式
 *   1. TitleBar       品牌 / 全局模式切换 / 主题切换 / 用户名
 *   2. Sidebar (56px) 9 个主功能图标导航
 *   3. Main           三栏: SessionSidebar(可选) + Center + RightPanel(可选)
 *   4. StatusBar      Gateway 状态 / 工具数 / 模式 / Token 用量
 *
 * 接入: Onboarding (首次启动) + StatusBar (底部)
 * 主题: 5 套 (dark/light/porcelain/midnight/ember)
 */
import React, { useState, useEffect, useMemo, useCallback, Suspense, lazy } from 'react';
import { ConfigProvider, App as AntApp, theme, Tooltip, Dropdown, Tag, Modal, Button } from 'antd';
import {
  MessageOutlined, EditOutlined, PictureOutlined, VideoCameraOutlined,
  CodeOutlined, AppstoreOutlined, RobotOutlined, MessageOutlined as QQIcon,
  SettingOutlined, BgColorsOutlined, UserOutlined, ThunderboltOutlined,
  ExperimentOutlined, PartitionOutlined, SmileOutlined, GithubOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined, InfoCircleOutlined, BulbOutlined,
  LeftOutlined, RightOutlined, SunOutlined, MoonOutlined, BookOutlined,
  WechatOutlined, ClockCircleOutlined, BellOutlined, MedicineBoxOutlined,
  DownOutlined, CheckCircleFilled, FolderOpenOutlined, DashboardOutlined,
} from '@ant-design/icons';
/* P0-4: 代码分割 — 12 个页面组件延迟加载, 首屏只加载 chat */
const ChatView = lazy(() => import('./components/ChatView').then(m => ({ default: m.ChatView })));
const WritePage = lazy(() => import('./components/WritePage').then(m => ({ default: m.WritePage })));
const ImageGen = lazy(() => import('./components/ImageGen').then(m => ({ default: m.ImageGen })));
const VideoGen = lazy(() => import('./components/VideoGen').then(m => ({ default: m.VideoGen })));
const Model3DGen = lazy(() => import('./components/Model3DGen').then(m => ({ default: m.Model3DGen })));
const Editor = lazy(() => import('./components/Editor').then(m => ({ default: m.Editor })));
const Settings = lazy(() => import('./components/Settings').then(m => ({ default: m.Settings })));
const QQBotPanel = lazy(() => import('./components/QQBotPanel').then(m => ({ default: m.QQBotPanel })));
const CleanerPanel = lazy(() => import('./components/CleanerPanel').then(m => ({ default: m.CleanerPanel })));
const KnowledgeBasePanel = lazy(() => import('./components/KnowledgeBasePanel').then(m => ({ default: m.KnowledgeBasePanel })));
const SkillLibrary = lazy(() => import('./components/SkillLibrary').then(m => ({ default: m.SkillLibrary })));
const WechatSetup = lazy(() => import('./components/WechatSetup').then(m => ({ default: m.WechatSetup })));
const SchedulePanel = lazy(() => import('./components/SchedulePanel').then(m => ({ default: m.SchedulePanel })));
const NotificationPanel = lazy(() => import('./components/NotificationPanel').then(m => ({ default: m.NotificationPanel })));
const WorkflowPanel = lazy(() => import('./components/WorkflowPanel').then(m => ({ default: m.WorkflowPanel })));
const ProactiveSuggestionsPanel = lazy(() => import('./components/ProactiveSuggestionsPanel').then(m => ({ default: m.default })));
const XuanjiPanel = lazy(() => import('./components/XuanjiPanel').then(m => ({ default: m.XuanjiPanel })));
import { RightPanel } from './components/RightPanel';
import { SessionSidebar } from './components/SessionSidebar';
import { GuideModal } from './components/GuideModal';
import { StatusBar } from './components/StatusBar';
import { Onboarding } from './components/Onboarding';
import { SetupWizard } from './components/SetupWizard';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PageSkeleton } from './components/PageSkeleton';
import { useProfileStore, UserProfile } from './store';
import { useSessionStore } from './store/sessionStore';
import { useModeStore, MODE_CONFIG, MODE_ORDER } from './store/modeStore';
import { useFontSizeStore, FONT_SIZE_MAP, type FontSize } from './store';
import { ModelSelector } from './components/ModelSelector';
import { gatewayFallback } from './services/GatewayFallback';
import FloatingSuggestionToast from './components/FloatingSuggestionToast';
import { useSuggestionSSE } from './hooks/useSuggestionSSE';
import { useSuggestionStore } from './store/suggestionStore';
import { Splash } from './components/Splash';

/* ════════════════ PAGES (图标 + 标签 + 渲染) ════════════════ */
type PageKey = 'chat' | 'write' | 'image' | 'video' | '3d' | 'editor' | 'skills' | 'cleaner' | 'qq' | 'wechat' | 'knowledge' | 'settings' | 'schedule' | 'notification' | 'workflow' | 'suggestions' | 'governor' | 'xuanji';

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

const GovernorPanel = lazy(() => import('./components/GovernorPanel').then(m => ({ default: m.GovernorPanel })));

const PAGES: PageMeta[] = [
  { key: 'chat',     label: '对话',     icon: <MessageOutlined />,    comp: ChatView,      group: 'core',   desc: '智能对话 · 多模型 · 工具调用' },
  { key: 'editor',   label: '编辑器',   icon: <CodeOutlined />,       comp: Editor,        group: 'core',   desc: '代码编辑 · 改写 · 文件管理' },
  { key: 'xuanji',   label: '医案',     icon: <MedicineBoxOutlined />, comp: XuanjiPanel,   group: 'core',   desc: '四诊合参 · 辨证论治 · 经验积累', badge: 'NEW' },
  { key: 'image',    label: '生图',     icon: <PictureOutlined />,    comp: ImageGen,      group: 'media',  desc: '文生图 · 多风格 · 多尺寸' },
  { key: 'video',    label: '生视频',   icon: <VideoCameraOutlined />,comp: VideoGen,      group: 'media',  desc: '文生视频 · 图生视频 · 首尾帧' },
  { key: '3d',       label: '3D建模',   icon: <AppstoreOutlined />,   comp: Model3DGen,    group: 'media',  desc: '文/图生3D · 混元 · 豆包' },
  { key: 'write',    label: '写作',     icon: <EditOutlined />,       comp: WritePage,     group: 'media',  desc: '长文写作 · 模板 · 一键导出' },
  { key: 'skills',   label: '技能库',   icon: <AppstoreOutlined />,   comp: SkillLibrary,  group: 'system', desc: '25+ 技能 · 7 分类' },
  { key: 'cleaner',  label: '智能清理', icon: <ThunderboltOutlined />,comp: CleanerPanel,  group: 'system', desc: '扫描 / 分类 / 安全清理' },
  { key: 'qq',       label: 'QQ Bot',   icon: <QQIcon />,             comp: QQBotPanel,    group: 'system', desc: '反向 WS · 自动回复' },
  { key: 'wechat',   label: '微信',     icon: <SmileOutlined />,      comp: WechatSetup,   group: 'system', desc: 'ClawBot 插件 · 扫码绑定' },
  { key: 'knowledge', label: '知识库', icon: <BookOutlined />,       comp: KnowledgeBasePanel, group: 'system', desc: '行业知识库 · 文档上传 · BM25 检索' },
  { key: 'schedule',     label: '定时任务', icon: <ClockCircleOutlined />, comp: SchedulePanel,     group: 'system', desc: 'Cron 调度 · RPA 定时回放 · AI 任务自动化' },
  { key: 'workflow',     label: '工作流',   icon: <PartitionOutlined />,   comp: WorkflowPanel,     group: 'system', desc: 'DAG 多步骤自动化 · 行业模板 · 变量管道' },
  { key: 'notification', label: '通知中心', icon: <BellOutlined />,        comp: NotificationPanel, group: 'system', desc: 'SSE · Webhook · 邮件 · 桌面弹窗' },
  { key: 'suggestions', label: '主动建议', icon: <BulbOutlined />,       comp: ProactiveSuggestionsPanel, group: 'system',   desc: '🎯 智能需求预判 · 行业知识链 · 资源瓶颈预判 · 决策支持' },
  { key: 'governor', label: '管控员',   icon: <DashboardOutlined />,  comp: GovernorPanel, group: 'system', desc: '动态能力矩阵 · 系统健康 · 模型治理' },
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

/** 获取所有已知的用户身份 (从 localStorage 中读取所有 agentai.user.* 键) */
function getAllUserProfiles(): Array<UserProfile & { userId: string }> {
  const profiles: Array<UserProfile & { userId: string }> = [];
  try {
    // 读取 agentai-user-profile (当前用户)
    const currentRaw = localStorage.getItem('agentai-user-profile');
    if (currentRaw) {
      const parsed = JSON.parse(currentRaw);
      const profile = parsed?.state?.profile || parsed?.profile || null;
      if (profile?.name) {
        profiles.push({ ...profile, userId: profile.name });
      }
    }
    // 读取 agentai.user.* 键 (历史用户)
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('agentai.user.')) {
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.name) {
            profiles.push({ ...parsed, userId: parsed.name });
          }
        }
      }
    }
  } catch { /* ignore */ }
  return profiles;
}

export const App: React.FC = () => {
  const [page, setPage] = useState<PageKey>('chat');
  const { profile, setProfile } = useProfileStore();
  const { mode, setMode } = useModeStore();
  const [themeStyle, setThemeStyle] = useState<ThemeStyle>('graphite');
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [rightPanelVisible, setRightPanelVisible] = useState(true);
  const [fileTreeVisible, setFileTreeVisible] = useState(false);
  const [guideVisible, setGuideVisible] = useState(false);
  const [wechatModalVisible, setWechatModalVisible] = useState(false);
  const [setupWizardVisible, setSetupWizardVisible] = useState(false);
  const [splashVisible, setSplashVisible] = useState(true);
  const { fontSize, setFontSize } = useFontSizeStore();

  /* ✨ 全局建议 SSE 连接 + 未读计数 */
  useSuggestionSSE();
  const unreadSuggestionCount = useSuggestionStore(s => s.unreadCount);
  const markSuggestionsRead = useSuggestionStore(s => s.markAllRead);

  // 切换到建议页面时清除未读
  useEffect(() => {
    if (page === 'suggestions') markSuggestionsRead();
  }, [page, markSuggestionsRead]);

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

  /* --- 首次启动环境检测 (仅 Tauri 桌面端打包后生效) --- */
  useEffect(() => {
    // 开发环境 (Vite dev server) 不检测, 避免开发时误弹
    const isTauri = !!(window as any).__TAURI_INTERNALS__ || window.location.protocol === 'tauri:' || location.port === '1420';
    if (!isTauri) return;
    if (localStorage.getItem('agentai.setupChecked')) return;
    const timer = setTimeout(() => {
      // 尝试连接 gateway, 如果连不上说明可能缺 Node.js
      fetch('/v1/system/check-dep?cmd=node')
        .then(r => r.json())
        .then((data) => {
          if (data.installed) {
            localStorage.setItem('agentai.setupChecked', '1');
          } else {
            setSetupWizardVisible(true);
          }
        })
        .catch(() => {
          // gateway 没启动, 弹出环境检测向导
          setSetupWizardVisible(true);
        });
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

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

  /* --- 启动时同步 sessionStore 的 currentUserId 到当前用户 ---
   * 确保会话数据按用户隔离，用户切换时自动关联到正确的会话
   */
  useEffect(() => {
    const { setCurrentUserId } = useSessionStore.getState();
    if (profile?.name) {
      setCurrentUserId(profile.name);
    }
  }, [profile?.name]);

  const handleOnboardFinish = useCallback((name: string) => {
    setProfile({
      name: name.trim(),
      onboardedAt: Date.now(),
      language: 'zh',
    });
    // 保存到 localStorage 的历史用户记录
    localStorage.setItem(`agentai.user.${name.trim()}`, JSON.stringify({
      name: name.trim(),
      onboardedAt: Date.now(),
      language: 'zh',
    }));
    // 同步到 sessionStore 的 currentUserId
    useSessionStore.getState().setCurrentUserId(name.trim());
    sessionStorage.setItem('agentai.onboarded', '1');
    setShowOnboarding(false);
  }, [setProfile]);

  const handleReuseIdentity = useCallback((userName?: string) => {
    // ═══ 2026-06-28 修复: 沿用身份时必须恢复完整 profile (行业/devPrefs/问卷) ═══
    // 原代码仅设置了 name, 丢失了 industry/devPrefs 等关键信息
    let profileToRestore: UserProfile | null = null;

    if (userName) {
      // 切换到指定历史用户: 从 agentai.user.{userName} 读取
      try {
        const raw = localStorage.getItem(`agentai.user.${userName}`);
        if (raw) profileToRestore = JSON.parse(raw);
      } catch { /* ignore */ }
      // fallback: 如果历史用户没存到, 用当前 profile
      if (!profileToRestore) {
        const current = getLocalProfile();
        if (current?.name === userName) profileToRestore = current;
      }
    } else {
      // 沿用当前用户: 直接从 localStorage 读取完整 profile
      profileToRestore = getLocalProfile();
    }

    if (profileToRestore) {
      // 恢复完整 profile (行业/devPrefs/问卷/industrySkills 全部恢复)
      setProfile({
        ...profileToRestore,
        onboardedAt: profileToRestore.onboardedAt || Date.now(),
        language: 'zh' as const,
      });
      useSessionStore.getState().setCurrentUserId(profileToRestore.name);

      // 同步到 gateway (非阻塞, 确保后端也用缓存的行业/身份)
      const GATEWAY_HTTP = (window as any).__GATEWAY_HTTP__ || 'http://localhost:3001';
      fetch(`${GATEWAY_HTTP}/v1/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: profileToRestore.name,
          industry: profileToRestore.industry || 'general',
          useCase: profileToRestore.useCase,
          devPrefs: profileToRestore.devPrefs,
          questionnaire: profileToRestore.questionnaire,
          industrySkills: profileToRestore.industrySkills || [],
          onboardedAt: profileToRestore.onboardedAt || Date.now(),
        }),
      }).catch(() => { /* 网络失败静默忽略, 下次 chat 请求会自动同步 */ });
    }
    sessionStorage.setItem('agentai.onboarded', '1');
    setShowReusePrompt(false);
  }, [setProfile]);

  const handleResetIdentity = useCallback(() => {
    setShowReusePrompt(false);
    setShowOnboarding(true);
  }, []);

  /* --- 当前页 meta --- */
  const currentPage = useMemo(() => PAGES.find(p => p.key === page) || PAGES[0], [page]);

  /* --- Sidebar 仅在 chat 显示会话侧栏 --- */
  const showSessionSidebar = page === 'chat' && sidebarVisible;
  const showRightPanel = page === 'chat' && rightPanelVisible;

  // 当前工作目录 (供 FileTreePanel 使用)
  const currentWorkspace = profile?.workspace || localStorage.getItem('agentai.workspace') || '';

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
            <img src="/favicon-32.png" alt="Atlas"
              style={{ width: 36, height: 36, borderRadius: 8, marginRight: 8 }} />
            <div className="app-brand-text">
              <span className="app-brand-name">PulseFlow</span>
            </div>
          </div>

          {/* 主导航 Tab (分组: core 直接显示, media/system 下拉) */}
          <div style={{ display: 'flex', gap: 2, flex: 1, marginLeft: 16, overflow: 'auto', alignItems: 'center' }}>
            {/* Core 组: 直接显示 */}
            {PAGES.filter(p => p.group === 'core').map(p => (
              <span
                key={p.key}
                onClick={() => setPage(p.key)}
                className={`app-tab ${page === p.key ? 'active' : ''}`}
                data-testid={`nav-${p.key}`}
              >
                {p.icon}
                <span>{p.label}</span>
              </span>
            ))}

            {/* Media 组: 下拉菜单 */}
            <Dropdown
              trigger={['click']}
              placement="bottomLeft"
              menu={{
                items: PAGES.filter(p => p.group === 'media').map(p => ({
                  key: p.key,
                  label: (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                      {p.icon}
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 500 }}>{p.label}</div>
                        <div style={{ fontSize: 10, color: 'var(--muted-2)' }}>{p.desc}</div>
                      </div>
                    </div>
                  ),
                })),
                onClick: ({ key }) => setPage(key as PageKey),
              }}
            >
              <span className={`app-tab ${PAGES.some(p => p.group === 'media' && p.key === page) ? 'active' : ''}`}>
                <PictureOutlined />
                <span>创作</span>
                <DownOutlined style={{ fontSize: 9, marginLeft: 2 }} />
              </span>
            </Dropdown>

            {/* System 组: 下拉菜单 */}
            <Dropdown
              trigger={['click']}
              placement="bottomLeft"
              menu={{
                items: PAGES.filter(p => p.group === 'system').map(p => ({
                  key: p.key,
                  label: (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', minWidth: 180 }}>
                      {p.icon}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
                          {p.label}
                          {p.key === 'suggestions' && unreadSuggestionCount > 0 && (
                            <Tag color="red" style={{ fontSize: 9, padding: '0 4px', lineHeight: '14px', margin: 0 }}>{unreadSuggestionCount}</Tag>
                          )}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--muted-2)' }}>{p.desc}</div>
                      </div>
                      {page === p.key && <CheckCircleFilled style={{ color: 'var(--accent)', fontSize: 12 }} />}
                    </div>
                  ),
                })),
                onClick: ({ key }) => setPage(key as PageKey),
              }}
            >
              <span className={`app-tab ${PAGES.some(p => p.group === 'system' && p.key === page) ? 'active' : ''}`}>
                <AppstoreOutlined />
                <span>系统</span>
                <DownOutlined style={{ fontSize: 9, marginLeft: 2 }} />
              </span>
            </Dropdown>
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
              <Tooltip title="文件树 (添加到上下文)">
                <span onClick={() => setFileTreeVisible(v => !v)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 30, height: 30, borderRadius: 6, cursor: 'pointer',
                    color: fileTreeVisible ? 'var(--accent)' : 'var(--muted-2)',
                    background: fileTreeVisible ? 'var(--accent-soft)' : 'transparent',
                    transition: 'all 0.15s ease',
                  }}>
                  <FolderOpenOutlined style={{ fontSize: 14 }} />
                </span>
              </Tooltip>
            </>
          )}

          {/* GitHub 仓库 */}
          <Tooltip title="GitHub 仓库">
            <a href="https://github.com/pulseflow/platform" target="_blank" rel="noopener noreferrer"
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

          {/* 联系开发者 */}
          <Tooltip title="联系开发者">
            <span onClick={() => setWechatModalVisible(true)}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 30, height: 30, borderRadius: 6, cursor: 'pointer',
                color: 'var(--muted-2)', transition: 'all 0.15s ease', marginLeft: 4,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--accent)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--muted-2)'; }}
            >
              <WechatOutlined style={{ fontSize: 16 }} />
            </span>
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

          {/* Center: 当前页 (P0-3: ErrorBoundary + P0-4: Suspense 骨架屏) */}
          <div className="app-content">
            <ErrorBoundary key={page} onRetry={() => setPage(page)}>
              <Suspense fallback={<PageSkeleton />}>
                <currentPage.comp />
              </Suspense>
            </ErrorBoundary>
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

      {/* ═══ 7.5 环境检测向导 (缺失依赖时弹出) ═══ */}
      <SetupWizard visible={setupWizardVisible} onClose={() => setSetupWizardVisible(false)} />

      {/* ═══ 8. 联系开发者二维码弹窗 ═══ */}
      <Modal
        open={wechatModalVisible}
        onCancel={() => setWechatModalVisible(false)}
        footer={null}
        width={320}
        centered
        styles={{
          body: { padding: '24px 24px 16px', textAlign: 'center' },
        }}
      >
        <div style={{ marginBottom: 16 }}>
          <WechatOutlined style={{ fontSize: 32, color: '#07C160' }} />
        </div>
        <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600, color: 'var(--fg)' }}>
          联系开发者
        </h3>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--muted)' }}>
          扫描二维码添加微信，获取技术支持
        </p>
        <img
          src="/weixin.jpg"
          alt="开发者微信二维码"
          style={{
            width: 200,
            height: 200,
            borderRadius: 8,
            border: '1px solid var(--border)',
            marginBottom: 12,
          }}
        />
        <p style={{ margin: 0, fontSize: 12, color: 'var(--muted-2)' }}>
          工作时间：9:00 - 18:00
        </p>
      </Modal>

      {/* ✨ 全局浮动建议弹窗 — 高优先级建议主动弹出 */}
      <FloatingSuggestionToast
        onAccept={(suggestion) => {
          // 采纳建议 → 跳转到对话页并自动发送
          setPage('chat');
          // 通过自定义事件将建议 action 传递给 ChatView
          window.dispatchEvent(new CustomEvent('agentai:suggestion-accept', {
            detail: { action: suggestion.action }
          }));
        }}
      />

      {/* Splash 启动欢迎页 */}
      {splashVisible && (
        <Splash onFinish={() => setSplashVisible(false)} duration={1500} />
      )}

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
 * 支持选择多个历史用户身份
 */
const ReuseIdentityPrompt: React.FC<{
  profile: any;
  onReuse: (userName?: string) => void;
  onReset: () => void;
}> = ({ profile: propProfile, onReuse, onReset }) => {
  // 使用 localStorage 数据作为 fallback (zustand profile 可能未 hydration)
  const displayProfile = (propProfile?.name && propProfile?.industry) ? propProfile : getLocalProfile();
  const industryLabel = displayProfile?.industry || '通用';
  const name = displayProfile?.name || '用户';

  // 获取所有历史用户
  const allUsers = getAllUserProfiles();
  // 排除当前用户，显示其他用户
  const otherUsers = allUsers.filter(u => u.name !== name);

  return (
    <Modal
      open={true}
      closable={false}
      maskClosable={false}
      footer={null}
      centered
      width={480}
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

        {/* 显示其他历史用户 */}
        {otherUsers.length > 0 && (
          <div style={{ marginTop: 20, textAlign: 'left' }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>其他用户:</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {otherUsers.map(u => (
                <button
                  key={u.name}
                  onClick={() => onReuse(u.name)}
                  style={{
                    padding: '8px 16px', borderRadius: 8, fontSize: 13,
                    border: '1px solid var(--border)', background: 'var(--card)',
                    color: 'var(--fg)', cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--card-hover)';
                    e.currentTarget.style.borderColor = 'var(--accent)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'var(--card)';
                    e.currentTarget.style.borderColor = 'var(--border)';
                  }}
                >
                  {u.name} {u.industry ? `· ${u.industry}` : ''}
                </button>
              ))}
            </div>
          </div>
        )}

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
            onClick={() => onReuse()}
            style={{ borderRadius: 8, minWidth: 120, background: 'var(--accent)', borderColor: 'var(--accent)' }}
          >
            沿用原有身份
          </Button>
        </div>
      </div>
    </Modal>
  );
};
