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
import zhCN from 'antd/locale/zh_CN';
import {
  MessageOutlined, EditOutlined, PictureOutlined, VideoCameraOutlined,
  CodeOutlined, AppstoreOutlined, RobotOutlined, MessageOutlined as QQIcon,
  SettingOutlined, BgColorsOutlined, UserOutlined, ThunderboltOutlined,
  ExperimentOutlined, PartitionOutlined, SmileOutlined, GithubOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined, InfoCircleOutlined, BulbOutlined,
  LeftOutlined, RightOutlined, SunOutlined, MoonOutlined, BookOutlined,
  WechatOutlined, ClockCircleOutlined, BellOutlined, MedicineBoxOutlined,
  DownOutlined, CheckCircleFilled, FolderOpenOutlined, DashboardOutlined, SyncOutlined,
  GlobalOutlined, MinusOutlined, BorderOutlined, CloseOutlined, MobileOutlined,
  HomeOutlined,
} from '@ant-design/icons';
/* P0-4: 代码分割 — 首屏组件同步加载，其他页面延迟加载 */
// 首屏核心组件 - 同步导入避免骨架屏等待
import { ChatView } from './components/ChatView';

// 其他页面组件 - 懒加载
const WritePage = lazy(() => import('./components/WritePage').then(m => ({ default: m.WritePage })));
const ImageGen = lazy(() => import('./components/ImageGen').then(m => ({ default: m.ImageGen })));
const ImageStudio = lazy(() => import('./components/ImageStudio').then(m => ({ default: m.ImageStudio })));
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
const AutomationPanel = lazy(() => import('./components/AutomationPanel').then(m => ({ default: m.AutomationPanel })));
const TaskCenterPanel = lazy(() => import('./components/TaskCenterPanel').then(m => ({ default: m.TaskCenterPanel })));
const EvolutionPanel = lazy(() => import('./components/EvolutionPanel').then(m => ({ default: m.EvolutionPanel })));
const SandboxRulesEditor = lazy(() => import('./components/SandboxRulesEditor').then(m => ({ default: m.SandboxRulesEditor })));
const KnowledgeGraphPanel = lazy(() => import('./components/knowledge/KnowledgeGraphPanel').then(m => ({ default: m.default })));
const MonitoringPanel = lazy(() => import('./components/MonitoringPanel').then(m => ({ default: m.default })));
const KnowledgeDashboard = lazy(() => import('./components/KnowledgeDashboard').then(m => ({ default: m.KnowledgeDashboard })));
import { RightPanel } from './components/RightPanel';
import { PulseFlowSidebar } from './components/PulseFlowSidebar';
import { GuideModal } from './components/GuideModal';
import { StatusBar } from './components/StatusBar';
import { GitStatusBar } from './components/GitStatusBar';
import { SimpleGitPanel } from './components/SimpleGitPanel';  // 使用简化版 Git 面板
import { TerminalPanel, terminalTaskManager, TerminalTask } from './components/TerminalPanel';  // 终端任务面板
import { Onboarding } from './components/Onboarding';
import { SetupWizard } from './components/SetupWizard';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PageSkeleton } from './components/PageSkeleton';
import { useProfileStore, UserProfile } from './store';
import { useSessionStore } from './store/sessionStore';
import { useModeStore, MODE_CONFIG, MODE_ORDER } from './store/modeStore';
import { useFontSizeStore, FONT_SIZE_MAP, type FontSize } from './store';
import { useModelStore } from './store/modelStore';
import { ModelSelector } from './components/ModelSelector';
import { gatewayFallback } from './services/GatewayFallback';
import FloatingSuggestionToast from './components/FloatingSuggestionToast';
import { useSuggestionSSE } from './hooks/useSuggestionSSE';
import { useSuggestionStore } from './store/suggestionStore';
import { Splash } from './components/Splash';
import { ReuseIdentityPrompt } from './components/ReuseIdentityPrompt';
import { GlobalBrowserDrawer, openGlobalBrowser } from './components/GlobalBrowserDrawer';
import { useIdeState } from './hooks/useIdeState';

