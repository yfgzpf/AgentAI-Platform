/**
 * Browser Engine API — Playwright 浏览器引擎 REST 端点
 * ====================================================
 * 提供完整的浏览器控制能力:
 *
 *   POST /v1/browser/engine/navigate      — 导航到 URL
 *   GET  /v1/browser/engine/screenshot    — 截图
 *   POST /v1/browser/engine/click         — 点击元素
 *   POST /v1/browser/engine/type          — 输入文本
 *   POST /v1/browser/engine/submit        — 提交表单
 *   POST /v1/browser/engine/select        — 下拉选择
 *   POST /v1/browser/engine/hover         — 悬停
 *   POST /v1/browser/engine/press         — 按键
 *   POST /v1/browser/engine/scroll        — 滚动
 *   POST /v1/browser/engine/click-at      — 坐标点击
 *   POST /v1/browser/engine/type-at       — 坐标输入
 *   POST /v1/browser/engine/extract       — 提取数据
 *   GET  /v1/browser/engine/scan          — 扫描元素
 *   POST /v1/browser/engine/evaluate      — 执行 JS
 *   POST /v1/browser/engine/wait          — 等待元素
 *   POST /v1/browser/engine/cookies       — 设置 Cookie
 *   GET  /v1/browser/engine/cookies       — 获取 Cookie
 *   GET  /v1/browser/engine/tabs          — 标签页列表
 *   POST /v1/browser/engine/tabs          — 新建标签页
 *   DELETE /v1/browser/engine/tabs/:id    — 关闭标签页
 *   POST /v1/browser/engine/tabs/:id/active — 切换标签页
 *   GET  /v1/browser/engine/status        — 引擎状态
 *   POST /v1/browser/engine/start         — 启动引擎
 *   POST /v1/browser/engine/stop          — 停止引擎
 *   GET  /v1/browser/engine/snapshot      — 截图 + 元素快照 (AI 一次获取)
 */
import { Router, Request, Response } from 'express';
import { getBrowserEngine } from '../browser-engine.js';

