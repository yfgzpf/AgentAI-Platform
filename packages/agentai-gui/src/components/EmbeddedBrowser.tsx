// @ts-nocheck
/**
 * EmbeddedBrowser — 智能体内嵌浏览器 (对标美团 Tabbit)
 * =====================================================
 * 核心能力:
 *   1. 多标签页浏览 — 支持同时打开多个网页
 *   2. 代理模式 — 通过 Gateway 代理绕过 X-Frame-Options/CSP
 *   3. WebSocket 桥接 — AI 实时控制 (导航/点击/输入/截图/提取/扫描)
 *   4. 元素扫描 — 自动识别可交互元素, 发送给 AI
 *   5. 收藏栏 — 读取本地 Chrome/Edge 书签, 一键打开
 *   6. 输入补全 — 从本地浏览器历史记录中自动补全 URL
 *   7. Cookie 同步 — 从本地浏览器导入 Cookie, 实现免登录
 *   8. 桌面/移动模式切换
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Input, Button, Tag, Tooltip, Segmented, message, Modal, AutoComplete, Popover } from 'antd';
import {
  ArrowLeftOutlined, ArrowRightOutlined, ReloadOutlined,
  SendOutlined, ScanOutlined,
  FullscreenOutlined, FullscreenExitOutlined, RobotOutlined,
  CheckCircleOutlined, PlusOutlined, CloseOutlined,
  GlobalOutlined, SafetyCertificateOutlined, ThunderboltOutlined,
  StarOutlined, StarFilled,
  VideoCameraOutlined, StopOutlined, PlayCircleOutlined,
} from '@ant-design/icons';
import { io, type Socket } from 'socket.io-client';
import { gatewayFallback } from '../services/GatewayFallback';
import { BrowserStateBus } from '../services/BrowserStateBus';

export interface IdentifiedElement {
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

interface BrowserTab {
  id: string;
  url: string;
  title: string;
  history: string[];
  historyIdx: number;
  loading: boolean;
  useProxy: boolean;
}

interface BookmarkItem {
  title: string;
  url: string;
}

interface HistoryItem {
  url: string;
  title: string;
  visitCount: number;
  lastVisitTime: number;
}

interface Props {
  initialUrl?: string;
  compact?: boolean;
  hideToolbar?: boolean;  // 由外部 BrowserMode 提供工具栏时隐藏内部导航栏
  aiControlled?: boolean;
  style?: React.CSSProperties;
  onElementsDetected?: (elements: IdentifiedElement[], url: string) => void;
  autoScan?: boolean;
}

const gatewayUrl = () => gatewayFallback.url || 'http://127.0.0.1:18789';

/** 防护: 兜底函数 (防止 AI/iframe postMessage 引用未定义变量导致 ReferenceError)
 *  BrowserMode 之外的挂载点 (GlobalBrowserDrawer) 没有这些函数, 必须兜底
 *  v3.1 (2026-07-15) 修复 hideToolbar is not defined 死循环
 */
const safeNoop = () => { /* 防止 ReferenceError: hideToolbar is not defined */ };
if (typeof (window as any).hideToolbar !== 'function') (window as any).hideToolbar = safeNoop;
if (typeof (window as any).showToolbar !== 'function') (window as any).showToolbar = safeNoop;
if (typeof (window as any).hideAddressBar !== 'function') (window as any).hideAddressBar = safeNoop;
if (typeof (window as any).toggleFullscreen !== 'function') (window as any).toggleFullscreen = safeNoop;

/** 构建 iframe src: 直连或通过代理 */
function buildIframeSrc(url: string, useProxy: boolean): string {
  if (!url) return '';
  if (useProxy) {
    return `${gatewayUrl()}/v1/browser/proxy?url=${encodeURIComponent(url)}`;
  }
  return url;
}