// 暴露到 window, 顶部导航按钮可调用
if (typeof window !== 'undefined') {
  (window as any).openGlobalBrowser = openGlobalBrowser;
}

/* ════════════════ 对话改图切换按钮 ════════════════ */
const ChatModeToggle: React.FC = () => {
  const { chatMode, setChatMode, models, activeModelId, setActive } = useModelStore();
  
  // 切换按钮始终显示: 用户可随时切换回普通对话模式 (即使当前模型不支持图片)
  const isImageMode = chatMode === 'image_edit';
  
  const handleToggle = () => {
    const newMode = isImageMode ? 'chat' : 'image_edit';
    setChatMode(newMode);
    
    // 切换到图片模式时，自动选择支持图片的模型
    if (newMode === 'image_edit') {
      const imageModels = models.filter(m => 
        m.capabilities?.includes('image') || 
        m.capabilities?.includes('multimodal') ||
        ['zhipu', 'doubao-chat', 'qwen-chat', 'longcat-2.0'].includes(m.id)
      );
      if (imageModels.length > 0 && !imageModels.find(m => m.id === activeModelId)) {
        setActive(imageModels[0].id);
      }
    }
  };
  
  return (
    <Tooltip title={isImageMode ? '切换回普通对话' : '切换到对话改图模式'}>
      <span
        onClick={handleToggle}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 30, height: 30, borderRadius: 6, cursor: 'pointer',
          color: isImageMode ? 'var(--accent)' : 'var(--muted-2)',
          background: isImageMode ? 'var(--accent-soft)' : 'transparent',
          transition: 'all 0.15s ease', marginRight: 8,
          fontSize: 16,
        }}
      >
        🎨
      </span>
    </Tooltip>
  );
};

/* ════════════════ PAGES (图标 + 标签 + 渲染) ════════════════ */
type PageKey = 'chat' | 'write' | 'image' | 'video' | '3d' | 'pascal' | 'editor' | 'skills' | 'cleaner' | 'qq' | 'wechat' | 'knowledge' | 'settings' | 'schedule' | 'notification' | 'workflow' | 'suggestions' | 'governor' | 'xuanji' | 'automation' | 'tasks' | 'stats' | 'evolution' | 'sandbox' | 'knowledge-graph' | 'external-connections' | 'monitoring' | 'knowledge-explore';

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
const StatsPanel = lazy(() => import('./components/StatsPanel').then(m => ({ default: m.StatsPanel })));
const ExternalConnectionsPanel = lazy(() => import('./components/ExternalConnectionsPanel').then(m => ({ default: m.ExternalConnectionsPanel })));
const PascalEditor = lazy(() => import('./components/PascalEditor').then(m => ({ default: m.PascalEditor })));

