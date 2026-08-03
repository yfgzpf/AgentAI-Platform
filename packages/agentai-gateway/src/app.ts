/**
 * Express App 配置
 * 把所有路由模块化, 替代 1000+ 行的 index.ts
 */
import express from 'express';
import cors from 'cors';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { Server as IOServer } from 'socket.io';

import { createChatRouter, ChatRouterDeps } from './routes/chat.js';
import { createAdminRouter } from './routes/admin.js';
import { createSessionsRouter, memoryRouter } from './routes/sessions.js';
import { createProfileRouter, setIndustryEngine } from './routes/profile.js';
import { createSettingsRouter } from './routes/settings.js';
import { createGovernorRouter } from './routes/governor.js';
import { execSync } from 'child_process';
import { validateCommand } from './safety/command-whitelist.js';
import { authMiddleware } from './middleware/auth.js';
import { MemoryManager } from './memory-manager.js';
import { MCP_HOSTS } from './mcp/config.js';

// ===== CORS 配置 =====
const CORS_ORIGINS = (process.env.AGENTAI_CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174,http://localhost:5176,http://127.0.0.1:5176,http://localhost:1420,http://127.0.0.1:1420,http://localhost:4173,http://127.0.0.1:4173,http://localhost:4174,http://127.0.0.1:4174,http://127.0.0.1,http://localhost,tauri://localhost,http://tauri.localhost,https://tauri.localhost').split(',').map(o => o.trim());
import { filesRouter } from './routes/files.js';
import { createQQRouter } from './routes/qq.js';
import { createChannelRouter } from './routes/channel.js';
import { createCustomerRouter } from './routes/customer.js';
import { createVoiceRouter } from './routes/voice.js';
import { ideRouter } from './routes/ide.js';
import { statsRouter } from './routes/stats.js';
import { createHealthRouter, HealthRouterDeps } from './routes/health.js';
import { wechatRouter } from './routes/wechat.js';
import { getGlobalSandbox, type Sandbox } from './sandbox/index.js';
import { createSandboxRouter } from './sandbox/router.js';
// 注意: skills/router.js (旧版) 与 routes/skills.js (新版) 提供同名 createSkillsRouter
// 当前统一使用 routes/skills.js, 因为它包含 /v1/skills/:name/execute 端点
// import { createSkillsRouter } from './skills/router.js';
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
import { createTasksRouter } from './routes/tasks.js';
import { createSkillsRouter } from './routes/skills.js';
import { startSkillWatcher } from './skills/watcher.js';
import { startEvolutionCleanupLoop } from './evolution.js';
import { getSessionManager } from './session-manager.js';
import { createModelsRouter } from './routes/models.js';
import { createAutomationRouter } from './routes/automation.js';
import gitRouter from './routes/git-simple.js';  // 使用简化版 Git 路由
import { createConnectorsRouter } from './routes/connectors.js';
import { createPresetWorkflowsRouter } from './routes/preset-workflows.js';
import { createQihuangRouter } from './routes/qihuang.js';
import { createRemoteRouter } from './routes/remote.js';
import { createPascalRouter } from './routes/pascal.js';

export interface AppDeps {
  /** 共享依赖 (router / sessions / 等) */
  [key: string]: any;
  /** socket.io server instance */
  io?: IOServer;
}

export async function createApp(deps: AppDeps) {
  const app = express();

  // ===== 中间件 =====
app.use(cors({
  origin: (origin, callback) => {
    // 允许: 无 origin (同源/curl) / 白名单 / 任意 localhost 变体 / tauri localhost
    if (!origin || CORS_ORIGINS.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) || /^https?:\/\/tauri\.localhost(:\d+)?$/.test(origin) || origin === 'tauri://localhost') {
      callback(null, origin || CORS_ORIGINS[0]);
    } else {
        console.warn(`[cors] rejected origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  }));
  app.use(express.json({ limit: '50mb' }));
  // 全局 token 认证（默认 disabled，通过 AGENTAI_AUTH_ENABLED=true 开启）
  app.use(authMiddleware);

  // ===== 静态资源 =====
  // 修复: 区分 dev / prod 环境的 /media 路径
  //   dev:  cwd 是 monorepo 根 → packages/agentai-skills/out
  //   prod: cwd 是 gateway-dist-v2/ → 使用 AGENTAI_HOME 下的 media 目录
  const mediaRoot = process.env.AGENTAI_DESKTOP === '1'
    ? path.join(process.env.AGENTAI_HOME || process.cwd(), 'skills-media')
    : path.resolve(process.cwd(), '../../packages/agentai-skills/out');
  app.use('/media', express.static(mediaRoot, { fallthrough: true }));
  console.log(`[static] /media → ${mediaRoot}`);


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
  // 技能执行API 移到下方 (line ~410) 一次性挂载, 避免重复
  // 注入行业引擎到 profile 路由 (支持行业切换时自动激活)
  if (deps.industryEngine) setIndustryEngine(deps.industryEngine);
  app.use('/v1/profile', createProfileRouter());
  app.use(createChatRouter(deps as ChatRouterDeps));
  app.use(createQQRouter());
  app.use(createChannelRouter()); // A5: 渠道桥接 + 外发消息 API
  app.use(createCustomerRouter()); // B2: 客户管理 API
  app.use(createVoiceRouter());
  app.use('/v1', ideRouter);  // IDE 状态推送 (编辑器上下文感知)
  app.use('/v1', statsRouter);  // 用量统计 API
  app.use(createHealthRouter(deps as HealthRouterDeps));
  app.use('/api/wechat', wechatRouter);
  app.use('/api/sessions', createSessionsRouter(deps.persistentMemory));
  app.use('/api/memory', memoryRouter);  // v3.1 跨会话记忆统计 (GUI 注入面板用)
  // 记忆可视化 API
  app.get('/v1/memory/list', (_req, res) => {
    try {
      const mm = MemoryManager.getInstance();
      mm.list().then((facts: any[]) => {
        res.json({ ok: true, facts: facts.map((f: any) => ({ key: f.key, value: f.value, scope: f.scope, createdAt: f.createdAt, updatedAt: f.updatedAt })) });
      }).catch(() => res.json({ ok: true, facts: [] }));
    } catch { res.json({ ok: true, facts: [] }); }
  });
  // MCP 配置 API
  app.get('/v1/mcp/config', (_req, res) => {
    try {
      const hosts = MCP_HOSTS.map((h: any) => ({ name: h.name, transport: h.transport, command: h.command, args: h.args, enabled: h.enabled, connected: h.connected || false }));
      res.json({ ok: true, servers: hosts });
    } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.patch('/v1/mcp/config/:name', (req, res) => {
    try {
      const { name } = req.params;
      const { enabled } = req.body;
      const host = MCP_HOSTS.find((h: any) => h.name === name);
      if (!host) return res.status(404).json({ ok: false, error: 'not found' });
      host.enabled = enabled;
      res.json({ ok: true, name, enabled });
    } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
  });
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
  const cmd = req.query.cmd as string;
  if (!cmd) return res.status(400).json({ error: 'cmd required' });

  // 安全: 命令白名单校验
  const validation = validateCommand(cmd);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.reason });
  }

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

/**
 * ══════════════════════════════════════════════════════════
 * POST /v1/system/auto-install — 首次启动自动安装 (P0 修复)
 * ══════════════════════════════════════════════════════════
 * 安装即开即用所需的缺失依赖:
 *   dep 白名单:
 *     - node:           不支持自动安装 (返回下载链接)
 *     - python:         不支持自动安装 (返回下载链接)
 *     - git:            不支持自动安装 (返回下载链接)
 *     - webview2:       不支持自动安装 (返回下载链接)
 *     - gateway-deps:   执行 npm install --production --legacy-peer-deps (gateway-dist-v2 内)
 *     - playwright:     执行 npx playwright install chromium
 *     - skills-check:   不安装, 仅检查 skills 目录, 返回 OK/MISSING
 *
 * 安全:
 *   - dep 严格白名单
 *   - 所有命令在 Gateway 工作区内执行 (cwd: 白名单目录)
 *   - 最长 10 分钟超时 (Playwright chromium 下载 ~3GB 需要时间)
 */
app.post('/v1/system/auto-install', async (req, res) => {
  const { dep } = req.body || {};
  const ALLOWED_DEPS = new Set([
    'gateway-deps', 'playwright', 'skills-check',
    'node', 'python', 'git', 'webview2',
  ]);
  if (!dep || !ALLOWED_DEPS.has(dep)) {
    return res.status(400).json({ ok: false, error: `dep 必须在白名单中: ${Array.from(ALLOWED_DEPS).join(', ')}` });
  }

  // --- 信息性检测: 仅返回下载链接 ---
  const INFO_DEPS: Record<string, { name: string; url: string; cmd: string }> = {
    node:     { name: 'Node.js v22 LTS', url: 'https://nodejs.org/dist/v22.16.0/node-v22.16.0-x64.msi', cmd: 'node --version' },
    python:   { name: 'Python 3.13',   url: 'https://www.python.org/ftp/python/3.13.3/python-3.13.3-amd64.exe', cmd: 'python --version' },
    git:      { name: 'Git for Windows', url: 'https://github.com/git-for-windows/git/releases/latest', cmd: 'git --version' },
    webview2: { name: 'Microsoft WebView2', url: 'https://go.microsoft.com/fwlink/p/?LinkId=2124703', cmd: 'reg query "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" /v pv' },
  };
  if (INFO_DEPS[dep]) {
    const info = INFO_DEPS[dep];
    let installed = false;
    let version: string | undefined;
    try {
      const output = execSync(`${info.cmd} 2>&1`, { encoding: 'utf8', timeout: 5000 }).trim();
      installed = true;
      const m = output.match(/(\d+\.\d+\.?\d*)/);
      version = m ? m[1] : output.slice(0, 40);
    } catch {}
    return res.json({
      ok: true,
      dep,
      installed,
      version,
      autoInstall: false,
      manualInstall: { name: info.name, url: info.url },
    });
  }

  // --- skills 目录检查 ---
  if (dep === 'skills-check') {
    // P0 分发修复: 打包后 monorepo 不存在, skills 从 Tauri resources 同级取
    //   Tauri resources 布局:
    //     resources/gateway-dist-v2/   <- cwd
    //     resources/agentai-skills/    <- 这里
    //   所以从 process.cwd()/../agentai-skills 开始找
    const candidates: string[] = [];
    if (process.env.AGENTAI_SKILLS_DIR) candidates.push(process.env.AGENTAI_SKILLS_DIR);
    candidates.push(path.resolve(process.cwd(), '..', 'agentai-skills'));
    candidates.push(path.resolve(process.cwd(), 'agentai-skills'));
    if (process.env.AGENTAI_HOME) {
      candidates.push(path.resolve(process.env.AGENTAI_HOME, '..', 'agentai-skills'));
      candidates.push(path.resolve(process.env.AGENTAI_HOME, 'agentai-skills'));
    }
    // 开发期 fallback
    candidates.push(path.resolve(process.cwd(), '..', '..', 'agentai-skills'));
    candidates.push(path.resolve(process.cwd(), 'packages', 'agentai-skills'));

    let skillsDir = '';
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)
            && fs.existsSync(path.join(p, 'scripts'))
            && fs.existsSync(path.join(p, 'README.md'))) {
          skillsDir = p;
          break;
        }
      } catch {}
    }

    const exists = !!skillsDir;
    return res.json({
      ok: true,
      dep,
      installed: exists,
      autoInstall: false,
      path: skillsDir || candidates[1],
      candidates,
      note: exists
        ? `SKILLS 目录存在: ${skillsDir}`
        : 'SKILLS 目录缺失: 打包时请确认 tauri.conf.json resources 包含 "../../agentai-skills" 映射',
    });
  }

  // --- gateway-deps: 在 gateway 工作区执行 npm install ---
  if (dep === 'gateway-deps') {
    const cwd = process.cwd();
    const pkgJson = path.join(cwd, 'package.json');
    if (!fs.existsSync(pkgJson)) {
      return res.status(412).json({
        ok: false,
        error: 'gateway-deps 无法自动安装: package.json 未找到',
        note: '请确保 Tauri resources 中打入了 gateway-dist-v2/package.json',
      });
    }
    // node_modules 已存在且有 express -> 跳过
    if (fs.existsSync(path.join(cwd, 'node_modules', 'express', 'package.json'))) {
      return res.json({ ok: true, dep, installed: true, autoInstall: true, skipped: 'already_installed' });
    }
    try {
      res.setHeader('Content-Type', 'application/json');
      res.flushHeaders?.();
      res.write(JSON.stringify({ ok: true, dep, status: 'installing', autoInstall: true }) + '\n');
      execSync(
        'npm install --production --ignore-scripts --no-optional --legacy-peer-deps',
        { cwd, stdio: 'inherit', timeout: 10 * 60 * 1000 }
      );
      return res.end(JSON.stringify({ ok: true, dep, installed: true, autoInstall: true }));
    } catch (e: any) {
      return res.status(500).json({
        ok: false,
        dep,
        autoInstall: true,
        error: e?.message || 'npm install 失败',
      });
    }
  }

  // --- playwright: npx playwright install chromium ---
  if (dep === 'playwright') {
    // 先检查是否已存在
    const pwDir = path.resolve(process.env.LOCALAPPDATA || process.env.HOME || '', 'ms-playwright');
    try {
      const check = execSync('npx playwright install chromium --dry-run 2>&1 || echo DRY_RUN_OK',
        { encoding: 'utf8', timeout: 10000 }
      );
      if (check.includes('already installed') || check.includes('DRY_RUN_OK')) {
        try {
          const entries = fs.existsSync(pwDir) ? fs.readdirSync(pwDir) : [];
          const hasChromium = entries.some(e => e.startsWith('chromium'));
          if (hasChromium) {
            return res.json({ ok: true, dep, installed: true, autoInstall: true, skipped: 'already_installed' });
          }
        } catch {}
      }
    } catch {}
    try {
      execSync('npx playwright install chromium', {
        cwd: process.cwd(),
        stdio: 'inherit',
        timeout: 10 * 60 * 1000,
      });
      return res.json({ ok: true, dep, installed: true, autoInstall: true });
    } catch (e: any) {
      return res.status(500).json({
        ok: false,
        dep,
        autoInstall: true,
        error: e?.message || 'playwright install 失败',
        manualInstall: {
          name: 'Playwright Chromium',
          url: 'https://playwright.dev/docs/browsers',
          cmd: 'npx playwright install chromium',
        },
      });
    }
  }

  res.status(500).json({ ok: false, error: 'unreachable' });
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

// ===== 监控面板 API (2026-07-31 新增) =====
app.use('/api/monitoring', async (req, res, next) => {
  try {
    const { default: monitoringRouter } = await import('./routes/monitoring.js');
    monitoringRouter(req, res, next);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 定时任务调度 API =====
// 安全守护: H7 修复 — 旧 inline 路由已被 createTaskSchedulerRouter() 完全遮蔽
// 旧 inline 版本无 /stats /pause /resume，前端调用会 404
// 委托给 router（router 在 line 432 之后才挂载，所以这里用 next() 透传）
// 实际生效靠 router 接管，inline 已被删除

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
  app.use(createSkillsRouter());        // 技能执行API (LLM/外部系统调用)
  app.use(createSettingsRouter({ router: deps.router }));
  app.use(createCleanerRouter());
  app.use('/v1/commercial-models', commercialModelsRouter);
  app.use('/v1/models', createModelsRouter(deps.router));
  app.use(createAutomationRouter(process.cwd(), deps.registry));  // 自动化引擎 API (注入 registry 让 cron 能找到工具)
  app.use('/v1/knowledge', createKnowledgeRouter());
  app.use(musicProxyRouter);
  app.use('/v1/suggestions', suggestionsRouter);
  app.use(createXuanjiRouter());  // PulseFlow Xuanji 核心认知框架
  app.use('/v1/tasks', createTasksRouter());  // 长任务快照与恢复 API
app.use('/v1/git', gitRouter);  // Git 版本控制 API (状态/diff/提交/推送)
app.use('/v1/qihuang', createQihuangRouter(deps.router));  // 岐枢四诊系统 API
app.use('/v1/remote', createRemoteRouter());  // 远程开发环境 API
app.use('/api/gateway/pascal', createPascalRouter());  // Pascal Editor 3D 建筑编辑器 API
app.use('/api/external-connections', (await import('./routes/external-connections.js')).default);  // 外部连接管理 API (Android/SketchUp/微信)

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
  // 安全守护: H8 修复 — 旧 inline /v1/suggestions 已被 suggestionsRouter 遮蔽
  // 实际生效靠 suggestionsRouter (line 432 后挂载)

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

  // Feature flags API (灰度开关)
  let _ff: any = null;
  const getFF = async () => { if (!_ff) _ff = await import('./feature-flags.js'); return _ff.FEATURE_FLAGS; };
  app.get('/v1/feature-flags', async (_req, res) => {
    const flags = await getFF();
    res.json({ ok: true, ...flags });
  });
  app.post('/v1/feature-flags', async (req, res) => {
    try {
      const flags = await getFF();
      const { useNewModelSelector, enableDiagnosisPipeline, newModelSelectorTrafficPercent } = req.body;
      if (typeof useNewModelSelector === 'boolean') flags.useNewModelSelector = useNewModelSelector;
      if (typeof enableDiagnosisPipeline === 'boolean') flags.enableDiagnosisPipeline = enableDiagnosisPipeline;
      if (typeof newModelSelectorTrafficPercent === 'number') flags.newModelSelectorTrafficPercent = newModelSelectorTrafficPercent;
      res.json({ ok: true, ...flags });
    } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ===== 外部连接器管理 API (Android/公众号/SketchUp) =====
  app.use('/api/connectors', createConnectorsRouter());

  // ===== 预置工作流 API (漫剧/公众号/数据分析等) =====
  app.use('/api/preset-workflows', createPresetWorkflowsRouter());

  // ===== 生产环境: 提供前端静态资源服务 =====
  // 当 GUI 构建产物存在时, 由 Gateway 统一托管前端, 避免跨域问题
  const appDirname = path.dirname(fileURLToPath(import.meta.url));
  const guiDist = path.resolve(appDirname, '../../agentai-gui/dist');
  if (fs.existsSync(guiDist)) {
    app.use(express.static(guiDist, { maxAge: 0, etag: true }));
    console.log(`[static] ✅ 前端静态资源已挂载: ${guiDist}`);
    // SPA 回退: 所有非 API 路径返回 index.html (支持前端路由)
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/v1/') || req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) {
        return next();
      }
      res.sendFile(path.join(guiDist, 'index.html'));
    });
  } else {
    console.log(`[static] ⚠️ 前端构建产物不存在: ${guiDist}`);
    console.log(`[static] 请先执行 "pnpm --filter @agentai/gui build" 构建前端`);
  }

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
export function startBackgroundJobs(skillsDir: string, io?: IOServer) {
  // 使用新的SkillManager扫描并注册所有技能
  if (skillsDir && fs.existsSync(skillsDir)) {
    import('./skill-manager.js').then(({ skillManager }) => {
      // 扫描主目录
      const count = skillManager.scanDirectory(skillsDir);
      console.log(`[SkillManager] 已扫描并注册 ${count} 个技能 from ${skillsDir}`);
      
      // 扫描装饰行业技能
      const decorationDir = path.join(skillsDir, 'decoration');
      if (fs.existsSync(decorationDir)) {
        const decoCount = skillManager.scanDirectory(decorationDir);
        console.log(`[SkillManager] 已扫描 ${decoCount} 个装饰行业技能`);
      }
      
      // 扫描营销获客技能
      const marketingDir = path.join(skillsDir, 'marketing');
      if (fs.existsSync(marketingDir)) {
        const marketingCount = skillManager.scanDirectory(marketingDir);
        console.log(`[SkillManager] 已扫描 ${marketingCount} 个营销获客技能`);
      }
      
      // 打印统计
      const stats = skillManager.getStats();
      console.log(`[SkillManager] 总计: ${stats.total} 个技能`, stats.byCategory);
    }).catch((e: any) => console.warn('[SkillManager] scan failed:', e?.message));
  }

  startEvolutionCleanupLoop();
  getSessionManager();

  // P0-2: 真定时反思 + 自进化触发器
  import('./cron-dispatcher.js').then(({ CronDispatcher }) => {
    const cron = new CronDispatcher();
    cron.start();

    // 将 CronDispatcher 事件连接到 Socket.IO 推送
    if (io) {
      cron.on('error-rate-alert', (data: any) => {
        io.emit('cron:alert', { type: 'error-rate', ...data });
      });
      cron.on('follow-up:tasks', (data: any) => {
        io.emit('cron:result', { type: 'follow-up', ...data });
      });
      // 通用 cron 执行结果推送
      cron.on('task:completed', (data: any) => {
        io.emit('execution:result', { source: 'cron', ...data });
      });
      cron.on('task:failed', (data: any) => {
        io.emit('execution:result', { source: 'cron', ...data });
      });
    }
  }).catch((e: any) => console.warn('[cron] start failed:', e?.message));

  // 恢复所有活跃的自动化任务 (SQLite 持久化的 cron 任务)
  const host = process.env.AGENTAI_HOST || '127.0.0.1';
  const port = process.env.AGENTAI_PORT || '18789';
  import('./automation-store.js').then(({ getAutomationStore, setDefaultGatewayUrl }) => {
    setDefaultGatewayUrl(`http://${host}:${port}`);
    getAutomationStore().then((store) => {
      store.resumeAll().catch((e: any) => console.warn('[automation] resumeAll failed:', e?.message));

      // 将 AutomationStore 事件连接到 Socket.IO + NotificationEngine
      if (io) {
        store.on('run:start', (data: any) => {
          io.emit('execution:result', { source: 'automation', event: 'start', ...data });
        });
        store.on('run:done', (data: any) => {
          io.emit('execution:result', { source: 'automation', event: 'done', ...data });
          io.emit('automation:result', data);  // 兼容旧事件名

          // 同时推送到通知引擎
          import('./notification-engine.js').then(({ getNotificationEngine }) => {
            getNotificationEngine().send({
              level: data.success ? 'success' : 'error',
              title: `自动化任务: ${data.name}`,
              body: data.success ? '执行成功' : `执行失败${data.error ? ': ' + data.error.slice(0, 100) : ''}`,
              source: 'automation',
              metadata: { taskId: data.id, durationMs: data.durationMs },
            });
          }).catch(() => {});
        });
      }
    });
  }).catch((e: any) => console.warn('[automation] init failed:', e?.message));

  // P2: 将定时任务调度器 (TaskScheduler) 事件连接到 Socket.IO
  import('./task-scheduler.js').then(({ getTaskScheduler }) => {
    const scheduler = getTaskScheduler();
    if (io) {
      scheduler.on('execution:result', (data: any) => {
        io.emit('execution:result', data);
        // 推送到通知引擎
        import('./notification-engine.js').then(({ getNotificationEngine }) => {
          getNotificationEngine().send({
            level: data.success ? 'success' : 'error',
            title: `定时任务: ${data.name}`,
            body: data.success ? '执行成功' : `执行失败${data.error ? ': ' + data.error.slice(0, 100) : ''}`,
            source: 'cron',
            metadata: { taskId: data.id, durationMs: data.durationMs },
          });
        }).catch(() => {});
      });
    }
  }).catch((e: any) => console.warn('[task-scheduler] event connect failed:', e?.message));
}
