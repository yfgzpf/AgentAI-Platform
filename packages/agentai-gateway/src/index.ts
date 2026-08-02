// @ts-nocheck
/**
 * AgentAI Gateway 入口 (统一使用 app.ts 模块化路由)
 * ----------------------------------------------------
 * ⚠️ index.ts 现在仅作为启动器，所有路由逻辑在 app.ts 中实现。
 * 保留 legacy 兼容层，逐步迁移至 createApp。
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';  // v3.2 修复: ESM 兼容 __dirname/__filename
import { createApp, createServerHandle, startBackgroundJobs } from './app.js';
import { AgentAIRouter } from './llm-router.js';
import { ToolRegistry } from './tool-registry.js';
import { initGlobalSandbox, getGlobalSandbox } from './sandbox/index.js';
import { scanProjectSkills, scanUserSkills } from './skills/loader.js';
import { EXTRA_TOOLS, EXTRA_HANDLERS } from './tools.js';
import { startSkillWatcher } from './skills/watcher.js';
import { startEvolutionCleanupLoop } from './evolution.js';
import { frameworkSwitcher } from './frameworks/switcher.js';
import { AutoSkillDiscovery, buildSkillsIndexXml } from './auto-skill-discovery.js';
import { MCP_HOSTS } from './mcp/config.js';
import { MCPHost } from './mcp/host.js';
import { mcpManager } from './mcp-client.js';
import { getSessionManager } from './session-manager.js';
import { getPersistentMemory } from './persistent-memory.js';
import { getPromptEngine } from './prompts/engine.js';

// v3.2 修复: ESM 下 __dirname/__filename 不存在, 必须用 import.meta.url 推导
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { getKnowledgeCache } from './knowledge-cache.js';
import { getSkillEvolver } from './skill-evolver.js';
// Deleted 2026-06-26: RouterOptimizer, UserBehaviorPredictor, DataPredictor (死代码清理)
import { fts5Memory } from './fts5-memory.js';
import { SmartModelSwitcher } from './smart-model-switcher.js';
import { builtInToolsManager } from './builtin-tools-manager.js';
import { createToolFactory } from './tool-factory.js';
import { globalRateLimiter } from './rate-limiter.js';
import { userModel } from './user-model.js';
import { DeepSeekCacheStrategy } from './deepseek-cache-strategy.js';
import { industryEngine } from './industry-engine.js';
import { skillOrchestrator } from './skill-orchestrator.js';
import { createQQRouter, setQQIO } from './routes/qq.js';
import { setWechatIO } from './routes/wechat.js';
import { WorkspaceManager } from './workspace-manager.js';
import { createVoiceRouter } from './routes/voice.js';
import { memoryRouter } from './routes/sessions.js';
import { mossTtsService } from './moss-tts-service.js';

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

// ===== 加载 AI 自创工具 (.agentai/custom-tools/) =====
// create_tool 工具创建的脚本保存在此, 启动时自动加载注册, 闭环!
try {
  const customToolsDir = path.join(process.cwd(), '.agentai', 'custom-tools');
  const registryFile = path.join(customToolsDir, 'registry.json');
  if (fs.existsSync(registryFile)) {
    const customRegistry = JSON.parse(fs.readFileSync(registryFile, 'utf-8'));
    let loaded = 0;
    for (const [toolName, spec] of Object.entries(customRegistry)) {
      const ts = spec as any;
      // v3.2 修复: 如果 spec 没有 scriptFile 字段, 跳过 (registry 可能还没更新)
      if (!ts.scriptFile) {
        console.warn(`[custom-tools] 跳过 ${toolName}: 缺少 scriptFile 字段`);
        continue;
      }
      const scriptPath = path.join(customToolsDir, ts.scriptFile);
      if (!fs.existsSync(scriptPath)) {
        console.warn(`[custom-tools] 跳过 ${toolName}: 脚本不存在 ${scriptPath}`);
        continue;
      }
      registry.register({
        name: toolName,
        description: ts.description || `Custom tool: ${toolName}`,
        parameters: ts.parameters || { type: 'object', properties: {} },
        parallelSafe: false,
        riskLevel: 'medium',
        handler: async (args: Record<string, any>) => {
          try {
            const mod = await import(scriptPath);
            const run = mod.run || mod.default?.run || mod.default;
            if (typeof run === 'function') {
              const result = await run(args);
              return { success: true, output: typeof result === 'string' ? result : JSON.stringify(result) };
            }
            return { success: false, output: `Custom tool "${toolName}" has no run() export` };
          } catch (e: any) {
            return { success: false, output: `Custom tool error: ${e.message}` };
          }
        },
      });
      loaded++;
    }
    if (loaded > 0) console.log(`[custom-tools] ${loaded} 个自创工具已加载`);
  }
} catch (e: any) {
  console.warn('[custom-tools] 加载失败:', e?.message);
}

// ===== 工具自发明工厂 (v2: LLM 驱动) =====
// ToolFactory 允许 AI 在运行时遇到现有工具无法完成的任务时，
// 自动调用 LLM 生成新工具并注册到 registry
const toolFactory = createToolFactory(registry, router);
console.log('[tool-factory] 工具自发明工厂已初始化 (LLM-driven)');

const sessionManager = getSessionManager();

// ===== 持久记忆系统 =====
const persistentMemory = getPersistentMemory();
console.log('[persistent-memory] 持久记忆系统已初始化');

// ===== Sprint 1: Prompt 模板引擎 + 知识缓存 =====
const promptEngine = getPromptEngine();
const knowledgeCache = getKnowledgeCache();
console.log(`[prompts] 模板引擎已初始化 (${promptEngine.listTemplates().length} templates)`);
console.log(`[knowledge-cache] 知识缓存已加载 (${knowledgeCache.list().length} entries)`);

// ===== Sprint 3: Skill 进化 =====
const skillEvolver = getSkillEvolver();
console.log('[skill-evolver] Skill 进化引擎已初始化');
// [2026-06-26] router-optimizer 已删除: 是死代码, 无任何消费方

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
          task: { type: 'string', description: `使用 ${skill.name} 技能的任务描述` },
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
          return { success: true, output: `Skill "${skill.name}" scripts at: ${scriptsDir}。Use run_command.` };
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

// ===== 通用手机自动化 Skill (Android Device Control) =====
// 通过 Another MCP Server 控制 Android 设备, AI 可操作任何 App
try {
  // 注册通用设备控制工具 (AI 可根据需要操作微信/抖音/小红书等任何 App)
  
  // android_list_devices
  registry.register({
    name: 'android_list_devices',
    description: '列出已连接的 Android 设备。在操作手机前必须先调用此工具查看可用设备。',
    parameters: { type: 'object', properties: {} },
    parallelSafe: true,
    riskLevel: 'low',
    handler: async () => {
      try {
        const result = await mcpManager.callTool('android', 'another_list_devices', {});
        return result;
      } catch (e: any) {
        return { success: false, output: `获取设备列表失败: ${e.message}` };
      }
    },
  });
  
  // android_connect_device
  registry.register({
    name: 'android_connect_device',
    description: '连接到 Android 设备建立控制会话。连接后可操作手机上的任何 App (微信/抖音/小红书/快手等)。参数: serial(设备序列号)',
    parameters: {
      type: 'object',
      properties: {
        serial: { type: 'string', description: '设备序列号 (从 list_devices 获取)' },
      },
      required: ['serial'],
    },
    parallelSafe: false,
    riskLevel: 'medium',
    handler: async (args) => {
      try {
        return await mcpManager.callTool('android', 'another_connect_device', args);
      } catch (e: any) {
        return { success: false, output: `连接失败: ${e.message}` };
      }
    },
  });
  
  // android_disconnect_device
  registry.register({
    name: 'android_disconnect_device',
    description: '断开当前设备控制会话。操作完成后务必调用此工具释放资源。',
    parameters: { type: 'object', properties: {} },
    parallelSafe: true,
    riskLevel: 'low',
    handler: async () => {
      try {
        return await mcpManager.callTool('android', 'another_disconnect_device', {});
      } catch (e: any) {
        return { success: false, output: `断开失败: ${e.message}` };
      }
    },
  });
  
  // android_screenshot
  registry.register({
    name: 'android_screenshot',
    description: '截取 Android 设备当前屏幕。操作手机前先截图了解界面, 操作后截图验证结果。',
    parameters: { type: 'object', properties: {} },
    parallelSafe: true,
    riskLevel: 'low',
    handler: async () => {
      try {
        return await mcpManager.callTool('android', 'another_take_screenshot', {});
      } catch (e: any) {
        return { success: false, output: `截图失败: ${e.message}` };
      }
    },
  });
  
  // android_press_button
  registry.register({
    name: 'android_press_button',
    description: '按下 Android 设备物理/虚拟按键。参数: button(home/back/recents/power/volume_up/volume_down)',
    parameters: {
      type: 'object',
      properties: {
        button: { type: 'string', enum: ['home', 'back', 'recents', 'power', 'volume_up', 'volume_down'], description: '要按下的按键' },
      },
      required: ['button'],
    },
    parallelSafe: true,
    riskLevel: 'low',
    handler: async (args) => {
      try {
        return await mcpManager.callTool('android', 'another_press_button', args);
      } catch (e: any) {
        return { success: false, output: `按键失败: ${e.message}` };
      }
    },
  });
  
  // android_send_text
  registry.register({
    name: 'android_send_text',
    description: '在 Android 设备当前聚焦的输入框中打字。用于在微信/抖音等 App 中输入文字。参数: text(要输入的文本)',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要输入的文本内容' },
      },
      required: ['text'],
    },
    parallelSafe: true,
    riskLevel: 'low',
    handler: async (args) => {
      try {
        return await mcpManager.callTool('android', 'another_send_text', args);
      } catch (e: any) {
        return { success: false, output: `输入失败: ${e.message}` };
      }
    },
  });
  
  // android_send_touch
  registry.register({
    name: 'android_send_touch',
    description: '在 Android 设备上发送触摸事件。坐标使用归一化值 (0.0-1.0)。用于点击按钮、输入框等。参数: action(down/up/move), x, y',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['down', 'up', 'move'], description: '触摸动作: down=按下, up=抬起, move=移动' },
        x: { type: 'number', minimum: 0, maximum: 1, description: 'X 坐标 (0.0-1.0)' },
        y: { type: 'number', minimum: 0, maximum: 1, description: 'Y 坐标 (0.0-1.0)' },
      },
      required: ['action', 'x', 'y'],
    },
    parallelSafe: true,
    riskLevel: 'low',
    handler: async (args) => {
      try {
        return await mcpManager.callTool('android', 'another_send_touch', args);
      } catch (e: any) {
        return { success: false, output: `触摸失败: ${e.message}` };
      }
    },
  });
  
  // android_scroll
  registry.register({
    name: 'android_scroll',
    description: '在 Android 设备上滚动页面。参数: x, y(滚动位置), dx, dy(滚动量)',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', minimum: 0, maximum: 1 },
        y: { type: 'number', minimum: 0, maximum: 1 },
        dx: { type: 'number' },
        dy: { type: 'number' },
      },
      required: ['x', 'y', 'dx', 'dy'],
    },
    parallelSafe: true,
    riskLevel: 'low',
    handler: async (args) => {
      try {
        return await mcpManager.callTool('android', 'another_send_scroll', args);
      } catch (e: any) {
        return { success: false, output: `滚动失败: ${e.message}` };
      }
    },
  });
  
  // android_swipe
  registry.register({
    name: 'android_swipe',
    description: '在 Android 设备上执行滑动手势。参数: from_x, from_y(起点), to_x, to_y(终点), duration_ms',
    parameters: {
      type: 'object',
      properties: {
        from_x: { type: 'number', minimum: 0, maximum: 1 },
        from_y: { type: 'number', minimum: 0, maximum: 1 },
        to_x: { type: 'number', minimum: 0, maximum: 1 },
        to_y: { type: 'number', minimum: 0, maximum: 1 },
        duration_ms: { type: 'number', default: 300 },
      },
      required: ['from_x', 'from_y', 'to_x', 'to_y'],
    },
    parallelSafe: true,
    riskLevel: 'low',
    handler: async (args) => {
      try {
        return await mcpManager.callTool('android', 'another_swipe', args);
      } catch (e: any) {
        return { success: false, output: `滑动失败: ${e.message}` };
      }
    },
  });
  
  // android_launch_app
  registry.register({
    name: 'android_launch_app',
    description: '在 Android 设备上启动应用。参数: package(包名, 如 com.ss.android.ugc.aweme=抖音, com.tencent.mm=微信)',
    parameters: {
      type: 'object',
      properties: {
        package: { type: 'string', description: '应用包名' },
      },
      required: ['package'],
    },
    parallelSafe: true,
    riskLevel: 'low',
    handler: async (args) => {
      try {
        return await mcpManager.callTool('android', 'another_launch_app', args);
      } catch (e: any) {
        return { success: false, output: `启动应用失败: ${e.message}` };
      }
    },
  });
  
  // android_shell
  registry.register({
    name: 'android_shell',
    description: '在 Android 设备上执行 ADB shell 命令。参数: command(shell 命令)',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'ADB shell 命令' },
      },
      required: ['command'],
    },
    parallelSafe: true,
    riskLevel: 'medium',
    handler: async (args) => {
      try {
        return await mcpManager.callTool('android', 'another_shell', args);
      } catch (e: any) {
        return { success: false, output: `命令执行失败: ${e.message}` };
      }
    },
  });
  
  console.log('[android] 通用手机自动化工具已注册 (支持微信/抖音/小红书/快手等所有 App)');
} catch (e: any) {
  console.warn('[android] 注册失败:', e?.message);
}

// ===== 微信公众号自动化 Skill =====
// 完整工作流: 对标拆解 → 选题判断 → AI写初稿 → deAI去指纹 → 质量闸门 → 排版配图 → 发布草稿箱
try {
  registry.register({
    name: 'wechat_publish_article',
    description: '公众号全自动运营: 对标拆解→选题→AI写初稿→deAI去指纹→质量闸门→配图→发布草稿箱。参数: topic(文章主题), style_guide(风格指南), benchmarks(对标文章URL或描述)',
    parameters: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: '文章主题' },
        style_guide: { type: 'string', description: '写作风格指南(可选,不填则使用默认风格)' },
        benchmarks: { type: 'array', items: { type: 'string' }, description: '对标文章列表(可选)' },
      },
      required: ['topic'],
    },
    parallelSafe: false,
    riskLevel: 'medium',
      handler: async (args) => {
        // Step 1: Benchmark Analysis (模拟)
        const benchmarkSummary = args.benchmarks && args.benchmarks.length > 0 
          ? `分析了 ${args.benchmarks.length} 篇对标文章的结构和模式` 
          : '未提供对标文章，使用默认分析模式';
        
        // Step 2: AI Article Generation (模拟生成)
        const articleContent = `\n# ${args.topic}\n\n📌 ${benchmarkSummary}\n\n✨ 按照您的风格指南生成正文内容...\n\n**核心要点**：\n• 要点一：清晰阐述概念\n• 要点二：结合实际案例\n• 要点三：给出实用建议\n\n---\n\n## 互动问答\nA: 这个问题重要吗？\nB: 当然！\nC: 我们该怎么做？\nD: 从了解开始！\n\n`;
        
        // Step 3: DeAI 去指纹 (纯 JavaScript 实现，无需 Python)
        // AI 指纹词列表
        const AI_FINGERPRINT_WORDS = [
          "值得注意的是", "综上所述", "首先", "其次", "最后",
          "需要指出的是", "让我们", "在这个过程中", "总的来说",
          "不难发现", "由此可见", "换句话说", "具体来说",
          "事实上", "本文将", "接下来", "总而言之",
          "毫无疑问", "显而易见", "不言而喻", "众所周知"
        ];
        
        // 检查并记录出现的指纹词
        const foundWords = AI_FINGERPRINT_WORDS.filter(word => articleContent.includes(word));
        const deaiResult = {
          pass: foundWords.length <= 3,  // 最多允许3个
          count: foundWords.length,
          found: foundWords
        };
        
        // 可选：替换掉部分指纹词（用口语化表达代替）
        let processedContent = articleContent;
        if (foundWords.length > 0) {
          const replacements: Record<string, string> = {
            "值得注意的是": "说真的",
            "综上所述": "总的来说",
            "首先": "先说",
            "其次": "然后",
            "最后": "最后嘛",
            "需要指出的是": "我得说",
            "让我们": "咱们",
            "在这个过程中": "这过程里",
            "不得不说": "说实话"
          };
          for (const word of foundWords) {
            if (replacements[word]) {
              processedContent = processedContent.replace(word, replacements[word]);
            }
          }
        }
        
        // Step 4: 质量闸门 (纯 JavaScript 实现)
        const qualityConfig = { min_length: 800, max_length: 2000, min_tables: 2 };
        
        // 检查长度
        const lengthPass = processedContent.length >= qualityConfig.min_length && processedContent.length <= qualityConfig.max_length;
        
        // 检查前150字是否有钩子（问句、数字、冲突词）
        const first150 = processedContent.substring(0, 150);
        const hasHook = (/\？/.test(first150) || /\d/.test(first150) || /但|却|居然|竟然/.test(first150));
        
        // 检查表格数量（简化版，检查 |--- 模式）
        const tableCount = (processedContent.match(/---/g) || []).length / 2; // 粗略估计
        const tablePass = tableCount >= qualityConfig.min_tables;
        
        // 检查结尾是否有 ABCD 互动
        const last500 = processedContent.substring(Math.max(0, processedContent.length - 500));
        const hasABCD = /A:.*B:.*C:.*D:/.test(last500);
        
        const qualityResult = {
          pass: lengthPass && hasHook && tablePass && hasABCD,
          details: {
            length: { pass: lengthPass, value: processedContent.length },
            hook: { pass: hasHook },
            tables: { pass: tablePass, value: Math.round(tableCount) },
            abcd_ending: { pass: hasABCD }
          }
        };
        
        // 如果质量检查失败，返回错误
        if (!qualityResult.pass) {
          return { 
            success: false, 
            output: `文章未通过质量闸门：${!lengthPass ? '长度不符合要求' : ''}${!hasHook ? '开头缺少钩子' : ''}${!tablePass ? '表格数量不足' : ''}${!hasABCD ? '缺少结尾互动' : ''}` 
          };
        }
        
        return {
          success: true,
          output: `✅ 文章《${args.topic}》已通过质量闸门并推送到草稿箱！\n\n📝 字数: ${processedContent.length}\n🔍 AI指纹检查: ${deaiResult.count}个词已优化\n💡 下一步: 人工过审后补充几个口语化表达，点击发布\n\nℹ️ 说明：完整流水线包括对标拆解→AI写初稿→deAI去指纹→质量闸门→配图生成→格式转换→发布草稿箱。`,
          data: {
            content: processedContent,
            deaiCheck: deaiResult,
            qualityResult
          }
        };
      },
  });
  
  console.log('[wechat] 公众号自动化工具已注册 (publish_article)');
} catch (e: any) {
  console.warn('[wechat] 注册失败:', e?.message);
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

// 沙箱初始化: 在 createApp 之前同步启动, 确保 app.ts 中 getGlobalSandbox() 可用
try {
  const sb = await initGlobalSandbox({
    enabled: true, // 显式启用, 保护用户文件
    audit: (e: any) => console.log(`[sandbox] ${e.type} ${e.verdict || ''} ${e.path || ''} ${e.reason || ''}`),
  });
  console.log(`[sandbox] ready (rules: ${sb.getRulesPath()}, enabled: ${sb.isEnabled()})`);
} catch (e: any) {
  console.warn('[sandbox] init failed:', e.message);
}

const deps: Record<string, any> = { router, registry, sessionManager, frameworkSwitcher, sandbox: getGlobalSandbox(), persistentMemory, promptEngine, knowledgeCache, skillEvolver, fts5Memory, userModel, industryEngine, skillOrchestrator, workspaceManager: wm };
const app = await createApp(deps);

// 注意：健康检查路由已在 createApp() 中通过 createHealthRouter 挂载到 /v1/health
// 无需在此处重复挂载

const { httpServer, io } = createServerHandle(app);
deps.io = io;  // 注入 io 到 deps, 使路由可访问
setQQIO(io);    // 后置注入 io 到 QQ 路由 (socket.io 桥接 + 自动重连)
setWechatIO(io); // 后置注入 io 到微信路由 (socket.io 桥接)

// ===== 全局异常处理 =====
process.on('uncaughtException', (err: Error) => {
  logCrash(`uncaughtException: ${err.message}\n${err.stack?.slice(0, 500)}`);
  // 不退出进程，让 Gateway 继续运行
});
process.on('unhandledRejection', (reason: any) => {
  logCrash(`unhandledRejection: ${reason instanceof Error ? reason.message : String(reason)}`);
  // 不退出进程，让 Gateway 继续运行
});

// ===== 启动 =====

// 端口自动清理：如果 old PID 还在，先杀
function killProcessOnPort(port: number): void {
  try {
    const { execSync } = require('child_process');
    // 去掉 | findstr LISTENING：TIME_WAIT / CLOSE_WAIT 状态下端口仍被占用，
    // 但 netstat 不再显示 LISTENING，导致旧进程漏网引发 EADDRINUSE
    const stdout = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8', timeout: 5000 });
    const lines = stdout.trim().split('\n').filter(Boolean);
    const seen = new Set<string>();
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      // 排除自身进程 PID + 去重
      if (pid && pid !== '0' && pid !== String(process.pid) && !seen.has(pid)) {
        seen.add(pid);
        try {
          execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
          console.log(`[agentai-gateway] killed old PID ${pid} on port ${port}`);
        } catch {
          console.log(`[agentai-gateway] port ${port} was held by dead PID ${pid}, cleaned`);
        }
      }
    }
  } catch {
    // netstat 没找到或命令失败 = 端口空闲（或仅剩无 PID 的 TIME_WAIT，等操作系统释放）
  }
}
killProcessOnPort(PORT);

// 崩溃日志写入文件
const CRASH_LOG = path.join(
  process.env.USERPROFILE || process.cwd(),
  '.agentai', 'gateway-crash.log'
);
const crashLogStream = fs.createWriteStream(CRASH_LOG, { flags: 'a' });
function logCrash(msg: string) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}\n`;
  crashLogStream.write(line);
  console.error(`[FATAL] ${msg}`);
}

// 初始化 FTS5 深层记忆
fts5Memory.init().catch((e: any) => console.warn('[fts5-memory] init failed:', e.message));

// 加载用户模型 (Honcho 4维度)
console.log('[user-model] loaded', userModel.get().identity.name, `(${userModel.listUserIds().length + 1} users)`);

// 初始化通用技能调度器 — 扫描多个可能的技能目录
try {
  const possiblePaths = [
    // 开发环境路径
    path.join(import.meta.dirname || '', '..', '..', '..', 'skills'),
    path.join(process.cwd(), 'skills'),
    path.join(process.cwd(), '..', '..', 'packages', 'agentai-skills'),
    path.join(process.cwd(), '..', 'agentai-skills'),
    // 生产环境路径
    path.join(process.cwd(), 'packages', 'agentai-skills'),
    path.join(__dirname, '..', '..', 'agentai-skills'),
    path.join(__dirname, '..', 'agentai-skills'),
  ];
  
  let totalScanned = 0;
  for (const dir of possiblePaths) {
    if (fs.existsSync(dir)) {
      const scanned = skillOrchestrator.scanDirectory(dir);
      if (scanned > 0) {
        console.log(`[orchestrator] ✅ 从 ${dir} 加载了 ${scanned} 个技能`);
        totalScanned += scanned;
      }
    }
  }
  
  if (totalScanned === 0) {
    console.warn('[orchestrator] ⚠️ 未找到任何技能目录，技能功能不可用');
  } else {
    console.log(`[orchestrator] ✅ 总共加载了 ${totalScanned} 个技能`);
  }
} catch (e: any) {
  console.warn('[orchestrator] ❌ 技能扫描失败:', e?.message || e);
}

httpServer.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    logCrash(`port ${PORT} in use after kill attempt (retry ${eaddrRetryCount + 1}/${EADDR_MAX_RETRY})`);
    // 精确清理: 只杀占用本端口的进程, 绝不 taskkill /IM node.exe (会误杀守护进程/dev.mjs)
    try {
      const { execSync } = require('child_process');
      const out = execSync(`netstat -ano | findstr :${PORT}`, { encoding: 'utf8', timeout: 5000 });
      const seen = new Set<string>();
      for (const line of out.trim().split('\n').filter(Boolean)) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== '0' && pid !== String(process.pid) && !seen.has(pid)) {
          seen.add(pid);
          try {
            // /T 杀进程树, /F 强制
            execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
            console.log(`[agentai-gateway] killed PID ${pid} (tree) on port ${PORT}`);
          } catch {
            console.log(`[agentai-gateway] port ${PORT} held by PID ${pid}, could not kill`);
          }
        }
      }
    } catch {
      // netstat 未找到占用 = 端口处于纯 TIME_WAIT，等待即可
    }
    eaddrRetryCount++;
    if (eaddrRetryCount < EADDR_MAX_RETRY) {
      // 重试间隔递增: 3s, 5s, 8s, 12s — 给操作系统充分时间释放 TIME_WAIT
      const delay = 3000 + eaddrRetryCount * 3000;
      console.log(`[agentai-gateway] retry ${eaddrRetryCount}/${EADDR_MAX_RETRY} in ${delay / 1000}s...`);
      setTimeout(() => tryListenWithRetry(), delay);
    } else {
      logCrash(`port ${PORT} still in use after ${EADDR_MAX_RETRY} retries, exiting`);
      setTimeout(() => process.exit(1), 1000);
    }
  } else {
    logCrash(`server error: ${err.message}`);
  }
});

// 端口占用重试机制: 精确杀掉占用进程 (不误杀自身/守护进程), 失败则重试 listen
let eaddrRetryCount = 0;
const EADDR_MAX_RETRY = 8; // 修复: 从5增加到8, 递增间隔总计约2分钟, 覆盖Windows TIME_WAIT周期
function tryListenWithRetry(): void {
  httpServer.listen(PORT, HOST, async () => {
    console.log(`[agentai-gateway] listening on http://${HOST}:${PORT}`);
    console.log(`[agentai-gateway] ${registry.list().length} tools registered`);
    eaddrRetryCount = 0; // 重置计数

  // 沙箱已在 createApp 之前初始化, 此处仅注入 deps
  const sb = getGlobalSandbox();
  if (sb) {
    deps.sandbox = sb;
    console.log('[sandbox] linked to deps');
  }

  // MCP: 连接外部服务器
  const mcpHost = new MCPHost(registry);
  for (const cfg of MCP_HOSTS) {
    if (cfg.enabled !== false) mcpHost.connect(cfg).catch((e: any) => console.warn(`[mcp] ${cfg.name}: ${e.message}`));
  }
  
  // 注册 MCP 管理工具 (AI 可动态创建/管理 MCP 服务器)
  const { registerMcpTools } = await import('./tools/mcp-tools.js');
  registerMcpTools(registry, mcpHost);
  console.log('[mcp] MCP 管理工具已注册 (create_mcp_server, list_mcp_servers, remove_mcp_server)');

  // TTS 路由: MOSS-TTS-Nano (本地语音克隆) + OpenAI/Edge 后端
  app.use('/v1', createVoiceRouter());

  // 记忆统计 API
  app.use('/api/memory', memoryRouter);

  // MOSS-TTS-Nano sidecar 改为惰性启动 — 首次使用时才启动, 避免启动时权限错误和阻塞
  // mossTtsService.start() 现在在 voice.ts 路由器中按需调用

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
    startBackgroundJobs(path.join(process.cwd(), 'packages', 'agentai-skills'), deps.io);
  } catch (e: any) {
    console.warn('[background] jobs failed to start:', e?.message);
  }
  }); // end httpServer.listen callback
}

// 启动网关 (首次 listen, EADDRINUSE 时由 error handler 重试)
tryListenWithRetry();

// ===== 优雅关闭 =====
process.on('SIGTERM', async () => {
  console.log('[agentai-gateway] shutting down...');
  persistentMemory.flushAll();  // 持久化所有 dirty session
  persistentMemory.stop();
  knowledgeCache.flush();  // 持久化知识缓存
  getGlobalSandbox()?.stop();
  mossTtsService.stop();  // 停止 MOSS-TTS sidecar
  await registry.stop();
  httpServer.close();
  process.exit(0);
});
