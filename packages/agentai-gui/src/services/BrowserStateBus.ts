// @ts-nocheck
/**
 * BrowserStateBus — 全局浏览器状态总线
 * ==========================================
 *
 * 设计目标: 让"编辑器 AI 对话"能够实时控制浏览器
 *   核心问题: EditorChatPanel / GlobalBrowserDrawer / ChatView 是不同的组件,
 *             但它们都需要访问**同一个浏览器实例**的状态
 *
 *   解决方案: 单例 EventBus + 全局 state
 *     - EmbeddedBrowser 状态变化 → publish(url, elements, screenshot)
 *     - EditorChatPanel 订阅 → 注入 system context 给 LLM
 *     - ChatView 订阅 → 显示当前页面
 *
 *   工作流程:
 *     1. EmbeddedBrowser 加载 URL → bus.setUrl()
 *     2. EmbeddedBrowser 扫描元素 → bus.setElements()
 *     3. EmbeddedBrowser 截图 → bus.setScreenshot()
 *     4. EditorChatPanel 接收用户消息 → 注入当前状态到 LLM context
 *     5. LLM 决定调用 browser_click → 实际是调 bus.click(selector)
 *     6. EmbeddedBrowser 执行点击 → 状态变化 → bus 更新 → LLM 看到结果
 *
 * v3.2 (2026-07-15) 新增
 */
import type { IdentifiedElement } from './EmbeddedBrowser';

export interface BrowserState {
  // 标签页
  activeTabId: string;
  activeTabUrl: string;
  activeTabTitle: string;
  tabs: { id: string; url: string; title: string; loading: boolean }[];

  // 页面状态
  pageTitle: string;
  pageFavicon: string;
  pageLoading: boolean;

  // 元素
  elements: IdentifiedElement[];
  elementsScannedAt: number;

  // 截图
  lastScreenshot: string | null;  // base64 data URL
  screenshotAt: number;

  // RPA 录制
  recording: boolean;
  recordStepCount: number;

  // Playwright 状态
  playwrightMode: boolean;
  playwrightConnected: boolean;
  playwrightEngineStatus: 'idle' | 'running' | 'starting';

  // 操作历史 (最近 20 条, 用于 AI 上下文)
  actionHistory: ActionRecord[];

  // 时间戳
  updatedAt: number;
}

export interface ActionRecord {
  ts: number;
  action: 'navigate' | 'click' | 'type' | 'screenshot' | 'scan' | 'back' | 'forward' | 'reload' | 'switch_tab';
  target?: string;       // URL / selector / etc
  result: 'success' | 'error' | 'pending';
  message?: string;
  durationMs?: number;
}

type Listener = (state: BrowserState) => void;
type ActionListener = (action: ActionRecord) => void;

const STORAGE_KEY = 'agentai.browserStateBus';

class BrowserStateBusImpl {
  private state: BrowserState = {
    activeTabId: '',
    activeTabUrl: '',
    activeTabTitle: '',
    tabs: [],
    pageTitle: '',
    pageFavicon: '',
    pageLoading: false,
    elements: [],
    elementsScannedAt: 0,
    lastScreenshot: null,
    screenshotAt: 0,
    recording: false,
    recordStepCount: 0,
    playwrightMode: true,
    playwrightConnected: false,
    playwrightEngineStatus: 'idle',
    actionHistory: [],
    updatedAt: 0,
  };

  private listeners = new Set<Listener>();
  private actionListeners = new Set<ActionListener>();

  // ───────────────────────────────────────────────────────────
  //  状态读取
  // ───────────────────────────────────────────────────────────
  getState(): BrowserState {
    return { ...this.state };
  }

  // ───────────────────────────────────────────────────────────
  //  状态写入 (发布订阅)
  // ───────────────────────────────────────────────────────────
  update(partial: Partial<BrowserState>): void {
    this.state = { ...this.state, ...partial, updatedAt: Date.now() };
    this.persist();
    this.notify();
  }

  setUrl(url: string, title?: string): void {
    this.update({ activeTabUrl: url, pageTitle: title || this.state.pageTitle });
  }

  setPageTitle(title: string): void {
    this.update({ pageTitle: title, activeTabTitle: title });
  }

  setPageLoading(loading: boolean): void {
    this.update({ pageLoading: loading });
  }

  setElements(elements: IdentifiedElement[]): void {
    this.update({ elements, elementsScannedAt: Date.now() });
  }

  setScreenshot(dataUrl: string | null): void {
    this.update({ lastScreenshot: dataUrl, screenshotAt: dataUrl ? Date.now() : 0 });
  }

  setTabs(tabs: BrowserState['tabs'], activeId: string): void {
    const active = tabs.find(t => t.id === activeId);
    this.update({
      tabs,
      activeTabId: activeId,
      activeTabUrl: active?.url || '',
      activeTabTitle: active?.title || '',
      pageTitle: active?.title || this.state.pageTitle,
    });
  }

  setRecording(recording: boolean, stepCount: number = 0): void {
    this.update({ recording, recordStepCount: stepCount });
  }

  setPlaywright(mode: boolean, connected: boolean, status: BrowserState['playwrightEngineStatus']): void {
    this.update({ playwrightMode: mode, playwrightConnected: connected, playwrightEngineStatus: status });
  }

  // ───────────────────────────────────────────────────────────
  //  动作历史
  // ───────────────────────────────────────────────────────────
  recordAction(action: ActionRecord['action'], opts: Partial<ActionRecord> = {}): void {
    const rec: ActionRecord = {
      ts: Date.now(),
      action,
      result: 'pending',
      ...opts,
    };
    const history = [rec, ...this.state.actionHistory].slice(0, 20);
    this.update({ actionHistory: history });
    this.actionListeners.forEach(fn => fn(rec));
    return rec as any;
  }

