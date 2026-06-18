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
import { globalRateLimiter } from './rate-limiter.js';
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

// ===== 速率限制可观测性接入 (非侵入式: 只订阅事件, 不 patch router) =====
// 设计说明: router 内部已有完整的 429/熔断/降级闭环 (llm-router.ts:780-790, 987),
// 这里仅订阅 router 的 EventEmitter 事件, 把状态同步到 globalRateLimiter 做可观测性,
// 不干预路由决策 — 避免与 router 内部逻辑双重处理。
// (router-rate-limiter.ts 的 enhanceRouterWithRateLimit 是激进 monkey-patch 模式,
//  会与 router 内部 429 处理冲突, 暂不启用, 保留代码作未来选项。)
try {
  router.on('provider:tripped', ({ provider, status }: { provider: string; status: number }) => {
    // 429/402/5xx 熔断 → 记录为失败请求, 估算 token 留空 (真实值在 chat 完成时已计)
    if (status === 429 || status === 402 || status >= 500) {
      globalRateLimiter.recordRequest(provider, 0, false);
    }
  });
  router.on('provider:failed', ({ provider }: { provider: string }) => {
    // 单次失败 (非熔断级) → 记录, 但不重置配额 (避免抖动)
    globalRateLimiter.recordRequest(provider, 0, false);
  });
  router.on('circuit:recovered', ({ provider }: { provider: string }) => {
    // 熔断恢复 → 重置该 provider 速率计数, 让它重新获得完整配额
    globalRateLimiter.resetProvider(provider);
  });
  console.log('[rate-limiter] 已订阅 router 事件 (provider:tripped/failed, circuit:recovered) — 可观测性模式');
} catch (e) {
  console.warn('[rate-limiter] 事件订阅失败, 跳过 (不影响主流程):', (e as Error).message);
}

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
// ⚠️ 状态说明 (2026-06-18 审查):
//   - UserBehaviorPredictor: 逻辑真实可用 (顺序模式识别+敏感数据过滤), 但缺消费方
//     (buildImmutablePrefix 未接预测结果). 保留实例化以维持 import 关系, 待会话级
//     预测场景明确后接入. 见 user-behavior-predictor.ts 顶部 @deprecated 说明.
//   - DataPredictor: _fetchData 返回模拟数据 ("模拟数据-xxx"), 接入会向上下文灌假数据.
//     暂注释实例化, 避免启动日志 "数据预判系统已初始化" 误导诊断. 代码本体保留.
const userBehaviorPredictor = new UserBehaviorPredictor({
  enabled: true,
  analyzeSensitiveData: false,
  sendToExternalServer: false,
});
console.log('[user-behavior-predictor] 已初始化 (⚠️ 待消费方接入, 当前无产出消费)');
// const dataPredictor = new DataPredictor({
//   enabled: true,
//   predictSensitiveData: false,
//   sendToExternalServer: false,
//   enableRateLimitProtection: true,
// });
// console.log('[data-predictor] 实例化已跳过 (_fetchData 为模拟实现, 接入会灌假数据)');

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
// 默认项目根目录 = dist/index.js 所在目录 → packages/agentai-gateway → 向上两级到 monorepo 根
// 运行时由前端传入 workspace 参数时动态更新
const _defaultProjectRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:\/)/, '$1')),  // dist/
  '..', '..', '..',  // → agentai-platform 根
);
const wm = new WorkspaceManager({ projectDir: _defaultProjectRoot });
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
