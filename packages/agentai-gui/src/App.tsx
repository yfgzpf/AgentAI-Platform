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
import React, { useState, useEffect, useMemo, useCallback, useRef, Suspense, lazy } from 'react';
import { ConfigProvider, App as AntApp, theme, Tooltip, Dropdown, Tag, Modal, Button, Alert, Checkbox } from 'antd';
import { StyleProvider } from '@ant-design/cssinjs';
import zhCN from 'antd/locale/zh_CN';
import {
  MessageOutlined, EditOutlined, PictureOutlined, VideoCameraOutlined,
  CodeOutlined, AppstoreOutlined, RobotOutlined,
  SettingOutlined, BgColorsOutlined, UserOutlined, ThunderboltOutlined,
  ExperimentOutlined, PartitionOutlined, SmileOutlined, GithubOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined, InfoCircleOutlined, BulbOutlined,
  LeftOutlined, RightOutlined, SunOutlined, MoonOutlined, BookOutlined,
  WechatOutlined, ClockCircleOutlined, BellOutlined, MedicineBoxOutlined,
  DownOutlined, CheckCircleFilled, FolderOpenOutlined, DashboardOutlined, SyncOutlined, DownloadOutlined,
  GlobalOutlined, MinusOutlined, BorderOutlined, CloseOutlined,
  HomeOutlined, KeyOutlined, HeartOutlined, ExpandOutlined, ReloadOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
/* P0-4: 代码分割 — 首屏组件同步加载，其他页面延迟加载 */
// 首屏核心组件 - 同步导入避免骨架屏等待
import { ChatView } from './components/ChatView';

// 其他页面组件 - 懒加载
const WritePage = lazy(() => import('./components/WritePage').then(m => ({ default: m.WritePage })));
const ImageStudio = lazy(() => import('./components/ImageStudio').then(m => ({ default: m.ImageStudio })));
const VideoGen = lazy(() => import('./components/VideoGen').then(m => ({ default: m.VideoGen })));
const Model3DGen = lazy(() => import('./components/Model3DGen').then(m => ({ default: m.Model3DGen })));
const Editor = lazy(() => import('./components/Editor').then(m => ({ default: m.Editor })));
const Settings = lazy(() => import('./components/Settings').then(m => ({ default: m.Settings })));
const QQBotPanel = lazy(() => import('./components/QQBotPanel').then(m => ({ default: m.QQBotPanel })));
const KnowledgeBasePanel = lazy(() => import('./components/KnowledgeBasePanel').then(m => ({ default: m.KnowledgeBasePanel })));
const SkillLibrary = lazy(() => import('./components/SkillLibrary').then(m => ({ default: m.SkillLibrary })));
const WechatSetup = lazy(() => import('./components/WechatSetup').then(m => ({ default: m.WechatSetup })));
// SchedulePanel 已合并到 AutomationPanel
const NotificationPanel = lazy(() => import('./components/NotificationPanel').then(m => ({ default: m.NotificationPanel })));
const WorkflowPanel = lazy(() => import('./components/WorkflowPanel').then(m => ({ default: m.WorkflowPanel })));
const ProactiveSuggestionsPanel = lazy(() => import('./components/ProactiveSuggestionsPanel').then(m => ({ default: m.default })));
const XuanjiPanel = lazy(() => import('./components/XuanjiPanel').then(m => ({ default: m.XuanjiPanel })));
const AutomationPanel = lazy(() => import('./components/AutomationPanel').then(m => ({ default: m.AutomationPanel })));
const TaskCenterPanel = lazy(() => import('./components/TaskCenterPanel').then(m => ({ default: m.TaskCenterPanel })));
const TaskBoard = lazy(() => import('./components/TaskBoard').then(m => ({ default: m.TaskBoard })));
const EvolutionPanel = lazy(() => import('./components/EvolutionPanel').then(m => ({ default: m.EvolutionPanel })));
import { preloadLazyChunks } from './lazyChunks';
const MonitoringPanel = lazy(() => import('./components/MonitoringPanel').then(m => ({ default: m.default })));
const KnowledgeDashboard = lazy(() => import('./components/KnowledgeDashboard').then(m => ({ default: m.KnowledgeDashboard })));
const SoulPanel = lazy(() => import('./components/SoulPanel').then(m => ({ default: m.SoulPanel })));
const ScopeManager = lazy(() => import('./components/ScopeManager').then(m => ({ default: m.default })));
import { RightPanel } from './components/RightPanel';
import { PulseFlowSidebar } from './components/PulseFlowSidebar';
import { GuideModal } from './components/GuideModal';
import { BrandLogo } from './components/BrandLogo';  // 品牌标唯一出口 (标题栏原用栅格 favicon, 已统一)
import { StatusBar } from './components/StatusBar';
import { GitStatusBar } from './components/GitStatusBar';
// 2026-10-17 环境体检面板: 一屏看清"缺什么 / 能不能自动装 / 怎么装"
//   (SetupWizard 偏首次启动向导; 本面板是随时可查的完整清单, 且**不含任何自动安装动作**)
import { EnvCheckPanel } from './components/EnvCheckPanel';
import { SimpleGitPanel } from './components/SimpleGitPanel';  // 使用简化版 Git 面板
import { TerminalPanel, terminalTaskManager, TerminalTask } from './components/TerminalPanel';  // 终端任务面板
import { IdentityOnboarding } from './components/IdentityOnboarding';
import { SetupWizard } from './components/SetupWizard';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PageSkeleton } from './components/PageSkeleton';
import { useProfileStore, UserProfile } from './store';
import { useSessionStore } from './store/sessionStore';
import { FeatureGuide } from './app/FeatureGuide';
import { ChatModeToggle } from './app/ChatModeToggle';
import { railTabStyle, railIconStyle } from './app/rail-styles';
import { NavGroupDropdown, type NavGroupItem } from './app/NavGroupDropdown';
import { getLocalProfile, getAllUserProfiles } from './app/profile-local';
import type { PageKey, PageMeta } from './app/page-types';
import { getCurrentWorkspace } from './utils/workspace-switch';
import { useModeStore, MODE_CONFIG, MODE_ORDER } from './store/modeStore';
import { useFontSizeStore, FONT_SIZE_MAP, type FontSize } from './store';
import { useModelStore } from './store/modelStore';
import { ModelSelector } from './components/ModelSelector';
import { gatewayFallback } from './services/GatewayFallback';
import { GATEWAY_HTTP } from './services/config';
import FloatingSuggestionToast from './components/FloatingSuggestionToast';
import { useSuggestionSSE } from './hooks/useSuggestionSSE';
import { useSuggestionStore } from './store/suggestionStore';
import { Splash } from './components/Splash';
import { ReuseIdentityPrompt } from './components/ReuseIdentityPrompt';
import { GlobalBrowserDrawer, openGlobalBrowser } from './components/GlobalBrowserDrawer';
import { EmbeddedBrowser } from './components/EmbeddedBrowser';
import { BrowserHost, useBrowserHost } from './services/browser-host';
import { BrowserStateBus } from './services/BrowserStateBus';
import { useIdeState } from './hooks/useIdeState';
import { useResizable } from './hooks/useResizable';
import { useStoreHydrated } from './hooks/useStoreHydrated';
import { PageShell } from './components/shell';
import { useUpdaterStore, mountUpdaterEventBus } from './store/updaterStore';
import { useSubscriptionStore } from './store/subscriptionStore';

// 暴露到 window, 顶部导航按钮可调用
if (typeof window !== 'undefined') {
  (window as any).openGlobalBrowser = openGlobalBrowser;
}

/* ════════════════ 功能引导提示 (非强制锁定) ════════════════ */
/**
 * 设计理念：
 * - 生图/生视频页面允许所有用户进入
 * - 免费用户使用内置免费模型（能力有限）
 * 组件本体已搬至 ./app/FeatureGuide (2026-10-12 App.tsx 瘦身第一批)
 */

