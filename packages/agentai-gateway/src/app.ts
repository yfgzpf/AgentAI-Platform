/**
 * Express App 配置
 * 把所有路由模块化, 替代 1000+ 行的 index.ts
 */
import express from 'express';
import cors from 'cors';
import * as path from 'path';
import { createServer } from 'http';
import { Server as IOServer } from 'socket.io';

import { createChatRouter, ChatRouterDeps } from './routes/chat.js';
import { createAdminRouter } from './routes/admin.js';
import { createSessionsRouter } from './routes/sessions.js';
import { createProfileRouter, setIndustryEngine } from './routes/profile.js';
import { createSettingsRouter } from './routes/settings.js';

// ===== CORS 配置 =====
const CORS_ORIGINS = (process.env.AGENTAI_CORS_ORIGINS || 'http://localhost:5173,http://localhost:5174,http://localhost:5176,http://localhost:1420,tauri://localhost').split(',').map(o => o.trim());
import { filesRouter } from './routes/files.js';
import { createQQRouter } from './routes/qq.js';
import { createVoiceRouter } from './routes/voice.js';
import { createHealthRouter, HealthRouterDeps } from './routes/health.js';
import { wechatRouter } from './routes/wechat.js';
import { getGlobalSandbox, type Sandbox } from './sandbox/index.js';
import { createSkillsRouter } from './skills/router.js';
import { createBrowserRouter } from './routes/browser.js';
import { parseFileRouter } from './routes/parse-file.js';
import { createCleanerRouter } from './routes/cleaner.js';
import { createGoalRouter } from './routes/goal.js';
import { createImageRouter } from './routes/image.js';
import { createVideoRouter } from './routes/video.js';
import { register3DRoutes } from './routes/3d-generate.js';
import { commercialModelsRouter } from './routes/commercial-models.js';
import { startSkillWatcher } from './skills/watcher.js';
import { startEvolutionCleanupLoop } from './evolution.js';
import { getSessionManager } from './session-manager.js';

export interface AppDeps {
  /** 共享依赖 (router / sessions / 等) */
  [key: string]: any;
  /** socket.io server instance */
  io?: IOServer;
}

