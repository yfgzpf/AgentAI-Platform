/**
 * Browser Scan Route — 浏览器页面元素扫描端点
 * ----------------------------------------------------
 * POST /v1/browser/scan
 *   请求: { url: string, timeout?: number }
 *   返回: { elements: IdentifiedElement[] }
 *
 * 功能:
 *   - 通过 HTTP 请求获取页面 HTML
 *   - 解析 DOM, 提取可交互元素
 *   - 生成 CSS Selector
 *   - 为 AI 自动化提供界面结构
 */
import { Router, Request, Response } from 'express';

interface IdentifiedElement {
  tag: string;
  id?: string;
  className?: string;
  text?: string;
  type?: string;
  href?: string;
  placeholder?: string;
  selector: string;
  interactivity: number;
}

/** 客户端 JS 脚本, 注入到页面执行时提取全局元素 */
const EXTRACT_SCRIPT = `
(function() {
  const results = [];
  const interactives = ['a','button','input','select','textarea','details','summary'];
  const attrSelectors = ['[role=button]','[onclick]','[ng-click]','[v-on:click]'];

  function makeSelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    let path = [];
    let cur = el;
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
        if (siblings.length > 1) {
          const idx = siblings.indexOf(cur) + 1;
          sel += ':nth-of-type(' + idx + ')';
        }
      }
      path.unshift(sel);
      cur = cur.parentElement;
    }
    return path.join(' > ');
  }

  function score(el) {
    let s = 50;
    const tag = el.tagName.toLowerCase();
    if (interactives.includes(tag)) s += 30;
    if (el.getAttribute('role') === 'button') s += 20;
    if (el.onclick) s += 20;
    if (el.getAttribute('href')) s += 10;
    if (el.getAttribute('type') === 'submit') s += 10;
    if (el.style.cursor === 'pointer') s += 10;
    if (el.disabled) s -= 30;
    return Math.min(100, Math.max(0, s));
  }

  function scan(el, depth) {
    if (depth > 8) return;
    const tag = el.tagName.toLowerCase();
    const interactive = interactives.includes(tag) || attrSelectors.some(s => el.matches(s)) || score(el) >= 60;
    if (interactive) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        results.push({
          tag, selector: makeSelector(el),
          id: el.id || undefined,
          className: (el.className && typeof el.className === 'string') ? el.className.trim().split(/\\s+/).slice(0,3).join(' ') : undefined,
          text: (el.textContent || '').trim().slice(0, 60) || undefined,
          type: el.getAttribute('type') || undefined,
          href: el.getAttribute('href') || undefined,
          placeholder: el.getAttribute('placeholder') || undefined,
          interactivity: score(el),
        });
      }
    }
    if (el.children && depth < 8) {
      for (const child of el.children) scan(child, depth + 1);
    }
  }

  if (document.body) {
    for (const child of document.body.children) scan(child, 0);
  }
  results.sort((a, b) => b.interactivity - a.interactivity);
  return JSON.stringify(results.slice(0, 100));
})();
`;

/**
 * GET /v1/browser/proxy?url=xxx
 * 代理模式获取网页 — 去除 X-Frame-Options / CSP 头, 使页面可在 iframe 中嵌入
 * 重写相对 URL 为绝对路径, 注入 base 标签
 */
