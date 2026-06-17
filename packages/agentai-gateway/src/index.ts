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
import { EXTRA_TOOLS, EXTRA_HANDLERS } from './tools.js';
import { startSkillWatcher } from './skills/watcher.js';
import { startEvolutionCleanupLoop } from './evolution.js';
import { frameworkSwitcher } from './frameworks/switcher.js';
import { AutoSkillDiscovery, buildSkillsIndexXml } from './auto-skill-discovery.js';
import { MCP_HOSTS } from './mcp/config.js';
import { MCPHost } from './mcp/host.js';
import { getSessionManager } from './session-manager.js';
import { getPersistentMemory } from './persistent-memory.js';
import { getPromptEngine } from './prompts/engine.js';
import { getKnowledgeCache } from './knowledge-cache.js';
import { getSkillEvolver } from './skill-evolver.js';
import { RouterOptimizer } from './router-optimizer.js';
import { fts5Memory } from './fts5-memory.js';
import { UserBehaviorPredictor } from './user-behavior-predictor.js';
import { DataPredictor } from './data-predictor.js';
import { SmartModelSwitcher } from './smart-model-switcher.js';
import { builtInToolsManager } from './builtin-tools-manager.js';
import { userModel } from './user-model.js';
import { DeepSeekCacheStrategy } from './deepseek-cache-strategy.js';
import { industryEngine } from './industry-engine.js';
import { skillOrchestrator } from './skill-orchestrator.js';
import { createQQRouter, setQQIO } from './routes/qq.js';
import { setWechatIO } from './routes/wechat.js';
import { WorkspaceManager } from './workspace-manager.js';

// ===== 启动时自动读 .env =====
function loadEnv() {
  const candidates: string[] = [
    process.env.AGENTAI_ENV_PATH || '',
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../.env'),
    path.resolve(process.cwd(), '../../.env'),
    path.resolve(process.cwd(), '../../.env.local'),
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

// ===== 内置工具管理器：检查工具可用性并自动安装缺失工具 =====
console.log('[builtin-tools-manager] 检查内置工具可用性...');
const toolAvailability = builtInToolsManager.checkAllTools();
const unavailableRequired = Array.from(toolAvailability.entries())
  .filter(([name, isAvailable]) => {
    const tool = builtInToolsManager.getTool(name);
    return tool?.required && !isAvailable;
  })
  .map(([name]) => name);

if (unavailableRequired.length > 0) {
  console.warn(`[builtin-tools-manager] ⚠️ 缺失必需工具: ${unavailableRequired.join(', ')}`);
  console.log('[builtin-tools-manager] 自动安装缺失工具...');
  const installResult = builtInToolsManager.installMissingTools();
  console.log(`[builtin-tools-manager] 安装完成: 成功 ${installResult.installed.length}, 失败 ${installResult.failed.length}`);
} else {
  console.log('[builtin-tools-manager] ✅ 所有必需工具都已可用');
}

const PORT = parseInt(process.env.AGENTAI_PORT || '18789', 10);
const HOST = process.env.AGENTAI_HOST || '127.0.0.1';

// ===== 初始化核心组件 =====
const router = new AgentAIRouter();
// .env 加载后重新检查 API Key (修复 import 时序导致的 tripped 问题)
router.recheckApiKeys();
const registry = new ToolRegistry();

// ===== 注册内置工具 (EXTRA_TOOLS + EXTRA_HANDLERS) =====
for (const spec of EXTRA_TOOLS) {
  const handler = EXTRA_HANDLERS[spec.name];
  if (!handler) { console.warn(`[tools] no handler for ${spec.name}`); continue; }
  registry.register({
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    parallelSafe: spec.parallelSafe,
    riskLevel: spec.riskLevel,
    handler: handler as any,
  });
}
console.log(`[tools] ${registry.list().length} tools registered`);

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

// ===== 用户行为预判 + 数据预判（安全保护） =====
const userBehaviorPredictor = new UserBehaviorPredictor({
  enabled: true,
  analyzeSensitiveData: false,
  sendToExternalServer: false,
});
const dataPredictor = new DataPredictor({
  enabled: true,
  predictSensitiveData: false,
  sendToExternalServer: false,
  enableRateLimitProtection: true,
});
console.log('[user-behavior-predictor] 用户行为预判系统已初始化（安全保护已启用）');
console.log('[data-predictor] 数据预判系统已初始化（安全保护已启用）');

// ===== 智能模型切换机制（AI自主决策） =====
const smartModelSwitcher = new SmartModelSwitcher();
console.log('[smart-model-switcher] 智能模型切换处理器已初始化');
console.log('[smart-model-switcher] AI可自主决策何时切换到商用API，避免任务中断');

// ===== TRAE Skills 自动发现 (20+ skills: docx/pdf/pptx/xlsx/web-dev) =====
const traeSkillDiscovery = new AutoSkillDiscovery();
const traeSkills = traeSkillDiscovery.discover();
if (traeSkills.length > 0) {
  console.log(`[trae-skills] discovered ${traeSkills.length} skills: ${traeSkills.map(s => s.name).join(', ')}`);
  // 注册为只读工具 (LLM 看到后可选择使用)
  for (const skill of traeSkills) {
    registry.register({
      name: skill.name,
      description: skill.description.slice(0, 256),
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', description: `使用 ${skill.name} 技能执行的任务描述` },
          format: { type: 'string', description: '输出格式 (如需要)' },
        },
        additionalProperties: true,
      },
      parallelSafe: true,
      riskLevel: 'low',
      handler: async (args: any) => {
        // TRAE skills 通过 Python / Node 调用
        // 标记为可用, 实际执行需要 callPython 桥接
        const scriptsDir = skill.scriptsDir;
        if (!scriptsDir) {
          return { success: true, output: `Skill "${skill.name}" 已就绪。使用方式: ${skill.description.slice(0, 200)}` };
        }
        try {
          const { callPython } = await import('./python-bridge.js');
          const mainPy = path.join(scriptsDir, '__init__.py');
          return await callPython(mainPy, args);
        } catch {
          return { success: true, output: `Skill "${skill.name}" scripts at: ${scriptsDir}。Use run_command to execute.` };
        }
      },
    });
  }
}

