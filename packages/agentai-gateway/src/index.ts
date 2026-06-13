// @ts-nocheck
/**
 * AgentAI Gateway 入口 (统一使用 app.ts 模块化路由)
 * ----------------------------------------------------
 * ⚠️ index.ts 现在仅作为启动器，所有路由逻辑在 app.ts 中实现。
 * 保留 legacy 兼容层，逐步迁移至 createApp。
 */

import path from 'path';
import fs from 'fs';
import { createApp, createServerHandle, startBackgroundJobs } from './app.js';
import { AgentAIRouter } from './llm-router.js';
import { ToolRegistry } from './tool-registry.js';
import { initGlobalSandbox } from './sandbox/index.js';
import { createSandboxRouter } from './sandbox/router.js';
import { scanProjectSkills, scanUserSkills } from './skills/loader.js';
import { startSkillWatcher } from './skills/watcher.js';
import { startEvolutionCleanupLoop } from './evolution.js';
import { frameworkSwitcher } from './frameworks/switcher.js';
import { MCP_HOSTS } from './mcp/config.js';
import { MCPHost } from './mcp/host.js';
import { getSessionManager } from './session-manager.js';
import { getPersistentMemory } from './persistent-memory.js';
import { getPromptEngine } from './prompts/engine.js';
import { getKnowledgeCache } from './knowledge-cache.js';
import { getSkillEvolver } from './skill-evolver.js';
import { RouterOptimizer } from './router-optimizer.js';

// ===== 启动时自动读 .env =====
function loadEnv() {
  const candidates: string[] = [
    process.env.AGENTAI_ENV_PATH || '',
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../../.env'),
    'F:/agentai-platform/.env',
  ].filter((p): p is string => !!p);
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const text = fs.readFileSync(p, 'utf-8');
      for (const line of text.split('\n')) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (m && m[1] && !process.env[m[1]] && m[2] !== undefined) {
          process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
        }
      }
      console.log(`[env] loaded from ${p}`);
      return;
    }
  }
  console.warn('[env] no .env found in', candidates);
}
loadEnv();

const PORT = parseInt(process.env.AGENTAI_PORT || '18789', 10);
const HOST = process.env.AGENTAI_HOST || '127.0.0.1';

// ===== 初始化核心组件 =====
const router = new AgentAIRouter();
const registry = new ToolRegistry();
const sessionManager = getSessionManager();

// ===== 持久记忆系统 =====
const persistentMemory = getPersistentMemory();
console.log('[persistent-memory] 持久记忆系统已初始化');

// ===== Sprint 1: Prompt 模板引擎 + 知识缓存 =====
const promptEngine = getPromptEngine();
const knowledgeCache = getKnowledgeCache();
console.log(`[prompts] 模板引擎已初始化 (${promptEngine.listTemplates().length} templates)`);
console.log(`[knowledge-cache] 知识缓存已加载 (${knowledgeCache.list().length} entries)`);

// ===== Sprint 3: Skill 进化 + 路由优化 =====
const skillEvolver = getSkillEvolver();
const routerOptimizer = new RouterOptimizer();
console.log('[skill-evolver] Skill 进化引擎已初始化');
console.log('[router-optimizer] 智能路由优化器已初始化');

// ===== 技能自动发现 =====
try {
  const projectSkills = scanProjectSkills();
  const userSkills = scanUserSkills();
  const totalSkills = projectSkills.length + userSkills.length;
  if (totalSkills > 0) {
    console.log(`[skills] discovered ${totalSkills} skills (${projectSkills.length} project, ${userSkills.length} user)`);
  }

  const skillsPaths = [
    path.join(process.cwd(), 'packages', 'agentai-skills'),
    path.join(process.cwd(), 'packages', 'agentai-gateway', 'src', 'skills', 'built-in'),
    path.join(require('os').homedir(), '.agentai', 'skills'),
  ].filter(p => fs.existsSync(p));
  startSkillWatcher(skillsPaths);
} catch (e: any) {
  console.warn('[skills] scan failed:', e?.message || e);
}

try {
  startEvolutionCleanupLoop();
} catch (e: any) {
  console.warn('[evolution] cleanup loop failed to start:', e?.message || e);
}

// ===== 创建 Express app + HTTP server =====
const deps: Record<string, any> = { router, registry, sessionManager, frameworkSwitcher, sandbox: null, persistentMemory, promptEngine, knowledgeCache, skillEvolver, routerOptimizer };
const app = createApp(deps);
const { httpServer, io } = createServerHandle(app);

// ===== 启动 =====
httpServer.listen(PORT, HOST, async () => {
  console.log(`[agentai-gateway] listening on http://${HOST}:${PORT}`);
  console.log(`[agentai-gateway] ${registry.list().length} tools registered`);

  // Sandbox 路由
  let sandboxInstance: any = null;
  try {
    initGlobalSandbox({
      audit: (e: any) => console.log(`[sandbox] ${e.type} ${e.verdict || ''} ${e.path || ''} ${e.reason || ''}`),
    }).then((sb: any) => {
      sandboxInstance = sb;
      deps.sandbox = sb;
      app.use('/v1/sandbox', createSandboxRouter(sb));
      console.log(`[sandbox] ready (rules: ${sb.getRulesPath()})`);
    }).catch((err: any) => {
      console.warn('[sandbox] init failed:', err.message);
    });
  } catch (e: any) {
    console.warn('[sandbox] init failed:', e.message);
  }

  // MCP: 连接外部服务器
  const mcpHost = new MCPHost(registry);
  for (const cfg of MCP_HOSTS) {
    if (cfg.enabled !== false) mcpHost.connect(cfg).catch((e: any) => console.warn(`[mcp] ${cfg.name}: ${e.message}`));
  }

  // 初始化 framework switcher
  await frameworkSwitcher.initActive({
    userId: 'gateway-bootstrap',
    workspace: process.cwd(),
    tools: registry.toLLMTools(),
  }).catch((err: any) => {
    console.warn('[agentai-gateway] framework init failed:', err.message);
  });

  // 后台任务 (skills watcher, evolution cleanup, cron dispatcher)
  try {
    startBackgroundJobs(path.join(process.cwd(), 'packages', 'agentai-skills'));
  } catch (e: any) {
    console.warn('[background] jobs failed to start:', e?.message);
  }
});

// ===== 优雅关闭 =====
process.on('SIGTERM', async () => {
  console.log('[agentai-gateway] shutting down...');
  persistentMemory.flushAll();  // 持久化所有 dirty session
  persistentMemory.stop();
  knowledgeCache.flush();  // 持久化知识缓存
  sandboxInstance?.stop();
  await registry.stop();
  httpServer.close();
  process.exit(0);
});
