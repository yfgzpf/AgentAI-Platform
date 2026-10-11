/**
 * browser-host.ts — 全局浏览器「宿主」状态总线 (单例 + 订阅)
 * ==========================================================
 *
 * 为什么需要它 (2026-10-11):
 *   浏览器实例 (EmbeddedBrowser) 现在有两个可能的宿主 —— 右侧栏常驻 (rail) 与
 *   右侧抽屉 (Drawer)。EmbeddedBrowser 内部会往 socket `/browser` 命名空间 subscribe 收帧,
 *   两个宿主各自监听同一批 window 事件 → "双开 + 双导航 + 双倍订阅"。
 *   所以把"该不该显示 / 显示在哪个宿主 / 谁的 URL / AI 是否在操作"收敛到本单例,
 *   window 监听全项目只装一份, 宿主组件只做渲染。
 *
 * 与 BrowserStateBus 的分工:
 *   - BrowserStateBus = 浏览器**页面**状态 (url / 元素 / 截图), 由 EmbeddedBrowser 上报
 *   - browser-host    = 浏览器**宿主**状态 (可见性 / 宿主选择 / AI 活跃 / 缩放), 由事件与 App 驱动
 *
 * 事件来源 (与迁移前 GlobalBrowserDrawer 逐条对齐, 语义未改):
 *   pulseflow:browser:open      → 打开 (auto 宿主)
 *   pulseflow:browser:navigate  → 打开并记录 URL
 *   pulseflow:browser:ai-start  → AI 正在操作 (30s 兜底隐藏)
 *   pulseflow:browser:ai-end    → AI 结束
 *   pulseflow:browser:close     → 关闭
 *   agentai:show-browser        → Gateway 在工具结果里打 _show_browser, 前端自动唤起
 */

export type BrowserHostIntent = 'auto' | 'drawer';

export interface BrowserHostState {
  /** 是否要求浏览器可见 */
  visible: boolean;
  /** auto = 优先右栏常驻; drawer = 强制独立抽屉 (用户点了「放大」) */
  intent: BrowserHostIntent;
  /** 最近一次要求打开的 URL (作为新宿主 mount 时的 initialUrl) */
  url: string;
  /** AI 是否正在操作 (顶栏 ⚡ 徽标) */
  aiActive: boolean;
  /** 本次可见是否由 AI 触发 (抽屉宿主用它决定任务结束后自动收起) */
  aiOpened: boolean;
  /** 抽屉缩放 0.25 - 1.0 */
  zoom: number;
  /** 抽屉全屏 */
  fullscreen: boolean;
  /** 重载计数: 作为 EmbeddedBrowser 的 key, 自增即强制重建浏览器实例 */
  reloadSeq: number;
  /**
   * 「要求显示」计数: 每次 open / openByAi / navigate / expand 自增。
   * App 用它做 effect 依赖 —— 只依赖 visible 布尔值的话, 用户手动切回"信息"模式后
   * 再来一次 AI 唤起就不会把右栏切回浏览器模式, 浏览器会"消失"(既不在右栏也不是抽屉)。
   */
  openSeq: number;
}

type Listener = (state: BrowserHostState) => void;

const INITIAL: BrowserHostState = {
  visible: false,
  intent: 'auto',
  url: '',
  aiActive: false,
  aiOpened: false,
  zoom: 0.75,
  fullscreen: false,
  reloadSeq: 0,
  openSeq: 0,
};

class BrowserHostImpl {
  private state: BrowserHostState = { ...INITIAL };
  private listeners = new Set<Listener>();
  private aiTimer: ReturnType<typeof setTimeout> | null = null;

  getState(): BrowserHostState {
    return this.state;
  }