export function createBrowserEngineRouter(io?: any): Router {
  const router = Router();
  const engine = getBrowserEngine();

  // ===== 状态管理 =====
  router.get('/status', (_req: Request, res: Response) => {
    res.json({
      running: engine.isRunning(),
      activeTabId: engine.getActiveTabId(),
      currentUrl: engine.getCurrentUrl(),
      engine: 'playwright',
    });
  });

  router.post('/start', async (_req: Request, res: Response) => {
    try {
      const ok = await engine.start();
      res.json({ success: ok, running: engine.isRunning() });
    } catch (e: any) {
      console.error('[browser-engine-api] start 失败:', e.message);
      res.status(500).json({ success: false, running: false, error: e.message });
    }
  });

  router.post('/stop', async (_req: Request, res: Response) => {
    await engine.stop();
    res.json({ success: true });
  });

  // ===== 导航 =====
  router.post('/navigate', async (req: Request, res: Response) => {
    try {
      const { url, waitFor } = req.body;
      if (!url) { res.status(400).json({ error: '缺少 url' }); return; }
      const result = await engine.navigate(url, waitFor || 'domcontentloaded');
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ===== 截图 =====
  router.get('/screenshot', async (req: Request, res: Response) => {
    try {
      const selector = (req.query.selector as string) || undefined;
      const fullPage = req.query.fullPage === 'true';
      const result = await engine.screenshot(selector, fullPage);
      // 直接返回 JPEG 图片 (浏览器可直接显示)
      const buf = Buffer.from(result.base64, 'base64');
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(buf);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/screenshot/base64', async (req: Request, res: Response) => {
    try {
      const selector = (req.query.selector as string) || undefined;
      const fullPage = req.query.fullPage === 'true';
      const result = await engine.screenshot(selector, fullPage);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ===== 快照 (截图 + 元素, AI 一次获取全部视觉信息) =====
  router.get('/snapshot', async (req: Request, res: Response) => {
    try {
      const fullPage = req.query.fullPage === 'true';
      const shot = await engine.screenshot(undefined, fullPage);
      const elements = await engine.scanElements();
      res.json({
        screenshot: shot,
        elements,
        url: engine.getCurrentUrl(),
        activeTabId: engine.getActiveTabId(),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ===== 交互操作 =====
  router.post('/click', async (req: Request, res: Response) => {
    try {
      const { selector, waitMs } = req.body;
      if (!selector) { res.status(400).json({ error: '缺少 selector' }); return; }
      await engine.click(selector, waitMs || 1000);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/type', async (req: Request, res: Response) => {
    try {
      const { selector, text, pressEnter } = req.body;
      if (!selector || text === undefined) { res.status(400).json({ error: '缺少 selector 或 text' }); return; }
      await engine.type(selector, text, pressEnter || false);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/submit', async (req: Request, res: Response) => {
    try {
      const { selector } = req.body;
      if (!selector) { res.status(400).json({ error: '缺少 selector' }); return; }
      await engine.submit(selector);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/select', async (req: Request, res: Response) => {
    try {
      const { selector, value } = req.body;
      if (!selector || value === undefined) { res.status(400).json({ error: '缺少 selector 或 value' }); return; }
      await engine.select(selector, value);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/hover', async (req: Request, res: Response) => {
    try {
      const { selector } = req.body;
      if (!selector) { res.status(400).json({ error: '缺少 selector' }); return; }
      await engine.hover(selector);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/press', async (req: Request, res: Response) => {
    try {
      const { key } = req.body;
      if (!key) { res.status(400).json({ error: '缺少 key' }); return; }
      await engine.pressKey(key);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/scroll', async (req: Request, res: Response) => {
    try {
      const { direction, amount } = req.body;
      await engine.scroll(direction || 'down', amount || 3);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/scroll-to', async (req: Request, res: Response) => {
    try {
      const { selector } = req.body;
      if (!selector) { res.status(400).json({ error: '缺少 selector' }); return; }
      await engine.scrollTo(selector);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ===== 坐标交互 (前端 Canvas 鼠标映射) =====
  router.post('/click-at', async (req: Request, res: Response) => {
    try {
      const { x, y } = req.body;
      if (x === undefined || y === undefined) { res.status(400).json({ error: '缺少 x, y' }); return; }
      await engine.clickAt(x, y);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/type-at', async (req: Request, res: Response) => {
    try {
      const { x, y, text, pressEnter } = req.body;
      if (x === undefined || y === undefined || text === undefined) { res.status(400).json({ error: '缺少 x, y 或 text' }); return; }
      await engine.typeAt(x, y, text, pressEnter || false);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ===== 数据提取 =====
  router.post('/extract', async (req: Request, res: Response) => {
    try {
      const { selector, extractType, fields } = req.body;
      const result = await engine.extract(selector, extractType || 'text', fields);
      res.json({ success: true, data: result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ===== 扫描 =====
  router.get('/scan', async (_req: Request, res: Response) => {
    try {
      const elements = await engine.scanElements();
      res.json({ elements });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ===== JS 执行 =====
  router.post('/evaluate', async (req: Request, res: Response) => {
    try {
      const { code } = req.body;
      if (!code) { res.status(400).json({ error: '缺少 code' }); return; }
      const result = await engine.evaluate(code);
      res.json({ success: true, result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ===== 等待 =====
  router.post('/wait', async (req: Request, res: Response) => {
    try {
      const { selector, timeout } = req.body;
      if (!selector) { res.status(400).json({ error: '缺少 selector' }); return; }
      await engine.waitFor(selector, timeout || 10000);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ===== Cookie =====
  router.post('/cookies', async (req: Request, res: Response) => {
    try {
      const { cookies } = req.body;
      if (!Array.isArray(cookies)) { res.status(400).json({ error: '缺少 cookies 数组' }); return; }
      const count = await engine.setCookies(cookies);
      res.json({ success: true, count });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/cookies', async (_req: Request, res: Response) => {
    try {
      const cookies = await engine.getCookies();
      res.json({ cookies });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ===== 标签页 =====
  router.get('/tabs', async (_req: Request, res: Response) => {
    try {
      const tabs = await engine.listPages();
      res.json({ tabs, activeTabId: engine.getActiveTabId() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/tabs', async (req: Request, res: Response) => {
    try {
      const { url } = req.body;
      const info = await engine.newPage(url);
      res.json(info);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete('/tabs/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      if (!id) { res.status(400).json({ error: 'Missing tab id' }); return; }
      const ok = await engine.closePage(id);
      res.json({ success: ok });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/tabs/:id/active', async (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      if (!id) { res.status(400).json({ error: 'Missing tab id' }); return; }
      const ok = engine.switchTab(id);
      res.json({ success: ok });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}

/**
 * 注册 Socket.IO 截图流事件
 * 前端通过 'browser:stream:subscribe' 订阅, 'browser:stream:unsubscribe' 取消
 * 后端推送 'browser:stream:frame' 事件
 */
export function registerBrowserStreamSocket(io: any): void {
  const engine = getBrowserEngine();
  const ns = io.of('/browser');

  ns.on('connection', (socket: any) => {
    console.log('[browser-stream] 客户端连接:', socket.id);

    socket.on('subscribe', () => {
      const unsub = engine.subscribeStream((data) => {
        socket.emit('frame', data);
      });
      // 存储 unsub 到 socket 上, 断开时清理
      (socket as any)._browserUnsub = unsub;
      console.log('[browser-stream] 已订阅:', socket.id);
    });

    socket.on('unsubscribe', () => {
      const unsub = (socket as any)._browserUnsub;
      if (unsub) { unsub(); (socket as any)._browserUnsub = null; }
    });

    // 前端鼠标事件 → 执行真实操作
    socket.on('mouse:click', async (data: { x: number; y: number }) => {
      try {
        await engine.clickAt(data.x, data.y);
        socket.emit('mouse:click:result', { success: true });
      } catch (e: any) {
        socket.emit('mouse:click:result', { success: false, error: e.message });
      }
    });

    socket.on('mouse:scroll', async (data: { direction: 'up' | 'down'; amount?: number }) => {
      try {
        await engine.scroll(data.direction, data.amount || 3);
      } catch {}
    });

    socket.on('keyboard:type', async (data: { text: string }) => {
      try {
        const page = (engine as any).getActivePage?.();
        if (page) await page.keyboard.type(data.text);
      } catch {}
    });

    socket.on('keyboard:press', async (data: { key: string }) => {
      try {
        await engine.pressKey(data.key);
      } catch {}
    });

    socket.on('navigate', async (data: { url: string }) => {
      try {
        const result = await engine.navigate(data.url);
        socket.emit('navigate:result', { success: true, ...result });
      } catch (e: any) {
        socket.emit('navigate:result', { success: false, error: e.message });
      }
    });

    socket.on('disconnect', () => {
      const unsub = (socket as any)._browserUnsub;
      if (unsub) { unsub(); }
      console.log('[browser-stream] 客户端断开:', socket.id);
    });
  });
}