/** 从 URL 提取域名 */
function getHostname(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

/** 获取 favicon URL */
function getFaviconUrl(url: string): string {
  try {
    const u = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=32`;
  } catch { return ''; }
}

/** 元素扫描脚本 */
const SCAN_SCRIPT = `
(function() {
  const results = [];
  const interactives = ['a','button','input','select','textarea','details','summary'];
  const attrSelectors = ['[role=button]','[onclick]','[ng-click]','[v-on:click]','@click'];
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
})();
`;

export const EmbeddedBrowser: React.FC<Props> = ({
  initialUrl, compact = false, aiControlled = false, style, onElementsDetected, autoScan: autoScanProp,
}) => {
  const autoScan = autoScanProp ?? aiControlled;
  const [tabs, setTabs] = useState<BrowserTab[]>([]);
  const [activeTabId, setActiveTabId] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [screenMode, setScreenMode] = useState<'desktop' | 'mobile'>('desktop');
  const [elements, setElements] = useState<IdentifiedElement[]>([]);
  const [scanning, setScanning] = useState(false);
  const [showCookieModal, setShowCookieModal] = useState(false);
  const [cookieText, setCookieText] = useState('');
  const [useProxyGlobal, setUseProxyGlobal] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);
  const [aiExecuting, setAiExecuting] = useState(false);
  // ===== Playwright 引擎模式 =====
  const [playwrightMode, setPlaywrightMode] = useState(true); // 默认使用 Playwright (真实浏览器)
  const [pwConnected, setPwConnected] = useState(false);
  const [pwEngineStatus, setPwEngineStatus] = useState<'idle' | 'running' | 'starting'>('idle');
  const streamWsRef = useRef<Socket | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pwUrl, setPwUrl] = useState('');

  // v3.2 修复: 把 RPA 录制 useState 提前, 避免 useEffect 访问未初始化的变量 (TDZ 错误)
  const [recording, setRecording] = useState(false);
  const [recordStepCount, setRecordStepCount] = useState(0);
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [recordName, setRecordName] = useState('');

  // v3.2 同步到 BrowserStateBus: 状态变化时自动发布
  useEffect(() => {
    BrowserStateBus.update({
      tabs: tabs.map(t => ({ id: t.id, url: t.url, title: t.title, loading: t.loading })),
      activeTabId,
      activeTabUrl: tabs.find(t => t.id === activeTabId)?.url || '',
      activeTabTitle: tabs.find(t => t.id === activeTabId)?.title || '',
      elements,
      recording,
      recordStepCount,
      playwrightMode,
      playwrightConnected: pwConnected,
      playwrightEngineStatus: pwEngineStatus,
    });
  }, [tabs, activeTabId, elements, recording, recordStepCount, playwrightMode, pwConnected, pwEngineStatus]);

  // ===== 本地浏览器数据 =====
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [showBookmarkBar, setShowBookmarkBar] = useState(true);
  const [bookmarksExpanded, setBookmarksExpanded] = useState(false); // 书签栏是否展开（默认收起）

  // v3.2 修复: 删掉下方的重复 useState (已提前到上面)
  const [recordStartUrl, setRecordStartUrl] = useState('');

  // ===== RPA 录制控制 =====
  const handleStartRecording = async () => {
    const name = recordName || `脚本-${Date.now()}`;
    const url = recordStartUrl || activeTab?.url || '';
    try {
      const resp = await fetch(`${gatewayUrl()}/v1/browser/rpa/record/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, start_url: url }),
      });
      const data = await resp.json();
      if (data.success) {
        setRecording(true); setRecordStepCount(0); setShowRecordModal(false);
        message.success(`录制已开始: ${name}`);
      } else { message.error(data.error || '启动录制失败'); }
    } catch (e: any) { message.error(e.message); }
  };

  const handleStopRecording = async () => {
    try {
      const resp = await fetch(`${gatewayUrl()}/v1/browser/rpa/record/stop`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
      });
      const data = await resp.json();
      setRecording(false);
      if (data.success) { 
        message.success(`录制完成: ${data.script?.name || ''}`); 
      }
      else { message.warning(data.error || '停止录制'); }
      setRecordName(''); setRecordStartUrl('');
    } catch (e: any) { message.error(e.message); setRecording(false); }
  };

  const iframeRefs = useRef<Record<string, HTMLIFrameElement | null>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<Socket | null>(null);
  const tabsRef = useRef(tabs);
  useEffect(() => { tabsRef.current = tabs; }, [tabs]);

  const activeTab = tabs.find(t => t.id === activeTabId);

  // ===== 初始化: 加载本地浏览器数据 + 创建第一个标签页 =====
  useEffect(() => {
    // 加载书签
    fetch(`${gatewayUrl()}/v1/browser/bookmarks`).then(r => r.json()).then(data => {
      if (data.bookmarks?.length) setBookmarks(data.bookmarks.slice(0, 50));
    }).catch(() => {});
    // 加载历史记录 (用于输入补全)
    fetch(`${gatewayUrl()}/v1/browser/history?limit=300`).then(r => r.json()).then(data => {
      if (data.history?.length) setHistoryItems(data.history);
    }).catch(() => {});
    // 创建初始标签页
    if (tabs.length === 0) createTab(initialUrl || '');
  }, []); // eslint-disable-line

  // ===== Playwright 截图流 WebSocket =====
  useEffect(() => {
    if (!playwrightMode) { setPwConnected(false); return; }
    const ws = io(`${gatewayUrl()}/browser`, { transports: ['websocket', 'polling'], reconnection: true, reconnectionDelay: 2000 });
    streamWsRef.current = ws;
    ws.on('connect', () => {
      setPwConnected(true);
      ws.emit('subscribe');
      // 检查引擎状态
      fetch(`${gatewayUrl()}/v1/browser/engine/status`).then(r => r.json()).then(d => {
        setPwEngineStatus(d.running ? 'running' : 'idle');
        if (d.currentUrl) setPwUrl(d.currentUrl);
      }).catch(() => {});
    });
    ws.on('disconnect', () => setPwConnected(false));
    ws.on('frame', (data: { tabId: string; base64: string; width: number; height: number }) => {
      const canvas = canvasRef.current;
      if (!canvas || !data.base64) return;
      canvas.width = data.width;
      canvas.height = data.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const img = new Image();
      img.onload = () => { ctx.drawImage(img, 0, 0, canvas.width, canvas.height); };
      img.src = `data:image/jpeg;base64,${data.base64}`;
    });
    ws.on('navigate:result', (data: any) => {
      if (data.success) setPwUrl(data.url || '');
      setAiExecuting(false);
    });
    return () => { ws.disconnect(); streamWsRef.current = null; };
  }, [playwrightMode]);

  // ===== Playwright 导航 =====
  const pwNavigate = async (url: string) => {
    let u = url.trim(); if (!u) return;
    if (!u.startsWith('http://') && !u.startsWith('https://')) u = 'https://' + u;
    setAiExecuting(true);
    setPwEngineStatus('starting');
    const action = BrowserStateBus.recordAction('navigate', { target: u, result: 'pending' });
    BrowserStateBus.setPageLoading(true);
    try {
      const resp = await fetch(`${gatewayUrl()}/v1/browser/engine/navigate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: u, waitFor: 'domcontentloaded' }),
      });
      const data = await resp.json();
      if (data.elements) { setElements(data.elements); BrowserStateBus.setElements(data.elements); if (onElementsDetected) onElementsDetected(data.elements, u); }
      setPwUrl(u);
      setPwEngineStatus('running');
      setUrlInput(u);
      BrowserStateBus.setUrl(u, data.title);
      BrowserStateBus.setPageLoading(false);
      BrowserStateBus.updateLastAction('success', `导航至 ${u.slice(0, 40)}`);
    } catch (e: any) {
      message.error(`导航失败: ${e.message}`);
      BrowserStateBus.setPageLoading(false);
      BrowserStateBus.updateLastAction('error', e.message);
    } finally {
      setAiExecuting(false);
    }
  };

  // ===== Canvas 鼠标事件 → Playwright =====
  const handleCanvasClick = async (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);
    // 通过 REST API 执行坐标点击
    try {
      await fetch(`${gatewayUrl()}/v1/browser/engine/click-at`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x, y }),
      });
    } catch {}
  };

  // ===== Canvas 键盘事件 → Playwright =====
  const handleCanvasKeyDown = async (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    const key = e.key;
    // 映射特殊键
    const keyMap: Record<string, string> = {
      'Enter': 'Enter', 'Backspace': 'Backspace', 'Tab': 'Tab',
      'ArrowUp': 'ArrowUp', 'ArrowDown': 'ArrowDown', 'ArrowLeft': 'ArrowLeft', 'ArrowRight': 'ArrowRight',
      'Escape': 'Escape', 'Delete': 'Delete',
    };
    const pwKey = keyMap[key] || key;
    if (e.ctrlKey || e.metaKey) {
      const ctrlKey = e.ctrlKey ? 'Control+' : 'Meta+';
      try {
        await fetch(`${gatewayUrl()}/v1/browser/engine/press`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: ctrlKey + pwKey }),
        });
      } catch {}
      e.preventDefault();
      return;
    }
    if (key.length === 1) {
      try {
        await fetch(`${gatewayUrl()}/v1/browser/engine/press`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: pwKey }),
        });
      } catch {}
    }
  };

  // ===== Playwright 滚轮事件 =====
  const handleCanvasWheel = async (e: React.WheelEvent<HTMLCanvasElement>) => {
    const direction = e.deltaY > 0 ? 'down' : 'up';
    const amount = Math.min(Math.abs(e.deltaY) / 100, 5);
    try {
      await fetch(`${gatewayUrl()}/v1/browser/engine/scroll`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction, amount }),
      });
    } catch {}
  };

  // ===== WebSocket 连接 (AI 桥接 - iframe 降级模式) =====
  useEffect(() => {
    if (!aiControlled || playwrightMode) return;
    const ws = io(`${gatewayUrl()}/browser`, { transports: ['websocket', 'polling'], reconnection: true, reconnectionDelay: 2000 });
    wsRef.current = ws;
    ws.on('connect', () => setWsConnected(true));
    ws.on('disconnect', () => setWsConnected(false));
    ws.on('browser:command', async (cmd: any) => {
      setAiExecuting(true);
      try { ws.emit('browser:result', await executeCommand(cmd)); }
      catch (err: any) { ws.emit('browser:result', { id: cmd.id, success: false, error: err.message }); }
      finally { setAiExecuting(false); }
    });
    // RPA 录制控制
    ws.on('rpa:record-control', (msg: { action: 'start' | 'stop' | 'cancel' }) => {
      if (msg.action === 'start') { setRecording(true); setRecordStepCount(0); }
      else if (msg.action === 'stop' || msg.action === 'cancel') { setRecording(false); }
    });
    // RPA 录制: 接收前端推送的操作步骤
    ws.on('rpa:record-step', (step: any) => {
      // 转发给后端 (通过 HTTP API, 因为 socket 是双向的)
      fetch(`${gatewayUrl()}/v1/browser/rpa/record-step`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(step),
      }).catch(() => {});
    });
    return () => { ws.disconnect(); wsRef.current = null; };
  }, [aiControlled, playwrightMode, activeTabId, tabs]); // eslint-disable-line

  // ===== 执行 AI 命令 =====
  const executeCommand = async (cmd: any): Promise<any> => {
    const { id, action } = cmd;
    const tab = tabs.find(t => t.id === activeTabId);
    if (!tab) return { id, success: false, error: '没有活跃标签页' };
    const iframe = iframeRefs.current[activeTabId];
    switch (action) {
      case 'navigate': {
        navigate(cmd.url);
        await new Promise(r => setTimeout(r, 3000));
        let title = cmd.url;
        try { const d = iframeRefs.current[activeTabId]?.contentDocument; if (d?.title) title = d.title; } catch {}
        const els = await scanIframe(activeTabId);
        return { id, success: true, data: { url: cmd.url, title, elements: els } };
      }
      case 'click': {
        if (!iframe?.contentDocument) return { id, success: false, error: '跨域限制' };
        try {
          const el = iframe.contentDocument.querySelector(cmd.selector);
          if (el instanceof HTMLElement) { el.click(); await new Promise(r => setTimeout(r, cmd.wait_ms || 1000)); return { id, success: true, data: { result: 'clicked' } }; }
          return { id, success: false, error: `未找到: ${cmd.selector}` };
        } catch (e: any) { return { id, success: false, error: e.message }; }
      }
      case 'type': {
        if (!iframe?.contentDocument) return { id, success: false, error: '跨域限制' };
        try {
          const el = iframe.contentDocument.querySelector(cmd.selector);
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            if (setter && el instanceof HTMLInputElement) setter.call(el, cmd.text); else el.value = cmd.text;
            el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
            if (cmd.press_enter) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            return { id, success: true, data: { result: 'typed' } };
          }
          return { id, success: false, error: `非输入框: ${cmd.selector}` };
        } catch (e: any) { return { id, success: false, error: e.message }; }
      }
      case 'screenshot': {
        try {
          const canvas = await screenshotIframe(iframe, cmd.full_page);
          if (!canvas) return { id, success: false, error: '截图失败' };
          return { id, success: true, data: { imageBase64: canvas.toDataURL('image/jpeg', 0.7).split(',')[1], width: canvas.width, height: canvas.height } };
        } catch (e: any) { return { id, success: false, error: e.message }; }
      }
      case 'extract': {
        if (!iframe?.contentDocument) return { id, success: false, error: '跨域限制' };
        try {
          const doc = iframe.contentDocument; let content = '';
          if (cmd.selector) {
            const el = doc.querySelector(cmd.selector);
            if (cmd.extract_type === 'html') content = el?.outerHTML || '';
            else content = el?.textContent || '';
          } else {
            switch (cmd.extract_type) {
              case 'html': content = doc.documentElement.outerHTML; break;
              case 'links': content = JSON.stringify(Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]')).map(a => ({ text: a.textContent?.trim().slice(0,50), href: a.href }))); break;
              case 'tables': {
                // 提取表格数据为 JSON 数组
                const tables = Array.from(doc.querySelectorAll('table'));
                const tableData = tables.map(table => {
                  const headers = Array.from(table.querySelectorAll('thead th, tr:first-child th')).map(th => th.textContent?.trim() || '');
                  const rows = Array.from(table.querySelectorAll('tbody tr, tr')).filter(tr => tr.querySelector('td')).map(tr =>
                    Array.from(tr.querySelectorAll('td')).map(td => td.textContent?.trim() || '')
                  );
                  return { headers, rows };
                });
                content = JSON.stringify(tableData);
                break;
              }
              case 'cards': {
                // 提取卡片列表为 JSON 数组
                const cardEls = cmd.selector ? Array.from(doc.querySelectorAll(cmd.selector)) : Array.from(doc.querySelectorAll('[class*=card], [class*=item], [class*=product]'));
                const cards = cardEls.slice(0, 50).map(el => {
                  const card: Record<string, string> = {};
                  if (cmd.fields) {
                    for (const [key, sel] of Object.entries(cmd.fields)) {
                      const child = el.querySelector(sel as string);
                      card[key] = child?.textContent?.trim() || '';
                    }
                  } else {
                    card.text = el.textContent?.trim().slice(0, 200) || '';
                    card.html = el.innerHTML.slice(0, 500);
                  }
                  return card;
                });
                content = JSON.stringify(cards);
                break;
              }
              default: content = doc.body?.textContent || '';
            }
          }
          return { id, success: true, data: { content: content.slice(0, 50000) } };
        } catch (e: any) { return { id, success: false, error: e.message }; }
      }
      case 'submit': {
        if (!iframe?.contentDocument) return { id, success: false, error: '跨域限制' };
        try {
          const form = iframe.contentDocument.querySelector(cmd.selector);
          if (form instanceof HTMLFormElement) { form.submit(); await new Promise(r => setTimeout(r, 2000)); return { id, success: true, data: { result: 'submitted' } }; }
          return { id, success: false, error: `未找到表单: ${cmd.selector}` };
        } catch (e: any) { return { id, success: false, error: e.message }; }
      }
      case 'upload': {
        if (!iframe?.contentDocument) return { id, success: false, error: '跨域限制' };
        try {
          const input = iframe.contentDocument.querySelector(cmd.selector);
          if (input instanceof HTMLInputElement && input.type === 'file') {
            // 通过 postMessage 通知前端创建 File 对象并设置 (浏览器安全限制, 无法直接设置 input.files)
            return { id, success: false, error: '浏览器安全限制: 无法直接设置 input[type=file] 的文件。请使用 evaluate 注入脚本或手动上传。' };
          }
          return { id, success: false, error: `未找到文件上传框: ${cmd.selector}` };
        } catch (e: any) { return { id, success: false, error: e.message }; }
      }
      case 'tabs': {
        const tabAction = cmd.tab_action;
        if (tabAction === 'list') {
          const tabList = tabsRef.current.map(t => ({ id: t.id, url: t.url, title: t.title, active: t.id === activeTabId }));
          return { id, success: true, data: { tabs: tabList } };
        }
        if (tabAction === 'new') { const newId = createTab(cmd.url || ''); return { id, success: true, data: { tabId: newId } }; }
        if (tabAction === 'close') { if (cmd.tab_id) closeTab(cmd.tab_id); return { id, success: true, data: { result: 'closed' } }; }
        if (tabAction === 'switch') { if (cmd.tab_id) { setActiveTabId(cmd.tab_id); const t = tabsRef.current.find(t => t.id === cmd.tab_id); if (t) setUrlInput(t.url); } return { id, success: true, data: { result: 'switched' } }; }
        return { id, success: false, error: `未知标签页操作: ${tabAction}` };
      }
      case 'set_cookie': {
        if (!iframe?.contentWindow) return { id, success: false, error: '跨域限制' };
        try {
          const cookies = cmd.cookies || [];
          // 通过 postMessage 注入 Cookie 到 iframe
          iframe.contentWindow.postMessage({ type: '__AI_SET_COOKIE__', cookies }, '*');
          await new Promise(r => setTimeout(r, 500));
          return { id, success: true, data: { count: cookies.length } };
        } catch (e: any) { return { id, success: false, error: e.message }; }
      }
      case 'wait_for': {
        if (!iframe?.contentDocument) return { id, success: false, error: '跨域限制' };
        try {
          const doc = iframe.contentDocument;
          if (doc.querySelector(cmd.selector)) return { id, success: true, data: { result: 'already_exists' } };
          return new Promise(resolve => {
            const observer = new MutationObserver(() => {
              if (doc.querySelector(cmd.selector)) { observer.disconnect(); resolve({ id, success: true, data: { result: 'appeared' } }); }
            });
            observer.observe(doc.body || doc.documentElement, { childList: true, subtree: true });
            setTimeout(() => { observer.disconnect(); resolve({ id, success: false, error: `等待超时: ${cmd.selector}` }); }, cmd.timeout || 10000);
          });
        } catch (e: any) { return { id, success: false, error: e.message }; }
      }
      case 'select': {
        if (!iframe?.contentDocument) return { id, success: false, error: '跨域限制' };
        try {
          const el = iframe.contentDocument.querySelector(cmd.selector);
          if (el instanceof HTMLSelectElement) {
            el.value = cmd.value;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return { id, success: true, data: { result: 'selected' } };
          }
          return { id, success: false, error: `非下拉框: ${cmd.selector}` };
        } catch (e: any) { return { id, success: false, error: e.message }; }
      }
      case 'hover': {
        if (!iframe?.contentDocument) return { id, success: false, error: '跨域限制' };
        try {
          const el = iframe.contentDocument.querySelector(cmd.selector);
          if (el instanceof HTMLElement) {
            el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            return { id, success: true, data: { result: 'hovered' } };
          }
          return { id, success: false, error: `未找到: ${cmd.selector}` };
        } catch (e: any) { return { id, success: false, error: e.message }; }
      }
      case 'press_key': {
        if (!iframe?.contentWindow) return { id, success: false, error: '跨域限制' };
        try {
          const key = cmd.key || '';
          // 支持组合键 ctrl+a, ctrl+c 等
          if (key.includes('+')) {
            const parts = key.toLowerCase().split('+');
            const mainKey = parts[parts.length - 1];
            const ctrlKey = parts.includes('ctrl') || parts.includes('control');
            const shiftKey = parts.includes('shift');
            const altKey = parts.includes('alt');
            iframe.contentWindow.dispatchEvent(new KeyboardEvent('keydown', { key: mainKey, ctrlKey, shiftKey, altKey, bubbles: true }));
            iframe.contentWindow.dispatchEvent(new KeyboardEvent('keyup', { key: mainKey, ctrlKey, shiftKey, altKey, bubbles: true }));
          } else {
            iframe.contentWindow.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
            iframe.contentWindow.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
          }
          return { id, success: true, data: { result: 'pressed' } };
        } catch (e: any) { return { id, success: false, error: e.message }; }
      }
      case 'scroll_to': {
        if (!iframe?.contentDocument) return { id, success: false, error: '跨域限制' };
        try {
          const el = iframe.contentDocument.querySelector(cmd.selector);
          if (el instanceof HTMLElement) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); await new Promise(r => setTimeout(r, 500)); return { id, success: true, data: { result: 'scrolled' } }; }
          return { id, success: false, error: `未找到: ${cmd.selector}` };
        } catch (e: any) { return { id, success: false, error: e.message }; }
      }
      case 'get_attribute': {
        if (!iframe?.contentDocument) return { id, success: false, error: '跨域限制' };
        try {
          const el = iframe.contentDocument.querySelector(cmd.selector);
          if (el) { const val = el.getAttribute(cmd.attribute) || ''; return { id, success: true, data: { value: val } }; }
          return { id, success: false, error: `未找到: ${cmd.selector}` };
        } catch (e: any) { return { id, success: false, error: e.message }; }
      }
      case 'scan': { return { id, success: true, data: { elements: await scanIframe(activeTabId) } }; }
      case 'scroll': { if (iframe?.contentWindow) { iframe.contentWindow.scrollBy(0, (cmd.direction==='up'?-1:1)*(cmd.amount||3)*300); return { id, success: true, data: { result: 'scrolled' } }; } return { id, success: false, error: '跨域限制' }; }
      case 'wait': {
        if (!iframe?.contentDocument) return { id, success: false, error: '跨域限制' };
        const start = Date.now(); const timeout = cmd.timeout || 10000;
        while (Date.now() - start < timeout) { if (iframe.contentDocument.querySelector(cmd.selector)) return { id, success: true }; await new Promise(r => setTimeout(r, 200)); }
        return { id, success: false, error: `等待超时: ${cmd.selector}` };
      }
      default: return { id, success: false, error: `未知命令: ${action}` };
    }
  };

  // ===== 扫描 iframe =====
  const scanIframe = async (tabId: string): Promise<IdentifiedElement[]> => {
    const iframe = iframeRefs.current[tabId];
    if (!iframe) return [];
    try {
      const doc = iframe.contentDocument;
      if (doc?.body) {
        const fn = new Function('document', SCAN_SCRIPT.replace(/^\(function\(\)\s*\{/, '').replace(/\}\);?\s*$/, ''));
        const els = (fn(doc) || []) as IdentifiedElement[];
        setElements(els);
        BrowserStateBus.setElements(els);  // v3.2 实时发布元素
        if (onElementsDetected && tabId === activeTabId) onElementsDetected(els, tabsRef.current.find(t => t.id === tabId)?.url || '');
        return els;
      }
    } catch {}
    try {
      return new Promise<IdentifiedElement[]>((resolve) => {
        const handler = (e: MessageEvent) => {
          if (e.data?.type === '__AI_SCAN_RESULT__') { window.removeEventListener('message', handler); const els = e.data.elements || []; setElements(els); if (onElementsDetected && tabId === activeTabId) onElementsDetected(els, tabsRef.current.find(t => t.id === tabId)?.url || ''); resolve(els); }
        };
        window.addEventListener('message', handler);
        iframe.contentWindow?.postMessage({ type: '__AI_SCAN__', code: SCAN_SCRIPT }, '*');
        setTimeout(() => { window.removeEventListener('message', handler); resolve([]); }, 3000);
      });
    } catch { return []; }
  };

  // ===== 截图 =====
  const screenshotIframe = async (iframe: HTMLIFrameElement | null, fullPage: boolean): Promise<HTMLCanvasElement | null> => {
    if (!iframe) return null;
    try {
      const rect = iframe.getBoundingClientRect();
      const canvas = document.createElement('canvas');
      canvas.width = fullPage ? iframe.contentDocument?.body?.scrollWidth || rect.width : rect.width;
      canvas.height = fullPage ? iframe.contentDocument?.body?.scrollHeight || rect.height : rect.height;
      const ctx = canvas.getContext('2d'); if (!ctx) return null;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (iframe.contentDocument) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}"><foreignObject width="100%" height="100%">${new XMLSerializer().serializeToString(iframe.contentDocument.documentElement)}</foreignObject></svg>`;
        const img = new Image(); img.crossOrigin = 'anonymous';
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
        ctx.drawImage(img, 0, 0);
      }
      return canvas;
    } catch { return null; }
  };

  // ===== 标签页管理 =====
  const createTab = (url: string): string => {
    const id = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setTabs(prev => [...prev, { id, url, title: url ? getHostname(url) : '新标签页', history: url ? [url] : [], historyIdx: url ? 0 : -1, loading: !!url, useProxy: useProxyGlobal }]);
    setActiveTabId(id); setUrlInput(url);
    // v3.2 同步到全局状态
    setTimeout(() => {
      const newTabs = [...tabsRef.current, { id, url, title: url ? getHostname(url) : '新标签页', loading: !!url }];
      BrowserStateBus.setTabs(newTabs, id);
    }, 0);
    return id;
  };

  const closeTab = (tabId: string) => {
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === tabId); const next = prev.filter(t => t.id !== tabId);
      if (tabId === activeTabId && next.length > 0) { const na = next[Math.min(idx, next.length - 1)]; setActiveTabId(na.id); setUrlInput(na.url); }
      if (next.length === 0) { const empty: BrowserTab = { id: `tab-${Date.now()}`, url: '', title: '新标签页', history: [], historyIdx: -1, loading: false, useProxy: useProxyGlobal }; setActiveTabId(empty.id); setUrlInput(''); return [empty]; }
      return next;
    });
  };

  const navigate = (targetUrl: string, tabId?: string) => {
    let u = targetUrl.trim(); if (!u) return;
    if (!u.startsWith('http://') && !u.startsWith('https://')) u = 'https://' + u;
    // Playwright 模式: 通过后端引擎导航
    if (playwrightMode) { pwNavigate(u); return; }
    // iframe 模式
    const tid = tabId || activeTabId;
    setTabs(prev => prev.map(t => { if (t.id !== tid) return t; const nh = t.history.slice(0, t.historyIdx + 1); nh.push(u); return { ...t, url: u, loading: true, history: nh, historyIdx: nh.length - 1 }; }));
    setUrlInput(u);
  };

  const goBack = () => { if (!activeTab || activeTab.historyIdx <= 0) return; const ni = activeTab.historyIdx - 1; const u = activeTab.history[ni]; setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, url: u, historyIdx: ni, loading: true } : t)); setUrlInput(u); };
  const goForward = () => { if (!activeTab || activeTab.historyIdx >= activeTab.history.length - 1) return; const ni = activeTab.historyIdx + 1; const u = activeTab.history[ni]; setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, url: u, historyIdx: ni, loading: true } : t)); setUrlInput(u); };