  updateLastAction(result: ActionRecord['result'], message?: string): void {
    const history = [...this.state.actionHistory];
    if (history.length === 0) return;
    history[0] = { ...history[0], result, message, durationMs: history[0].durationMs ?? (Date.now() - history[0].ts) };
    this.update({ actionHistory: history });
  }

  // ───────────────────────────────────────────────────────────
  //  订阅
  // ───────────────────────────────────────────────────────────
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    // 立即推送当前状态
    fn(this.getState());
    return () => this.listeners.delete(fn);
  }

  subscribeActions(fn: ActionListener): () => void {
    this.actionListeners.add(fn);
    return () => this.actionListeners.delete(fn);
  }

  private notify(): void {
    const snapshot = this.getState();
    this.listeners.forEach(fn => fn(snapshot));
  }

  private persist(): void {
    try {
      // 只持久化轻量数据 (不存截图 base64, 太长)
      const light: Partial<BrowserState> = {
        activeTabId: this.state.activeTabId,
        activeTabUrl: this.state.activeTabUrl,
        activeTabTitle: this.state.activeTabTitle,
        tabs: this.state.tabs,
        pageTitle: this.state.pageTitle,
        recording: this.state.recording,
        recordStepCount: this.state.recordStepCount,
        playwrightMode: this.state.playwrightMode,
        actionHistory: this.state.actionHistory.slice(0, 5),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(light));
    } catch { /* quota exceeded, ignore */ }
  }

  hydrate(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      this.state = { ...this.state, ...data };
    } catch { /* ignore */ }
  }
}

export const BrowserStateBus = new BrowserStateBusImpl();
if (typeof window !== 'undefined') {
  (window as any).__browserStateBus = BrowserStateBus;
  // 启动时从 localStorage 恢复
  BrowserStateBus.hydrate();
}

/* ════════════════════════════════════════════════════════════
 *  React Hook 封装
 * ════════════════════════════════════════════════════════════ */
import { useEffect, useState } from 'react';

export function useBrowserState(): BrowserState {
  const [state, setState] = useState<BrowserState>(() => BrowserStateBus.getState());
  useEffect(() => {
    return BrowserStateBus.subscribe(setState);
  }, []);
  return state;
}

export function useBrowserActions(): ActionRecord[] {
  const [history, setHistory] = useState<ActionRecord[]>(() => BrowserStateBus.getState().actionHistory);
  useEffect(() => {
    return BrowserStateBus.subscribe(state => setHistory(state.actionHistory));
  }, []);
  return history;
}

/* ════════════════════════════════════════════════════════════
 *  上下文注入: 把当前浏览器状态格式化为 LLM 上下文
 * ════════════════════════════════════════════════════════════ */
export function buildBrowserContext(state: BrowserState, maxElements: number = 15): string {
  const lines: string[] = [];
  lines.push(`## 🌐 浏览器实时状态 (v3.2 自动注入)`);

  if (state.activeTabUrl) {
    lines.push(`- **当前页面**: ${state.pageTitle || '(无标题)'}`);
    lines.push(`- **URL**: ${state.activeTabUrl}`);
    if (state.pageLoading) lines.push(`- **状态**: 加载中...`);
  } else {
    lines.push(`- **当前页面**: 未打开任何网页`);
  }

  if (state.tabs.length > 1) {
    lines.push(`- **打开的标签页 (${state.tabs.length})**: ${state.tabs.map(t => `${t.id === state.activeTabId ? '📍' : '·'} ${t.title || t.url}`).join(', ')}`);
  }

  // 元素列表 (只列可交互的, 限制数量)
  if (state.elements.length > 0) {
    const interactives = state.elements
      .filter(e => e.interactivity >= 60)
      .slice(0, maxElements);
    if (interactives.length > 0) {
      lines.push(`\n**可交互元素 (${interactives.length} 个, 按重要性排序)**:`);
      interactives.forEach((e, i) => {
        const desc = [
          e.text ? `"${e.text}"` : null,
          e.placeholder ? `placeholder="${e.placeholder}"` : null,
          e.href ? `→ ${e.href.slice(0, 50)}` : null,
          e.tag,
        ].filter(Boolean).join(' ');
        lines.push(`  ${i + 1}. [${e.tag}] ${desc} (selector: \`${e.selector}\`)`);
      });
    }
  } else if (state.activeTabUrl) {
    lines.push(`\n⚠️ **元素未扫描**: 让 AI 调用 browser_scan 或等待自动扫描`);
  }

  // Playwright 状态
  if (state.playwrightMode) {
    lines.push(`\n- **执行模式**: Playwright (${state.playwrightConnected ? '✅ 已连接' : '❌ 未连接'})`);
  } else {
    lines.push(`\n- **执行模式**: 浏览器内嵌 iframe`);
  }

  // 最近动作
  if (state.actionHistory.length > 0) {
    const recent = state.actionHistory.slice(0, 5);
    lines.push(`\n**最近操作**:`);
    recent.forEach(a => {
      const icon = a.result === 'success' ? '✅' : a.result === 'error' ? '❌' : '⏳';
      const target = a.target ? ` → ${String(a.target).slice(0, 40)}` : '';
      const msg = a.message ? ` (${a.message.slice(0, 30)})` : '';
      lines.push(`  ${icon} ${a.action}${target}${msg}`);
    });
  }

  // RPA 录制
  if (state.recording) {
    lines.push(`\n🎬 **RPA 录制中** (${state.recordStepCount} 步)`);
  }

  lines.push(`\n💡 可用工具: browser_navigate / browser_click / browser_type / browser_screenshot / browser_scan`);

  return lines.join('\n');
}