async function proxyUrl(targetUrl: string, res: Response, timeout = 15000) {
  try {
    const parsed = new URL(targetUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      res.status(400).json({ error: 'only http/https' });
      return;
    }
    const resp = await fetch(targetUrl, {
      signal: AbortSignal.timeout(timeout),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
    });
    const contentType = resp.headers.get('content-type') || 'text/html';
    let body = await resp.text();
    // 注入 <base> 标签, 使相对路径正确解析
    const baseTag = `<base href="${targetUrl}">`;
    if (/<head[^>]*>/i.test(body)) {
      body = body.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
    } else if (/<html[^>]*>/i.test(body)) {
      body = body.replace(/<html([^>]*)>/i, `<html$1><head>${baseTag}</head>`);
    } else {
      body = baseTag + body;
    }
    // 移除限制嵌入的 meta 标签
    body = body.replace(/<meta[^>]*http-equiv=["']?content-security-policy["']?[^>]*>/gi, '');
    // 设置响应头: 允许嵌入
    res.setHeader('Content-Type', contentType);
    res.setHeader('X-AgentAI-Proxy', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    // 不转发 X-Frame-Options 和 CSP
    res.send(body);
  } catch (err: any) {
    if (err.name === 'AbortError' || err.code === 'ABORT_ERR') {
      res.status(408).json({ error: 'proxy timeout' });
      return;
    }
    res.status(502).json({ error: err.message || 'proxy failed' });
  }
}

/** 服务端 HTML 解析提取元素 (兜底方案, 当无法执行 JS 时) */
function extractElementsFromHtml(html: string): IdentifiedElement[] {
  const elements: IdentifiedElement[] = [];
  // 简单标签匹配 (仅作为 fallback, 精确度不如 DOM 扫描)
  const tagPatterns = [
    { tag: 'a', attr: 'href', pattern: /<a\s[^>]*href=["']([^"']*)["'][^>]*>([^<]*)<\/a>/gi },
    { tag: 'button', attr: 'type', pattern: /<button\s[^>]*>([^<]*)<\/button>/gi },
    { tag: 'input', attr: 'type', pattern: /<input\s[^>]*type=["']([^"']*)["'][^>]*>/gi },
  ];

  for (const { tag, pattern } of tagPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const text = match[1] || '';
      elements.push({
        tag,
        text: text.slice(0, 60),
        type: tag === 'input' ? text : undefined,
        selector: tag,
        interactivity: tag === 'button' ? 85 : tag === 'input' ? 80 : 65,
      });
    }
  }

  return elements;
}

export function createBrowserRouter() {
  const router = Router();

  router.post('/v1/browser/scan', async (req: Request, res: Response) => {
    const { url, timeout = 8000 } = req.body;
    if (!url || typeof url !== 'string') {
      res.status(400).json({ error: 'url is required' });
      return;
    }

    try {
      // 验证 URL
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        res.status(400).json({ error: 'only http/https URLs are supported' });
        return;
      }

      // 优先使用 Playwright 引擎 (完整 JS 执行, 精确元素扫描)
      try {
        const { getBrowserEngine } = await import('../browser-engine.js');
        const engine = getBrowserEngine();
        // 如果引擎未启动, 先导航到 URL (会自动启动引擎)
        if (!engine.isRunning()) {
          await engine.start();
        }
        if (engine.isRunning()) {
          // 如果当前页面 URL 与请求不同, 先导航
          const currentUrl = engine.getCurrentUrl();
          if (currentUrl !== url) {
            await engine.navigate(url, 'domcontentloaded');
          }
          const elements = await engine.scanElements();
          res.json({
            url: engine.getCurrentUrl(),
            elements,
            total: elements.length,
            engine: 'playwright',
          });
          return;
        }
      } catch (engineErr: any) {
        console.warn('[browser/scan] Playwright 引擎不可用, 降级到 HTML 解析:', engineErr.message);
      }

      // 降级: 获取页面 HTML 并服务端解析
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeout),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
        },
      });

      if (!response.ok) {
        res.status(502).json({ error: `HTTP ${response.status}: ${response.statusText}`, elements: [] });
        return;
      }

      const html = await response.text();
      const elements = extractElementsFromHtml(html);

      res.json({
        url,
        elements: elements.slice(0, 80),
        total: elements.length,
        note: 'server-side HTML scan (limited precision, Playwright engine not available)',
      });
    } catch (err: any) {
      if (err.name === 'AbortError' || err.code === 'ABORT_ERR') {
        res.status(408).json({ error: 'scan timeout', elements: [] });
        return;
      }
      res.status(502).json({ error: err.message || 'scan failed', elements: [] });
    }
  });

  /**
   * POST /v1/browser/action
   * AI 浏览器操作: 填写表单/点击元素/选择/提交
   * 实际操作在前端 iframe 中执行, 后端只负责转发指令
   */
  router.post('/v1/browser/action', async (req: Request, res: Response) => {
    const { action, selector, value, url } = req.body;
    if (!action || !selector) {
      res.status(400).json({ error: 'action and selector are required' });
      return;
    }

    const validActions = ['click', 'fill', 'type', 'select', 'submit'];
    if (!validActions.includes(action)) {
      res.status(400).json({ error: `invalid action: ${action}. Valid: ${validActions.join(', ')}` });
      return;
    }

    // 返回操作指令, 前端通过 SSE 事件接收并执行
    res.json({
      success: true,
      action,
      selector,
      value: value || '',
      url: url || '',
      message: `浏览器操作: ${action} ${selector}${value ? ` = ${value}` : ''}`,
    });
  });

  /**
   * GET /v1/browser/proxy?url=xxx
   * 代理获取网页, 去除 X-Frame-Options/CSP, 使任意网站可在 iframe 中嵌入
   */
  router.get('/v1/browser/proxy', async (req: Request, res: Response) => {
    const targetUrl = (req.query.url as string) || '';
    if (!targetUrl) { res.status(400).json({ error: 'url query param required' }); return; }
    await proxyUrl(targetUrl, res);
  });

  /**
   * GET /v1/browser/status
   * 返回浏览器桥接状态
   */
  router.get('/v1/browser/status', async (_req: Request, res: Response) => {
    try {
      const { getBrowserBridge } = await import('../browser-bridge.js');
      const bridge = getBrowserBridge();
      res.json({ connected: bridge.isConnected() });
    } catch {
      res.json({ connected: false });
    }
  });

  /**
   * GET /v1/browser/bookmarks
   * 读取本地浏览器 (Chrome/Edge) 书签, 用于显示收藏栏
   */
  router.get('/v1/browser/bookmarks', async (_req: Request, res: Response) => {
    try {
      const { readBookmarks } = await import('../browser-profile.js');
      const bookmarks = readBookmarks();
      res.json({ bookmarks, total: bookmarks.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message, bookmarks: [] });
    }
  });

  /**
   * GET /v1/browser/history?q=keyword&limit=50
   * 读取本地浏览器历史记录, 用于输入栏自动补全
   */
  router.get('/v1/browser/history', async (req: Request, res: Response) => {
    try {
      const { readHistory } = await import('../browser-profile.js');
      const q = (req.query.q as string) || '';
      const limit = parseInt(req.query.limit as string) || 200;
      let history = await readHistory(limit * 2); // 多取一些用于过滤
      if (q) {
        const lower = q.toLowerCase();
        history = history.filter(h =>
          h.url.toLowerCase().includes(lower) || h.title.toLowerCase().includes(lower)
        );
      }
      res.json({ history: history.slice(0, limit), total: history.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message, history: [] });
    }
  });

  /**
   * GET /v1/browser/cookies?domain=example.com
   * 读取本地浏览器 Cookie, 用于内嵌浏览器免登录
   */
  router.get('/v1/browser/cookies', async (req: Request, res: Response) => {
    try {
      const { readCookies } = await import('../browser-profile.js');
      const domain = (req.query.domain as string) || '';
      const cookies = await readCookies(domain || undefined);
      res.json({ cookies, total: cookies.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message, cookies: [] });
    }
  });

  /**
   * GET /v1/browser/info
   * 返回本地浏览器信息 (哪些浏览器可用, 有哪些 profile)
   */
  router.get('/v1/browser/info', async (_req: Request, res: Response) => {
    try {
      const { getBrowserInfo } = await import('../browser-profile.js');
      const info = getBrowserInfo();
      res.json({ browsers: info });
    } catch (err: any) {
      res.status(500).json({ error: err.message, browsers: [] });
    }
  });

  /**
   * POST /v1/browser/rpa/record-step
   * 接收前端推送的录制步骤
   */
  router.post('/v1/browser/rpa/record-step', async (req: Request, res: Response) => {
    try {
      const { getRpaRecorder } = await import('../rpa-recorder.js');
      const recorder = getRpaRecorder();
      const result = recorder.recordStep(req.body);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  /**
   * GET /v1/browser/rpa/scripts
   * 列出所有 RPA 脚本
   */
  router.get('/v1/browser/rpa/scripts', async (_req: Request, res: Response) => {
    try {
      const { getRpaRecorder } = await import('../rpa-recorder.js');
      const recorder = getRpaRecorder();
      res.json({ scripts: recorder.listScripts() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * DELETE /v1/browser/rpa/scripts/:id
   * 删除 RPA 脚本
   */
  router.delete('/v1/browser/rpa/scripts/:id', async (req: Request, res: Response) => {
    try {
      const { getRpaRecorder } = await import('../rpa-recorder.js');
      const recorder = getRpaRecorder();
      const ok = recorder.deleteScript(req.params.id || '');
      res.json({ success: ok });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /v1/browser/rpa/record/start
   * 开始录制 RPA 脚本
   * body: { name: string, startUrl: string }
   */
  router.post('/v1/browser/rpa/record/start', async (req: Request, res: Response) => {
    try {
      const { getRpaRecorder } = await import('../rpa-recorder.js');
      const recorder = getRpaRecorder();
      const { name, startUrl } = req.body;
      if (!startUrl) { res.status(400).json({ error: 'startUrl is required' }); return; }
      const result = recorder.startRecording(name || `脚本-${Date.now()}`, startUrl);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  /**
   * POST /v1/browser/rpa/record/stop
   * 停止录制并保存
   * body: { description?: string }
   */
  router.post('/v1/browser/rpa/record/stop', async (req: Request, res: Response) => {
    try {
      const { getRpaRecorder } = await import('../rpa-recorder.js');
      const recorder = getRpaRecorder();
      const result = recorder.stopRecording(req.body?.description);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  /**
   * POST /v1/browser/rpa/record/cancel
   * 取消录制 (不保存)
   */
  router.post('/v1/browser/rpa/record/cancel', async (_req: Request, res: Response) => {
    try {
      const { getRpaRecorder } = await import('../rpa-recorder.js');
      const recorder = getRpaRecorder();
      recorder.cancelRecording();
      res.json({ success: true, message: '录制已取消' });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  /**
   * GET /v1/browser/rpa/record/status
   * 获取当前录制状态
   */
  router.get('/v1/browser/rpa/record/status', async (_req: Request, res: Response) => {
    try {
      const { getRpaRecorder } = await import('../rpa-recorder.js');
      const recorder = getRpaRecorder();
      res.json(recorder.getRecordingStatus());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /v1/browser/rpa/scripts/:id/replay
   * 回放指定 RPA 脚本
   * body: { variables?: Record<string, string> }
   */
  router.post('/v1/browser/rpa/scripts/:id/replay', async (req: Request, res: Response) => {
    try {
      const { getRpaRecorder } = await import('../rpa-recorder.js');
      const recorder = getRpaRecorder();
      const result = await recorder.replay(req.params.id || '', req.body?.variables);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /v1/browser/rpa/scripts
   * 手动创建 RPA 脚本 (不通过录制)
   * body: { name, description?, startUrl, steps, variables? }
   */
  router.post('/v1/browser/rpa/scripts', async (req: Request, res: Response) => {
    try {
      const { getRpaRecorder } = await import('../rpa-recorder.js');
      const recorder = getRpaRecorder();
      const { name, description, startUrl, steps, variables } = req.body;
      if (!name || !startUrl || !Array.isArray(steps)) {
        res.status(400).json({ error: 'name, startUrl, steps are required' });
        return;
      }
      const script = recorder.createScript({ name, description, startUrl, steps, variables });
      res.json({ success: true, script });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * PATCH /v1/browser/rpa/scripts/:id
   * 更新 RPA 脚本
   */
  router.patch('/v1/browser/rpa/scripts/:id', async (req: Request, res: Response) => {
    try {
      const { getRpaRecorder } = await import('../rpa-recorder.js');
      const recorder = getRpaRecorder();
      const updated = recorder.updateScript(req.params.id || '', req.body);
      if (!updated) { res.status(404).json({ error: '脚本不存在' }); return; }
      res.json({ success: true, script: updated });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /v1/browser/rpa/scripts/:id/transcribe
   * 将录制的 RPA 脚本转写为语义技能卡 (BrowserBC 范式)
   * 录制步骤 → LLM 转写 → 自然语言技能卡
   */
  router.post('/v1/browser/rpa/scripts/:id/transcribe', async (req: Request, res: Response) => {
    try {
      const { getRpaRecorder } = await import('../rpa-recorder.js');
      const recorder = getRpaRecorder();
      const card = await recorder.transcribeToSkill(req.params.id || '');
      if (!card) {
        res.status(404).json({ success: false, error: '脚本不存在或转写失败' });
        return;
      }
      res.json({ success: true, skillCard: card });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /v1/browser/rpa/scripts/:id/execute-skill
   * 按技能卡语义执行 (非机械回放, 使用 Playwright 引擎)
   * body: { variables?: Record<string, string> }
   */
  router.post('/v1/browser/rpa/scripts/:id/execute-skill', async (req: Request, res: Response) => {
    try {
      const { getRpaRecorder } = await import('../rpa-recorder.js');
      const recorder = getRpaRecorder();
      const result = await recorder.executeBySkill(req.params.id || '', req.body?.variables);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}