const StatsPanel = lazy(() => import('./components/StatsPanel').then(m => ({ default: m.StatsPanel })));
const PascalEditor = lazy(() => import('./components/PascalEditor').then(m => ({ default: m.PascalEditor })));
const DecorAI = lazy(() => import('./components/DecorAI/index').then(m => ({ default: m.DecorAI })));

const PAGES: PageMeta[] = [
  { key: 'chat',     label: '对话',     icon: <MessageOutlined />,    comp: ChatView,      group: 'core',   desc: '智能对话 · 多模型 · 工具调用' },
  { key: 'editor',   label: '编辑器',   icon: <CodeOutlined />,       comp: Editor,        group: 'core',   desc: '代码编辑 · 改写 · 文件管理' },
  { key: 'xuanji',   label: '医案',     icon: <MedicineBoxOutlined />, comp: XuanjiPanel,   group: 'core',   desc: '四诊合参 · 辨证论治 · 经验积累', badge: 'NEW' },
  { key: 'image',    label: '生图',     icon: <PictureOutlined />,    comp: ImageStudio,   group: 'media',  desc: 'AI 图像工作室 · 5种创作模式', requireSubscription: true },
  { key: 'video',    label: '生视频',   icon: <VideoCameraOutlined />,comp: VideoGen,      group: 'media',  desc: '文生视频 · 图生视频 · 首尾帧', requireSubscription: true },
  { key: '3d',       label: '3D建模',   icon: <AppstoreOutlined />,   comp: Model3DGen,    group: 'media',  desc: '文/图生3D · 混元 · 豆包' },
  { key: 'pascal',   label: '建筑编辑', icon: <HomeOutlined />,       comp: PascalEditor,  group: 'media',  desc: 'AI 驱动 3D 建筑模型 · 墙体/门窗/屋顶', badge: 'NEW', hidden: true },
  { key: 'decorai',  label: '建筑装饰', icon: <ExperimentOutlined />, comp: DecorAI,        group: 'media',  desc: '对话画布 · 效果图 · 改图 · 报价 · 视频', badge: 'NEW', hidden: true },
  { key: 'write',    label: '写作',     icon: <EditOutlined />,       comp: WritePage,     group: 'media',  desc: '长文写作 · 模板 · 一键导出' },
  /* system 组按 section 分段 —— 15 项平铺过密, 下拉里靠段标题扫读 (同 section 必须连续) */
  { key: 'qq',       label: 'QQ Bot',   icon: <MessageOutlined />,             comp: QQBotPanel,    group: 'system', section: '渠道与通知', desc: '反向 WS · 自动回复' },
  { key: 'wechat',   label: '微信',     icon: <SmileOutlined />,      comp: WechatSetup,   group: 'system', section: '渠道与通知', desc: '微信助手插件 · 扫码绑定' },
  { key: 'notification', label: '通知中心', icon: <BellOutlined />,        comp: NotificationPanel, group: 'system', section: '渠道与通知', desc: 'SSE · Webhook · 邮件 · 桌面弹窗' },
  { key: 'skills',   label: '技能库',   icon: <AppstoreOutlined />,   comp: SkillLibrary,  group: 'system', section: '知识与技能', desc: '25+ 技能 · 7 分类' },
  { key: 'knowledge', label: '知识库', icon: <BookOutlined />,       comp: KnowledgeBasePanel, group: 'system', section: '知识与技能', desc: '行业知识库 · 文档上传 · BM25 检索' },
  { key: 'knowledge-explore', label: '知识探索', icon: <ExperimentOutlined />, comp: KnowledgeDashboard, group: 'system', section: '知识与技能', desc: 'AI 自主学习 · GitHub 探索 · 知识蒸馏', badge: 'NEW' },
  { key: 'automation',   label: '自动化',   icon: <ThunderboltOutlined />, comp: AutomationPanel, group: 'system', section: '自动化', desc: 'Cron 调度 · RPA 自动化 · AI 任务 · 成功率统计 · 执行监控', badge: 'NEW' },
  { key: 'workflow',     label: '工作流',   icon: <PartitionOutlined />,   comp: WorkflowPanel,     group: 'system', section: '自动化', desc: 'DAG 多步骤自动化 · 行业模板 · 变量管道' },
  { key: 'stats',    label: '用量',     icon: <ThunderboltOutlined />, comp: StatsPanel,    group: 'system', section: '运行与洞察', desc: '工具调用统计 · 成功率 · 省时报告', badge: 'NEW' },
  { key: 'tasks',    label: '任务中心', icon: <SyncOutlined />,       comp: TaskCenterPanel, group: 'system', section: '运行与洞察', desc: '长任务快照 · 跨会话恢复 · 进度跟踪', badge: 'NEW' },
  { key: 'suggestions', label: '主动建议', icon: <BulbOutlined />,       comp: ProactiveSuggestionsPanel, group: 'system', section: '运行与洞察', desc: '🎯 智能需求预判 · 行业知识链 · 资源瓶颈预判 · 决策支持' },
  { key: 'evolution', label: '自进化',  icon: <ExperimentOutlined />, comp: EvolutionPanel,  group: 'system', section: '运行与洞察', desc: '跨会话规则自修改 · 技能自动创建 · 行为优化', badge: 'NEW' },
  { key: 'monitoring', label: '监控面板', icon: <DashboardOutlined />, comp: MonitoringPanel, group: 'system', section: '运行与洞察', desc: '进化系统 · 审批策略 · 反馈闭环 实时监控', badge: 'NEW' },
  { key: 'soul', label: '灵魂', icon: <HeartOutlined />, comp: SoulPanel, group: 'system', section: '运行与洞察', desc: '梦境 · 好奇心 · 内心独白 · 痛觉 · 辩论 — AI 的内心世界', badge: 'NEW' },
  { key: 'pentest-scope', label: '渗透测试授权', icon: <SafetyCertificateOutlined />, comp: ScopeManager, group: 'system', section: '运行与洞察', desc: '授权范围管理 · 赏金打单 · 挖洞前加目标, 免改 JSON' , badge: 'NEW' },
  { key: 'settings', label: '设置',     icon: <SettingOutlined />,    comp: Settings,      group: 'system', section: '应用设置', desc: '密钥 · 框架 · 模型 · 主题' },
];

/* ════════════════ 主题 (5 套 + 跟随系统) ════════════════ */
type ThemeStyle = 'graphite' | 'sandstone' | 'porcelain' | 'midnight' | 'ember' | 'system';
type ThemeMode = 'dark' | 'light';

const THEME_OPTIONS: { value: ThemeStyle; label: string; swatch: string }[] = [
  { value: 'system',    label: '跟随系统',     swatch: 'linear-gradient(135deg, #1a1a22 0%, #f5f1ea 100%)' },
  { value: 'graphite',  label: '石墨 (暗)',   swatch: 'linear-gradient(135deg, #1a1a22 0%, #2a1f1a 100%)' },
  { value: 'midnight',  label: '午夜紫 (暗)', swatch: 'linear-gradient(135deg, #16162a 0%, #2a1a4a 100%)' },
  { value: 'ember',     label: '余烬橙 (暗)', swatch: 'linear-gradient(135deg, #1f1815 0%, #4a2a18 100%)' },
  { value: 'sandstone', label: '砂岩 (亮)',   swatch: 'linear-gradient(135deg, #f5f1ea 0%, #e8d8b8 100%)' },
  { value: 'porcelain', label: '瓷白 (亮)',   swatch: 'linear-gradient(135deg, #fafafa 0%, #e0e0e8 100%)' },
];

/* getLocalProfile / getAllUserProfiles 已搬至 ./app/profile-local (2026-10-12) */