// ===== 技能自动发现 (项目 + 用户) =====
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
    path.join(process.env.USERPROFILE || process.cwd(), '.agentai', 'skills'),
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

// ===== 初始化 AI 工作目录管理器 (跨平台路径解析) =====
const wm = new WorkspaceManager({ projectDir: process.cwd() });
wm.init();
console.log(`[workspace] AI work dir: ${wm.aiWorkDir}`);
console.log(`[workspace] project dir: ${wm.projectDir}`);

// ===== 创建 Express app + HTTP server =====
const deps: Record<string, any> = { router, registry, sessionManager, frameworkSwitcher, sandbox: null, persistentMemory, promptEngine, knowledgeCache, skillEvolver, routerOptimizer, fts5Memory, userModel, industryEngine, skillOrchestrator, workspaceManager: wm };
const app = createApp(deps);
const { httpServer, io } = createServerHandle(app);
deps.io = io;  // 注入 io 到 deps, 使路由可访问
setQQIO(io);    // 后置注入 io 到 QQ 路由 (socket.io 桥接 + 自动重连)
setWechatIO(io); // 后置注入 io 到微信路由 (socket.io 桥接)

// ===== 启动 =====
// 初始化 FTS5 深层记忆
fts5Memory.init().catch((e: any) => console.warn('[fts5-memory] init failed:', e.message));

// 加载用户模型 (Honcho 4维度)
console.log('[user-model] loaded', userModel.get().identity.name);

// 初始化通用技能调度器
try {
  const skillsDir = path.join(import.meta.dirname || process.cwd(), '..', '..', '..', 'skills');
  const scanned = skillOrchestrator.scanDirectory(skillsDir);
  if (scanned > 0) {
    console.log(`[orchestrator] loaded ${scanned} skills (scanning: ${skillsDir})`);
  }
  // 也扫 package skills
  const pkgSkills = path.join(process.cwd(), '..', '..', 'packages', 'agentai-skills');
  skillOrchestrator.scanDirectory(pkgSkills);
} catch (e: any) {
  console.warn('[orchestrator] scan failed:', e?.message || e);
}

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