const PAGES: PageMeta[] = [
  { key: 'chat',     label: '对话',     icon: <MessageOutlined />,    comp: ChatView,      group: 'core',   desc: '智能对话 · 多模型 · 工具调用' },
  { key: 'editor',   label: '编辑器',   icon: <CodeOutlined />,       comp: Editor,        group: 'core',   desc: '代码编辑 · 改写 · 文件管理' },
  { key: 'xuanji',   label: '医案',     icon: <MedicineBoxOutlined />, comp: XuanjiPanel,   group: 'core',   desc: '四诊合参 · 辨证论治 · 经验积累', badge: 'NEW' },
  { key: 'external-connections', label: '外部连接', icon: <MobileOutlined />, comp: ExternalConnectionsPanel, group: 'system', desc: 'Android 设备 · SketchUp · 公众号自动化', badge: 'NEW' },
  { key: 'image',    label: '生图',     icon: <PictureOutlined />,    comp: ImageStudio,   group: 'media',  desc: 'AI 图像工作室 · 5种创作模式' },
  { key: 'video',    label: '生视频',   icon: <VideoCameraOutlined />,comp: VideoGen,      group: 'media',  desc: '文生视频 · 图生视频 · 首尾帧' },
  { key: '3d',       label: '3D建模',   icon: <AppstoreOutlined />,   comp: Model3DGen,    group: 'media',  desc: '文/图生3D · 混元 · 豆包' },
  { key: 'pascal',   label: '建筑编辑', icon: <HomeOutlined />,       comp: PascalEditor,  group: 'media',  desc: 'AI 驱动 3D 建筑模型 · 墙体/门窗/屋顶', badge: 'NEW' },
  { key: 'write',    label: '写作',     icon: <EditOutlined />,       comp: WritePage,     group: 'media',  desc: '长文写作 · 模板 · 一键导出' },
  { key: 'skills',   label: '技能库',   icon: <AppstoreOutlined />,   comp: SkillLibrary,  group: 'system', desc: '25+ 技能 · 7 分类' },
  { key: 'cleaner',  label: '智能清理', icon: <ThunderboltOutlined />,comp: CleanerPanel,  group: 'system', desc: '扫描 / 分类 / 安全清理' },
  { key: 'qq',       label: 'QQ Bot',   icon: <QQIcon />,             comp: QQBotPanel,    group: 'system', desc: '反向 WS · 自动回复' },
  { key: 'wechat',   label: '微信',     icon: <SmileOutlined />,      comp: WechatSetup,   group: 'system', desc: 'ClawBot 插件 · 扫码绑定' },
  { key: 'knowledge', label: '知识库', icon: <BookOutlined />,       comp: KnowledgeBasePanel, group: 'system', desc: '行业知识库 · 文档上传 · BM25 检索' },
  { key: 'schedule',     label: '定时任务', icon: <ClockCircleOutlined />, comp: SchedulePanel,     group: 'system', desc: 'Cron 调度 · RPA 定时回放 · AI 任务自动化' },
  { key: 'automation',   label: '自动化',   icon: <ThunderboltOutlined />, comp: AutomationPanel, group: 'system', desc: '定时任务管理 · 成功率统计 · 执行监控', badge: 'NEW' },
  { key: 'workflow',     label: '工作流',   icon: <PartitionOutlined />,   comp: WorkflowPanel,     group: 'system', desc: 'DAG 多步骤自动化 · 行业模板 · 变量管道' },
  { key: 'notification', label: '通知中心', icon: <BellOutlined />,        comp: NotificationPanel, group: 'system', desc: 'SSE · Webhook · 邮件 · 桌面弹窗' },
  { key: 'suggestions', label: '主动建议', icon: <BulbOutlined />,       comp: ProactiveSuggestionsPanel, group: 'system',   desc: '🎯 智能需求预判 · 行业知识链 · 资源瓶颈预判 · 决策支持' },
  { key: 'governor', label: '管控员',   icon: <DashboardOutlined />,  comp: GovernorPanel, group: 'system', desc: '动态能力矩阵 · 系统健康 · 模型治理' },
  { key: 'stats',    label: '用量',     icon: <ThunderboltOutlined />, comp: StatsPanel,    group: 'system', desc: '工具调用统计 · 成功率 · 省时报告', badge: 'NEW' },
  { key: 'tasks',    label: '任务中心', icon: <SyncOutlined />,       comp: TaskCenterPanel, group: 'system', desc: '长任务快照 · 跨会话恢复 · 进度跟踪', badge: 'NEW' },
  { key: 'evolution', label: '自进化',  icon: <ExperimentOutlined />, comp: EvolutionPanel,  group: 'system', desc: '跨会话规则自修改 · 技能自动创建 · 行为优化', badge: 'NEW' },
  { key: 'sandbox',   label: '沙箱规则', icon: <PartitionOutlined />, comp: SandboxRulesEditor, group: 'system', desc: '可视化编辑沙箱规则的 deny/prompt/allow' },
  { key: 'knowledge-graph', label: '知识图谱', icon: <BulbOutlined />, comp: KnowledgeGraphPanel, group: 'system', desc: '知识关系可视化 · 实体链接 · 概念网络' },
  { key: 'monitoring', label: '监控面板', icon: <DashboardOutlined />, comp: MonitoringPanel, group: 'system', desc: '进化系统 · 审批策略 · 反馈闭环 实时监控', badge: 'NEW' },
  { key: 'knowledge-explore', label: '知识探索', icon: <ExperimentOutlined />, comp: KnowledgeDashboard, group: 'system', desc: 'AI 自主学习 · GitHub 探索 · 知识蒸馏', badge: 'NEW' },
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
  const [gitPanelVisible, setGitPanelVisible] = useState(false);
  const [terminalPanelVisible, setTerminalPanelVisible] = useState(false);
  const [terminalTasks, setTerminalTasks] = useState<TerminalTask[]>([]);
  const { fontSize, setFontSize } = useFontSizeStore();

  // Tauri 环境检测 (用于显示窗口控制按钮)
  const isTauriEnv = !!(window as any).__TAURI_INTERNALS__ || window.location.protocol === 'tauri:';

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
        case 'close': await win.close(); break;
      }
    } catch (e) {
      console.warn('[App] Window action failed:', e);
    }
  }, [isTauriEnv]);

  /* ✨ 全局建议 SSE 连接 + 未读计数 */
  useSuggestionSSE();
  useIdeState();  // 编辑器上下文感知: 推送当前文件/光标到 Gateway
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
    const dark = THEME_OPTIONS.find(t => t.value === themeStyle)?.value === 'graphite' || themeStyle === 'midnight' || themeStyle === 'ember';
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    root.setAttribute('data-theme-style', themeStyle);

    // 字体大小
    const fontCfg = FONT_SIZE_MAP[fontSize] || FONT_SIZE_MAP.medium;
    root.style.setProperty('--font-scale', String(fontCfg.scale));
    root.style.setProperty('--font-base', fontCfg.cssBase);
    root.style.fontSize = fontCfg.cssBase;
  }, [themeStyle, fontSize]);

  /* --- 启动网关健康检测 + 同步工作目录 + 加载模型密钥 --- */
  useEffect(() => {
    gatewayFallback.start();

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
              console.log('[workspace] synced from gateway:', data.cwd);
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
                console.log(`[keys] loaded ${provider}: ${keyData.envVar}`);
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
          console.log('[models] dynamic models loaded from backend');
        } catch (e) {
          console.warn('[models] failed to load dynamic models:', e);
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

  /* --- 监听打开使用指南事件 (左侧栏底部入口触发) --- */
  useEffect(() => {
    const handler = () => setGuideVisible(true);
    window.addEventListener('agentai:show-guide', handler);
    return () => window.removeEventListener('agentai:show-guide', handler);
  }, []);

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

  /* --- 首次启动环境检测 (仅 Tauri 桌面端打包后生效) --- */
  useEffect(() => {
    // 开发环境 (Vite dev server) 不检测, 避免开发时误弹
    const isTauri = !!(window as any).__TAURI_INTERNALS__ || window.location.protocol === 'tauri:' || window.location.port === '1420';
    if (!isTauri) return;
    if (localStorage.getItem('agentai.setupChecked')) return;
    const timer = setTimeout(async () => {
      // ⚠️ 关键修复: 必须用 GATEWAY_HTTP 绝对路径, 不能用相对路径!
      // 相对路径 /v1/... 在 Tauri 打包后 → tauri://localhost/v1/... → 404 (因为 Gateway 还没启动)
      // 等待 GatewayFallback 先尝试自启 Gateway (quickStartGateway 在 gatewayFallback.start() 中调用)
      const { GATEWAY_HTTP } = await import('./services/config');
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
      // 安全守护: H11 修复 — 端口改为 18789（gateway 默认端口），不再硬编码错误端口
      const GATEWAY_HTTP = (window as any).__GATEWAY_HTTP__
        || `http://${window.location.hostname}:18789`;
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
        {/* ═══ 1. TitleBar (ZCode 风格: 紧凑 36px) ═══ */}
        <div className="app-titlebar">
          {/* 品牌 (精简: 小图标 + 文字) */}
          <div className="app-brand" style={{ gap: 4 }}>
            <img src="./favicon-32.png" alt="岐枢"
              style={{ width: 20, height: 20, borderRadius: 4 }} />
            <span className="app-brand-name" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontWeight: 600, color: 'var(--fg)' }}>岐枢</span>
              <span style={{ opacity: 0.6, fontSize: 10 }}>|</span>
              <span style={{ opacity: 0.8 }}>PulseFlow</span>
            </span>
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

            {/* 浏览器按钮 (唤起 Drawer, 不切换页面) */}
            <Tooltip title="智能体浏览器 (Ctrl+B) — 任意页面可用">
              <span
                className="app-tab browser-tab"
                data-testid="open-browser"
                onClick={() => (window as any).openGlobalBrowser?.()}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <GlobalOutlined style={{ color: 'var(--accent)' }} />
                <span>浏览器</span>
              </span>
            </Tooltip>

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

          {/* 对话改图切换按钮 */}
          <ChatModeToggle />

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

          {/* Tauri 窗口控制按钮 (仅桌面端显示) */}
          {isTauriEnv && (
            <div style={{ display: 'flex', marginLeft: 'auto', gap: 0 }}>
              <Tooltip title="最小化">
                <span
                  onClick={() => handleWindowAction('minimize')}
                  className="window-control-btn"
                  data-action="minimize"
                >
                  <MinusOutlined style={{ fontSize: 11 }} />
                </span>
              </Tooltip>
              <Tooltip title="最大化">
                <span
                  onClick={() => handleWindowAction('toggle-maximize')}
                  className="window-control-btn"
                  data-action="maximize"
                >
                  <BorderOutlined style={{ fontSize: 11 }} />
                </span>
              </Tooltip>
              <Tooltip title="关闭">
                <span
                  onClick={() => handleWindowAction('close')}
                  className="window-control-btn window-control-close"
                  data-action="close"
                >
                  <CloseOutlined style={{ fontSize: 11 }} />
                </span>
              </Tooltip>
            </div>
          )}
        </div>

        {/* ═══ 2. 主区: 三栏 (ZCode 风格: 无面包屑，节省空间) ═══ */}
        <div className="app-main fade-in" key={page /* 切页时重启动画 */}>
          {/* Left: 全能侧栏 (PulseFlowSidebar — Sessions / Files / Tasks) */}
          {showSessionSidebar && (
            <div style={{ width: 260, borderRight: '1px solid var(--border)', background: 'var(--panel)', overflow: 'auto', flexShrink: 0 }}>
              <PulseFlowSidebar
                width={260}
                onFileOpen={(path: string) => {
                  // Open file in editor mode
                  setPage('editor');
                  window.dispatchEvent(new CustomEvent('agentai:open-file', { detail: { path } }));
                }}
              />
            </div>
          )}

          {/* Center: 当前页 (P0-3: ErrorBoundary + P0-4: Suspense 骨架屏) */}
          <div className="app-content">
            <ErrorBoundary key={page} onRetry={() => setPage(page)}>
              <Suspense fallback={<PageSkeleton />}>
                {currentPage?.comp ? <currentPage.comp /> : <PageSkeleton />}
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
          src="./weixin.jpg"
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

      {/* Splash 启动欢迎页 (PulseFlow v2, 3600ms 多阶段动画) */}
      {splashVisible && (
        <Splash onFinish={() => setSplashVisible(false)} duration={3600} />
      )}

      {/* 全局浏览器侧栏 — 任何页面可用, AI 自动化核心能力 */}
      <GlobalBrowserDrawer />

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