export const App: React.FC = () => {
  /** 启动页 = localStorage 里上次的页面 (仅接受已知 PageKey, 异常值退回 'chat')。
   *  ⚠️ 这里曾有一份**逻辑完全相同的死函数** `resolveStoredPage` (定义了但从未调用,
   *  注释自己写着"定义了但从未调用"), 同时又内联了同一份白名单 —— 同一规则两处真相。
   *  死函数已删, 白名单只保留这一处。 */
  const [page, setPageState] = useState<PageKey>(() => {
    try {
      const saved = localStorage.getItem('agentai.lastPage');
      if (saved) {
        const VALID: PageKey[] = ['chat', 'write', 'image', 'video', '3d', 'pascal', 'decorai',
        'editor', 'skills', 'qq', 'wechat', 'knowledge', 'settings', 'notification',
        'workflow', 'suggestions', 'xuanji', 'automation', 'tasks', 'stats',
        'evolution', 'monitoring', 'knowledge-explore', 'soul', 'pentest-scope'];
        if (VALID.includes(saved as PageKey)) return saved as PageKey;
      }
    } catch { /* ignore */ }
    return 'chat';
  });
  const setPage = useCallback((next: PageKey) => {
    setPageState(next);
    try { localStorage.setItem('agentai.lastPage', next); } catch { /* ignore */ }
  }, []);
  const { profile, setProfile } = useProfileStore();
  const { mode, setMode } = useModeStore();
  const [themeStyle, setThemeStyle] = useState<ThemeStyle>('graphite');
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [rightPanelVisible, setRightPanelVisible] = useState(true);
  const [fileTreeVisible, setFileTreeVisible] = useState(false);
  // P0: 跨页面打开文件 — 当从非 editor 页跳转时, 先存 path, 等 Editor 挂载后重放
  const [pendingFilePath, setPendingFilePath] = useState<string | null>(null);
  const [guideVisible, setGuideVisible] = useState(false);
  const [wechatModalVisible, setWechatModalVisible] = useState(false);
  const [setupWizardVisible, setSetupWizardVisible] = useState(false);
  const [splashVisible, setSplashVisible] = useState(true);
  const [gitPanelVisible, setGitPanelVisible] = useState(false);
  // 2026-10-17: 环境体检抽屉
  const [envPanelVisible, setEnvPanelVisible] = useState(false);
  const [terminalPanelVisible, setTerminalPanelVisible] = useState(false);
  const [terminalTasks, setTerminalTasks] = useState<TerminalTask[]>([]);
  const { fontSize, setFontSize } = useFontSizeStore();

  // P0: 监听 agentai:navigate (页面切换) + agentai:open-file-pending (跨页打开文件)
  // 之前: 组件先 dispatch open-file 再 dispatch navigate, 但 Editor 未挂载 → 事件丢失
  // 现在: 组件 dispatch navigate + open-file-pending, App 存 path, Editor 挂载后重放
  useEffect(() => {
    const navHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.page) {
        setPage(detail.page as PageKey);
      }
    };
    const filePendingHandler = (e: Event) => {
      const path = (e as CustomEvent).detail?.path;
      if (typeof path === 'string' && path) {
        // 无论当前是否在 editor 页, 都先存起来
        // 如果已在 editor 页, 下面的重放 useEffect 会立即触发
        setPendingFilePath(path);
      }
    };
    window.addEventListener('agentai:navigate', navHandler);
    window.addEventListener('agentai:open-file-pending', filePendingHandler);
    return () => {
      window.removeEventListener('agentai:navigate', navHandler);
      window.removeEventListener('agentai:open-file-pending', filePendingHandler);
    };
  }, [setPage]);

  // P0: 当页面已切到 editor 且有 pendingFilePath 时, 延迟一帧 dispatch open-file
  // Editor 组件此时已挂载, 其 useEffect 注册的监听器可以正常接收
  useEffect(() => {
    if (pendingFilePath && page === 'editor') {
      const timer = setTimeout(() => {
        window.dispatchEvent(new CustomEvent('agentai:open-file', { detail: { path: pendingFilePath } }));
        setPendingFilePath(null);
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [pendingFilePath, page]);

  // Tauri 环境检测 (用于显示窗口控制按钮)
  const isTauriEnv = !!(window as any).__TAURI_INTERNALS__ || window.location.protocol === 'tauri:';

  /** 真正执行关闭 (不拦截) */
  const doCloseWindow = useCallback(async () => {
    if (!isTauriEnv) return;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      await win.close();
    } catch (e) {
      console.warn('[App] close window failed:', e);
    }
  }, [isTauriEnv]);

  /** 点 [关闭并安装重启] */
  const handleCloseAndInstall = useCallback(async () => {
    setInstallingOnClose(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      useUpdaterStore.getState().setStage('installing');
      // Rust: updater_take_and_install → 清 pending + download_and_install → 进程退出重启
      await invoke('updater_take_and_install');
      // 正常安装后 Tauri 会自动重启进程；如果没重启 (返回了)，走 fallback：关闭窗口
      await doCloseWindow();
    } catch (e: any) {
      console.warn('[App] 关闭并安装失败，fallback 到仅关闭:', e);
      // 失败时不要卡住：调 discard 清内存状态，再关窗口
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('updater_discard');
      } catch {}
      useUpdaterStore.getState().setError(String(e?.message || e));
      await doCloseWindow();
    } finally {
      setInstallingOnClose(false);
      setShowUpdateCloseModal(false);
    }
  }, [doCloseWindow]);

  /** 点 [仅关闭不安装] */
  const handleCloseOnly = useCallback(async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      // 仅清 Rust 内存里的 pending 标记；下次启动重新 check 不会重复下载（Tauri 自己有缓存）
      await invoke('updater_discard');
    } catch {}
    useUpdaterStore.getState().clearPending();
    setShowUpdateCloseModal(false);
    await doCloseWindow();
  }, [doCloseWindow]);

  /** 窗口控制操作 (最小化/最大化/关闭) */
  const handleWindowAction = useCallback(async (action: 'minimize' | 'toggle-maximize' | 'close') => {
    if (!isTauriEnv) return;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      switch (action) {
        case 'minimize': await win.minimize(); break;
        case 'toggle-maximize':
          await win.isMaximized().then(async (maxed) => {
            maxed ? await win.unmaximize() : await win.maximize();
          });
          break;
        case 'close': {
          const st = useUpdaterStore.getState();
          // 有已下载更新 → 弹确认 Modal（Trae 风格：关闭时询问）
          if (st.stage === 'ready' && st.pending?.downloaded) {
            if (st.autoInstallOnClose) {
              // 用户勾选了「关闭时自动安装」→ 跳过弹窗直接装
              await handleCloseAndInstall();
            } else {
              setShowUpdateCloseModal(true);
            }
          } else {
            await doCloseWindow();
          }
          break;
        }
      }
    } catch (e) {
      console.warn('[App] Window action failed:', e);
    }
  }, [isTauriEnv, doCloseWindow, handleCloseAndInstall]);

  /* ✨ 全局建议 SSE 连接 + 未读计数 */
  useSuggestionSSE();
  useIdeState();  // 编辑器上下文感知: 推送当前文件/光标到 Gateway
  /* 🔄 更新进度事件总线：启动时拉 Rust pending + 监听 updater://progress */
  useEffect(() => mountUpdaterEventBus(), []);
  const updaterStage = useUpdaterStore(s => s.stage);
  const updaterPending = useUpdaterStore(s => s.pending);
  const autoInstallOnClose = useUpdaterStore(s => s.autoInstallOnClose);
  const [showUpdateCloseModal, setShowUpdateCloseModal] = useState(false);
  const [installingOnClose, setInstallingOnClose] = useState(false);
  const unreadSuggestionCount = useSuggestionStore(s => s.unreadCount);
  const markSuggestionsRead = useSuggestionStore(s => s.markAllRead);

  // 切换到建议页面时清除未读
  useEffect(() => {
    if (page === 'suggestions') markSuggestionsRead();
  }, [page, markSuggestionsRead]);

  /* --- 监听终端任务变化 --- */
  useEffect(() => {
    const unsubscribe = terminalTaskManager.onChange(setTerminalTasks);
    return () => unsubscribe();
  }, []);

  /* --- 主题 + 字体大小应用 --- */
  useEffect(() => {
    const root = document.documentElement;

    // P2: 跟随系统 — 监听 OS 暗色模式
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      let effective = themeStyle;
      if (themeStyle === 'system') {
        // 系统暗色 → graphite, 系统亮色 → sandstone
        effective = media.matches ? 'graphite' : 'sandstone';
      }
      const dark = effective === 'graphite' || effective === 'midnight' || effective === 'ember';
      root.setAttribute('data-theme', dark ? 'dark' : 'light');
      root.setAttribute('data-theme-style', effective);
      root.style.colorScheme = dark ? 'dark' : 'light';
    };
    applyTheme();
    // 监听系统主题变化 (仅当选择 "跟随系统" 时生效)
    if (themeStyle === 'system') {
      media.addEventListener('change', applyTheme);
      return () => media.removeEventListener('change', applyTheme);
    }

    // 字体大小
    const fontCfg = FONT_SIZE_MAP[fontSize] || FONT_SIZE_MAP.medium;
    root.style.setProperty('--font-scale', String(fontCfg.scale));
    root.style.setProperty('--font-base', fontCfg.cssBase);
    root.style.fontSize = fontCfg.cssBase;
  }, [themeStyle, fontSize]);

  /* --- 启动网关健康检测 + 同步工作目录 + 加载模型密钥 --- */
  useEffect(() => {
    gatewayFallback.start();
    /**
     * 构建vs开发一致性修复 (P1):
     * 首次启动空闲时预加载常用懒加载 chunk,
     * 消除生产构建下首次切页时"chunk加载瞬慢→骨架屏多停留→框框感"
     */
    preloadLazyChunks();

    // 从网关同步工作目录和模型密钥
    (async () => {
      try {
        const base = gatewayFallback.url;
        
        // 同步工作目录
        const resp = await fetch(base + '/v1/health');
        if (resp.ok) {
          const data = await resp.json();
          if (data.cwd) {
            const existing = localStorage.getItem('agentai.workspace');
            // 只在以下情况覆盖: localStorage 为空, 或路径不存在
            if (!existing || existing === 'C:\\') {
              localStorage.setItem('agentai.workspace', data.cwd);
            }
          }
        }
        
        // 加载所有模型密钥状态 + 动态模型列表
        const providers = ['agentai', 'deepseek', 'openai', 'zhipu', 'yi', 'baichuan', 'minimax', 'anthropic'];
        for (const provider of providers) {
          try {
            const keyResp = await fetch(`${base}/v1/settings/keys?provider=${provider}`);
            if (keyResp.ok) {
              const keyData = await keyResp.json();
              if (keyData.ok && keyData.envVar) {
                // 同步到 modelStore
                const { useModelStore } = await import('./store/modelStore');
                useModelStore.getState().setCommercialKey(keyData.envVar, 'configured');
              }
            }
          } catch (e) {
            console.warn(`[keys] failed to load ${provider}:`, e);
          }
        }
        
        // 加载动态模型列表
        try {
          const { useModelStore } = await import('./store/modelStore');
          await useModelStore.getState().loadDynamicModels();
        } catch (e) {
          console.warn('[models] failed to load dynamic models:', e);
        }
      } catch {}
    })();

    return () => gatewayFallback.stop();
  }, []);

  /* --- 监听打开使用指南事件 (左侧栏底部入口触发) --- */
  useEffect(() => {
    const handler = () => setGuideVisible(true);
    window.addEventListener('agentai:show-guide', handler);
    return () => window.removeEventListener('agentai:show-guide', handler);
  }, []);

  /* --- 监听切换到指定会话事件 (自动化任务详情页触发) --- */
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ sessionId: string; source?: string }>;
      const { sessionId } = ce.detail;
      if (sessionId) {
        // 切换到 chat 页面
        setPage('chat');
        // 激活对应会话
        const { setActive, sessions, createSession } = useSessionStore.getState();
        const existingSession = sessions.find(s => s.id === sessionId);
        if (existingSession) {
          setActive(sessionId);
        } else {
          // 如果会话不存在（如自动化创建的会话），创建一个新会话并加载
          const newId = createSession('自动化任务对话', undefined, 'chat', getCurrentWorkspace());
          // 尝试从后端加载该会话的消息
          loadSessionFromGateway(sessionId, newId);
        }
      }
    };
    window.addEventListener('agentai:switch-session', handler);
    return () => window.removeEventListener('agentai:switch-session', handler);
  }, []);

  // 从 gateway 加载会话消息
  const loadSessionFromGateway = async (gatewaySessionId: string, localSessionId: string) => {
    try {
      const resp = await fetch(`${GATEWAY_HTTP}/api/sessions/${gatewaySessionId}/messages`);
      const data = await resp.json();
      if (data.success && data.messages) {
        const { addMessage } = useSessionStore.getState();
        data.messages.forEach((msg: any) => {
          addMessage(localSessionId, {
            role: msg.role,
            content: msg.content,
            ts: msg.timestamp || Date.now(),
          });
        });
      }
    } catch (e) {
      console.error('加载会话消息失败:', e);
    }
  };

  /* --- 监听 Tauri 托盘菜单导航事件 --- */
  useEffect(() => {
    const isTauri = !!(window as any).__TAURI_INTERNALS__ || window.location.protocol === 'tauri:';
    if (!isTauri) return;
    
    let unlisten: (() => void) | null = null;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen<string>('navigate', (event) => {
          const target = event.payload as PageKey;
          if (target && PAGES.some(p => p.key === target)) {
            setPage(target);
          }
        });
      } catch (e) {
        console.warn('[App] Failed to setup Tauri navigate listener:', e);
      }
    })();
    
    return () => {
      if (unlisten) unlisten();
    };
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

  /* --- 2026-10-17 环境体检面板: StatusBar 按钮 → 打开弹窗 (用事件解耦, 避免 StatusBar 依赖 App 状态) --- */
  useEffect(() => {
    const open = () => setEnvPanelVisible(true);
    window.addEventListener('agentai:open-env-check', open);
    return () => window.removeEventListener('agentai:open-env-check', open);
  }, []);

  /* --- 首次启动环境检测 (仅 Tauri 桌面端打包后生效) --- */
  useEffect(() => {
    // 开发环境 (Vite dev server) 不检测, 避免开发时误弹
    const isTauri = !!(window as any).__TAURI_INTERNALS__ || window.location.protocol === 'tauri:' || window.location.port === '1420';
    if (!isTauri) return;
    if (localStorage.getItem('agentai.setupChecked')) return;
    const timer = setTimeout(async () => {
      // 统一使用顶部导入的 GATEWAY_HTTP (开发态走 Vite proxy, 生产态直连)
      const healthUrl = `${GATEWAY_HTTP}/v1/health`;
      
      // 先给 Gateway 自启留足时间 (Rust 端 setup 延迟 1s + Node 启动 ~2s + Gateway listen ~3s)
      let nodeOk = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const resp = await fetch(`${GATEWAY_HTTP}/v1/system/check-dep?cmd=node`, { 
            signal: AbortSignal.timeout(5000) 
          });
          if (resp.ok) {
            const data = await resp.json();
            if (data.installed) {
              nodeOk = true;
              localStorage.setItem('agentai.setupChecked', '1');
              break;
            }
          }
        } catch {
          // Gateway 可能还在启动中, 等待后重试
          await new Promise(r => setTimeout(r, 3000));
        }
      }
      
      if (!nodeOk) {
        // 3 次重试都失败: 要么没装 Node,要么 Gateway 启动失败
        setSetupWizardVisible(true);
      }
    }, 5000); // 延迟到 5s, 给 Rust auto-start 足够时间
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

  /* --- 等待 sessionStore 水合完成 (IndexedDB 异步), 见 hooks/useStoreHydrated --- */
  const sessionStoreHydrated = useStoreHydrated(useSessionStore);

  /* --- 启动时同步 sessionStore 的 currentUserId 到当前用户 ---
   * 确保会话数据按用户隔离，用户切换时自动关联到正确的会话
   */
  useEffect(() => {
    // ★ 2026-10-22 复审: 存储后端是 IndexedDB(异步水合), 挂载即写会把**初始空态**
    //   写回存储, 随后水合又把这份空态读回来 → 存量会话被彻底抹掉(实测坐实)。
    //   必须等 sessionStore 水合完成再写。
    if (!sessionStoreHydrated) return;
    const { setCurrentUserId } = useSessionStore.getState();
    if (profile?.name) {
      setCurrentUserId(profile.name);
    }
  }, [profile?.name, sessionStoreHydrated]);

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
      // 统一使用 config.ts 的 GATEWAY_HTTP (开发态走 Vite proxy, 生产态直连)
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

  // ═══ 右栏双模式 (2026-10-11): 信息 / 浏览器 ═══
  // 背景: 浏览器能力本来就有 (EmbeddedBrowser + browser-engine), 但只挂在右侧浮层 Drawer 上。
  // 现在改成 ZCode 那样嵌在右栏常驻, 与"信息"模式共用一个栏位。
  //   - chat 页: 信息 / 浏览器 可切
  //   - 其它页: 只走浏览器模式 —— Editor/ImageStudio 自带多栏, 平白加一条信息栏只会挤
  // ✅ 批次8.8 (2026-10-12): 初值恒 'info' (不再读 localStorage 自动弹浏览器栏)。
  //   写逻辑保留 —— 手动切到 browser 时仍持久化, 但**启动不再自动弹**。
  const [railMode, setRailMode] = useState<'info' | 'browser'>('info');
  useEffect(() => {
    try { localStorage.setItem('agentai.rail.mode', railMode); } catch { /* 隐私模式忽略 */ }
  }, [railMode]);

  // ═══ 浏览器宿主状态 (事件中枢在 services/browser-host.ts) ═══
  // 全项目只有一份 window 监听 + 一份 EmbeddedBrowser —— 两个宿主同时挂会双开+双导航+重复订阅 socket
  const browserHost = useBrowserHost();
  const hostVisible = browserHost.visible;
  const hostIntent = browserHost.intent;
  const hostOpenSeq = browserHost.openSeq;
  // 抽屉宿主激活 (用户点了「⬈ 独立大窗」) → 右栏必须收起,
  // 否则右栏和抽屉会各挂一份 EmbeddedBrowser = 两份 socket /browser 订阅 (实测踩过这个坑)
  const drawerHostActive = hostVisible && hostIntent === 'drawer';

  // 非 chat 页只有浏览器一种模式, 所以 railMode 作为**持久化值只代表 chat 页的偏好**。
  // 不能拿 railMode 直接决定右栏内容, 否则「在编辑器页开了浏览器」会把偏好写成 browser,
  // 回 chat 页看到的就是浏览器栏而不是信息栏 (上一轮实测踩到); 非 chat 页还会因此拿到
  // 信息栏的 320px 宽度和 240–560 的 aria 区间, 与 520px 的浏览器内容错配。
  const effectiveRailMode: 'info' | 'browser' = page === 'chat' ? railMode : 'browser';
  const showInfoRail = page === 'chat' && railMode === 'info';
  const showBrowserRail = effectiveRailMode === 'browser';
  const showRightPanel = rightPanelVisible && (showInfoRail || showBrowserRail) && !drawerHostActive;
  const railBrowserActive = showBrowserRail && rightPanelVisible && !drawerHostActive;

  // AI 唤起浏览器 → 切到右栏常驻 (浮层会盖住当前页面, 常驻栏不会)。
  // 只在 chat 页改偏好: 非 chat 页本来就是浏览器模式, 改了等于污染 chat 的持久化值。
  useEffect(() => {
    if (hostVisible && hostIntent === 'auto') {
      if (page === 'chat') setRailMode('browser');
      setRightPanelVisible(true);
    }
  }, [hostVisible, hostIntent, hostOpenSeq, page]);

  // Ctrl+B: 切右栏浏览器模式 (原先在 Drawer 内部, 现在默认宿主是右栏, 快捷键归 App)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        if (page !== 'chat') {
          // 非 chat 页没有"信息"可选, Ctrl+B 只做显示/隐藏开关
          setRightPanelVisible(v => (railBrowserActive ? false : true));
          return;
        }
        const next = railMode === 'browser' ? 'info' : 'browser';
        setRailMode(next);
        if (next === 'browser') setRightPanelVisible(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [railMode, page, railBrowserActive]);

  // ═══ 侧栏可拖拽（2026-10-06 L-Batch 1）═══
  // 原为硬编码 width:260 / 320，1366px 屏下内容区只剩 786px 且无法调整。
  // 现在可拖拽 + 双击复位 + 键盘←→ 调整 + localStorage 持久化。
  const leftPane = useResizable({
    storageKey: 'agentai.pane.left.width',
    defaultWidth: 260, minWidth: 180, maxWidth: 480, side: 'right',
    enabled: showSessionSidebar,
  });
  const rightPane = useResizable({
    storageKey: 'agentai.pane.right.width',
    defaultWidth: 320, minWidth: 240, maxWidth: 560, side: 'left',
    enabled: showInfoRail,
  });
  // 浏览器模式独立记忆宽度 —— 320px 看网页太窄, 而且和"信息"栏的合理宽度不同量级
  const browserPane = useResizable({
    storageKey: 'agentai.pane.browser.width',
    defaultWidth: 520, minWidth: 320, maxWidth: 900, side: 'left',
    enabled: showBrowserRail && rightPanelVisible,
  });
  // 当前生效的把手/宽度: 两种模式共用一个 .pane-grip (不能出现第三根把手)。
  // 用 effectiveRailMode 而不是 railMode —— 非 chat 页内容恒为浏览器, 必须拿 browserPane
  const activePane = effectiveRailMode === 'browser' ? browserPane : rightPane;

  // 当前工作目录 (供 FileTreePanel 使用)
  const currentWorkspace = profile?.workspace || localStorage.getItem('agentai.workspace') || '';