  private update(partial: Partial<BrowserHostState>): void {
    this.state = { ...this.state, ...partial };
    const snapshot = this.state;
    this.listeners.forEach(fn => fn(snapshot));
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state); // 立即推送当前状态
    return () => { this.listeners.delete(fn); };
  }

  // ───────────── 动作 ─────────────

  /** 打开 (auto 宿主: 优先右栏)。url 为空时保留上一次的 URL */
  open(url?: string): void {
    this.update({ visible: true, intent: 'auto', url: url || this.state.url, openSeq: this.state.openSeq + 1 });
  }

  /** AI 触发唤起 (标记 aiOpened, 抽屉宿主据此在任务结束后自动收起) */
  openByAi(url?: string): void {
    this.update({
      visible: true, intent: 'auto', aiOpened: true,
      url: url || this.state.url, openSeq: this.state.openSeq + 1,
    });
  }

  /** 打开并导航 (URL 一定更新) */
  navigate(url: string): void {
    this.update({ visible: true, intent: 'auto', url, openSeq: this.state.openSeq + 1 });
  }

  /** 「放大」→ 强制走独立抽屉宿主 */
  expand(url?: string): void {
    this.update({ visible: true, intent: 'drawer', url: url || this.state.url, openSeq: this.state.openSeq + 1 });
  }

  /** 关闭 (同时清掉 AI 打开标记) */
  dismiss(): void {
    if (this.aiTimer) { clearTimeout(this.aiTimer); this.aiTimer = null; }
    this.update({ visible: false, intent: 'auto', aiOpened: false, aiActive: false, fullscreen: false });
  }

  closeDrawer(): void {
    this.dismiss();
  }

  /** 重载: 让宿主重建 EmbeddedBrowser 实例 (key 变化) */
  reload(): void {
    this.update({ reloadSeq: this.state.reloadSeq + 1 });
  }

  // ───────────── AI 状态 ─────────────

  aiStart(): void {
    if (this.aiTimer) { clearTimeout(this.aiTimer); this.aiTimer = null; }
    this.update({ aiActive: true });
    // 30s 兜底: 工具链断了也不会永久显示"AI 正在操作"
    this.aiTimer = setTimeout(() => this.update({ aiActive: false }), 30_000);
  }

  /**
   * AI 任务结束。
   * 只清徽标 + 抽屉宿主才自动收起 —— 右栏是常驻的, 不像浮层那样挡视线,
   * 自动收起反而会把用户正在看的页面弄没, 所以 rail 宿主不退场。
   */
  aiEnd(): void {
    if (this.aiTimer) { clearTimeout(this.aiTimer); this.aiTimer = null; }
    this.update({ aiActive: false });
    const { visible, intent, aiOpened } = this.state;
    if (visible && intent === 'drawer' && aiOpened) {
      // 3 秒延迟, 让用户看到最后结果
      setTimeout(() => {
        if (this.state.intent === 'drawer' && this.state.aiOpened) this.dismiss();
      }, 3000);
    }
  }

  setZoom(zoom: number): void {
    this.update({ zoom: Math.min(1, Math.max(0.25, Math.round(zoom * 100) / 100)) });
  }

  setFullscreen(fullscreen: boolean): void {
    this.update({ fullscreen });
  }
}

export const BrowserHost = new BrowserHostImpl();

/* ════════════════════════════════════════════════════════════
 *  window 事件监听 —— 全项目只装一份
 * ════════════════════════════════════════════════════════════ */
const INSTALL_FLAG = '__agentaiBrowserHostInstalled';

export function installBrowserHostListeners(): void {
  if (typeof window === 'undefined') return;
  // 幂等: HMR / 重复 import 时不会装第二份 (装两份 = 双开 + 双导航)
  if ((window as any)[INSTALL_FLAG]) return;
  (window as any)[INSTALL_FLAG] = true;

  window.addEventListener('pulseflow:browser:open', (e: Event) => {
    const detail = (e as CustomEvent<{ url?: string }>).detail || {};
    BrowserHost.open(detail.url);
  });

  window.addEventListener('pulseflow:browser:navigate', (e: Event) => {
    const detail = (e as CustomEvent<{ url?: string }>).detail || {};
    if (detail.url) BrowserHost.navigate(detail.url);
  });

  window.addEventListener('pulseflow:browser:ai-start', () => BrowserHost.aiStart());
  window.addEventListener('pulseflow:browser:ai-end', () => BrowserHost.aiEnd());

  window.addEventListener('pulseflow:browser:close', () => BrowserHost.dismiss());

  // Gateway 在浏览器工具结果里打了 _show_browser 标记 → 自动唤起
  window.addEventListener('agentai:show-browser', (e: Event) => {
    const detail = (e as CustomEvent<{ url?: string }>).detail || {};
    BrowserHost.openByAi(detail.url);
  });
}

/* ════════════════════════════════════════════════════════════
 *  对外 API (保持旧调用点不变)
 * ════════════════════════════════════════════════════════════ */

/** 打开浏览器 (auto 宿主: 右栏优先)。原 GlobalBrowserDrawer 导出, 调用点未改 */
export function openGlobalBrowser(url?: string): void {
  BrowserHost.open(url);
}

/** 打开并导航到指定 URL */
export function navigateGlobalBrowser(url: string): void {
  BrowserHost.navigate(url);
}

/* ════════════════════════════════════════════════════════════
 *  React Hook
 * ════════════════════════════════════════════════════════════ */
import { useEffect, useState } from 'react';

export function useBrowserHost(): BrowserHostState {
  const [state, setState] = useState<BrowserHostState>(() => BrowserHost.getState());
  useEffect(() => BrowserHost.subscribe(setState), []);
  return state;
}

// 模块加载即安装 (与 BrowserStateBus 的 hydrate 同一时机)
installBrowserHostListeners();

if (typeof window !== 'undefined') {
  (window as any).__browserHost = BrowserHost;
}