const handleLoad = useCallback((tabId: string) => {
setTabs(prev => prev.map(t => t.id === tabId ? { ...t, loading: false } : t));
const iframe = iframeRefs.current[tabId];
try { const doc = iframe?.contentDocument; if (doc?.title) setTabs(prev => prev.map(t => t.id === tabId ? { ...t, title: doc.title } : t)); } catch {}
// RPA 录制: 通过 postMessage 与 iframe 通信（解决跨域问题）
if (recording && iframe) {
  try {
    // 向 iframe 发送启动录制消息
    iframe.contentWindow?.postMessage({
      type: 'RPA_START_RECORDING',
      timestamp: Date.now(),
    }, '*');
  } catch (e) {
    console.warn('[RPA] 无法向iframe发送消息:', e);
  }
}
if (autoScan && tabId === activeTabId) setTimeout(() => scanIframe(tabId), 800);
}, [autoScan, activeTabId, recording]);

  const handleScan = () => { if (activeTabId) { setScanning(true); scanIframe(activeTabId).finally(() => setScanning(false)); } };

  // ===== Cookie 同步: 从本地浏览器导入 =====
  const handleSyncCookies = async () => {
    if (!activeTab?.url) { message.warning('请先打开网页'); return; }
    try {
      const domain = getHostname(activeTab.url);
      const resp = await fetch(`${gatewayUrl()}/v1/browser/cookies?domain=${encodeURIComponent(domain)}`);
      const data = await resp.json();
      if (!data.cookies?.length) { message.info(`未找到 ${domain} 的本地 Cookie`); return; }
      // 将 Cookie 注入到 iframe
      const iframe = iframeRefs.current[activeTabId];
      if (iframe?.contentWindow) {
        iframe.contentWindow.postMessage({ type: '__AI_SET_COOKIE__', cookies: data.cookies }, '*');
        message.success(`已同步 ${data.cookies.length} 个 Cookie (${domain})`);
      } else {
        message.warning('无法注入 Cookie');
      }
    } catch (e: any) { message.error(`Cookie 同步失败: ${e.message}`); }
  };

  // ===== 手动 Cookie 导入 =====
  const handleImportCookies = () => {
    if (!cookieText.trim()) { message.warning('请粘贴 Cookie'); return; }
    const iframe = iframeRefs.current[activeTabId];
    if (iframe?.contentWindow) { iframe.contentWindow.postMessage({ type: '__AI_SET_COOKIE__', cookies: cookieText }, '*'); message.success('Cookie 已注入'); }
    setShowCookieModal(false); setCookieText('');
  };

  useEffect(() => { const onFS = () => setFullscreen(!!document.fullscreenElement); document.addEventListener('fullscreenchange', onFS); return () => document.removeEventListener('fullscreenchange', onFS); }, []);

  // ===== 输入栏自动补全选项 =====
  const autoCompleteOptions = (() => {
    const opts: { value: string; label: React.ReactNode }[] = [];
    // 从历史记录补全
    const lower = urlInput.toLowerCase();
    for (const h of historyItems) {
      if (opts.length >= 15) break;
      if (!lower || h.url.toLowerCase().includes(lower) || h.title.toLowerCase().includes(lower)) {
        opts.push({
          value: h.url,
          label: (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
              <img src={getFaviconUrl(h.url)} style={{ width: 14, height: 14, borderRadius: 2 }} alt="" />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.title || h.url}</span>
              <span style={{ color: 'var(--muted-2)', fontSize: 9 }}>{getHostname(h.url)}</span>
            </div>
          ),
        });
      }
    }
    // 从书签补全
    for (const b of bookmarks) {
      if (opts.length >= 20) break;
      if (!lower || b.url.toLowerCase().includes(lower) || b.title.toLowerCase().includes(lower)) {
        if (!opts.find(o => o.value === b.url)) {
          opts.push({
            value: b.url,
            label: (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <StarFilled style={{ fontSize: 10, color: '#facc15' }} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.title}</span>
                <span style={{ color: 'var(--muted-2)', fontSize: 9 }}>{getHostname(b.url)}</span>
              </div>
            ),
          });
        }
      }
    }
    return opts;
  })();

  const widthClass = screenMode === 'mobile' ? '375px' : '100%';
  const hasScanResult = elements.length > 0;

  return (
    <div ref={containerRef} style={{
      borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--card)',
      display: 'flex', flexDirection: 'column', height: '100%',
      ...(fullscreen ? { position: 'fixed', inset: 0, zIndex: 9999, background: '#000' } : {}),
      ...style,
    }}>
      {/* ===== 标签栏 + 书签（合并为一行） ===== */}
      {!compact && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '2px 4px', background: 'var(--panel)', borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
          {tabs.map(tab => (
            <div key={tab.id} onClick={() => { setActiveTabId(tab.id); setUrlInput(tab.url); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: '4px 4px 0 0',
                cursor: 'pointer', fontSize: 11, maxWidth: 180,
                background: tab.id === activeTabId ? 'var(--card)' : 'transparent',
                color: tab.id === activeTabId ? 'var(--fg)' : 'var(--muted-2)',
                border: tab.id === activeTabId ? '1px solid var(--border)' : '1px solid transparent',
                borderBottom: tab.id === activeTabId ? 'none' : '1px solid var(--border)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
              {tab.loading && <ReloadOutlined spin style={{ fontSize: 8 }} />}
              {tab.url && <img src={getFaviconUrl(tab.url)} style={{ width: 12, height: 12, borderRadius: 2 }} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{tab.title || tab.url || '新标签页'}</span>
              <CloseOutlined style={{ fontSize: 8, opacity: 0.5 }} onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }} />
            </div>
          ))}
          <Tooltip title="新标签页"><Button size="small" type="text" icon={<PlusOutlined />} onClick={() => createTab('')} style={{ color: 'var(--muted-2)', fontSize: 10, height: 22, width: 22, flexShrink: 0 }} /></Tooltip>

          {/* 书签按钮（Popover 下拉，不占独立栏） */}
          {showBookmarkBar && bookmarks.length > 0 && (
            <Popover
              placement="bottomLeft"
              trigger="click"
              content={
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                  gap: 1,
                  maxHeight: 280,
                  overflowY: 'auto',
                  minWidth: 300,
                  padding: '2px 0',
                }}>
                  {bookmarks.map((bm, i) => (
                    <div
                      key={i}
                      onClick={() => { if (activeTabId) navigate(bm.url); else createTab(bm.url); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 5, padding: '4px 8px',
                        cursor: 'pointer', fontSize: 11, color: 'var(--fg)',
                        whiteSpace: 'nowrap', overflow: 'hidden',
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(99,102,241,0.08)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                    >
                      <img src={getFaviconUrl(bm.url)} style={{ width: 14, height: 14, borderRadius: 2, flexShrink: 0 }} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{bm.title}</span>
                    </div>
                  ))}
                </div>
              }
              title={<span style={{ fontSize: 11 }}>⭐ 书签 ({bookmarks.length})</span>}
            >
              <Button size="small" type="text" icon={<StarFilled style={{ color: '#facc15', fontSize: 10 }} />}
                style={{ color: 'var(--muted-2)', fontSize: 10, height: 22, flexShrink: 0, marginLeft: 2 }}
              />
            </Popover>
          )}
        </div>
      )}

      {/* ===== 收藏栏 (水平显示常用书签, 像浏览器一样) ===== */}
      {!compact && showBookmarkBar && bookmarks.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 2,
          padding: '1px 4px', background: 'var(--bg-2)',
          borderBottom: '1px solid var(--border)',
          overflowX: 'auto', height: 24, flexShrink: 0,
        }}>
          {bookmarks.slice(0, bookmarksExpanded ? 50 : 12).map((bm, i) => (
            <Tooltip key={i} title={bm.title} placement="bottom">
              <div
                onClick={() => { if (activeTabId) navigate(bm.url); else createTab(bm.url); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 3,
                  padding: '1px 6px', borderRadius: 3, cursor: 'pointer',
                  fontSize: 10, color: 'var(--muted-2)', whiteSpace: 'nowrap',
                  flexShrink: 0, maxWidth: 120, overflow: 'hidden',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(99,102,241,0.1)'; (e.currentTarget as HTMLElement).style.color = 'var(--fg)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--muted-2)'; }}
              >
                <img src={getFaviconUrl(bm.url)} style={{ width: 12, height: 12, borderRadius: 2, flexShrink: 0 }} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{bm.title}</span>
              </div>
            </Tooltip>
          ))}
          {bookmarks.length > 12 && (
            <Button size="small" type="text" onClick={() => setBookmarksExpanded(v => !v)}
              style={{ fontSize: 9, height: 20, flexShrink: 0, color: 'var(--muted-2)' }}>
              {bookmarksExpanded ? '收起' : `+${bookmarks.length - 12}`}
            </Button>
          )}
        </div>
      )}

      {/* ===== 导航栏 ===== */}
      {!hideToolbar && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: compact ? '3px 6px' : '4px 8px', background: 'var(--panel)', borderBottom: '1px solid var(--border)' }}>
        <Tooltip title="后退"><Button size="small" type="text" icon={<ArrowLeftOutlined />} disabled={!activeTab || activeTab.historyIdx <= 0} onClick={goBack} style={{ color: 'var(--muted-2)', height: compact ? 22 : 24, width: compact ? 22 : 24 }} /></Tooltip>
        <Tooltip title="前进"><Button size="small" type="text" icon={<ArrowRightOutlined />} disabled={!activeTab || activeTab.historyIdx >= activeTab.history.length - 1} onClick={goForward} style={{ color: 'var(--muted-2)', height: compact ? 22 : 24, width: compact ? 22 : 24 }} /></Tooltip>
        <Tooltip title="刷新"><Button size="small" type="text" icon={<ReloadOutlined />} loading={activeTab?.loading} onClick={() => { if (activeTab) { setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, loading: true } : t)); iframeRefs.current[activeTabId]?.contentWindow?.location.reload(); } }} style={{ color: 'var(--muted-2)', height: compact ? 22 : 24, width: compact ? 22 : 24 }} /></Tooltip>
        {/* 输入栏: 带自动补全 */}
        <AutoComplete
          style={{ flex: 1 }}
          value={urlInput}
          options={autoCompleteOptions}
          onChange={setUrlInput}
          onSelect={(val: string) => navigate(val)}
          filterOption={false}
        >
          <Input size="small" onPressEnter={() => navigate(urlInput)} placeholder="输入 URL 或搜索..."
            prefix={activeTab?.url ? <span style={{ width: 6, height: 6, borderRadius: '50%', background: activeTab.url.startsWith('https') ? '#22c55e' : '#f59e0b', display: 'inline-block' }} /> : null}
            suffix={<SendOutlined style={{ fontSize: 10, color: 'var(--muted-2)', cursor: 'pointer' }} onClick={() => navigate(urlInput)} />}
            style={{ fontSize: compact ? 10 : 11, height: compact ? 22 : 26, fontFamily: 'monospace' }}
          />
        </AutoComplete>
        {!compact && <Segmented size="small" value={screenMode} onChange={(v) => setScreenMode(v as 'desktop'|'mobile')} options={[{ label: <DesktopOutlined />, value:'desktop' },{ label: <MobileOutlined />, value:'mobile' }]} style={{ height: 24 }} />}
        {/* Playwright 引擎模式切换 */}
        <Tooltip title={playwrightMode ? ' playwright 引擎 (真实浏览器, 点击切换到 iframe)' : 'iframe 模式 (点击切换到 Playwright 引擎)'}>
          <Button size="small" type="text" icon={<ThunderboltOutlined style={{ color: playwrightMode ? '#818cf8' : 'var(--muted-2)' }} />} 
            onClick={() => setPlaywrightMode(v => !v)} style={{ height: compact ? 22 : 24, width: compact ? 22 : 24 }} />
        </Tooltip>
        {/* 代理模式 */}
        <Tooltip title={useProxyGlobal ? '代理模式 (绕过嵌入限制)' : '直连模式'}><Button size="small" type="text" icon={<SafetyCertificateOutlined style={{ color: useProxyGlobal ? 'var(--success)' : 'var(--muted-2)' }} />} onClick={() => setUseProxyGlobal(v => !v)} style={{ height: compact ? 22 : 24, width: compact ? 22 : 24 }} /></Tooltip>
        {/* 收藏栏开关 */}
        {!compact && <Tooltip title={showBookmarkBar ? '隐藏收藏栏' : '显示收藏栏'}><Button size="small" type="text" icon={showBookmarkBar ? <StarFilled style={{ color: 'var(--warning)' }} /> : <StarOutlined />} onClick={() => setShowBookmarkBar(v => !v)} style={{ color: 'var(--muted-2)', height: compact ? 22 : 24, width: compact ? 22 : 24 }} /></Tooltip>}
        {/* Cookie 同步 */}
        {!compact && <Tooltip title="从本地浏览器同步 Cookie (免登录)"><Button size="small" type="text" icon={<SafetyCertificateOutlined />} onClick={handleSyncCookies} style={{ color: 'var(--muted-2)', height: 24, width: 24 }} /></Tooltip>}
        {/* AI 状态 */}
        {aiControlled && (() => {
          const connected = playwrightMode ? pwConnected : wsConnected;
          const connLabel = playwrightMode ? 'PW 引擎' : 'AI 桥接';
          return (
            <Tooltip title={connected ? `${connLabel}${aiExecuting ? ' (执行中)' : ''}` : `${connLabel}未连接`}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '1px 6px', borderRadius: 4, background: connected ? aiExecuting ? 'rgba(250,204,21,0.15)' : 'rgba(99,102,241,0.15)' : 'rgba(239,68,68,0.15)', fontSize: 9, color: connected ? aiExecuting ? '#facc15' : '#818cf8' : '#ef4444' }}>
                <RobotOutlined style={{ fontSize: 8 }} />{aiExecuting ? '执行中' : connected ? '已连接' : '未连接'}
              </div>
            </Tooltip>
          );
        })()}
        {aiControlled && <Tooltip title={scanning ? '扫描中' : hasScanResult ? `${elements.length} 个元素` : '扫描'}><Button size="small" type="text" icon={scanning ? <ReloadOutlined spin /> : hasScanResult ? <CheckCircleOutlined style={{ color: 'var(--success)' }} /> : <ScanOutlined />} onClick={handleScan} style={{ color: hasScanResult ? 'var(--success)' : 'var(--muted-2)', height: compact ? 22 : 24 }} /></Tooltip>}
        {!compact && <Tooltip title="手动导入 Cookie"><Button size="small" type="text" icon={<SafetyCertificateOutlined />} onClick={() => setShowCookieModal(true)} style={{ color: 'var(--muted-2)', height: 24, width: 24 }} /></Tooltip>}
        {/* RPA 录制按钮 */}
        {!compact && (recording ? (
            <Tooltip title="停止录制并保存">
              <Button size="small" type="text" icon={<StopOutlined style={{ color: 'var(--danger)' }} />} onClick={handleStopRecording} style={{ height: 24, width: 24 }} />
            </Tooltip>
          ) : (
            <Tooltip title="开始录制操作 (RPA)">
              <Button size="small" type="text" icon={<VideoCameraOutlined style={{ color: 'var(--muted-2)' }} />} onClick={() => {
                setRecordStartUrl(activeTab?.url || '');
                setShowRecordModal(true);
              }} style={{ height: 24, width: 24 }} />
            </Tooltip>
          )
        )}
        {/* RPA 录制指示器 */}
        {recording && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '1px 8px', borderRadius: 4, background: 'var(--danger-soft)', fontSize: 9, color: 'var(--danger)' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--danger)', animation: 'pulse 1.5s infinite' }} />
            录制中 ({recordStepCount})
          </div>
        )}
        <Tooltip title={fullscreen ? '退出全屏' : '全屏'}><Button size="small" type="text" icon={fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />} onClick={() => { if (!fullscreen) containerRef.current?.requestFullscreen?.().catch(()=>{}); else document.exitFullscreen?.().catch(()=>{}); }} style={{ color: 'var(--muted-2)', height: compact ? 22 : 24, width: compact ? 22 : 24 }} /></Tooltip>
      </div>
      )}

      {/* ===== 内容区: Playwright Canvas 或 iframe ===== */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#fff', ...(screenMode === 'mobile' && !fullscreen ? { display: 'flex', justifyContent: 'center', padding: '8px 0' } : {}) }}>
        {/* Playwright Canvas 模式 */}
        {playwrightMode && (
          <>
            <canvas
              ref={canvasRef}
              onClick={handleCanvasClick}
              onKeyDown={handleCanvasKeyDown}
              onWheel={handleCanvasWheel}
              tabIndex={0}
              style={{
                width: widthClass, height: '100%', border: 'none',
                display: pwEngineStatus === 'running' ? 'block' : 'none',
                cursor: 'pointer', outline: 'none',
                ...(screenMode === 'mobile' ? { borderRadius: 12, boxShadow: '0 0 20px rgba(0,0,0,0.2)' } : {}),
              }}
            />
            {/* Playwright 空状态 */}
            {pwEngineStatus !== 'running' && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#999', fontSize: 13, flexDirection: 'column', gap: 8, position: 'absolute', inset: 0 }}>
                <ThunderboltOutlined style={{ fontSize: 40, color: playwrightMode ? '#818cf8' : '#ccc' }} />
                <div style={{ fontWeight: 600 }}>Playwright 浏览器引擎</div>
                <div style={{ fontSize: 11, color: '#bbb' }}>
                  {pwEngineStatus === 'starting' ? '正在启动 Chromium...' : '输入 URL 开始浏览，AI 可实时看到页面'}
                </div>
                {pwConnected && <div style={{ fontSize: 10, color: '#818cf8', marginTop: 4 }}>⚡ 截图流已连接</div>}
              </div>
            )}
            {/* Playwright AI 状态指示器 */}
            {aiControlled && pwEngineStatus === 'running' && (
              <div style={{ position: 'absolute', top: 4, right: 4, padding: '1px 6px', borderRadius: 4, background: aiExecuting ? 'rgba(250,204,21,0.85)' : 'rgba(99,102,241,0.85)', color: '#fff', fontSize: 9, display: 'flex', alignItems: 'center', gap: 3 }}>
                <ThunderboltOutlined style={{ fontSize: 8 }} />{aiExecuting ? 'AI 执行中' : 'PW 引擎'}
              </div>
            )}
          </>
        )}
        {/* iframe 模式 (降级) */}
        {!playwrightMode && tabs.map(tab => (
          <iframe key={tab.id} ref={el => { iframeRefs.current[tab.id] = el; }} src={tab.url ? buildIframeSrc(tab.url, tab.useProxy) : undefined} onLoad={() => handleLoad(tab.id)} title={`Browser-${tab.id}`}
            style={{ width: widthClass, height: '100%', border: 'none', display: tab.id === activeTabId ? 'block' : 'none', ...(screenMode === 'mobile' ? { borderRadius: 12, boxShadow: '0 0 20px rgba(0,0,0,0.2)' } : {}) }}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox" />
        ))}
        {tabs.length === 0 || !activeTab?.url ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#999', fontSize: 13, flexDirection: 'column', gap: 8, position: 'absolute', inset: 0 }}>
            <GlobalOutlined style={{ fontSize: 40, color: '#ccc' }} />
            <div style={{ fontWeight: 600 }}>智能体浏览器</div>
            <div style={{ fontSize: 11, color: '#bbb' }}>输入 URL 开始浏览，AI 可实时控制页面</div>
            {aiControlled && <div style={{ fontSize: 10, color: '#999', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}><ThunderboltOutlined style={{ color: '#818cf8' }} />{playwrightMode ? 'Playwright 引擎' : 'AI 桥接'} {(playwrightMode ? pwConnected : wsConnected) ? '✅ 已连接' : '⏳ 等待连接'}</div>}
            {bookmarks.length > 0 && <div style={{ fontSize: 10, color: '#999', marginTop: 2 }}>📚 已加载 {bookmarks.length} 个本地书签</div>}
          </div>
        ) : null}
        {aiControlled && activeTab?.url && (
          <div style={{ position: 'absolute', top: 4, right: 4, padding: '1px 6px', borderRadius: 4, background: aiExecuting ? 'rgba(250,204,21,0.85)' : 'rgba(99,102,241,0.85)', color: '#fff', fontSize: 9, display: 'flex', alignItems: 'center', gap: 3, transition: 'background 0.3s' }}>
            <RobotOutlined style={{ fontSize: 8 }} />{aiExecuting ? 'AI 执行中' : 'AI 控制'}
          </div>
        )}
        {hasScanResult && !compact && (
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '2px 8px', background: 'rgba(74,222,128,0.12)', borderTop: '1px solid rgba(74,222,128,0.2)', fontSize: 9, color: '#4ade80', display: 'flex', alignItems: 'center', gap: 4 }}>
            <CheckCircleOutlined style={{ fontSize: 8 }} />已识别 {elements.length} 个可交互元素
          </div>
        )}
      </div>

      {/* ===== 元素列表 ===== */}
      {!compact && aiControlled && hasScanResult && (
        <div style={{ maxHeight: 120, overflow: 'auto', borderTop: '1px solid var(--border)', background: 'var(--bg-2)', padding: '3px 6px' }}>
          <div style={{ fontSize: 9, color: 'var(--muted-2)', marginBottom: 2, display: 'flex', justifyContent: 'space-between' }}>
            <span>页面元素 (已发 AI 上下文)</span><span style={{ color: '#4ade80' }}>{elements.length} 个</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {elements.slice(0, 20).map((el, i) => (<Tag key={i} style={{ fontSize: 8, borderRadius: 2, lineHeight: '12px', height: 14, margin: 0, borderColor: el.interactivity > 80 ? '#4ade80' : 'var(--border)' }}>{el.tag}{el.text ? `: ${el.text.slice(0, 15)}` : ''}</Tag>))}
            {elements.length > 20 && <span style={{ fontSize: 8, color: 'var(--muted-2)' }}>+{elements.length - 20}</span>}
          </div>
        </div>
      )}

      {/* ===== Cookie 导入弹窗 ===== */}
      <Modal title="导入浏览器 Cookie / 配置" open={showCookieModal} onOk={handleImportCookies} onCancel={() => setShowCookieModal(false)} width={600}>
        <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--muted-2)' }}>粘贴 Cookie 字符串 (格式: key=value; key2=value2), 将注入到当前页面。<br />也可粘贴 JSON 格式的 Cookie 数组。</div>
        <Input.TextArea value={cookieText} onChange={e => setCookieText(e.target.value)} placeholder="key=value; key2=value2 ..." rows={6} style={{ fontFamily: 'monospace', fontSize: 11 }} />
      </Modal>

      {/* RPA 录制对话框 */}
      <Modal
        title="开始录制浏览器操作"
        open={showRecordModal}
        onOk={handleStartRecording}
        onCancel={() => setShowRecordModal(false)}
        okText="开始录制"
        cancelText="取消"
        width={450}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
          <div style={{ padding: '8px 12px', background: 'rgba(99,102,241,0.08)', borderRadius: 6, fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
            📹 录制模式下, 你在浏览器中的每次点击、输入、提交都会被自动记录为可回放的脚本。<br />
            录制完成后, 可以让 AI 定时回放或批量执行。
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4, display: 'block' }}>脚本名称</label>
            <Input value={recordName} onChange={e => setRecordName(e.target.value)} placeholder="如: 淘宝登录流程" />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4, display: 'block' }}>起始 URL</label>
            <Input value={recordStartUrl} onChange={e => setRecordStartUrl(e.target.value)} placeholder="https://..." />
          </div>
        </div>
      </Modal>
    </div>
  );
};
