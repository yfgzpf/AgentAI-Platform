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
import { createGovernorRouter } from './routes/governor.js';
import { execSync } from 'child_process';

// ===== CORS 配置 =====
const CORS_ORIGINS = (process.env.AGENTAI_CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174,http://localhost:5176,http://127.0.0.1:5176,http://localhost:1420,http://127.0.0.1:1420,http://127.0.0.1,http://localhost,tauri://localhost').split(',').map(o => o.trim());
import { filesRouter } from './routes/files.js';
import { createQQRouter } from './routes/qq.js';
import { createChannelRouter } from './routes/channel.js';
import { createCustomerRouter } from './routes/customer.js';
import { createVoiceRouter } from './routes/voice.js';
import { createHealthRouter, HealthRouterDeps } from './routes/health.js';
import { wechatRouter } from './routes/wechat.js';
import { getGlobalSandbox, type Sandbox } from './sandbox/index.js';
import { createSandboxRouter } from './sandbox/router.js';
import { createSkillsRouter } from './skills/router.js';
import { createBrowserRouter } from './routes/browser.js';
import { createBrowserEngineRouter, registerBrowserStreamSocket } from './routes/browser-engine-api.js';
import { parseFileRouter } from './routes/parse-file.js';
import { createCleanerRouter } from './routes/cleaner.js';
import { createKnowledgeRouter } from './routes/knowledge.js';
import { createGoalRouter } from './routes/goal.js';
import { createTaskSchedulerRouter } from './routes/task-scheduler.js';
import { createImageRouter } from './routes/image.js';
import { createVideoRouter } from './routes/video.js';
import { register3DRoutes } from './routes/3d-generate.js';
import { commercialModelsRouter } from './routes/commercial-models.js';
import { musicProxyRouter } from './routes/music-proxy.js';
import suggestionsRouter from './routes/suggestions.js';
import { createXuanjiRouter } from './routes/xuanji.js';
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
      // 允许: 无 origin (同源/curl) / 白名单 / 任意 localhost 变体
      if (!origin || CORS_ORIGINS.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) || origin === 'tauri://localhost') {
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
  // 沙箱路由: index.ts 在 createApp 之前已 initGlobalSandbox(), 此处 getGlobalSandbox() 可用
  const sandbox: Sandbox | null = getGlobalSandbox();
  if (sandbox) {
    try {
      app.use('/v1/sandbox', createSandboxRouter(sandbox));
      console.log('[sandbox] routes mounted at /v1/sandbox');
    } catch (e: any) {
      console.warn('[sandbox] router mount failed:', e.message);
    }
  } else {
    console.warn('[sandbox] not initialized, sandbox routes unavailable');
  }
  app.use(createSkillsRouter());
  // 注入行业引擎到 profile 路由 (支持行业切换时自动激活)
  if (deps.industryEngine) setIndustryEngine(deps.industryEngine);
  app.use('/v1/profile', createProfileRouter());
  app.use(createChatRouter(deps as ChatRouterDeps));
  app.use(createQQRouter());
  app.use(createChannelRouter()); // A5: 渠道桥接 + 外发消息 API
  app.use(createCustomerRouter()); // B2: 客户管理 API
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
app.use('/v1/browser/engine', createBrowserEngineRouter(deps.io));
app.use(parseFileRouter);

// ===== 系统管控员 AI 治理路由 =====
app.use(createGovernorRouter());

// ===== 系统依赖检测 (SetupWizard 使用) =====
app.get('/v1/system/check-dep', (req, res) => {
  const { execSync: _unused } = { execSync }; // already imported at top
  const cmd = req.query.cmd as string;
  if (!cmd) return res.status(400).json({ error: 'cmd required' });

  try {
    const output = execSync(cmd + ' --version 2>&1', { encoding: 'utf8', timeout: 5000 }).trim();
    const versionMatch = output.match(/(\d+\.\d+\.?\d*)/);
    res.json({ installed: true, version: versionMatch ? versionMatch[1] : output.slice(0, 50) });
  } catch {
    // 可能是 --version 不支持的命令 (如 reg query), 尝试直接运行
    try {
      execSync(cmd, { encoding: 'utf8', timeout: 5000, stdio: 'ignore' });
      res.json({ installed: true });
    } catch {
      res.json({ installed: false });
    }
  }
});

// ===== Evolution API — 让用户看到 AI 学到了什么 =====
app.get('/v1/evolution/list', async (req, res) => {
  try {
    const { readEvolution } = await import('./evolution.js');
    const limit = parseInt(req.query.limit as string) || 50;
    const entries = readEvolution(limit);
    res.json({ entries, total: entries.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/v1/evolution/summary', async (_req, res) => {
  try {
    const { getSummary } = await import('./evolution.js');
    const summary = getSummary();
    res.json(summary);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/v1/evolution/rules', async (_req, res) => {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');
    const ws = process.env.AGENTAI_WORKSPACE || process.cwd();
    const rulesFile = path.join(ws, '.agentai', 'evolved-rules.json');
    if (!fs.existsSync(rulesFile)) {
      res.json({ rules: [] });
      return;
    }
    const rules = JSON.parse(fs.readFileSync(rulesFile, 'utf-8'));
    res.json({ rules });
  } catch (err: any) {
    res.status(500).json({ error: err.message, rules: [] });
  }
});

app.delete('/v1/evolution/rules/:id', async (req, res) => {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const ws = process.env.AGENTAI_WORKSPACE || process.cwd();
    const rulesFile = path.join(ws, '.agentai', 'evolved-rules.json');
    if (!fs.existsSync(rulesFile)) {
      res.json({ success: false, error: '规则文件不存在' });
      return;
    }
    const rules = JSON.parse(fs.readFileSync(rulesFile, 'utf-8'));
    const ruleId = parseInt(req.params.id);
    const filtered = Array.isArray(rules) ? rules.filter((_: any, i: number) => i !== ruleId) : [];
    fs.writeFileSync(rulesFile, JSON.stringify(filtered, null, 2), 'utf-8');
    res.json({ success: true, remaining: filtered.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 通知历史 API
app.get('/v1/notifications/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const level = req.query.level as string | undefined;
    const { getNotificationEngine } = await import('./notification-engine.js');
    const engine = getNotificationEngine();
    const history = engine.getHistory(limit, level as any);
    const stats = engine.getStats();
    res.json({ history, stats });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 通知配置 API
app.post('/v1/notifications/config', async (req, res) => {
  try {
    const { getNotificationEngine } = await import('./notification-engine.js');
    const engine = getNotificationEngine();
    engine.updateConfig(req.body);
    res.json({ success: true, config: engine.getConfig() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/v1/notifications/config', async (_req, res) => {
  try {
    const { getNotificationEngine } = await import('./notification-engine.js');
    const engine = getNotificationEngine();
    res.json({ config: engine.getConfig() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 定时任务调度 API
app.get('/v1/schedules', async (req, res) => {
  try {
    const { getTaskScheduler } = await import('./task-scheduler.js');
    const scheduler = getTaskScheduler();
    const status = req.query.status as string | undefined;
    res.json({ schedules: scheduler.list(status as any) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/v1/schedules/:id', async (req, res) => {
  try {
    const { getTaskScheduler } = await import('./task-scheduler.js');
    const scheduler = getTaskScheduler();
    const s = scheduler.get(req.params.id);
    if (!s) return res.status(404).json({ error: 'not found' });
    res.json({ schedule: s });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/v1/schedules', async (req, res) => {
  try {
    const { getTaskScheduler } = await import('./task-scheduler.js');
    const scheduler = getTaskScheduler();
    const schedule = scheduler.create(req.body);
    res.json({ success: true, schedule });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/v1/schedules/:id/run', async (req, res) => {
  try {
    const { getTaskScheduler } = await import('./task-scheduler.js');
    const scheduler = getTaskScheduler();
    const result = await scheduler.runOnce(req.params.id);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/v1/schedules/:id', async (req, res) => {
  try {
    const { getTaskScheduler } = await import('./task-scheduler.js');
    const scheduler = getTaskScheduler();
    const updated = scheduler.update(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'not found' });
    res.json({ success: true, schedule: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/v1/schedules/:id', async (req, res) => {
  try {
    const { getTaskScheduler } = await import('./task-scheduler.js');
    const scheduler = getTaskScheduler();
    const ok = scheduler.delete(req.params.id);
    res.json({ success: ok });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 行业工作流模板 API
app.get('/v1/workflows/templates', async (req, res) => {
  try {
    const { getWorkflowEngine } = await import('./workflow-template-engine.js');
    const engine = getWorkflowEngine();
    const industry = req.query.industry as string | undefined;
    res.json({ templates: engine.listTemplates(industry) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/v1/workflows/templates/:id', async (req, res) => {
  try {
    const { getWorkflowEngine } = await import('./workflow-template-engine.js');
    const engine = getWorkflowEngine();
    const t = engine.getTemplate(req.params.id);
    if (!t) return res.status(404).json({ error: 'not found' });
    res.json({ template: t });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/v1/workflows/templates', async (req, res) => {
  try {
    const { getWorkflowEngine } = await import('./workflow-template-engine.js');
    const engine = getWorkflowEngine();
    const template = engine.createTemplate(req.body);
    res.json({ success: true, template });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/v1/workflows/templates/:id', async (req, res) => {
  try {
    const { getWorkflowEngine } = await import('./workflow-template-engine.js');
    const engine = getWorkflowEngine();
    const ok = engine.deleteTemplate(req.params.id);
    res.json({ success: ok });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/v1/workflows/run', async (req, res) => {
  try {
    const { getWorkflowEngine } = await import('./workflow-template-engine.js');
    const engine = getWorkflowEngine();
    const host = process.env.AGENTAI_HOST || '127.0.0.1';
    const port = process.env.AGENTAI_PORT || '18789';
    engine.setGatewayUrl(`http://${host}:${port}`);
    const { template_id, variables } = req.body;
    const execution = await engine.execute(template_id, variables);
    // 序列化 stepResults (Map → Object)
    const serializable = { ...execution, stepResults: Object.fromEntries(execution.stepResults) };
    res.json({ success: true, execution: serializable });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/v1/workflows/executions', async (req, res) => {
  try {
    const { getWorkflowEngine } = await import('./workflow-template-engine.js');
    const engine = getWorkflowEngine();
    const templateId = req.query.template_id as string | undefined;
    const limit = parseInt(req.query.limit as string) || 20;
    const executions = engine.listExecutions(templateId, limit);
    // 序列化 stepResults
    const serializable = executions.map(e => ({ ...e, stepResults: Object.fromEntries(e.stepResults) }));
    res.json({ executions: serializable });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/v1/workflows/executions/:id', async (req, res) => {
  try {
    const { getWorkflowEngine } = await import('./workflow-template-engine.js');
    const engine = getWorkflowEngine();
    const exec = engine.getExecution(req.params.id);
    if (!exec) return res.status(404).json({ error: 'not found' });
    const serializable = { ...exec, stepResults: Object.fromEntries(exec.stepResults) };
    res.json({ execution: serializable });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 工作流模板导出
app.get('/v1/workflows/templates/:id/export', async (req, res) => {
  try {
    const { getWorkflowEngine } = await import('./workflow-template-engine.js');
    const engine = getWorkflowEngine();
    const json = engine.exportTemplate(req.params.id);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="workflow-${req.params.id}.json"`);
    res.send(json);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 工作流模板导入
app.post('/v1/workflows/templates/import', async (req, res) => {
  try {
    const { getWorkflowEngine } = await import('./workflow-template-engine.js');
    const engine = getWorkflowEngine();
    const jsonStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const template = engine.importTemplate(jsonStr);
    res.json({ success: true, template });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
  app.use(createGoalRouter({ router: deps.router, registry: deps.registry, sessionManager: deps.sessionManager, persistentMemory: deps.persistentMemory }));
  app.use(createTaskSchedulerRouter());  // 定时任务调度器API
  app.use(createSettingsRouter({ router: deps.router }));
  app.use(createCleanerRouter());
  app.use('/v1/commercial-models', commercialModelsRouter);
  app.use('/v1/knowledge', createKnowledgeRouter());
  app.use(musicProxyRouter);
  app.use('/v1/suggestions', suggestionsRouter);
  app.use(createXuanjiRouter());  // PulseFlow Xuanji 核心认知框架

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
      const { proactiveEngine } = await import('./proactive-suggestion-engine.js');
      const workspace = (req.query.workspace as string) || process.cwd();
      const industry = (req.query.industry as string) || 'general';
      const suggestions = (proactiveEngine as any).buildSuggestions
        ? await (proactiveEngine as any).buildSuggestions(workspace, industry)
        : (proactiveEngine as any).getSuggestions
          ? (proactiveEngine as any).getSuggestions(workspace)
          : [];
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
    pingInterval: 60_000,   // 每 60 秒发一次 ping（减少频率）
    pingTimeout: 120_000,    // 120 秒没收到 pong 才断开（LLM 慢时事件循环可能阻塞）
    transports: ['websocket', 'polling'],
  });
  // 初始化浏览器桥接 (AI → 前端浏览器实时控制)
import('./browser-bridge.js').then(({ getBrowserBridge }) => {
getBrowserBridge().init(io);
console.log('[browser-bridge] 已初始化, 等待前端浏览器连接...');
}).catch((e: any) => console.warn('[browser-bridge] init failed:', e?.message));
// Playwright 浏览器引擎截图流 Socket.IO
registerBrowserStreamSocket(io);
console.log('[browser-engine] 截图流 Socket.IO 已注册');

// 通知引擎初始化
import('./notification-engine.js').then(({ getNotificationEngine }) => {
getNotificationEngine().init(io);
console.log('[notification-engine] 已初始化');
}).catch((e: any) => console.warn('[notification-engine] init failed:', e?.message));

// 工作流引擎初始化
import('./workflow-template-engine.js').then(({ getWorkflowEngine }) => {
getWorkflowEngine().init(io);
console.log('[workflow-engine] 已初始化, 支持实时进度推送');
}).catch((e: any) => console.warn('[workflow-engine] init failed:', e?.message));

return { httpServer, io };
}

/**
 * 启动后台任务
 * - 技能热加载 watcher
 * - evolution 文件清理循环
 * - session manager (内部已自动)
 * - 真定时反思 (cron dispatcher)
 */
export function startBackgroundJobs(skillsDir: string) {
  // 扫描并注册所有技能
  if (skillsDir && fs.existsSync(skillsDir)) {
    import('./skill-orchestrator.js').then(({ getSkillOrchestrator }) => {
      const orchestrator = getSkillOrchestrator();
      const count = orchestrator.scanDirectory(skillsDir);
      console.log(`[skills] 已扫描并注册 ${count} 个技能 from ${skillsDir}`);
      
      // 同时扫描装饰行业技能
      const decorationDir = path.join(skillsDir, 'decoration');
      if (fs.existsSync(decorationDir)) {
        const decoCount = orchestrator.scanDirectory(decorationDir);
        console.log(`[skills] 已扫描 ${decoCount} 个装饰行业技能`);
      }
      
      // 扫描营销获客技能
      const marketingDir = path.join(skillsDir, 'marketing');
      if (fs.existsSync(marketingDir)) {
        const marketingCount = orchestrator.scanDirectory(marketingDir);
        console.log(`[skills] 已扫描 ${marketingCount} 个营销获客技能`);
      }
    }).catch((e: any) => console.warn('[skills] scan failed:', e?.message));
  }

  startEvolutionCleanupLoop();
  getSessionManager();

  // P0-2: 真定时反思 + 自进化触发器
  import('./cron-dispatcher.js').then(({ CronDispatcher }) => {
    const cron = new CronDispatcher();
    cron.start();
  }).catch((e: any) => console.warn('[cron] start failed:', e?.message));

  // 恢复所有活跃的自动化任务 (SQLite 持久化的 cron 任务)
  const host = process.env.AGENTAI_HOST || '127.0.0.1';
  const port = process.env.AGENTAI_PORT || '18789';
  import('./automation-store.js').then(({ getAutomationStore, setDefaultGatewayUrl }) => {
    setDefaultGatewayUrl(`http://${host}:${port}`);
    getAutomationStore().then((store) => {
      store.resumeAll().catch((e: any) => console.warn('[automation] resumeAll failed:', e?.message));
    });
  }).catch((e: any) => console.warn('[automation] init failed:', e?.message));
}
