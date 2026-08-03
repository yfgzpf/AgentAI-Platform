/**
 * BrowserEngine — 基于 Playwright 的后端真实浏览器引擎
 * ========================================================
 * 解决 iframe 方案的跨域限制问题:
 *   - 真实 Chromium 实例, 完整 DOM 访问 (无跨域限制)
 *   - 像素级截图 (AI 可以"看到"页面)
 *   - 真实交互 (点击/输入/提交, 触发完整 JS 事件链)
 *   - 多标签页管理
 *   - Cookie 管理正确绑定域名
 *
 * 架构:
 *   AI 工具调用 → BrowserEngine.navigate/click/type/screenshot/...
 *   前端 WebSocket ← 截图流 (base64) → 渲染到 Canvas
 *   前端鼠标/键盘事件 → WebSocket → BrowserEngine 执行真实操作
 */
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

// Playwright 动态导入 (可选依赖, 缺失时降级到 iframe)
let _chromium: any = null;
async function getChromium(): Promise<any> {
  if (_chromium) return _chromium;
  try {
    // @ts-ignore - playwright 可选依赖
    const mod = await import('playwright');
    _chromium = mod.chromium;
    return _chromium;
  } catch {
    return null;
  }
}

/** 查找已安装的 Chromium 可执行文件 (兼容多版本，支持打包环境) */
function findExistingChromium(): string | undefined {
  try {
    // 1. 首先检查打包目录内的 ms-playwright (桌面端打包后)
    const bundledPath = path.join(process.cwd(), 'ms-playwright');
    if (fs.existsSync(bundledPath)) {
      const dirs = fs.readdirSync(bundledPath)
        .filter((d: string) => d.startsWith('chromium_headless_shell-') || d.startsWith('chromium-'))
        .sort()
        .reverse();
      for (const d of dirs) {
        const shellExe = path.join(bundledPath, d, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
        if (fs.existsSync(shellExe)) return shellExe;
        const chromeExe = path.join(bundledPath, d, 'chrome-win64', 'chrome.exe');
        if (fs.existsSync(chromeExe)) return chromeExe;
        const chromeExe6 = path.join(bundledPath, d, 'chrome-win', 'chrome.exe');
        if (fs.existsSync(chromeExe6)) return chromeExe6;
      }
    }
    
    // 2. 检查系统 ms-playwright (开发环境)
    const base = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
    if (fs.existsSync(base)) {
      const dirs = fs.readdirSync(base)
        .filter((d: string) => d.startsWith('chromium_headless_shell-') || d.startsWith('chromium-'))
        .sort()
        .reverse();
      for (const d of dirs) {
        const shellExe = path.join(base, d, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
        if (fs.existsSync(shellExe)) return shellExe;
        const chromeExe = path.join(base, d, 'chrome-win64', 'chrome.exe');
        if (fs.existsSync(chromeExe)) return chromeExe;
        const chromeExe6 = path.join(base, d, 'chrome-win', 'chrome.exe');
        if (fs.existsSync(chromeExe6)) return chromeExe6;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export interface BrowserPageInfo {
  url: string;
  title: string;
  tabId: string;
}

export interface ScreenshotResult {
  base64: string;
  width: number;
  height: number;
}

export interface ElementInfo {
  tag: string;
  id?: string;
  className?: string;
  text?: string;
  type?: string;
  href?: string;
  placeholder?: string;
  selector: string;
  interactivity: number;
  rect: { x: number; y: number; width: number; height: number };
}

/** DOM 脱水输出: 单行文本, 如 [3]<button type="submit">提交</> */
export interface DehydratedElement {
  index: number;          // 全局唯一索引, LLM 用此定位
  tag: string;
  text: string;
  attrs?: Record<string, string>;
  role?: string;
  ariaLabel?: string;
  placeholder?: string;
  href?: string;
  type?: string;
  scrollable?: boolean;
}

/** DOM 脱水结果: 带索引的文本 + 元素索引表 */
export interface DehydrationResult {
  text: string;                          // LLM 可读的脱水文本
  elements: DehydratedElement[];          // 元素索引表 (LLM 可用)
  totalElements: number;                 // 交互元素总数
  pageUrl: string;
  pageTitle: string;
  viewport: { width: number; height: number };
}

/**
 * DOM 脱水脚本 (运行在 Playwright 页面上下文中)
 * 借鉴 page-agent 的脱水思路:
 *   - 提取所有可交互元素, 分配 [index]
 *   - 脱水: 移除样式/隐藏元素/冗余容器
 *   - 输出文本格式: [3]<button type="submit">提交</>
 *   - 保留父-子层级缩进
 */
const DEHYDRATE_JS = `() => {
  const INTERACTIVE_TAGS = new Set(['a','button','input','select','textarea','details','summary','label']);
  const INTERACTIVE_ATTRS = ['onclick','onkeydown','role'];
  const ATTR_WHITELIST = ['type','value','name','placeholder','for','disabled','checked','tabindex','aria-label','aria-expanded','aria-haspopup','href','target','src','role','data-testid'];
  const SCROLLABLE_TAGS = new Set(['div','section','main','article','aside','span']);

  const elements = [];        // [index, Element]
  const indexMap = new WeakMap<Element, number>();

  function isInteractive(el) {
    const tag = el.tagName.toLowerCase();
    if (INTERACTIVE_TAGS.has(tag)) return true;
    if (INTERACTIVE_ATTRS.some(a => el.hasAttribute(a))) return true;
    if (el.onclick || el.onkeydown || el.getAttribute('role') === 'button') return true;
    if (el.style.cursor === 'pointer') return true;
    if (el.getAttribute('contenteditable') === 'true') return true;
    return false;
  }

  function isHidden(el) {
    try {
      const style = window.getComputedStyle(el);
      return style.display === 'none' || style.visibility === 'hidden' || el.hidden || el.hasAttribute('hidden');
    } catch { return false; }
  }

  function isRedundant(el) {
    const tag = el.tagName.toLowerCase();
    if (['script','style','noscript','template','meta','link'].includes(tag)) return true;
    if (el.classList.contains('hidden') || el.classList.contains('sr-only')) return true;
    return false;
  }

  function capText(s, max = 80) {
    if (!s) return '';
    s = s.replace(/\\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max) + '…' : s;
  }

  function getRelevantAttrs(el) {
    const attrs = {};
    for (const key of ATTR_WHITELIST) {
      const val = el.getAttribute(key);
      if (val) attrs[key] = val;
    }
    return attrs;
  }

  function indexElement(el) {
    const idx = elements.length;
    elements.push(el);
    indexMap.set(el, idx);
    return idx;
  }

  function getScrollableInfo(el) {
    try {
      const style = window.getComputedStyle(el);
      const overflow = style.overflow;
      const isScrollable = (overflow === 'scroll' || overflow === 'auto' || overflow === 'overlay') && el.scrollHeight > el.clientHeight;
      if (isScrollable && SCROLLABLE_TAGS.has(el.tagName.toLowerCase())) {
        return true;
      }
    } catch {}
    return false;
  }

  function buildLine(el, idx, indent) {
    const tag = el.tagName.toLowerCase();
    const attrs = getRelevantAttrs(el);
    const text = capText(el.textContent || '');
    const scrollable = getScrollableInfo(el);

    // 构建属性字符串
    let attrStr = '';
    if (Object.keys(attrs).length > 0) {
      attrStr = ' ' + Object.entries(attrs).map(([k,v]) => k + '="' + v + '"').join(' ');
    }

    // 如果元素可滚动, 加上 data-scrollable
    if (scrollable) {
      attrStr += ' data-scrollable';
    }

    const prefix = '[*' + idx + ']';
    const open = prefix + '<' + tag + attrStr + '>';
    const close = '</>';

    // 只输出带文本的交互元素 (脱水核心)
    if (isInteractive(el) && !isHidden(el) && !isRedundant(el)) {
      if (text.length > 0) {
        return ' '.repeat(indent) + open + text + close;
      }
      // 无文本但可交互 (如 submit 按钮无 label), 输出 tag
      return ' '.repeat(indent) + open + close;
    }

    // 非交互但有文本的内容节点 (脱水文本)
    if (!isRedundant(el) && text.length > 0 && !isInteractive(el)) {
      return ' '.repeat(indent) + text;
    }

    // 可滚动容器 (脱水标记)
    if (scrollable) {
      return ' '.repeat(indent) + open + '(scrollable)' + close;
    }

    return null;
  }

  function walkTree(el, depth, lines) {
    if (depth > 10) return;
    if (isRedundant(el)) return;
    if (isHidden(el)) return;

    // 交互元素: 分配索引, 输出脱水行
    if (isInteractive(el)) {
      const idx = indexElement(el);
      const line = buildLine(el, idx, depth * 2);
      if (line) lines.push(line);
      // 交互元素不递归子节点 (避免重复)
      return;
    }

    // 可滚动容器
    if (getScrollableInfo(el)) {
      const idx = indexElement(el);
      const line = buildLine(el, idx, depth * 2);
      if (line) lines.push(line);
    }

    // 非交互节点: 收集子节点
    if (el.children && depth < 10) {
      for (const child of el.children) {
        walkTree(child, depth + 1, lines);
      }
    }
  }

  const lines = [];
  if (document.body) {
    for (const child of document.body.children) {
      walkTree(child, 0, lines);
    }
  }

  // 构建元素索引表 (供后端缓存, 用于 clickByIndex)
  const indexedElements = elements.map((el, idx) => ({
    index: idx,
    tag: el.tagName.toLowerCase(),
    text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 100),
    attrs: (() => { const a = {}; for (const k of ATTR_WHITELIST) { const v = el.getAttribute(k); if (v) a[k] = v; } return Object.keys(a).length > 0 ? a : null; })(),
    selector: (() => {
      if (el.id) return '#' + el.id;
      // 尝试用 nth-of-type 生成可靠 selector
      try {
        let cur = el; let parts = [];
        while (cur && cur !== document.body && cur !== document.documentElement && parts.length < 4) {
          let sel = cur.tagName.toLowerCase();
          if (cur.id) { sel = '#' + cur.id; parts.unshift(sel); break; }
          const cls = (cur.className || '').toString().trim();
          if (cls) sel += '.' + cls.split(/\\s+/)[0];
          const parent = cur.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter(s => s.tagName === cur.tagName);
            if (siblings.length > 1) sel += ':nth-of-type(' + (siblings.indexOf(cur) + 1) + ')';
          }
          parts.unshift(sel);
          cur = cur.parentElement;
        }
        return parts.join(' > ');
      } catch { return null; }
    })(),
    rect: (() => { try { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; } catch { return null; } })(),
  }));

  return {
    text: lines.join('\\n'),
    indexedElements,
    totalElements: elements.length,
    url: window.location.href,
    title: document.title || '',
    viewport: { width: window.innerWidth, height: window.innerHeight },
  };
}`;

class BrowserEngine extends EventEmitter {
  /** 缓存的元素索引表 (每次脱水后更新, 用于 clickByIndex) */
  private _indexedElements: DehydratedElement[] = [];
  private _indexCacheExpiry = 0;  // ms 时间戳, 超时后索引失效

  private browser: any = null;
  private context: any = null;
  private pages: Map<string, any> = new Map();
  private activeTabId: string | null = null;
  private _starting = false;
  private _streamClients: Set<(data: any) => void> = new Set();
  private _streamInterval: ReturnType<typeof setInterval> | null = null;

  /** 是否已启动 */
  isRunning(): boolean {
    return this.browser !== null;
  }

  /** 启动浏览器 (惰性: 首次使用时才启动) */
  async start(): Promise<boolean> {
    if (this.browser) return true;
    if (this._starting) {
      // 等待启动完成
      while (this._starting) await new Promise(r => setTimeout(r, 100));
      return this.browser !== null;
    }
    this._starting = true;
    try {
      const chromium = await getChromium();
      if (!chromium) {
        console.warn('[browser-engine] Playwright 未安装, 浏览器引擎不可用');
        this._starting = false;
        return false;
      }

      // 启动策略 (优先级从高到低, 确保桌面端开箱即用):
      //   1. 环境变量 PLAYWRIGHT_CHROMIUM 指定的路径
      //   2. 系统 Edge (Windows 10+ 自带, Tauri 也依赖 WebView2/Edge)
      //   3. 系统 Chrome
      //   4. 已安装的 Playwright Chromium (findExistingChromium)
      const launchOptions: any = {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
        ],
      };

      const envPath = process.env.PLAYWRIGHT_CHROMIUM;
      if (envPath) {
        launchOptions.executablePath = envPath;
      } else {
        const existing = findExistingChromium();
        if (existing) {
          launchOptions.executablePath = existing;
        } else {
          // 尝试使用系统浏览器 (Edge 优先, Chrome 其次)
          // Windows 10+ 必有 Edge, Tauri 也依赖 WebView2, 所以开箱即用
          const edgePaths = [
            path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
            path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          ];
          const chromePaths = [
            path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
          ];
          const sysBrowser = [...edgePaths, ...chromePaths].find(p => { try { return fs.existsSync(p); } catch { return false; } });
          if (sysBrowser) {
            launchOptions.executablePath = sysBrowser;
            console.log(`[browser-engine] 使用系统浏览器: ${sysBrowser}`);
          }
        }
      }

      this.browser = await chromium.launch(launchOptions);
      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        locale: 'zh-CN',
      });
      // 启用页面截图流
      this._startStreamLoop();
      console.log('[browser-engine] Chromium 已启动 (headless)');
      this._starting = false;
      // 暴露到全局, 供 agentai-loop 注入浏览器状态
      (globalThis as any).__browserEngine = this;
      this.emit('started');
      return true;
    } catch (e: any) {
      console.error('[browser-engine] 启动失败:', e.message);
      this._starting = false;
      this.browser = null;
      return false;
    }
  }

  /** 停止浏览器 */
  async stop(): Promise<void> {
    if (this._streamInterval) { clearInterval(this._streamInterval); this._streamInterval = null; }
    if (this.browser) {
      try { await this.browser.close(); } catch {}
      this.browser = null;
      this.context = null;
      this.pages.clear();
      this.activeTabId = null;
      console.log('[browser-engine] Chromium 已停止');
      this.emit('stopped');
    }
  }

  // ===== 标签页管理 =====

  /** 新建标签页 */
  async newPage(url?: string): Promise<BrowserPageInfo> {
    await this.start();
    const page = await this.context.newPage();
    const tabId = `pw-tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.pages.set(tabId, page);
    this.activeTabId = tabId;

    // 监听导航完成
    page.on('framenavigated', (frame: any) => {
      if (frame === page.mainFrame()) {
        this.emit('page:navigated', { tabId, url: frame.url() });
      }
    });
    // 监听页面错误
    page.on('pageerror', (err: Error) => {
      console.warn(`[browser-engine] 页面错误 (${tabId}):`, err.message);
    });

    if (url) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    }
    return { tabId, url: page.url(), title: await page.title().catch(() => '') };
  }

  /** 获取标签页列表 */
  async listPages(): Promise<BrowserPageInfo[]> {
    const result: BrowserPageInfo[] = [];
    for (const [tabId, page] of this.pages) {
      result.push({
        tabId,
        url: page.url(),
        title: await page.title().catch(() => ''),
      });
    }
    return result;
  }

  /** 切换活跃标签页 */
  switchTab(tabId: string): boolean {
    if (!this.pages.has(tabId)) return false;
    this.activeTabId = tabId;
    this.emit('tab:switched', { tabId });
    return true;
  }

  /** 关闭标签页 */
  async closePage(tabId: string): Promise<boolean> {
    const page = this.pages.get(tabId);
    if (!page) return false;
    await page.close().catch(() => {});
    this.pages.delete(tabId);
    if (this.activeTabId === tabId) {
      const remaining = Array.from(this.pages.keys());
      this.activeTabId = remaining[0] || null;
    }
    return true;
  }

  /** 获取当前活跃页面 */
  private getActivePage(): any | null {
    if (!this.activeTabId) return null;
    return this.pages.get(this.activeTabId) || null;
  }

  // ===== 导航 =====

  async navigate(url: string, waitFor: 'load' | 'domcontentloaded' | 'networkidle' = 'domcontentloaded'): Promise<{ url: string; title: string; elements: ElementInfo[] }> {
    await this.start();
    let page = this.getActivePage();
    if (!page) {
      const info = await this.newPage(url);
      page = this.pages.get(info.tabId);
    } else {
      await page.goto(url, { waitUntil: waitFor, timeout: 30000 }).catch(() => {});
    }
    // 等页面渲染
    await page.waitForTimeout(1000);
    const title = await page.title().catch(() => '');
    const elements = await this.scanElements();
    return { url: page.url(), title, elements };
  }

  // ===== 交互操作 =====

  async click(selector: string, waitMs = 1000): Promise<void> {
    const page = this.getActivePage();
    if (!page) throw new Error('没有活跃标签页');
    await page.click(selector, { timeout: 10000 }).catch((e: any) => {
      throw new Error(`点击失败: ${selector} — ${e.message}`);
    });
    if (waitMs > 0) await page.waitForTimeout(waitMs);
  }

  async type(selector: string, text: string, pressEnter = false): Promise<void> {
    const page = this.getActivePage();
    if (!page) throw new Error('没有活跃标签页');
    await page.click(selector, { timeout: 5000 }).catch(() => {});
    await page.fill(selector, text, { timeout: 5000 }).catch(async () => {
      // fill 失败时用 keyboard.type
      await page.click(selector, { timeout: 5000 }).catch(() => {});
      await page.keyboard.type(text);
    });
    if (pressEnter) await page.keyboard.press('Enter');
  }

  async submit(selector: string): Promise<void> {
    const page = this.getActivePage();
    if (!page) throw new Error('没有活跃标签页');
    await page.$eval(selector, (form: any) => form.submit()).catch((e: any) => {
      throw new Error(`提交表单失败: ${selector} — ${e.message}`);
    });
    await page.waitForTimeout(2000);
  }

  async select(selector: string, value: string): Promise<void> {
    const page = this.getActivePage();
    if (!page) throw new Error('没有活跃标签页');
    await page.selectOption(selector, value).catch((e: any) => {
      throw new Error(`下拉选择失败: ${selector} — ${e.message}`);
    });
  }

  async hover(selector: string): Promise<void> {
    const page = this.getActivePage();
    if (!page) throw new Error('没有活跃标签页');
    await page.hover(selector, { timeout: 5000 }).catch((e: any) => {
      throw new Error(`悬停失败: ${selector} — ${e.message}`);
    });
  }

  async pressKey(key: string): Promise<void> {
    const page = this.getActivePage();
    if (!page) throw new Error('没有活跃标签页');
    // Playwright 支持组合键: "Control+a", "Shift+ArrowDown"
    const pwKey = key.replace(/ctrl/gi, 'Control').replace(/cmd/gi, 'Meta');
    await page.keyboard.press(pwKey);
  }

  async scrollTo(selector: string): Promise<void> {
    const page = this.getActivePage();
    if (!page) throw new Error('没有活跃标签页');
    await page.$eval(selector, (el: any) => el.scrollIntoView({ behavior: 'smooth', block: 'center' })).catch((e: any) => {
      throw new Error(`滚动到元素失败: ${selector} — ${e.message}`);
    });
    await page.waitForTimeout(500);
  }

  async scroll(direction: 'up' | 'down', amount = 3): Promise<void> {
    const page = this.getActivePage();
    if (!page) throw new Error('没有活跃标签页');
    const delta = direction === 'down' ? amount * 300 : -amount * 300;
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(300);
  }

  // ===== 坐标交互 (前端 Canvas 映射) =====

  async clickAt(x: number, y: number): Promise<void> {
    const page = this.getActivePage();
    if (!page) throw new Error('没有活跃标签页');
    await page.mouse.click(x, y);
    await page.waitForTimeout(500);
  }

  async typeAt(x: number, y: number, text: string, pressEnter = false): Promise<void> {
    const page = this.getActivePage();
    if (!page) throw new Error('没有活跃标签页');
    await page.mouse.click(x, y);
    await page.waitForTimeout(200);
    await page.keyboard.type(text);
    if (pressEnter) await page.keyboard.press('Enter');
  }

  // ===== 数据提取 =====

  async getAttribute(selector: string, attribute: string): Promise<string> {
    const page = this.getActivePage();
    if (!page) throw new Error('没有活跃标签页');
    const val = await page.getAttribute(selector, attribute);
    if (val === null) throw new Error(`未找到: ${selector}`);
    return val;
  }

  async extract(selector?: string, extractType = 'text', fields?: Record<string, string>): Promise<string> {
    const page = this.getActivePage();
    if (!page) throw new Error('没有活跃标签页');

    if (selector) {
      const el = await page.$(selector);
      if (!el) throw new Error(`未找到元素: ${selector}`);
      if (extractType === 'html') return await el.innerHTML();
      return await el.innerText();
    }

    switch (extractType) {
      case 'html':
        return await page.content();
      case 'links': {
        const links = await page.$$eval('a[href]', (as: any[]) =>
          as.map(a => ({ text: (a.textContent || '').trim().slice(0, 50), href: a.href }))
        );
        return JSON.stringify(links);
      }
      case 'tables': {
        const tables = await page.$$eval('table', (ts: any[]) => ts.map(t => {
          const headers = Array.from(t.querySelectorAll('thead th, tr:first-child th')).map((th: any) => th.textContent?.trim() || '');
          const rows = Array.from(t.querySelectorAll('tbody tr, tr')).filter((tr: any) => tr.querySelector('td')).map((tr: any) =>
            Array.from(tr.querySelectorAll('td')).map((td: any) => td.textContent?.trim() || '')
          );
          return { headers, rows };
        }));
        return JSON.stringify(tables);
      }
      case 'cards': {
        const cardSel = '[class*=card], [class*=item], [class*=product]';
        const cards = await page.$$eval(cardSel, (els: any[], _fields?: Record<string, string>) => {
          return els.slice(0, 50).map(el => {
            if (_fields) {
              const card: Record<string, string> = {};
              for (const [key, sel] of Object.entries(_fields)) {
                const child = el.querySelector(sel);
                card[key] = child?.textContent?.trim() || '';
              }
              return card;
            }
            return { text: (el.textContent || '').trim().slice(0, 200) };
          });
        }, fields);
        return JSON.stringify(cards);
      }
      default:
        return await page.innerText('body').catch(() => '');
    }
  }

  // ===== 截图 (AI 视觉核心) =====

  async screenshot(selector?: string, fullPage = false): Promise<ScreenshotResult> {
    const page = this.getActivePage();
    if (!page) throw new Error('没有活跃标签页');

    const opts: any = { type: 'jpeg', quality: 70 };
    if (fullPage) opts.fullPage = true;
    if (selector) {
      const el = await page.$(selector);
      if (!el) throw new Error(`截图失败: 未找到 ${selector}`);
      const buf = await el.screenshot(opts);
      const bbox = await el.boundingBox();
      return {
        base64: buf.toString('base64'),
        width: bbox?.width || 0,
        height: bbox?.height || 0,
      };
    }
    const buf = await page.screenshot(opts);
    const viewport = page.viewportSize();
    return {
      base64: buf.toString('base64'),
      width: viewport?.width || 1280,
      height: viewport?.height || 800,
    };
  }

  // ===== 页面扫描 (元素列表) =====

  async scanElements(): Promise<ElementInfo[]> {
    const page = this.getActivePage();
    if (!page) return [];

    const SCAN_FN = `() => {
      const results = [];
      const interactives = ['a','button','input','select','textarea','details','summary'];
      const attrSelectors = ['[role=button]','[onclick]','[ng-click]','[v-on:click]'];
      function makeSelector(el) {
        if (el.id) return '#' + CSS.escape(el.id);
        let path = []; let cur = el;
        while (cur && cur !== document.body && cur !== document.documentElement) {
          let sel = cur.tagName.toLowerCase();
          if (cur.id) { path.unshift('#' + CSS.escape(cur.id)); break; }
          if (cur.className && typeof cur.className === 'string') {
            const cls = cur.className.trim().split(/\\s+/).filter(Boolean).slice(0,2).map(c => '.' + CSS.escape(c)).join('');
            if (cls) sel += cls;
          }
          const parent = cur.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter(s => s.tagName === cur.tagName);
            if (siblings.length > 1) { sel += ':nth-of-type(' + (siblings.indexOf(cur) + 1) + ')'; }
          }
          path.unshift(sel); cur = cur.parentElement;
        }
        return path.join(' > ');
      }
      function getInteractivity(el) {
        let s = 50;
        if (interactives.includes(el.tagName.toLowerCase())) s += 30;
        if (el.getAttribute('role') === 'button') s += 20;
        if (el.onclick) s += 20;
        if (el.getAttribute('href')) s += 10;
        if (el.getAttribute('type') === 'submit') s += 10;
        if (el.style.cursor === 'pointer') s += 10;
        if (el.disabled) s -= 30;
        return Math.min(100, Math.max(0, s));
      }
      function scanNode(el, depth) {
        if (depth > 8) return;
        const tag = el.tagName.toLowerCase();
        const isInt = interactives.includes(tag) || attrSelectors.some(s => { try { return el.matches(s); } catch { return false; } }) || getInteractivity(el) >= 60;
        if (isInt) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            results.push({ tag, selector: makeSelector(el), id: el.id||undefined,
              className: (el.className&&typeof el.className==='string')?el.className.trim().split(/\\s+/).slice(0,3).join(' '):undefined,
              text: (el.textContent||'').trim().slice(0,60)||undefined, type: el.getAttribute('type')||undefined,
              href: el.getAttribute('href')||undefined, placeholder: el.getAttribute('placeholder')||undefined,
              interactivity: getInteractivity(el), rect: {x:Math.round(rect.x),y:Math.round(rect.y),width:Math.round(rect.width),height:Math.round(rect.height)} });
          }
        }
        if (el.children && depth < 8) { for (const child of el.children) scanNode(child, depth+1); }
      }
      if (document.body) { for (const child of document.body.children) scanNode(child, 0); }
      results.sort((a,b) => b.interactivity - a.interactivity);
      return results.slice(0, 100);
    }`;

    try {
      return await page.evaluate(SCAN_FN);
    } catch {
      return [];
    }
  }

  // ===== DOM 脱水 (借鉴 page-agent) =====

  /**
   * DOM 脱水: 把当前页面 DOM 转为带索引的文本表示
   * 输出: "[3]<button type="submit">提交</>" 格式
   * 优势: token 消耗比截图低 5-10x, 纯文本模型即可理解
   */
  async dehydrate(): Promise<DehydrationResult> {
    const page = this.getActivePage();
    if (!page) throw new Error('没有活跃标签页');

    const raw = await page.evaluate(DEHYDRATE_JS);
    if (!raw) throw new Error('DOM 脱水失败: 页面为空');

    // 转换前端数据结构 → DehydrationResult
    const elements: DehydratedElement[] = raw.indexedElements.map((e: any) => ({
      index: e.index,
      tag: e.tag,
      text: e.text,
      attrs: e.attrs,
      href: e.attrs?.href || undefined,
      type: e.attrs?.type || undefined,
      ariaLabel: e.attrs?.['aria-label'] || undefined,
    }));

    this._indexedElements = elements;
    this._indexCacheExpiry = Date.now() + 30000;  // 30 秒过期

    return {
      text: raw.text,
      elements,
      totalElements: raw.totalElements,
      pageUrl: raw.url,
      pageTitle: raw.title,
      viewport: raw.viewport,
    };
  }

  /**
   * 按索引点击元素 (页面对话框中分配的索引号)
   * 比 CSS selector 更可靠: 索引是实时分配的, selector 可能因 DOM 变化失效
   */
  async clickByIndex(index: number, waitMs = 1000): Promise<string> {
    const page = this.getActivePage();
    if (!page) throw new Error('没有活跃标签页');

    // 缓存过期, 重新脱水
    if (Date.now() > this._indexCacheExpiry || !this._indexedElements[index]) {
      await this.dehydrate();
    }

    const el = this._indexedElements[index];
    if (!el) throw new Error(`索引 ${index} 无效。请重新调用 browser_extract type=dehydration 获取当前页面索引。`);

    if (!el.attrs?.selector) {
      // 用坐标点击作为兜底
      throw new Error(`索引 ${index} (${el.tag}: ${el.text}) 缺少定位信息, 请重新扫描`);
    }

    // 直接用 Playwright click
    const sel = el.attrs?.selector;
    try {
      if (!sel) throw new Error(`索引 ${index} 缺少定位信息`);
      await page.click(sel, { timeout: 8000 });
    } catch {
      // selector 失效: 用 evaluate 直接操作 DOM (JS 字符串运行在浏览器上下文)
      await page.evaluate(`
        (function(){
          var e = document.querySelector(${JSON.stringify(el.attrs?.selector || '')});
          if (e) { e.click(); return; }
          var els = Array.from(document.querySelectorAll('*')).filter(function(x){
            var r = x.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          });
          if (els[${index}]) els[${index}].click();
        })();
      `);
    }

    if (waitMs > 0) await page.waitForTimeout(waitMs);
    return `点击成功: [${index}] <${el.tag}> ${el.text || '(no text)'}`;
  }

  /**
   * 按索引输入文本
   */
  async typeByIndex(index: number, text: string, pressEnter = false): Promise<string> {
    const page = this.getActivePage();
    if (!page) throw new Error('没有活跃标签页');

    if (Date.now() > this._indexCacheExpiry || !this._indexedElements[index]) {
      await this.dehydrate();
    }

    const el = this._indexedElements[index];
    if (!el) throw new Error(`索引 ${index} 无效。请重新调用 browser_extract type=dehydration。`);

    if (!el.attrs?.selector) throw new Error(`索引 ${index} 缺少定位信息`);

    const selector = el.attrs?.selector;
    if (!selector) throw new Error(`索引 ${index} 缺少定位信息`);
    await page.fill(selector, text, { timeout: 5000 }).catch(async () => {
      await page.click(selector, { timeout: 3000 }).catch(() => {});
      await page.keyboard.type(text);
    });
    if (pressEnter) await page.keyboard.press('Enter');

    return `输入成功: [${index}] <${el.tag}> "${text}"`;
  }

  // ===== 等待 =====

  async waitFor(selector: string, timeoutMs = 10000): Promise<boolean> {
    const page = this.getActivePage();
    if (!page) throw new Error('没有活跃标签页');
    try {
      await page.waitForSelector(selector, { timeout: timeoutMs });
      return true;
    } catch {
      throw new Error(`等待超时: ${selector}`);
    }
  }

  // ===== JS 执行 =====

  async evaluate(code: string): Promise<any> {
    const page = this.getActivePage();
    if (!page) throw new Error('没有活跃标签页');
    return await page.evaluate(code);
  }

  // ===== Cookie 管理 =====

  async setCookies(cookies: Array<{ name: string; value: string; domain?: string; path?: string }>): Promise<number> {
    await this.start();
    const page = this.getActivePage();
    if (!page) throw new Error('没有活跃标签页');
    const url = page.url();
    const hostname = new URL(url).hostname;
    const pwCookies = cookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain || hostname,
      path: c.path || '/',
    }));
    await this.context.addCookies(pwCookies);
    return pwCookies.length;
  }

  async getCookies(): Promise<any[]> {
    if (!this.context) return [];
    return await this.context.cookies();
  }

  // ===== 截图流 (推送到前端 Canvas) =====

  /** 订阅截图流 (前端 WebSocket 连接时调用) */
  subscribeStream(callback: (data: { tabId: string; base64: string; width: number; height: number }) => void): () => void {
    this._streamClients.add(callback);
    return () => { this._streamClients.delete(callback); };
  }

  /** 启动截图流循环 (每 500ms 推送一次截图) */
  private _startStreamLoop(): void {
    if (this._streamInterval) return;
    this._streamInterval = setInterval(async () => {
      if (this._streamClients.size === 0) return;
      const page = this.getActivePage();
      if (!page) return;
      try {
        const buf = await page.screenshot({ type: 'jpeg', quality: 50 });
        const viewport = page.viewportSize();
        const data = {
          tabId: this.activeTabId,
          base64: buf.toString('base64'),
          width: viewport?.width || 1280,
          height: viewport?.height || 800,
        };
        for (const cb of this._streamClients) {
          try { cb(data); } catch {}
        }
      } catch {}
    }, 500);
  }

  /** 获取当前页面 URL */
  getCurrentUrl(): string {
    const page = this.getActivePage();
    return page?.url() || '';
  }

  /** 获取活跃标签页 ID */
  getActiveTabId(): string | null {
    return this.activeTabId;
  }
}

/** 单例 */
let _instance: BrowserEngine | null = null;
export function getBrowserEngine(): BrowserEngine {
  if (!_instance) _instance = new BrowserEngine();
  return _instance;
}