export function createApp(deps: AppDeps) {
  const app = express();

  // ===== 中间件 =====
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || CORS_ORIGINS.includes(origin)) {
        callback(null, origin || CORS_ORIGINS[0]);
      } else {
        console.warn(`[cors] rejected origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  }));
  app.use(express.json({ limit: '50mb' }));

  // ===== 静态资源 =====
  app.use('/media', express.static(path.resolve(process.cwd(), '../../packages/agentai-skills/out')));

  // ===== 路由模块化 =====
  const sandbox: Sandbox | null = getGlobalSandbox();
  if (sandbox) {
    try {
      const { createSandboxRouter } = require('./sandbox/router.js');
      app.use('/v1/sandbox', createSandboxRouter(sandbox));
    } catch {
      // sandbox router 不可用, 静默跳过
    }
  }
  app.use(createSkillsRouter());
  // 注入行业引擎到 profile 路由 (支持行业切换时自动激活)
  if (deps.industryEngine) setIndustryEngine(deps.industryEngine);
  app.use(createProfileRouter());
  app.use(createChatRouter(deps as ChatRouterDeps));
  app.use(createQQRouter());
  app.use(createVoiceRouter());
  app.use(createHealthRouter(deps as HealthRouterDeps));
  app.use('/api/wechat', wechatRouter);
  app.use('/api/sessions', createSessionsRouter(deps.persistentMemory));
  app.use(createImageRouter());
  app.use(createVideoRouter());
  register3DRoutes(app);
  if (deps.router) {
    app.use(createAdminRouter({ ...deps }));
  } else {
    app.use(createAdminRouter({}));
  }
  app.use(filesRouter);
  app.use(createBrowserRouter());
  app.use(parseFileRouter);
  app.use(createGoalRouter({ router: deps.router, registry: deps.registry, sessionManager: deps.sessionManager, persistentMemory: deps.persistentMemory }));
  app.use(createSettingsRouter({ router: deps.router }));
  app.use(createCleanerRouter());
  app.use('/v1/commercial-models', commercialModelsRouter);

  // ===== IDE 状态感知 =====
  app.post('/v1/ide-state', (req, res) => {
    try {
      const { update_ide_state } = require('./ide-state.js');
      update_ide_state(req.body || {});
      res.json({ ok: true });
    } catch (e: any) {
      res.json({ ok: false, error: e.message });
    }
  });

  // ===== 任务计划 API =====
  app.get('/v1/plan', async (_req, res) => {
    try {
      const { _active_plan } = await import('./tools.js');
      res.json({ plan: _active_plan || null });
    } catch (e: any) {
      res.json({ plan: null });
    }
  });

  // ===== 主动建议引擎 =====
  app.get('/v1/suggestions', async (req, res) => {
    try {
      const { getProactiveEngine } = await import('./proactive-engine.js');
      const engine = getProactiveEngine();
      const workspace = (req.query.workspace as string) || process.cwd();
      const industry = (req.query.industry as string) || 'general';
      const suggestions = await engine.scan(workspace, industry, req.query.force === '1');
      res.json({ suggestions });
    } catch (e: any) {
      res.json({ suggestions: [] });
    }
  });

  // ===== 高风险操作审批 =====
  app.post('/v1/approve/:callId', async (req, res) => {
    try {
      const { callId } = req.params;
      const { approved } = req.body || {};
      // 通知 ToolRegistry 审批结果
      const registry = deps.registry;
      registry.emit('tool:approval_result', { callId, approved: !!approved });
      // 记录审计日志
      const { writeMemory } = await import('./memory.js');
      writeMemory({
        userId: 'audit',
        workspace: process.cwd(),
        role: 'system',
        content: `审批操作: callId=${callId}, ${approved ? '已批准' : '已拒绝'}`,
        source: 'auto_reflect',
        metadata: { type: 'audit', callId, approved },
      }).catch(() => {});
      res.json({ ok: true });
    } catch (e: any) {
      res.json({ ok: false, error: e.message });
    }
  });

  // ===== 审计日志查询 =====
  app.get('/v1/audit', async (req, res) => {
    try {
      const { readMemory } = await import('./memory.js');
      const mems = await readMemory({ userId: 'audit', workspace: process.cwd(), limit: 50 });
      const audits = mems.filter(m => m.metadata?.type === 'audit');
      res.json({ audits });
    } catch (e: any) {
      res.json({ audits: [] });
    }
  });

  // ===== 速率限制监控 =====
  app.get('/v1/rate-limit/status', async (req, res) => {
    try {
      if (!deps.router || !deps.router.getRateLimitStatus) {
        res.json({ error: '速率限制监控未启用' });
        return;
      }
      const status = deps.router.getRateLimitStatus();
      const availableModels = deps.router.getAvailableModels();
      res.json({
        status,
        availableModels,
        timestamp: new Date().toISOString(),
      });
    } catch (e: any) {
      res.json({ error: e.message });
    }
  });

  // ===== 全局错误处理中间件 (防止未捕获异常导致进程崩溃) =====
  app.use((err: any, req: any, res: any, _next: any) => {
    console.error(`[error] ${req.method} ${req.path}: ${err.message?.slice(0, 200)}`);
    if (res.headersSent) return;
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  });

  return app;
}

export interface ServerHandle {
  httpServer: any;
  io: IOServer;
}

export function createServerHandle(app: express.Express): ServerHandle {
  const httpServer = createServer(app);
  const io = new IOServer(httpServer, {
    cors: {
      origin: CORS_ORIGINS.length === 1 && CORS_ORIGINS[0] === '*' ? '*' : CORS_ORIGINS,
    },
    pingInterval: 25_000,   // 每 25 秒发一次 ping
    pingTimeout: 20_000,    // 20 秒没收到 pong 就断开
    transports: ['websocket', 'polling'],
  });
  return { httpServer, io };
}

/**
 * 启动后台任务
 * - 技能热加载 watcher
 * - evolution 文件清理循环
 * - session manager (内部已自动)
 * - 真定时反思 (cron dispatcher)
 */
export function startBackgroundJobs(_skillsDir: string) {
  startEvolutionCleanupLoop();
  getSessionManager();

  // P0-2: 真定时反思 + 自进化触发器
  import('./cron-dispatcher.js').then(({ CronDispatcher }) => {
    const cron = new CronDispatcher();
    cron.start();
  }).catch((e: any) => console.warn('[cron] start failed:', e?.message));
}