/* --- 配置 antd 主题 (跟随 light/dark) --- */
// P2: 跟随系统模式 — 检测 OS 暗色偏好
const _systemDark = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
const _effectiveTheme = themeStyle === 'system' ? (_systemDark ? 'graphite' : 'sandstone') : themeStyle;
const isDark = ['graphite', 'midnight', 'ember'].includes(_effectiveTheme);
const accentColor = _effectiveTheme === 'midnight' ? '#8b6bff' : _effectiveTheme === 'ember' ? '#ff6b3d' : '#CD7A3A';

  /* ════════════════ 渲染 ════════════════ */
  /*
   * ╔═══════════════════════════════════════════════════════════════╗
   * ║ 构建vs开发一致性修复 (P0):                                   ║
   * ║ - StyleProvider + hashPriority="high"                        ║
   * ║   强制 antd 组件样式使用 :where(...) 高优先级选择器,        ║
   * ║   防止打包后 CSS 合并顺序变化导致样式被覆盖 → 出现框框按键  ║
   * ║ - layer = false: 关闭 antd v5 @layer 特性(部分打包器不兼容)║
   * ╚═══════════════════════════════════════════════════════════════╝
   */
  return (
    <StyleProvider hashPriority="high" layer={false}>
      <ConfigProvider
        locale={zhCN}
        theme={{
          algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
          // Antd 的 theme token 只接受 number, 不能传 CSS 变量 (对应 --radius-md = 8)
          token: { colorPrimary: accentColor, borderRadius: 8 },
          cssVar: { key: 'agentai-antd', prefix: 'agentai' },
          hashed: false,
        }}
      >
        <AntApp>
        {/* 外壳高度收进 .app-root (layout.css) —— 原 inline `height:'100vh'` **无 dvh 兜底**,
            Tauri 无边框窗口 / 移动端下 100vh 会含被动态视口遮掉的部分, 底栏被顶出可视区。 */}
        <div className="app-root">
        {/* ═══ 1. TitleBar (ZCode 风格: 紧凑 36px) ═══ */}
        <div className="app-titlebar">
          {/* 品牌 (精简: 小图标 + 文字) */}
          <div className="app-brand" style={{ gap: 4 }}>
            <BrandLogo size={20} />
            <span className="app-brand-name" style={{ fontSize: 'var(--fs-sm)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontWeight: 600, color: 'var(--fg)' }}>岐枢</span>
              <span style={{ opacity: 0.6, fontSize: 'var(--fs-micro)' }}>|</span>
              <span style={{ opacity: 0.8 }}>PulseFlow</span>
            </span>
          </div>

          {/* 主导航 Tab (分组: core 直接显示, media/system 下拉) */}
          <div style={{ display: 'flex', gap: 2, flex: 1, marginLeft: 16, overflow: 'visible', alignItems: 'center' }}>
            {/* Core 组: 直接显示 */}
            {PAGES.filter(p => p.group === 'core' && !p.hidden).map(p => (
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

            {/* 浏览器按钮 (切右栏常驻浏览器模式, 不切换页面) */}
            <Tooltip title="智能体浏览器 (Ctrl+B) — 右栏常驻, 任意页面可用">
              <span
                className={`app-tab browser-tab${railBrowserActive ? ' active' : ''}`}
                data-testid="open-browser"
                onClick={() => {
                  if (railBrowserActive) {
                    setRightPanelVisible(false);
                  } else {
                    // 只有 chat 页需要改偏好; 非 chat 页恒为浏览器模式, 改了会污染 chat 的持久化值
                    if (page === 'chat') setRailMode('browser');
                    setRightPanelVisible(true);
                  }
                }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <GlobalOutlined style={{ color: 'var(--accent)' }} />
                <span>浏览器</span>
              </span>
            </Tooltip>

            {/* Media 组: 内联下拉 (避免 Tauri transparent 模式下 antd Dropdown portal 不可见) */}
            <NavGroupDropdown
              label="创作"
              icon={<PictureOutlined />}
              active={PAGES.some(p => p.group === 'media' && p.key === page)}
              items={PAGES.filter(p => p.group === 'media' && !p.hidden).map(p => ({
                key: p.key, icon: p.icon, label: p.label, desc: p.desc, active: page === p.key,
              }))}
              onSelect={(k) => setPage(k as PageKey)}
            />

            {/* System 组: 内联下拉 (同上, 避免 portal 不可见) */}
            <NavGroupDropdown
              label="系统"
              icon={<AppstoreOutlined />}
              active={PAGES.some(p => p.group === 'system' && p.key === page)}
              items={PAGES.filter(p => p.group === 'system' && !p.hidden).map(p => ({
                key: p.key, icon: p.icon, label: p.label, desc: p.desc, active: page === p.key,
                section: p.section,
                badge: p.key === 'suggestions' && unreadSuggestionCount > 0 ? String(unreadSuggestionCount) : undefined,
              }))}
              onSelect={(k) => setPage(k as PageKey)}
            />
          </div>

{/* 模型选择 (TitleBar) */}
<div style={{ marginRight: 8 }}>
<ModelSelector mode="minimal" />
</div>

{/* 对话改图切换已移入 Composer 对话框内底部 */}

{/* 显示设置 (主题 + 字体) */}
          <Tooltip title="主题 & 字体大小">
            <Dropdown
              trigger={['click']}
              getPopupContainer={(trigger) => trigger.parentElement || document.body}
              menu={{
                items: [
                  {
                    key: 'theme-group',
                    type: 'group',
                    label: <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }}>主题</span>,
                    children: THEME_OPTIONS.map(t => ({
                      key: `theme-${t.value}`,
                      label: (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
                          <span style={{ width: 16, height: 16, borderRadius: 'var(--radius-sm)', background: t.swatch, border: '1px solid var(--border)' }} />
                          <span style={{ fontSize: 'var(--fs-sm)' }}>{t.label}</span>
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
                    label: <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }}>字体大小</span>,
                    children: (['small', 'medium', 'large', 'xlarge'] as FontSize[]).map(f => ({
                      key: `font-${f}`,
                      label: (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
                          <span style={{
                            fontSize: f === 'small' ? 11 : f === 'medium' ? 13 : f === 'large' ? 15 : 17,
                            color: 'var(--fg-2)',
                          }}>Aa</span>
                          <span style={{ fontSize: 'var(--fs-sm)' }}>{FONT_SIZE_MAP[f].label}</span>
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
                width: 30, height: 30, borderRadius: 'var(--radius-md)', cursor: 'pointer',
                color: 'var(--muted-2)', transition: 'all 0.15s ease',
              }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--card-hover)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                {isDark ? <SunOutlined style={{ fontSize: 'var(--fs-md)' }} /> : <MoonOutlined style={{ fontSize: 'var(--fs-md)' }} />}
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
                    width: 30, height: 30, borderRadius: 'var(--radius-md)', cursor: 'pointer',
                    color: sidebarVisible ? 'var(--accent)' : 'var(--muted-2)',
                    background: sidebarVisible ? 'var(--accent-soft)' : 'transparent',
                    transition: 'all 0.15s ease', marginLeft: 4,
                  }}>
                  {sidebarVisible ? <LeftOutlined style={{ fontSize: 'var(--fs-md)' }} /> : <RightOutlined style={{ fontSize: 'var(--fs-md)' }} />}
                </span>
              </Tooltip>
              <Tooltip title="右侧信息栏">
                <span onClick={() => setRightPanelVisible(v => !v)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 30, height: 30, borderRadius: 'var(--radius-md)', cursor: 'pointer',
                    color: rightPanelVisible ? 'var(--accent)' : 'var(--muted-2)',
                    background: rightPanelVisible ? 'var(--accent-soft)' : 'transparent',
                    transition: 'all 0.15s ease',
                  }}>
                  {rightPanelVisible ? <RightOutlined style={{ fontSize: 'var(--fs-md)' }} /> : <LeftOutlined style={{ fontSize: 'var(--fs-md)' }} />}
                </span>
              </Tooltip>
              <Tooltip title="文件树 (添加到上下文)">
                <span onClick={() => setFileTreeVisible(v => !v)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 30, height: 30, borderRadius: 'var(--radius-md)', cursor: 'pointer',
                    color: fileTreeVisible ? 'var(--accent)' : 'var(--muted-2)',
                    background: fileTreeVisible ? 'var(--accent-soft)' : 'transparent',
                    transition: 'all 0.15s ease',
                  }}>
                  <FolderOpenOutlined style={{ fontSize: 'var(--fs-md)' }} />
                </span>
              </Tooltip>
            </>
          )}

          {/* 用户菜单 — 「GitHub 仓库」「联系开发者」不是操作而是"关于",
              从标题栏两个独立图标收进用户菜单 (标题栏右区 3 控件 → 1) */}
          <Dropdown
            trigger={['click']}
            getPopupContainer={(trigger) => trigger.parentElement || document.body}
            menu={{
              items: [
                {
                  key: 'github',
                  icon: <GithubOutlined />,
                  label: (
                    <a href="https://github.com/pulseflow/platform" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>
                      GitHub 仓库
                    </a>
                  ),
                },
                {
                  key: 'contact',
                  icon: <WechatOutlined />,
                  label: '联系开发者',
                  onClick: () => setWechatModalVisible(true),
                },
              ],
            }}
          >
            <div
              data-testid="user-menu"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px',
                background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', marginLeft: 4,
                cursor: 'pointer',
              }}
            >
              <UserOutlined style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }} />
              <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-2)', fontWeight: 500 }}>
                {profile?.name || '游客'}
              </span>
              <DownOutlined style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }} />
            </div>
          </Dropdown>

          {/* Tauri 窗口控制按钮 (仅桌面端显示) */}
          {isTauriEnv && (
            <div style={{ display: 'flex', marginLeft: 'auto', alignItems: 'center', gap: 0 }}>
              {/* ── 🔄 更新徽章: 下载中/已就绪 显示 (Trae 风格) ── */}
              {['checking', 'downloading', 'ready'].includes(updaterStage) && (
                <Tooltip
                  title={
                    updaterStage === 'checking' ? '正在检查更新…' :
                    updaterStage === 'downloading' ? (
                      <span>
                        新版本 v{updaterPending?.version ?? ''} 下载中
                        {typeof updaterPending?.progress === 'number'
                          ? ` ${updaterPending.progress}%` : ''}
                        <br />
                        <span style={{ color: 'var(--muted)' }}>下载完成后关闭时自动安装</span>
                      </span>
                    ) :
                    updaterStage === 'ready' ? (
                      <span>
                        ✅ v{updaterPending?.version ?? ''} 已就绪
                        <br />
                        <span style={{ color: 'var(--muted)' }}>
                          点 × 关闭 → 弹确认安装重启
                        </span>
                      </span>
                    ) : ''
                  }
                >
                  <span
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      height: 22, padding: '0 8px', marginRight: 6,
                      border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
                      background: updaterStage === 'ready'
                        ? 'color-mix(in srgb, var(--accent) 12%, transparent)'
                        : 'var(--panel)',
                      color: updaterStage === 'ready' ? 'var(--accent)' : 'var(--muted)',
                      fontSize: 'var(--fs-micro)', lineHeight: 1, cursor: 'default',
                      userSelect: 'none',
                    }}
                    onClick={() => {
                      // ready 状态点击徽章直接弹关闭确认 (等同于点 ×)
                      if (updaterStage === 'ready') setShowUpdateCloseModal(true);
                    }}
                  >
                    <SyncOutlined spin={updaterStage === 'checking' || updaterStage === 'downloading'} />
                    {updaterStage === 'checking' && '检查更新'}
                    {updaterStage === 'downloading' && (
                      <>
                        下载
                        {typeof updaterPending?.progress === 'number'
                          ? `${updaterPending.progress}%` : '…'}
                      </>
                    )}
                    {updaterStage === 'ready' && (
                      <>
                        <DownloadOutlined style={{ marginLeft: 0 }} />
                        v{updaterPending?.version ?? ''} 就绪
                      </>
                    )}
                  </span>
                </Tooltip>
              )}

              <Tooltip title="最小化">
                <span
                  onClick={() => handleWindowAction('minimize')}
                  className="window-control-btn"
                  data-action="minimize"
                >
                  <MinusOutlined style={{ fontSize: 'var(--fs-micro)' }} />
                </span>
              </Tooltip>
              <Tooltip title="最大化">
                <span
                  onClick={() => handleWindowAction('toggle-maximize')}
                  className="window-control-btn"
                  data-action="maximize"
                >
                  <BorderOutlined style={{ fontSize: 'var(--fs-micro)' }} />
                </span>
              </Tooltip>
              <Tooltip title="关闭">
                <span
                  onClick={() => handleWindowAction('close')}
                  className="window-control-btn window-control-close"
                  data-action="close"
                >
                  <CloseOutlined style={{ fontSize: 'var(--fs-micro)' }} />
                </span>
              </Tooltip>
            </div>
          )}
        </div>

        {/* ═══ 2. 主区: 三栏 (ZCode 风格: 无面包屑，节省空间) ═══ */}
        <div className="app-main fade-in" key={page /* 切页时重启动画 */}>
          {/* Left: 全能侧栏 (PulseFlowSidebar — Sessions / Files / Tasks) */}
          {showSessionSidebar && (
            // 2026-10-06: 宽度改为可拖拽（useResizable），样式抽到 layout.css
            <div
              ref={leftPane.paneRef}
              className="app-pane app-pane-left"
              style={{ width: leftPane.width }}
            >
              {/* 拖拽把手：键盘可达（←→ 调整 / Home 复位），双击复位 */}
              <div
                ref={leftPane.gripRef}
                className={`pane-grip${leftPane.resizing ? ' is-dragging' : ''}`}
                role="separator"
                aria-orientation="vertical"
                aria-label="调整左侧栏宽度（方向键调整，双击复位）"
                aria-valuenow={leftPane.width}
                aria-valuemin={180}
                aria-valuemax={480}
                tabIndex={0}
                onKeyDown={leftPane.onGripKeyDown}
                onDoubleClick={leftPane.onGripDoubleClick}
              />
              <div className="app-pane-body">
              <PulseFlowSidebar
                width={leftPane.width}
                onFileOpen={(path: string) => {
                  // P0: 走 pending 机制, 避免 Editor 未挂载时事件丢失
                  setPage('editor');
                  setPendingFilePath(path);
                }}
              />
              </div>
            </div>
          )}

          {/* Center: 当前页 (P0-3: ErrorBoundary + P0-4: Suspense 骨架屏)
              ★ 页面壳层 (2026-10-12): **24 个页面在这里统一拿到 same 契约** ——
              `.page-shell` = height:100% + 纵向 flex + min-height:0 (溢出根因)。
              放在此处而不是逐个改 24 个页面的根节点: 渲染点只有这一个,
              改一处即全覆盖, 且新页面自动继承, 不会再分叉。
              Suspense 不产生 DOM 节点, 故骨架屏与页面同享这一层。 */}
          <div className="app-content">
            <PageShell>
            <ErrorBoundary key={page} onRetry={() => setPage(page)}>
              <Suspense fallback={<PageSkeleton />}>
          {/* 功能引导提示（非强制锁定） */}
          {currentPage?.requireSubscription ? (
            <FeatureGuide page={currentPage}>
              <currentPage.comp />
            </FeatureGuide>
          ) : currentPage?.comp ? (
                  <currentPage.comp />
                ) : (
                  <PageSkeleton />
                )}
              </Suspense>
            </ErrorBoundary>
            </PageShell>
          </div>

          {/* Right: 右栏 (信息 / 浏览器 双模式) */}
          {showRightPanel && (
            <div
              ref={activePane.paneRef}
              className="app-pane app-pane-right"
              style={{ width: activePane.width }}
            >
              {/* 右侧栏把手在左边，拖拽方向与鼠标相反（side: 'left'） */}
              <div
                ref={activePane.gripRef}
                className={`pane-grip${activePane.resizing ? ' is-dragging' : ''}`}
                role="separator"
                aria-orientation="vertical"
                aria-label="调整右侧栏宽度（方向键调整，双击复位）"
                aria-valuenow={activePane.width}
                aria-valuemin={effectiveRailMode === 'browser' ? 320 : 240}
                aria-valuemax={effectiveRailMode === 'browser' ? 900 : 560}
                tabIndex={0}
                onKeyDown={activePane.onGripKeyDown}
                onDoubleClick={activePane.onGripDoubleClick}
              />

              {/* 模式切换条 */}
              <div
                data-testid="rail-modes"
                style={{
                  display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
                  padding: '4px 6px', borderBottom: '1px solid var(--border)',
                }}
              >
                {page === 'chat' ? (
                  <>
                    <span
                      data-testid="rail-mode-info"
                      onClick={() => setRailMode('info')}
                      style={railTabStyle(railMode === 'info')}
                    >信息</span>
                    <span
                      data-testid="rail-mode-browser"
                      onClick={() => setRailMode('browser')}
                      style={railTabStyle(railMode === 'browser')}
                    >浏览器</span>
                  </>
                ) : (
                  // 非 chat 页只有浏览器模式 (见 showInfoRail 注释)
                  <span
                    data-testid="rail-mode-browser"
                    style={{ fontSize: 'var(--fs-micro)', fontWeight: 600, color: 'var(--fg-2)' }}
                  >浏览器</span>
                )}
                <span style={{ flex: 1 }} />
                {effectiveRailMode === 'browser' && (
                  <>
                    <Tooltip title="重新加载">
                      <span
                        data-testid="rail-browser-reload"
                        onClick={() => BrowserHost.reload()}
                        style={railIconStyle}
                      ><ReloadOutlined /></span>
                    </Tooltip>
                    <Tooltip title="在独立大窗打开 (会重新加载页面)">
                      <span
                        data-testid="rail-browser-expand"
                        onClick={() => BrowserHost.expand(browserHost.url || BrowserStateBus.getState().activeTabUrl)}
                        style={railIconStyle}
                      ><ExpandOutlined /></span>
                    </Tooltip>
                    <Tooltip title="关闭右栏">
                      <span
                        data-testid="rail-browser-close"
                        onClick={() => setRightPanelVisible(false)}
                        style={railIconStyle}
                      ><CloseOutlined /></span>
                    </Tooltip>
                  </>
                )}
              </div>

              {effectiveRailMode === 'browser' ? (
                // 浏览器自己滚 —— 外套不能再 overflow:auto, 否则出现双层滚动条
                <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex' }}>
                  <EmbeddedBrowser
                    key={browserHost.reloadSeq}
                    initialUrl={browserHost.url}
                    compact={true}
                    aiControlled={true}
                    autoScan={true}
                    zoom={1}
                    style={{ height: '100%', width: '100%' }}
                  />
                </div>
              ) : (
                <div className="app-pane-body">
                  <RightPanel />
                </div>
              )}
            </div>
          )}
        </div>

        {/* ═══ 4. StatusBar ═══ */}
        <div className="app-statusbar">
          <StatusBar />
          <GitStatusBar onClick={() => setGitPanelVisible(true)} />
        </div>

        {/* ═══ Git Panel ═══ */}
        <SimpleGitPanel visible={gitPanelVisible} onClose={() => setGitPanelVisible(false)} />

        {/* ═══ Terminal Panel ═══ */}
        <TerminalPanel 
          visible={terminalPanelVisible} 
          onClose={() => setTerminalPanelVisible(false)}
          tasks={terminalTasks}
          onClearTasks={() => terminalTaskManager.clearTasks()}
        />
      </div>

      {/* ═══ 5. 使用指南 Modal ═══ */}
      {guideVisible && <GuideModal onClose={() => setGuideVisible(false)} />}

      {/* ═══ 6. 沿用身份确认弹窗 ═══ */}
      <ReuseIdentityPrompt
        open={showReusePrompt}
        profile={profile}
        onReuse={handleReuseIdentity}
        onReset={handleResetIdentity}
        onClose={() => setShowReusePrompt(false)}
      />

      {/* ═══ 7. Onboarding Modal (首次启动 — 新颖身份设置) ═══ */}
      {showOnboarding && (
        <IdentityOnboarding
          onDone={() => {
            sessionStorage.setItem('agentai.onboarded', '1');
            setShowOnboarding(false);
          }}
        />
      )}

      {/* ═══ 7.5 环境检测向导 (缺失依赖时弹出) ═══ */}
      <SetupWizard visible={setupWizardVisible} onClose={() => setSetupWizardVisible(false)} />

      {/* ═══ 7.6 环境体检面板 (随时可查的完整依赖清单, 只读不安装) ═══ */}
      <Modal
        open={envPanelVisible}
        onCancel={() => setEnvPanelVisible(false)}
        footer={null}
        width={560}
        title="环境体检"
      >
        <EnvCheckPanel onClose={() => setEnvPanelVisible(false)} />
      </Modal>

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
          <WechatOutlined style={{ fontSize: 32, color: 'var(--wechat)' }} />
        </div>
        <h3 style={{ margin: '0 0 8px', fontSize: 'var(--fs-lg)', fontWeight: 600, color: 'var(--fg)' }}>
          联系开发者
        </h3>
        <p style={{ margin: '0 0 16px', fontSize: 'var(--fs-md)', color: 'var(--muted)' }}>
          扫描二维码添加微信，获取技术支持
        </p>
        <img
          src="/weixin.jpg"
          alt="开发者微信二维码"
          style={{
            width: 200,
            height: 200,
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)',
            marginBottom: 12,
          }}
        />
        <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--muted-2)' }}>
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

      {/* Splash 启动进入首页 (PulseFlow 极简 Logo + 标语; 停留约 3.5s, 可点击跳过) */}
      {splashVisible && (
        <Splash onFinish={() => setSplashVisible(false)} duration={3500} minDuration={2800} />
      )}

      {/* 全局浏览器侧栏 — 任何页面可用, AI 自动化核心能力 */}
      <GlobalBrowserDrawer />

      {/* ═══ 🔄 关闭时自动安装 Modal (Trae 风格) ═══ */}
      <Modal
        open={showUpdateCloseModal}
        onCancel={() => setShowUpdateCloseModal(false)}
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <DownloadOutlined style={{ color: 'var(--accent)' }} />
            新版本已下载完成
          </span>
        }
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setShowUpdateCloseModal(false)}>
              取消
            </Button>
            <Button onClick={handleCloseOnly}>
              仅关闭，下次启动安装
            </Button>
            <Button
              type="primary"
              loading={installingOnClose}
              icon={<DownloadOutlined />}
              onClick={handleCloseAndInstall}
            >
              关闭并自动安装重启
            </Button>
          </div>
        }
        width={520}
        maskClosable={false}
        destroyOnClose
      >
        <div style={{ padding: '4px 0 8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <div style={{
              fontSize: 36, lineHeight: 1,
              color: 'var(--accent)',
              padding: '10px 14px',
              borderRadius: 'var(--radius-lg)',
              background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
            }}>
              <DownloadOutlined />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{
                fontSize: 'var(--fs-lg)', fontWeight: 600, marginBottom: 4,
                color: 'var(--fg)',
              }}>
                PulseFlow {updaterPending?.version ?? '新版本'} ·{' '}
                <span style={{ color: 'var(--muted)', fontWeight: 500 }}>
                  {updaterPending?.date || ''}
                </span>
              </div>
              <div style={{ fontSize: 'var(--fs-md)', color: 'var(--muted-2)' }}>
                安装包 {updaterPending?.bytes ? `${Math.max(1, Math.round(updaterPending.bytes / 1048576))} MB` : ''}
                 · 安装后自动重启
              </div>
            </div>
          </div>

          <Alert
            type="info"
            showIcon
            icon={<InfoCircleOutlined />}
            message="和 Trae 一样：关闭应用时自动安装"
            description="点击 [关闭并自动安装重启]，安装完成后应用会自动重新启动，无需手动重新打开。如果你想下次启动再装，选择 [仅关闭，下次启动安装]。"
            style={{ borderRadius: 'var(--radius-md)', marginBottom: 14 }}
          />

          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 12px',
            border: '1px dashed var(--border)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--fs-md)',
            color: 'var(--fg)',
            background: 'color-mix(in srgb, var(--panel) 50%, transparent)',
          }}>
            <Checkbox
              checked={autoInstallOnClose}
              onChange={(e) =>
                useUpdaterStore.getState().setAutoInstallOnClose(Boolean(e.target?.checked))}
            >
              以后关闭时自动安装（不再询问）
            </Checkbox>
          </div>
        </div>
      </Modal>

        </AntApp>
      </ConfigProvider>
    </StyleProvider>
  );
};


