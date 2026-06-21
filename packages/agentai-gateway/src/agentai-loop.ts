/**
 * AgentAI 主循环 (Cache-First Loop)
 * ----------------------------------------------------
 * 自创整合: 融合 3 框架精华
 *   - Reasonix Pillar 1 三段式 (immutable prefix / append-only log / volatile scratch)
 *   - Hermes SessionDB (FTS5 会话存储)
 *   - ZhiY.AI zhiy-agent-core (多智能体编排)
 *
 * 自创:
 *   - **每 10 轮反思门** (写三层记忆, 学 WorkBuddy)
 *   - **中文 Skills 索引注入** (学 ZhiY.AI skills-system)
 *   - **abort 信号传递** (学 Reasonix ToolCallContext)
 *
 * @see docs/INTEGRATION_ARCHITECTURE.md 第 3.1 节
 */

import { EventEmitter } from 'events';
import fsSync from 'fs';
import pathSync from 'path';
import { AgentAIRouter, ChatRequest, ChatResponse, ChatMessage, MessageContent, ProviderId } from './llm-router.js';
import { ToolRegistry, ToolContext, ToolResult } from './tool-registry.js';
import { AGENT_SYSTEM_IDENTITY } from './system-prompt.js';
import { userModel } from './user-model.js';
import { compressAllToolResults, CompressStats } from './token-compressor.js';
import { recommendModel, getProModelKeyInfo } from './model-classifier.js';

/* ═══════════ 审批白名单: 用户信任的命令模式 ═══════════
 * 当用户在审批卡片中点击"信任此命令"后，相同工具+路径模式将自动跳过审批
 * 白名单存储在 ~/.agentai/trusted-commands.json
 */
import os from 'os';
import fs from 'fs';
import path from 'path';

const TRUSTED_COMMANDS_FILE = path.join(os.homedir(), '.agentai', 'trusted-commands.json');

interface TrustedPattern {
  toolName: string;
  pathPattern: string;  // glob-like, e.g. "packages/agentai-gui/**" or "*"
  trustedAt: number;
}

let trustedPatternsCache: TrustedPattern[] | null = null;

function loadTrustedPatterns(): TrustedPattern[] {
  if (trustedPatternsCache) return trustedPatternsCache;
  try {
    if (fs.existsSync(TRUSTED_COMMANDS_FILE)) {
      trustedPatternsCache = JSON.parse(fs.readFileSync(TRUSTED_COMMANDS_FILE, 'utf-8'));
      return trustedPatternsCache || [];
    }
  } catch { /* ignore */ }
  return [];
}

function saveTrustedPatterns(patterns: TrustedPattern[]): void {
  try {
    const dir = path.dirname(TRUSTED_COMMANDS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(TRUSTED_COMMANDS_FILE, JSON.stringify(patterns, null, 2), 'utf-8');
    trustedPatternsCache = patterns;
  } catch { /* ignore */ }
}

/** 检查命令是否在白名单中 */
function isTrustedCommand(toolName: string, filePath: string): boolean {
  const patterns = loadTrustedPatterns();
  return patterns.some(p => {
    if (p.toolName !== toolName && p.toolName !== '*') return false;
    if (p.pathPattern === '*') return true;
    // 简单 glob 匹配: ** 匹配任意路径段, * 匹配非/字符
    const regex = new RegExp('^' + p.pathPattern.replace(/\./g, '\\.').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$');
    return regex.test(filePath);
  });
}

/** 添加信任模式 (由路由端点调用) */
export function addTrustedPattern(toolName: string, pathPattern: string): void {
  const patterns = loadTrustedPatterns();
  // 去重
  if (!patterns.some(p => p.toolName === toolName && p.pathPattern === pathPattern)) {
    patterns.push({ toolName, pathPattern, trustedAt: Date.now() });
    saveTrustedPatterns(patterns);
  }
}

/** 获取所有信任模式 */
export function getTrustedPatterns(): TrustedPattern[] {
  return loadTrustedPatterns();
}

/** 移除信任模式 */
export function removeTrustedPattern(toolName: string, pathPattern: string): void {
  const patterns = loadTrustedPatterns().filter(p => !(p.toolName === toolName && p.pathPattern === pathPattern));
  saveTrustedPatterns(patterns);
}
import { maskCredentials } from './credential-extractor.js';
import { GoalResult } from './goal-runner.js';
import { revertBridge } from './revert-bridge.js';

// 全局缓存 (同 session 内复用)
let _globalCache: any = null;
let _globalCacheReady = false;

async function getOrCreateCache(registry: any): Promise<any> {
  if (_globalCache) return _globalCache;
  if (_globalCacheReady) return _globalCache; // already tried
  try {
    const mod = await import('./deepseek-cache-strategy.js');
    _globalCache = new mod.DeepSeekCacheStrategy({
      system: AGENT_SYSTEM_IDENTITY,
      toolDefs: registry?.list?.().map((t: any) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })) || [],
    });
  } catch {
    _globalCache = null;
  }
  _globalCacheReady = true;
  return _globalCache;
}

export interface LoopOptions {
  maxIterations: number;
  userId: string;
  workspace: string;
  abortSignal?: AbortSignal;
  parallelMax?: number;
  reflectEvery?: number;
  includeSkillsIndex?: boolean;
  model?: string;
  modelName?: string;
  /** UI 显示的模型名称 (前端传给 done 事件) */
  displayModelLabel?: string;
  /** 持久记忆系统引用 (用于注入上下文) */
  persistentMemory?: any;
  /** 用户手动选择模型 (跳过自动路由) */
  userPickedModel?: boolean;
  /** 运行模式: auto/planning/readonly */
  mode?: string;
  /** 用户当前情绪 (前端注入) */
  emotion?: { emotion: string; intensity: number; label: string };
  /** 内部: 自动恢复是否已触发 */
  _autoResumed?: boolean;
  /** 是否开启思考模式 (Agnes AI 的 chat_template_kwargs.enable_thinking) */
  thinking?: boolean;
  /** 思考模式 token 预算 */
  thinkingBudget?: number;
  /** 自定义模型配置 (非内置 provider 时由前端传递) */
  modelConfig?: { baseURL: string; modelName: string; provider: string };
}

/**
 * Reasonix Pillar 1 三段式上下文
 * - immutable prefix: 系统提示 + 工具描述, 一旦 session 创建就固定
 * - append-only log:  对话历史, 只增不删
 * - volatile scratch: 当前轮思考, 不发上游
 */
export interface AgentContext {
  sessionId: string;
  immutablePrefix: ChatMessage[];   // 系统 + 工具, pinned
  appendOnlyLog: ChatMessage[];     // 历史对话
  volatileScratch: string;          // 当前轮思考, 不发 LLM
}

export class AgentAILoop extends EventEmitter {
  private router: AgentAIRouter;
  private registry: ToolRegistry;
  readonly context: AgentContext;
  readonly opts: Required<LoopOptions>;
  private iteration = 0;
  private initialMessages: ChatMessage[];
  private contextReady = false;

  private _aborted = false;
  private _startupInjected = false;

  /** 元认知循环实例 (复用, 不每轮重建) */
  private metaLoop: any = null;

  /** 待审批队列: approvalId → { resolve, reject, timer } */
  private pendingApprovals = new Map<string, { resolve: (granted: boolean) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }>();


  /** 智能模型切换: 连续触发熔断时自动换商用 API */
  private trippedCount = 0;
  private _smartSwitcher: any = null;

  private async _getSmartSwitcher() {
    if (!this._smartSwitcher) {
      const { SmartModelSwitcher } = await import('./smart-model-switcher.js');
      this._smartSwitcher = new SmartModelSwitcher();
    }
    return this._smartSwitcher;
  }

  /** 中断当前运行的任务 */
  abort() {
    this._aborted = true;
    // 清理所有待审批（全部拒绝）
    for (const [id, entry] of this.pendingApprovals) {
      clearTimeout(entry.timer);
      entry.resolve(false);
    }
    this.pendingApprovals.clear();
    this.emit('aborted');
  }

  /**
   * 等待用户审批（超时自动拒绝）
   * @returns true=批准, false=拒绝/超时
   */
  waitForApproval(id: string, timeoutMs = 60_000): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingApprovals.delete(id);
        console.warn(`[loop] approval ${id} 超时, 自动拒绝`);
        resolve(false);
      }, timeoutMs);
      this.pendingApprovals.set(id, { resolve, reject, timer });
    });
  }

  /**
   * 解决审批请求 (由路由端点调用)
   * @param id 审批ID
   * @param granted true=批准, false=拒绝
   */
  resolveApproval(id: string, granted: boolean): boolean {
    const entry = this.pendingApprovals.get(id);
    if (!entry) {
      console.warn(`[loop] resolveApproval: 未找到 ${id}`);
      return false;
    }
    clearTimeout(entry.timer);
    this.pendingApprovals.delete(id);
    entry.resolve(granted);
    return true;
  }

  constructor(
    router: AgentAIRouter,
    registry: ToolRegistry,
    initialMessages: ChatMessage[],
    opts: LoopOptions,
  ) {
    super();
    this.router = router;
    this.registry = registry;
    this.initialMessages = initialMessages;
    this.opts = {
      maxIterations: opts.maxIterations ?? 90,
      userId: opts.userId,
      workspace: opts.workspace,
      abortSignal: opts.abortSignal ?? new AbortController().signal,
      parallelMax: opts.parallelMax ?? 3,
      reflectEvery: opts.reflectEvery ?? 10,
      includeSkillsIndex: opts.includeSkillsIndex ?? true,
      model: opts.model ?? 'agentai',
      modelName: opts.modelName ?? '',
      displayModelLabel: opts.displayModelLabel ?? '',
      emotion: opts.emotion ?? { emotion: 'neutral', intensity: 0, label: '中性' },
      thinking: opts.thinking ?? false,
      thinkingBudget: opts.thinkingBudget ?? 0,
      persistentMemory: opts.persistentMemory ?? null,
      userPickedModel: opts.userPickedModel ?? false,
      mode: opts.mode ?? 'auto',
      modelConfig: opts.modelConfig ?? { baseURL: '', modelName: '', provider: '' },
      _autoResumed: false,
    };

    // 初始化空 context (lazy build)
    this.context = {
      sessionId: `agentai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      immutablePrefix: [],
      appendOnlyLog: [],
      volatileScratch: '',
    };
  }

  private async ensureContext() {
    if (this.contextReady) return;
    this.context.immutablePrefix = await this.buildImmutablePrefix(this.initialMessages);
    // ⚠️ 保留已存在的 appendOnlyLog 内容 (附件可能在 loop.run() 之前被推入)
    const initialLog = this.initialMessages.filter(m => m.role !== 'system');
    this.context.appendOnlyLog = [...initialLog, ...this.context.appendOnlyLog];
    this.contextReady = true;
  }

  /**
   * 构建不可变前缀: AI 身份 + 规则 + 工具描述 + 记忆 + workspace
   */
  private async buildImmutablePrefix(messages: ChatMessage[]): Promise<ChatMessage[]> {
    const systemMsgs: ChatMessage[] = [];

    // === 1. AI 身份 + 核心规则 (来自 system-prompt.ts) ===
    systemMsgs.push({
      role: 'system',
      content: AGENT_SYSTEM_IDENTITY,
    });

    // === 2. 用户身份 (姓名提示) ===
    try {
      const name = userModel.get().identity.name || this.opts.userId || '用户';
      if (name && name !== 'User') {
        systemMsgs.push({
          role: 'system',
          content: `\n# 用户身份\n当前用户姓名: ${name}\n在对话开始时应称呼用户姓名打招呼。`,
        });
      }
    } catch (e: any) { /* workspace context optional */ }

    // === 2.5 用户情绪上下文 (前端实时注入) ===
    if (this.opts.emotion && this.opts.emotion.emotion !== 'neutral') {
      const e = this.opts.emotion;
      const tips: Record<string, string> = {
        anxious: '用户当前焦虑不安, 请耐心安抚, 给出明确可执行的方案, 避免模糊回答',
        angry: '用户当前愤怒不满, 请先共情理解, 再提供解决方案, 语气要温和专业',
        sad: '用户当前情绪低落, 请温和鼓励, 提供积极的建设性建议',
        surprised: '用户当前感到惊讶, 请解释清楚原因, 消除疑虑',
        negative: '用户当前情绪消极, 请积极引导, 提供可行的改进方案',
        positive: '用户当前情绪积极, 可以更自信地推进任务',
        joyful: '用户当前心情愉快, 可以保持轻松的交流氛围',
      };
      const tip = tips[e.emotion] || '';
      systemMsgs.push({
        role: 'system',
        content: `\n# 用户当前情绪: ${e.label} (强度: ${Math.round(e.intensity * 100)}%)\n${tip}\n请在回复中体现对用户情绪的关注和回应。`,
      });
    }

    // === 3. 用户行业 + 身份 + knowledge base ===
    try {
      // 优先从 industryEngine 读取当前活跃行业 (支持动态切换)
      let industryId = '';
      let industrySkillsStr = '';
      try {
        const { industryEngine } = await import('./industry-engine.js');
        industryId = (industryEngine as any).activeIndustry || '';
        // 注入 IndustryEngine 的 System Prompt 片段
        const frag = industryEngine.buildSystemPromptFragment();
        if (frag) systemMsgs.push({ role: 'system', content: frag });
      } catch (e: any) { /* industry engine optional */ }
      // 回退到环境变量
      if (!industryId) {
        industryId = process.env['AGENTAI_INDUSTRY'] || '';
        industrySkillsStr = process.env['AGENTAI_INDUSTRY_SKILLS'] || '';
      }
      if (industryId && industryId !== 'general') {
        systemMsgs.push({
          role: 'system',
          content: `\n# 当前行业: ${industryId}\n用户当前处于「${industryId}」行业模式。\n\n## 自适应规则\n- 保留所有历史记忆，不要删除或覆盖\n- 根据当前行业自主选择相关记忆和知识\n- 行业切换时自动调整专业深度和术语体系\n- 跨行业知识可作为参考，但优先使用当前行业的专业框架\n${industrySkillsStr ? `\n行业技能: ${industrySkillsStr}` : ''}\n\n## 行业知识自动补全\n- 当你识别到用户的行业身份时，应立即检查记忆中是否有该行业的知识\n- 如果记忆中缺少行业知识，使用 web_search 搜索并使用 remember 保存\n- 搜索关键词: "${industryId}行业 核心知识/工作流程/专业术语/最新趋势"\n- 同时搜索: "${industryId}从业者 常用工具/AI辅助需求"\n- 将搜索到的关键信息用 remember 工具保存为行业知识记忆`,
        });
      } else if (industryId === 'general' || !industryId) {
        // 从 UserModel 读取行业
        let userModelIndustry = '';
        try { userModelIndustry = userModel.get().identity.industry || ''; } catch {}
        const effectiveIndustry = userModelIndustry || '未知';

        systemMsgs.push({
          role: 'system',
          content: `\n# 当前行业: ${effectiveIndustry === '未知' ? '通用模式 (待识别)' : effectiveIndustry}\n${effectiveIndustry === '未知'
            ? '- 用户行业尚未识别，请在对话中主动了解用户的行业和职业\n- 识别到行业后，使用 remember 工具保存，并使用 web_search 搜索行业知识补全\n- 搜索关键词: "[行业] 核心知识/工作流程/专业术语/最新趋势"'
            : `- 用户处于「${effectiveIndustry}」行业模式\n- 检查记忆中是否有该行业的知识，如缺少则使用 web_search 搜索补全\n- 将搜索到的关键信息用 remember 保存为行业知识记忆`}\n- 保留所有历史记忆\n- 综合运用各行业知识`,
        });
      }
    } catch (e: any) { /* workspace context optional */ }

    // === 3. 用户模型 (Honcho 4维度) ===
    try {
      const profile = userModel.buildSystemPromptFragment();
      if (profile && !profile.includes('0,')) {
        systemMsgs.push({ role: 'system', content: profile });
      }
    } catch (e: any) { /* user model optional */ }

    // === 4. 持久记忆注入 (智能排序: 行业加权 + 时效衰减) ===
    try {
      const { readMemory } = await import('./memory.js');
      const mems = await readMemory({
        userId: this.opts.userId,
        workspace: this.opts.workspace,
        limit: 10,
      });
      if (mems.length > 0) {
        const memEntries = mems.map(m => {
          const industryTag = m.industry && m.industry !== 'general' ? `[${m.industry}]` : '';
          const date = new Date(m.ts).toLocaleDateString();
          return `- ${date}${industryTag} ${m.content.slice(0, 80)}`;
        });
        systemMsgs.push({
          role: 'system',
          content: `\n# Persistent Memory\n${memEntries.join('\n')}\n使用 recall_memory 查看详情, remember 保存, forget 删除。`,
        });
      }
    } catch (e: any) { /* persistent memory optional */ }

    // === 4.5 自进化记忆 (跨会话经验 - 治失忆症) ===
    // 设计意图见 evolution.ts:7 — 原本就该在启动时注入, 实现遗漏, 2026-06-18 补接
    try {
      const { readEvolutionForContext } = await import('./evolution.js');
      const entries = readEvolutionForContext({
        userId: this.opts.userId,
        workspace: this.opts.workspace,
        limit: 30,
      });
      // 只注入有价值的: failure > preference > success, 跳过 tool_stats (太啰嗦)
      const valuable = entries
        .filter(e => e.type !== 'tool_stats')
        .slice(-20);
      if (valuable.length > 0) {
        const lines = valuable.map(e => {
          const tag = e.type === 'failure' ? '[教训]' : e.type === 'preference' ? '[偏好]' : '[经验]';
          const content = (e.content || '').slice(0, 100);
          return `- ${tag} ${content}`;
        });
        systemMsgs.push({
          role: 'system',
          content: `\n# Evolution Memory (跨会话自进化经验 - 这些是你过去反思的结晶)\n${lines.join('\n')}\n\n参考这些历史经验调整行为, 但不要盲从 — 上下文可能已变化。`,
        });
      }
    } catch (e: any) { /* evolution memory optional - 不影响主流程 */ }

    // === 4.6 IDE 状态感知: 注入当前编辑器状态 ===
    try {
      const { format_ide_context } = await import('./ide-state.js');
      const ideCtx = format_ide_context();
      if (ideCtx) {
        systemMsgs.push({ role: 'system', content: ideCtx });
      }
    } catch { /* ide-state optional */ }

    // === 4.65 开发偏好: 从 profile 读取用户的技术栈偏好 ===
    try {
      const profileFile = path.join(this.opts.workspace || process.cwd(), '.agentai', 'profile.json');
      let devPrefs: any = null;
      // 尝试从项目级 profile 读取
      if (fs.existsSync(profileFile)) {
        try { devPrefs = JSON.parse(fs.readFileSync(profileFile, 'utf-8'))?.devPrefs; } catch { /* ignore */ }
      }
      // 尝试从 chat route 传入的 profile 读取
      if (!devPrefs && (this as any)._requestProfile?.devPrefs) {
        devPrefs = (this as any)._requestProfile.devPrefs;
      }
      if (devPrefs && typeof devPrefs === 'object') {
        const parts: string[] = [];
        if (devPrefs.languages?.length) parts.push(`语言: ${devPrefs.languages.join(', ')}`);
        if (devPrefs.frontend?.length) parts.push(`前端: ${devPrefs.frontend.join(', ')}`);
        if (devPrefs.backend?.length) parts.push(`后端: ${devPrefs.backend.join(', ')}`);
        if (devPrefs.packageManager?.length) parts.push(`包管理: ${devPrefs.packageManager.join(', ')}`);
        if (devPrefs.css?.length) parts.push(`CSS: ${devPrefs.css.join(', ')}`);
        if (parts.length > 0) {
          systemMsgs.push({
            role: 'system',
            content: `\n# 用户开发偏好\n${parts.join('\n')}\n生成代码时请遵循这些偏好。`,
          });
        }
      }
    } catch { /* devPrefs optional */ }

    // === 4.7 自进化规则: 加载 AI 自己创建的行为规则 ===
    try {
      const rulesFile = path.join(this.opts.workspace || process.cwd(), '.agentai', 'evolved-rules.json');
      if (fs.existsSync(rulesFile)) {
        const rulesData = fs.readFileSync(rulesFile, 'utf-8');
        const rules = JSON.parse(rulesData);
        if (Array.isArray(rules) && rules.length > 0) {
          const ruleLines = rules.map((r: any) => `- ${r.rule}`).join('\n');
          systemMsgs.push({
            role: 'system',
            content: `\n# 自进化规则 (你自己总结的行为准则)\n${ruleLines}`,
          });
        }
      }
    } catch { /* evolved rules optional */ }

    // === 4.8 启动感知: 首轮注入项目摘要 ===
    if (!this._startupInjected) {
      this._startupInjected = true;
      try {
        const { execSync } = await import('child_process');
        const ws = this.opts.workspace || process.cwd();
        // 最近 5 次 git commit
        let gitLog = '';
        try {
          gitLog = execSync('git log --oneline -5 2>&1', { cwd: ws, encoding: 'utf-8', timeout: 5000 }).trim();
        } catch { /* not a git repo */ }
        // 最近修改的文件
        let recentFiles = '';
        try {
          recentFiles = execSync('git diff --name-only HEAD~3 2>&1', { cwd: ws, encoding: 'utf-8', timeout: 5000 }).trim();
        } catch { /* git diff optional */ }
        if (gitLog || recentFiles) {
          const parts = ['# 项目近况 (启动时自动注入)'];
          if (gitLog) parts.push(`最近提交:\n${gitLog}`);
          if (recentFiles) parts.push(`最近改动文件:\n${recentFiles.split('\n').slice(0, 10).join('\n')}`);
          systemMsgs.push({ role: 'system', content: parts.join('\n') });
        }
      } catch { /* startup awareness optional */ }
    }

    // === 5. DeepSeek 缓存策略: 构建稳定前缀 ===
    try {
      const cache = await getOrCreateCache(this.registry);
      if (cache) {
        const stats = cache.getCacheStats();
        systemMsgs.push({
          role: 'system',
          content: `\n# Cache: prefix ${stats.prefixTokens} tokens stable, ${stats.toolsCached ? 'tools cached' : ''}, ${stats.skillsCount} skills loaded`,
        });
      }
    } catch (e: any) { /* cache stats optional */ }

    // === 6. Workspace 上下文 + 子目录记忆 ===
    if (this.opts.workspace) {
      try {
        const dirPath = this.opts.workspace;
        if (fsSync.existsSync(dirPath)) {
          const entries = fsSync.readdirSync(dirPath).slice(0, 15);
          const listing = entries.map((e: string) => {
            const full = pathSync.join(dirPath, e);
            try { return fsSync.statSync(full).isDirectory() ? `📁 ${e}/` : `📄 ${e}`; } catch { return `  ${e}`; }
          }).join('\n');

          // 不加载详细文件列表到前缀 (节省 token)
          // 仅展示顶层目录结构, 需要时调用 list_directory 或 directory_tree 获取详情
          systemMsgs.push({
            role: 'system',
            content: `\n# Workspace: ${dirPath}\n你正在此目录工作。所有文件操作的路径必须是相对于工作区的相对路径（如 "src/index.ts"），不要使用绝对路径。\n\n## 顶层目录:\n${listing || '(空)'}\n\n> ⚡ 仅展示顶层前15项以节省上下文。需要查看深层结构请调用 \`list_directory\` 或 \`directory_tree\`。`,
          });

          // 子目录记忆 (学 Reasonix subdir.ts)
          try {
            const { buildSubdirMemorySection } = await import('./subdir-memory.js');
            const mem = buildSubdirMemorySection(dirPath);
            if (mem) {
              systemMsgs.push({ role: 'system', content: `\n${mem}\n\n使用 \`read_file\` 查看完整规则。` });
            }
          } catch (e: any) { /* sub-memory read optional */ }
        }
      } catch (e: any) { /* workspace context optional */ }
    }

    // === 6.3 项目规则文件自动加载/生成 (跨会话项目规范) ===
    // 每次会话自动检测 .trae/rules/project_rules.md
    // 存在 → 加载到上下文；不存在 → LLM 根据项目特征自动生成
    if (this.opts.workspace) {
      try {
        const { ensureProjectRules } = await import('./project-rules-initializer.js');
        const rules = await ensureProjectRules(this.opts.workspace, this.router);
        if (rules && rules.trim().length > 0) {
          systemMsgs.push({
            role: 'system',
            content: `\n# 项目规则 (来自 .trae/rules/project_rules.md)\n${rules}`,
          });
        }
      } catch (e: any) { /* project rules init optional */ }
    }

    // === 6.5 自主能力自动触发规则 (授人以渔: 告诉AI何时该用、怎么用) ===
    systemMsgs.push({
      role: 'system',
      content: `\n# 自主能力自动触发规则 (CRITICAL — 不用等用户命令!)
你是具备自主探索、行业洞察和系统管理能力的智能体。以下场景你必须**主动调用**对应工具，不要等用户来要求：

## 1. 代码探索 (explore_project)
**触发场景**: 
- 首次进入一个项目 (你不知道目录结构时) → 调用 \`explore_project {mode:"structure"}\`
- 用户提到某个文件/模块但你不了解其依赖 → 调用 \`explore_project {trace_from:"文件路径"}\`
- 用户说"这个项目怎么组织的" / "架构是什么" → 调用 \`explore_project {mode:"full"}\`
**注意**: 只在新项目或结构变化时调用，不要每次都探索。

## 2. 行业洞察 (industry_insight)
**触发场景**:
- 对话中出现行业术语/工作流/痛点时 → 调用 \`industry_insight {action:"detect", message:"用户消息"}\`
- 需要了解用户行业的深度知识时 → 调用 \`industry_insight {action:"profile", industry_id:"software_dev"}\`
- 用户分享了有价值的行业经验 → 调用 \`industry_insight {action:"add", ...}\` 存入洞察库
- 想查看已积累的行业知识 → 调用 \`industry_insight {action:"summary"}\`
**注意**: 行业洞察是跨会话持久化的，积累越多AI越了解用户行业。

## 3. 系统自检 (self_diagnose)
**触发场景**:
- 连续 2 次工具调用失败时 → 调用 \`self_diagnose {action:"diagnose"}\`
- 用户反馈"系统慢了"或"为什么失败" → 调用 \`self_diagnose {action:"diagnose"}\`
- 发现磁盘空间不足的迹象 → 调用 \`self_diagnose {action:"cleanup"}\`
- 诊断发现问题 → 调用 \`self_diagnose {action:"autofix"}\` 自动修复
- 会话开始时 → 建议调用 \`self_diagnose {action:"health_prompt"}\` 告知用户系统状态`,
    });

    // === 6.6 成本意识提示 (节省 token, 勿一次加载全目录) ===
    systemMsgs.push({
      role: 'system',
      content: `\n# 成本意识 (CRITICAL)
## 你的行为直接影响用户的钱包
1. **不要一上来就加载整个目录**: 先用 \`list_directory\` 看顶层, 再用 \`read_file\` 按需读文件
2. **不要做全盘文本搜索** (\`search_content\`) 除非明确需要: 先思考问题范围再精准搜索
3. **代码开发尽量用免费模型**: 架构设计、代码生成用免费模型, 仅在安全审查/性能分析时用付费模型
4. **能用单行命令解决的问题不要写多函数**: 优先简单方案, 避免过度工程
5. **skills 按需发现**: 不用的 skills 不要加载到上下文`,
    });

    // === 5. Skills 索引 (按需精简, 不浪费 token) ===
    // 旧方案: 全量 toSkillsXML() 注入 50+ 工具描述 ≈ 3000+ token
    // 新方案: 只注入分类摘要 ≈ 200 token, 具体技能由 smartDispatch 按需匹配
    if (this.opts.includeSkillsIndex) {
      const skills = this.registry.list();
      // 按分类聚合
      const categories = new Map<string, number>();
      for (const s of skills) {
        const cat = s.skillMeta?.source || s.riskLevel || 'general';
        categories.set(cat, (categories.get(cat) || 0) + 1);
      }
      const summary = [...categories.entries()]
        .map(([cat, count]) => `${cat}(${count})`)
        .join(', ');
      systemMsgs.push({
        role: 'system',
        content: `# Available Skills\n共 ${skills.length} 个技能: ${summary}\n当用户请求匹配某技能时，系统会自动注入该技能的详细说明。你无需预先了解所有技能，只需根据用户需求自然回应。`,
      });
    }

    // === 5. 用户偏好 (从 RevertBridge 学习的缩进/引号风格) ===
    try {
      const prefs = revertBridge.toSystemPrompt(this.opts.workspace || process.cwd());
      if (prefs) {
        systemMsgs.push({ role: 'system', content: prefs });
      }
    } catch (e: any) { /* RevertBridge preferences optional */ }

    // === 5. 用户传入的额外 system messages ===
    const userSystemMsgs = messages.filter(m => m.role === 'system');
    systemMsgs.push(...userSystemMsgs);

    // === 6. 审查模式专用提示 ===
    if (this.opts.mode === 'review') {
      systemMsgs.push({
        role: 'system',
        content: `\n# 审查模式 (Review Mode)\n你是一名资深代码审查专家。请对用户指定的代码/文件/项目进行全面审查，按以下结构输出审查报告：\n\n` +
          `## 审查报告模板\n` +
          `### 1. 🔒 安全风险\n- 检查硬编码密钥、SQL注入、XSS、路径遍历、不安全的依赖等\n` +
          `### 2. ⚡ 性能问题\n- 检查不必要的循环、内存泄漏、N+1查询、阻塞操作等\n` +
          `### 3. 🎨 代码质量\n- 检查命名规范、代码重复、复杂度过高的函数、缺失错误处理等\n` +
          `### 4. 📋 最佳实践\n- 检查是否遵循语言/框架的最佳实践、设计模式是否合理\n` +
          `### 5. ✅ 改进建议\n- 按优先级列出具体的改进建议（高/中/低）\n\n` +
          `**重要**: 你只能读取代码和文件，绝对不能修改任何文件。如果你需要展示修改建议，请在报告中以代码块形式展示。`,
      });
    }

    return systemMsgs;
  }

  /**
   * 主入口: 跑一轮对话
   * 学自: Reasonix loop.ts CacheFirstLoop
   * 学自: Hermes AIAgent.chat()
   * 学自: ZhiY.AI zhiy-agent-core.ts 主循环
   *
   * @param userMessage 纯文本消息, 或含 text+image_url 块的结构化消息
   */
  async run(userMessage: string | { content: MessageContent }): Promise<ChatResponse> {
    await this.ensureContext();
    this.iteration = 0;
    this.context.volatileScratch = '';
    const startedAt = Date.now();
    const MAX_RUNTIME_MS = 180_000; // 3分钟总超时保护

    // 1. 用户消息进 append-only log (支持结构化 content, 含 image_url)
    const messageContent: MessageContent = typeof userMessage === 'string' ? userMessage : userMessage.content;
    const messageText = typeof messageContent === 'string' ? messageContent
      : messageContent.find(b => b.type === 'text')?.text || '';
    this.context.appendOnlyLog.push({ role: 'user', content: messageContent });
    this.emit('log:appended', { role: 'user', content: messageText });

    // 1.1 自动检测图片/视频输入 → 切换到视觉模型
    // 检测来源: runMessage (前端直接发送) 或 appendOnlyLog (后端注入的多路径附件)
    const hasImage = (typeof messageContent !== 'string' &&
      Array.isArray(messageContent) &&
      messageContent.some(b => b.type === 'image_url')) ||
      this.context.appendOnlyLog.some(m =>
        Array.isArray(m.content) && m.content.some((c: any) => c.type === 'image_url')
      );
    if (hasImage) {
      // 图片输入: 只在当前模型是免费模型且 zhipu 可用时才切换到视觉模型
      // 如果用户手动选了商业模型, 不强制切换 (尊重用户选择)
      // 如果 zhipu 也熔断了, 保留图片但降级为文字描述
      const FREE_PROVIDERS_SET = new Set(['agentai', 'zhipu']);
      const isCurrentFree = FREE_PROVIDERS_SET.has(this.opts.model);
      const zhipuStats = (this.router as any)?.providers?.get('zhipu');
      const zhipuAvailable = zhipuStats && !zhipuStats.tripped && !!process.env.ZHIPU_API_KEY;

      if (isCurrentFree && zhipuAvailable) {
        console.log('[vision] detected image input, routing to vision model');
        this.opts.model = 'zhipu';
        this.opts.modelName = 'glm-4.6v-flash';
        this.emit('model:switched', { to: 'zhipu:glm-4.6v-flash', reason: 'image_input' });
      } else if (isCurrentFree && !zhipuAvailable) {
        // zhipu 不可用 → 将图片替换为文字描述, 避免图片数据被不支持vision的模型丢弃
        console.log('[vision] image input but vision model unavailable, converting to text description');
        for (const msg of this.context.appendOnlyLog) {
          if (Array.isArray(msg.content)) {
            const hasImageUrl = msg.content.some((c: any) => c.type === 'image_url');
            if (hasImageUrl) {
              // 将图片转为文字描述
              const textParts = msg.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
              const imageCount = msg.content.filter((c: any) => c.type === 'image_url').length;
              msg.content = `${textParts}\n[用户上传了 ${imageCount} 张图片, 但当前模型不支持视觉理解, 请根据文字描述回答]`;
            }
          }
        }
      } else {
        // 商业模型: 大多支持vision, 不切换, 直接使用
        console.log(`[vision] detected image input, keeping current model ${this.opts.model} (commercial model likely supports vision)`);
      }
    }

    // 1.5 自动创建任务链 (TaskChain / GraphTaskChain)
    // 闲聊/短消息/简单问答不触发任务编排
    const isSimpleChat = /^(你好|嗨|hi|hello|好的|谢谢|没问题|ok|嗯|对|是|不|行|可以|在吗|你在|怎么样|能不能|会不会|为什么|怎么|什么|哪里|哪个|谁|多少|几|吗|呢|吧|啊|呀|哦|哈|嘿)/i.test(messageText.trim())
      || messageText.trim().length < 20
      || /^(为什么|怎么|什么|如何|能不能|会不会|是不是|有没有)/.test(messageText.trim());
    const isComplex = !isSimpleChat
      && messageText.length > 30
      && /做|写|改|建|生成|分析|创建|开发|构建|重构|审查|修复|部署|实现|设计|优化|测试|配置|总结|整理|对比|规划|帮我|请你|make|build|create|develop|refactor|review|fix|deploy|implement|design|optimize|test|analyze|generate|summarize/i.test(messageText);
    let taskChain: any = null;
    if (isComplex) {
      try {
        const isDAG = /并行|多个|同时|multi|parallel|graph|dag/i.test(messageText);
        if (isDAG) {
          const { GraphTaskChain } = await import('./graph-task-chain.js');
          taskChain = new GraphTaskChain({ goal: messageText.slice(0, 200), userId: this.opts.userId, workspace: this.opts.workspace });
        } else {
          const { TaskChain } = await import('./task-chain.js');
          taskChain = new TaskChain({ goal: messageText.slice(0, 200), userId: this.opts.userId, workspace: this.opts.workspace });
        }
        this.emit('plan:created', { chainId: taskChain.chainId, goal: messageText.slice(0, 200), stages: [{ key: 'understand', label: '理解' }, { key: 'execute', label: '执行' }, { key: 'report', label: '报告' }], currentStage: 'understand' });
      } catch (e: any) { console.warn('[TaskChain] init failed:', e?.message); }

      // 复杂任务: 自动创建计划 + 自动追踪进度
      try {
        const { EXTRA_HANDLERS } = await import('./tools.js');
        const goal = messageText.slice(0, 200);
        await EXTRA_HANDLERS.plan_task({
          goal,
          subtasks: [
            { id: 'understand', title: '理解需求', priority: 'high' },
            { id: 'research', title: '调研分析', priority: 'medium' },
            { id: 'execute', title: '执行操作', priority: 'high' },
            { id: 'summary', title: '总结报告', priority: 'medium' },
          ],
        });
        // 注入引导提示
        this.context.appendOnlyLog.push({
          role: 'system',
          content: `[任务计划] 已自动创建执行计划。系统会根据你的工具调用自动更新进度。请按 理解→调研→执行→总结 的顺序推进。`,
        });
      } catch { /* plan creation optional */ }
    }
    try {
      const { skillOrchestrator } = await import('./skill-orchestrator.js');
      const matches = skillOrchestrator.smartDispatch(messageText, 3);
      // 降低匹配阈值: 6分以上即可注入 (原8分太严格, 浪费了已注册的技能)
      const qualified = matches.filter(m => m.score >= 6);
      if (qualified.length > 0) {
        // 按需注入匹配到的技能 (替代全量 XML 注入, 节省 token)
        const injected: string[] = [];
        for (const match of qualified) {
          const skill = skillOrchestrator.get(match.name);
          if (skill) {
            injected.push(`- **${skill.name}**: ${skill.description} [${skill.category}] (匹配度: ${match.score})`);
            this.emit('skill:triggered', { name: skill.name, category: skill.category, score: match.score });
            // 记录技能使用 (用于自进化)
            try {
              const { getSkillEvolver } = await import('./skill-evolver.js');
              const evolver = getSkillEvolver();
              evolver.recordUsage({
                skill_id: skill.name,
                skill_name: skill.name,
                category: skill.category,
                score: match.score,
                latency_ms: 0,
                timestamp: new Date().toISOString(),
              });
            } catch (e: any) { /* skill dispatch log optional */ }
          }
        }
        if (injected.length > 0) {
          this.context.appendOnlyLog.push({
            role: 'system',
            content: `[技能匹配] 检测到 ${injected.length} 个匹配技能:\n${injected.join('\n')}\n请优先使用匹配技能的能力来完成任务。`,
          });
        }
      }
    } catch (e: any) { /* skill orchestrator optional */ }

    // 2.5 智能模型推荐: 复杂任务自动建议切换强模型
    let modelRecommendation: string | null = null;
    try {
      const currentModelId = `${this.opts.model}:${this.opts.modelName || ''}`;
      const rec = recommendModel(messageText, currentModelId);
      if (rec.needsPro && rec.currentIsFree) {
        const keyInfo = getProModelKeyInfo(rec.recommendedModel);
        const keyHint = keyInfo
          ? `\n> 需要提供 API Key (${keyInfo.envVar}), 可在设置页一键配置, 或访问 ${keyInfo.signupUrl} 获取`
          : '';
        modelRecommendation = `💡 **模型建议**: ${rec.reason}, 推荐切换到 **${rec.recommendedLabel}** 以获得更好的结果。${keyHint}\n\n---\n\n`;
        this.emit('model:recommended', { from: currentModelId, to: rec.recommendedModel, reason: rec.reason });
        console.log(`[model-recommend] ${rec.reason} → ${rec.recommendedModel}`);
      }
    } catch (e: any) { /* model recommendation optional */ }

    // 2. 歧义检测: 用户消息模糊时主动注入追问提示
    if (!isSimpleChat && messageText.length > 10 && this.iteration === 0) {
      const ambiguityPatterns = [
        /做一个|帮我|搞一下|弄一下|处理/,       // 模糊动词
        /这个|那个|它|这些|上面/,                 // 指代不明
        /好看的|合适的|差不多|大概|随便/,         // 模糊描述
        /或者|还是|要不/,                         // 二选一未决
      ];
      const hasAmbiguity = ambiguityPatterns.some(p => p.test(messageText));
      const isShort = messageText.length < 30;
      const lacksTarget = !/\.(tsx?|jsx?|py|css|html|json|md|vue|go|rs)/i.test(messageText)
        && !/文件|目录|项目|页面|组件|模块|接口|数据库/i.test(messageText);

      if (hasAmbiguity && (isShort || lacksTarget)) {
        this.context.appendOnlyLog.push({
          role: 'system',
          content: `[歧义检测] 用户消息可能不够明确。如果你不确定用户想要什么，请立即调用 ask_user 工具追问，提供 2-4 个选项让用户选择。不要猜测用户意图后直接执行——猜错了成本更高。`,
        });
      }
    }

    // 3. 反思门 (学 WorkBuddy, 自创触发点)
    if (this.context.appendOnlyLog.length % this.opts.reflectEvery === 0) {
      await this.reflect();
    }

    // 3. 主循环
    let lastResponse: ChatResponse | null = null;
    let autoResumeCount = 0;
    const MAX_AUTO_RESUME = 5;

    while (true) {
      if (this.opts.abortSignal.aborted) {
        throw new Error('Aborted by user');
      }
      this.iteration++;
      this.emit('loop:iteration', { n: this.iteration });

      // 工作记忆摘要: 每 10 轮自动生成, 防止长对话"失忆"
      if (this.iteration > 0 && this.iteration % 10 === 0) {
        try {
          const toolCalls = this.context.appendOnlyLog
            .filter(m => m.role === 'tool')
            .map(m => (m as any).name || 'unknown');
          const toolSummary = [...new Set(toolCalls)].join(', ');
          const userMsgs = this.context.appendOnlyLog
            .filter(m => m.role === 'user' && typeof m.content === 'string' && !m.content.startsWith('[SYSTEM'))
            .map(m => (m.content as string).slice(0, 60));
          const lastUserGoal = userMsgs[userMsgs.length - 1] || messageText.slice(0, 60);
          const completedTools = toolCalls.length;
          const summary = `[工作记忆 · 轮次 ${this.iteration}]\n` +
            `用户目标: ${lastUserGoal}\n` +
            `已调用 ${completedTools} 次工具: ${toolSummary}\n` +
            `当前迭代: ${this.iteration}/${this.opts.maxIterations}`;
          // 注入到 log 开头, 不影响最近消息
          this.context.appendOnlyLog.unshift({
            role: 'system', content: summary,
          });
          console.log(`[working-memory] injected summary at iteration ${this.iteration}`);
        } catch { /* working memory optional */ }
      }

      // 总超时保护: 3分钟强制退出
      if (Date.now() - startedAt > MAX_RUNTIME_MS) {
        this.context.appendOnlyLog.push({
          role: 'user',
          content: '[SYSTEM] 已超过3分钟执行时限, 请立即总结当前进展并结束。',
        });
        // 再给一次机会让AI总结
        if (this.iteration > this.opts.maxIterations - 2) break;
      }

      // 检查是否被中断
      if (this._aborted) {
        return { content: '[任务已中断]', provider: 'aborted', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0, cacheHit: false, source: 'estimated' as const }, iterations: this.iteration, durationMs: Date.now() - startedAt };
      }

      let userText = '';
      // 3.0 规则前置: 仅对 Agnes (无工具能力)生效, DeepSeek 原生调工具不干预
      if (this.iteration === 1 && this.opts.model !== 'deepseek') {
        const lastMsg = this.context.appendOnlyLog[this.context.appendOnlyLog.length - 1];
        userText = lastMsg?.role === 'user' ? (typeof lastMsg.content === 'string' ? lastMsg.content : '') : '';
        const ctx: any = { userId: this.opts.userId, workspace: this.opts.workspace, abortSignal: this.opts.abortSignal };
        if (/^(审查|分析|检查|探索|review|analyze|explore)/i.test(userText) && userText.length < 50) {
          try {
            const r = await this.registry.executeOne({ id: 'pre_list', name: 'list_directory', args: { path: this.opts.workspace || '.' } }, ctx);
            if (r?.success) {
              this.context.appendOnlyLog.splice(-1, 0, { role: 'tool', name: 'list_directory', content: `📁 目录结构:\n${r.output}` });
            }
          } catch (e: any) { console.warn('[pre-read] list_directory failed:', e?.message); }
        }
        const readMatch = userText.match(/^(读|查看|读取|cat|read)\s+(.+)/i);
        if (readMatch?.[2]) {
          try {
            const r = await this.registry.executeOne({ id: 'pre_read', name: 'read_file', args: { file_path: readMatch[2].trim() } }, ctx);
            if (r?.success) {
              this.context.appendOnlyLog.splice(-1, 0, { role: 'tool', name: 'read_file', content: `📄 文件内容:\n${r.output}` });
            }
          } catch (e: any) { console.warn('[pre-read] read_file failed:', e?.message); }
        }
      }

      // 3.1 构造 LLM 请求 (immutable prefix + append-only log)
      const messages: ChatMessage[] = [
        ...this.context.immutablePrefix,
        ...this.context.appendOnlyLog,
      ];

      // 凭证遮蔽: 防止 API key / token / password 泄露到 LLM 上下文
      for (const msg of messages) {
        if (typeof msg.content === 'string') {
          msg.content = maskCredentials(msg.content);
        } else if (Array.isArray(msg.content)) {
          msg.content = msg.content.map((part: any) =>
            part.type === 'text' ? { ...part, text: maskCredentials(part.text) } : part
          );
        }
      }

      // 只读工具子集 (planning / review 模式共用)
      const readonlyToolNames = ['read_file','list_directory','directory_tree','search_codebase','web_fetch','ask_user'];
      const isReadonlyTools = (t: any) => readonlyToolNames.includes(t.name || t.function?.name || '');

      // 计算工具列表: 根据模式 + 模型能力过滤
      let requestTools: any[] = [];
      if (this.opts.mode !== 'readonly') {
        const allTools = this.registry.toLLMTools();
        const { MODELS } = await import('./model-classifier.js');
        const modelMeta = MODELS.find(m =>
          m.provider === this.opts.model &&
          (!this.opts.modelName || m.subModel === this.opts.modelName)
        );
        if (modelMeta && !modelMeta.supportsTools) {
          console.log(`[tools] model ${modelMeta.id} doesn't support tools, sending 0 tools`);
          requestTools = [];
        } else if (this.opts.mode === 'planning' || this.opts.mode === 'review') {
          requestTools = allTools.filter(isReadonlyTools);
        } else {
          requestTools = allTools;
        }
      }

      const req: ChatRequest = {
        model: this.opts.model as ProviderId,
        subModel: this.opts.modelName || undefined,
        messages,
        tools: requestTools,
        userId: this.opts.userId,
        workspace: this.opts.workspace,
        thinking: this.opts.thinking,
        thinkingBudget: this.opts.thinkingBudget,
        stream: true,
        modelConfig: this.opts.modelConfig,
        onDelta: (delta: string) => {
          // 区分思考内容和普通内容
          if (delta.startsWith('[THINKING]')) {
            const thinkingText = delta.slice('[THINKING]'.length);
            this.emit('llm:thinking', { text: thinkingText });
          } else {
            this.emit('llm:delta', { delta });
          }
        },
      };

      // 3.2 调 LLM
      console.log('[run:chat] calling router.chat, model=', req.model, 'subModel=', req.subModel);
      const res = await this.router.chat(req);
      console.log('[run:chat] router.chat returned, provider=', res?.provider, 'contentLen=', res?.content?.length);

      // 🎯 智能模型切换: 检测连续熔断，自动切换商用 API
      // 注意: 只有当所有 provider 都返回了 'none' (全部不可用) 时才计数
      // 路由器内部正常降级 (如 deepseek→agentai 成功响应) 不算熔断
      if (res?.provider === 'none') {
        this.trippedCount++;
        console.log(`[smart-switch] 全部 provider 不可用, 熔断计数: ${this.trippedCount}/3`);
        if (this.trippedCount >= 3) {
          const switcher = await this._getSmartSwitcher();
          const decision = switcher.analyzeSwitchNeed(
            String(req.model),
            { isLimited: true, waitTime: 0, remainingRequests: 0 },
            'medium' as any,
            'medium' as any,
          );
          if (decision.shouldSwitch && decision.hasApiKey) {
            console.log(`[smart-switch] ✅ 自动切换: ${req.model} → ${decision.targetProvider}`);
            // 避免切到相同的 provider
            if (decision.targetProvider === req.model) {
              console.log(`[smart-switch] ⚠️ 目标 provider 与当前相同, 跳过切换`);
              this.trippedCount = 0;
            } else {
              this.opts.model = decision.targetProvider;
              const switchModelMap: Record<string, string> = {
                superapi: 'deepseek-v4-flash',
                deepseek: 'deepseek-v4-flash',
                openai: 'gpt-4o-mini',
                zhipu: 'glm-4-flash',
              };
              this.opts.modelName = switchModelMap[decision.targetProvider] || 'deepseek-v4-flash';
              this.emit('model:auto-switched', { from: req.model, to: decision.targetProvider, reason: '当前模型全部不可用，自动切换' });
              this.trippedCount = 0;
            }
          } else if (decision.shouldSwitch && !decision.hasApiKey) {
            console.log(`[smart-switch] ⚠️ 需要商用 API 密钥: ${decision.targetProvider}, 提示用户`);
            this.emit('model:need-api-key', { provider: decision.targetProvider, estimatedCost: decision.estimatedCost });
          }
        }
      } else if (res?.provider) {
        // 任何有效响应 (即使是降级到其他 provider) 都重置计数
        this.trippedCount = 0;
      }
      lastResponse = res;

      // 3.3 写 append-only log (assistant 消息 — 必须包含 tool_calls!)
      // OpenAI 兼容协议: 多轮工具调用需要 assistant 消息包含 tool_calls 字段
      // 否则 LLM 在下一轮看不到自己调用了什么工具, 导致上下文断裂
      const assistantMsg: any = { role: 'assistant', content: res.content || null };
      if (res.toolCalls && res.toolCalls.length > 0) {
        assistantMsg.tool_calls = res.toolCalls.map((tc: any) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args || {}) },
        }));
      }
      this.context.appendOnlyLog.push(assistantMsg);
      this.emit('log:appended', { role: 'assistant', content: res.content });

      // ═══ 推理过程展示: LLM在调工具前的思考内容 → 推送到前端 ═══
      // 当LLM同时返回文本内容+工具调用时, 文本内容就是它的推理过程
      // 发送 reasoning 事件, 前端会把之前收到的delta(text)转为reasoning segment
      if (res.toolCalls && res.toolCalls.length > 0) {
        // 有工具调用 → 之前的文本输出都是推理过程
        this.emit('reasoning', { text: '' }); // 空text, 信号前端转换已有text→reasoning
      }

      // 3.4 处理 tool calls
      if (res.toolCalls && res.toolCalls.length > 0) {
        // 任务链推进: 有工具调用 = 进入执行阶段
        if (taskChain) {
          try {
            if (taskChain.state?.currentStage === 'plan') {
              taskChain.advance('solve', { output: '开始执行工具调用' });
              this.emit('plan:stage', { chainId: taskChain.chainId, stage: 'solve', status: 'running' });
            }
          } catch (e: any) { /* TaskChain advance optional */ }
        }
        // 子Agent 检测: spawn_subagent 调用 → 创建独立 AgentAILoop 执行
        // 模型策略: 免费模型(agentai/zhipu)禁用子智能体并行(配额有限), 商业模型以本体为主
        const FREE_PROVIDERS = new Set(['agentai', 'zhipu']);
        const isFreeModel = FREE_PROVIDERS.has(this.opts.model);
        for (const tc of res.toolCalls) {
          if (tc.name === 'spawn_subagent') {
            if (isFreeModel) {
              // 免费模型: 禁用子智能体并发, 由主Agent自己串行执行
              console.log(`[subagent] free model ${this.opts.model} does not support subagent parallelism, deferring to main loop`);
              this.emit('subagent:start', { id: `deferred-${Date.now()}`, type: tc.args?.type, task: tc.args?.task });
              // 不创建子Agent, 让主Agent自己通过工具调用完成任务
              // 替换为提示信息, 引导主Agent自行执行
              this.context.appendOnlyLog.push({
                role: 'tool', name: 'spawn_subagent', tool_call_id: tc.id,
                content: `[子Agent不可用] 当前使用免费模型, 不支持子智能体并行。请直接使用工具执行: ${tc.args?.task || ''}`,
              });
              this.emit('subagent:error', { id: `deferred-${Date.now()}`, error: 'Free model does not support subagent parallelism' });
            } else {
              // 商业模型: 以本体为主, 子智能体也用同一商业模型
              const subId = `${tc.args?.type || 'sub'}-${Date.now()}`;
              this.emit('subagent:start', { id: subId, type: tc.args?.type, task: tc.args?.task }); // 前端可见
              (async () => {
                try {
                  const subLoop = new AgentAILoop(this.router, this.registry, [], {
                    maxIterations: 20,
                    userId: this.opts.userId,
                    workspace: this.opts.workspace,
                    model: this.opts.model,
                    modelName: this.opts.modelName,
                    userPickedModel: this.opts.userPickedModel,
                  });
                  const subResult = await subLoop.run(tc.args?.task || '');
                  this.emit('subagent:done', { id: subId, result: subResult.content?.slice(0, 200) });
                  this.context.appendOnlyLog.push({
                    role: 'tool', name: 'spawn_subagent', tool_call_id: tc.id,
                    content: `[子Agent ${tc.args?.type || 'explore'}]: ${subResult.content.slice(0, 2000)}`,
                  });
                } catch (e: any) {
                  this.emit('subagent:error', { id: subId, error: e.message });
                  this.context.appendOnlyLog.push({
                    role: 'tool', name: 'spawn_subagent', tool_call_id: tc.id,
                    content: `[子Agent 失败]: ${e.message}`,
                  });
                }
              })();
            }
          }
        }
        const rawResults = await this.dispatchToolCalls(res.toolCalls);

        // ═══ Token 压缩: 在入 log 前对工具输出做语义压缩 ═══
        // 学习 RTK 的 4 层压缩: 噪音过滤 → 结构化分组 → 重复折叠 → 智能截断
        // 副作用: 不影响 LLM 理解, 仅减少 token 消耗
        const { results: toolResults, stats: compressStats } = compressAllToolResults(
          rawResults.map(r => ({ id: r.id, name: r.name, output: r.output, data: r.data })),
        );
        if (compressStats.compressedCount > 0) {
          const saved = compressStats.totalBefore - compressStats.totalAfter;
          const pct = compressStats.totalBefore > 0
            ? Math.round((saved / compressStats.totalBefore) * 100) : 0;
          console.log(`[token-compress] ${compressStats.compressedCount} tools compressed, ${compressStats.totalBefore}→${compressStats.totalAfter} chars (-${pct}%)`);
          this.emit('compress:done', { compressedCount: compressStats.compressedCount, savedChars: saved, savedPercent: pct });
        }

        // 3.5 工具结果进 append-only log + 检测重复失败
        let hasPendingAsk = false;
        let askData: any = null;
        const duplicateTracker = new Map<string, number>(); // tool:args → 连续失败次数
        for (const r of toolResults) {
          const sig = `${r.name}::${JSON.stringify(res.toolCalls?.find((tc:any) => tc.id === r.id)?.args || {})}`;
          const failCount = duplicateTracker.get(sig) || 0;
          // 检查是否失败且连续重复
          if (!(r.output && r.output.startsWith('Error:')) && r.output) {
            // 成功 → 重置
            duplicateTracker.delete(sig);
          } else {
            duplicateTracker.set(sig, failCount + 1);
          }
          this.context.appendOnlyLog.push({
            role: 'tool',
            name: r.name,
            tool_call_id: r.id,
            content: r.output,
          });
          this.emit('log:appended', { role: 'tool', content: r.output });
          this.emit('tool:result', { callId: r.id, name: r.name, result: r.output, ok: !(r.output && r.output.startsWith('Error:')), durationMs: 0 }); // 前端可监听

          // 自动计划追踪: 根据工具名推断当前阶段
          try {
            const { _active_plan, EXTRA_HANDLERS } = await import('./tools.js');
            if (_active_plan) {
              const readTools = ['read_file', 'list_directory', 'directory_tree', 'search_content', 'search_codebase', 'get_symbols', 'glob'];
              const researchTools = ['web_search', 'web_fetch', 'recall_memory'];
              const execTools = ['write_file', 'multi_edit', 'create_file', 'run_code', 'delete_file', 'create_directory', 'move_file', 'copy_file', 'generate_image', 'generate_diagram'];

              let stageId = '';
              if (readTools.includes(r.name)) stageId = 'understand';
              else if (researchTools.includes(r.name)) stageId = 'research';
              else if (execTools.includes(r.name)) stageId = 'execute';

              if (stageId) {
                // 标记之前的阶段为完成, 当前阶段为进行中
                for (const t of _active_plan.subtasks) {
                  if (t.id === stageId) {
                    t.status = 'in_progress';
                  } else if (_active_plan.subtasks.indexOf(t) < _active_plan.subtasks.findIndex((s: any) => s.id === stageId)) {
                    if (t.status !== 'completed') t.status = 'completed';
                  }
                }
              }
            }
          } catch { /* auto-track optional */ }
          if (r.name === 'ask_user' && r.data?.action === 'ask_user') {
            hasPendingAsk = true;
            askData = r.data;
          }
        }
        // 检测重复失败 → 引导 AI 换方案
        for (const [sig, count] of duplicateTracker) {
          if (count >= 3) {
            const [toolName] = sig.split('::');
            this.context.appendOnlyLog.push({
              role: 'user',
              content: `[SYSTEM] ${toolName} 已连续失败 ${count} 次。请**停止重试**，改用其他工具或方案。例如: 如果读文件失败, 尝试 \`list_directory\` + \`search_codebase\`。如果路径不存在, 用 \`list_directory\` 探索。不要反复执行相同操作!`,
            });
            this.emit('tool:stuck', { tool: toolName, count });
            break; // 只触发一次
          }
        }

        // ═══ 自主修复闭环: 检测工具错误模式并自动注入修复指令 ═══
        // 核心理念: 不会就学, 学不会就抄, 抄不会就自己建
        for (const r of toolResults) {
          const out = r.output || '';
          // 1) 模块缺失 → 自动安装 (npm + pip)
          const moduleMatch = out.match(/Cannot find module ['"]([^'"]+)['"]/i)
            || out.match(/ModuleNotFoundError:\s*No module named ['"]([^'"]+)['"]/i)
            || out.match(/Error: Cannot find package ['"]([^'"]+)['"]/i)
            || out.match(/ImportError:\s*No module named ['"]([^'"]+)['"]/i)
            || out.match(/Module not found:\s*Error: Can't resolve ['"]([^'"]+)['"]/i);
          if (moduleMatch && !out.includes('npm_install') && !out.includes('pip_install')) {
            const mod = moduleMatch[1];
            const isPython = out.includes('ModuleNotFoundError') || out.includes('ImportError');
            const installCmd = isPython ? 'pip_install' : 'npm_install';
            this.context.appendOnlyLog.push({
              role: 'user',
              content: `[SYSTEM 自主修复] 检测到模块缺失: "${mod}"。请立即调用 ${installCmd} 安装此依赖, 然后重试操作。不要告诉用户缺模块, 自己装! 如果安装失败, 尝试: 1) 换一个功能相同的包 2) 用 run_code 自己实现该功能`,
            });
            this.emit('auto:fix', { type: 'missing_module', module: mod });
            this.emit('reasoning', { text: `[自主修复] 检测到缺失依赖 "${mod}", 正在自动安装...` });
            break;
          }
          // 2) Python编码错误 → 自动注入UTF-8修复
          if (out.includes('UnicodeEncodeError') || out.includes('UnicodeDecodeError')) {
            this.context.appendOnlyLog.push({
              role: 'user',
              content: `[SYSTEM 自主修复] 检测到Python编码错误。请在Python代码开头添加:\nimport sys, io\nsys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')\nsys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')\n然后重试。不要告诉用户编码有问题, 自己修!`,
            });
            this.emit('auto:fix', { type: 'encoding_error' });
            this.emit('reasoning', { text: `[自主修复] 检测到编码错误, 自动注入UTF-8修复...` });
            break;
          }
          // 3) 文件路径不存在 → 自动探索
          if ((out.includes('ENOENT') || out.match(/no such file|not found|找不到/i)) && !out.includes('list_directory')) {
            this.context.appendOnlyLog.push({
              role: 'user',
              content: `[SYSTEM 自主修复] 检测到文件/路径不存在。请先调用 list_directory 或 directory_tree 查看实际目录结构, 找到正确路径后重试。不要反复尝试错误路径!`,
            });
            this.emit('auto:fix', { type: 'path_not_found' });
            this.emit('reasoning', { text: `[自主修复] 路径不存在, 自动探索目录结构...` });
            break;
          }
          // 4) 权限错误 → 自动换路径/方式
          if (out.includes('EACCES') || out.includes('EPERM') || out.includes('permission denied')) {
            this.context.appendOnlyLog.push({
              role: 'user',
              content: `[SYSTEM 自主修复] 检测到权限不足。请尝试: 1) 换到工作区目录下操作 2) 用 run_code 执行需要权限的操作。不要告诉用户"权限不够", 自己想办法!`,
            });
            this.emit('auto:fix', { type: 'permission_error' });
            this.emit('reasoning', { text: `[自主修复] 权限不足, 自动切换方案...` });
            break;
          }
          // 5) 语法/运行错误 → 自动修复重试
          if (out.includes('SyntaxError') || out.includes('TypeError') || out.includes('ReferenceError') || out.includes('NameError')) {
            const errorLine = out.split('\n').find(l => /Error:/i.test(l)) || '';
            this.context.appendOnlyLog.push({
              role: 'user',
              content: `[SYSTEM 自主修复] 检测到代码错误: ${errorLine.slice(0, 200)}。请分析错误原因, 修复代码后重新执行。不要只描述错误, 必须修复并重试!`,
            });
            this.emit('auto:fix', { type: 'code_error', error: errorLine.slice(0, 100) });
            this.emit('reasoning', { text: `[自主修复] 代码错误, 自动分析并修复: ${errorLine.slice(0, 80)}...` });
            break;
          }
          // 6) 网络超时/连接失败 → 自动重试
          if (out.match(/ETIMEDOUT|ECONNREFUSED|ECONNRESET|fetch failed|network error/i)) {
            this.context.appendOnlyLog.push({
              role: 'user',
              content: `[SYSTEM 自主修复] 检测到网络错误。请: 1) 等待2秒后重试 2) 如果持续失败, 换一种方式完成任务(如用本地资源替代网络请求)。不要告诉用户网络有问题, 自己想办法!`,
            });
            this.emit('auto:fix', { type: 'network_error' });
            this.emit('reasoning', { text: `[自主修复] 网络错误, 自动重试...` });
            break;
          }
          // 7) 工具不存在 → 自动用 run_code 替代
          if (out.match(/Unknown tool|tool not found|no tool named|Function\s+\w+\s+does not exist/i)) {
            const toolMatch = out.match(/(?:Unknown tool|tool not found|no tool named|Function\s+)(\w+)/i);
            const missingTool = toolMatch ? toolMatch[1] : 'unknown';
            this.context.appendOnlyLog.push({
              role: 'user',
              content: `[SYSTEM 自主修复] 检测到工具 "${missingTool}" 不存在。请用 run_code (Python/Shell) 自己实现该功能。不要告诉用户缺工具, 自己写代码实现!`,
            });
            this.emit('auto:fix', { type: 'missing_tool', tool: missingTool });
            this.emit('reasoning', { text: `[自主修复] 工具 "${missingTool}" 不存在, 自动用代码实现替代...` });
            break;
          }
          // 8) Excel/文件解析失败 → 自动换解析方式
          if (out.match(/Excel解析失败|xlsx.*failed|pdf.*failed|doc.*failed|文件解析失败/i)) {
            this.context.appendOnlyLog.push({
              role: 'user',
              content: `[SYSTEM 自主修复] 文件解析失败。请: 1) 用 run_code 执行 Python 脚本解析 (openpyxl/pandas/pdfplumber) 2) 如果依赖缺失先安装 3) 用 PowerShell 读取。不要告诉用户解析失败, 自己换方式!`,
            });
            this.emit('auto:fix', { type: 'parse_error' });
            this.emit('reasoning', { text: `[自主修复] 文件解析失败, 自动切换解析方式...` });
            break;
          }
        }

        if (hasPendingAsk) {
          this.emit('ask_user', { question: askData?.question || '', options: askData?.options || [], sessionId: this.context.sessionId });
          break;
        }
        continue;
      }

      // 3.7 无 tool call: 检查是否需要自动恢复

      // finish_reason='length' → 回复被截断(max_tokens限制), 自动继续
      if (res.finishReason === 'length') {
        this.context.appendOnlyLog.push({
          role: 'user',
          content: '[SYSTEM] 你的回复被截断了(max_tokens限制)。请从断点继续完成你的回答和任务。',
        });
        autoResumeCount++;
        this.emit('auto:resume', { reason: 'length_truncated', count: autoResumeCount });
        continue;
      }

      // ═══ 元认知决策: 让 AI 自己判断是否继续 ═══
      // 复用 metaLoop 实例, 不每轮重建, 保留跨轮经验积累
      try {
        if (!this.metaLoop) {
          const { MetaCognitiveLoop } = await import('./meta/meta-cognitive-loop.js');
          this.metaLoop = new MetaCognitiveLoop({
            agentId: this.opts.userId,
            task: { description: messageText.slice(0, 200), taskType: 'general', complexity: messageText.length > 200 ? 'high' : 'medium' },
            currentPlan: [],
            completedSteps: [],
            pendingQuestions: [],
            lastToolResult: null,
            maxMetaSteps: 5,
          });
        }
        const completedSteps = this.context.appendOnlyLog
          .filter(m => m.role === 'tool')
          .map(m => typeof m.content === 'string' ? m.content.slice(0, 50) : '');
        const lastToolResult = this.context.appendOnlyLog
          .filter(m => m.role === 'tool')
          .map(m => typeof m.content === 'string' ? m.content : '')
          .slice(-1)[0] || null;
        const toolUsed = this.context.appendOnlyLog
          .filter(m => m.role === 'tool')
          .map(m => (m as any).name)
          .slice(-1)[0];

        const metaOutput = this.metaLoop.iterate({
          task: { description: messageText.slice(0, 200), taskType: 'general', complexity: messageText.length > 200 ? 'high' : 'medium', requiredTools: [] },
          currentPlan: [],
          completedSteps,
          pendingQuestions: [],
          lastToolResult,
          toolUsed,
        });

        // 元认知决策: stop 且高置信度 → 直接结束
        if (metaOutput.decision.action === 'stop' && metaOutput.decision.confidence >= 0.85) {
          this.emit('meta:decision', { action: 'stop', confidence: metaOutput.decision.confidence, reason: metaOutput.decision.reasoning });
          break;
        }
        // 元认知决策: ask_human → 注入追问指令让 AI 调用 ask_user
        if (metaOutput.decision.action === 'ask_human') {
          this.emit('meta:decision', { action: 'ask_human', question: metaOutput.decision.reasoning });
          this.context.appendOnlyLog.push({
            role: 'user',
            content: `[SYSTEM 元认知] 你需要向用户追问才能继续。原因: ${metaOutput.decision.reasoning}\n请立即调用 ask_user 工具提问，不要直接退出。`,
          });
          continue; // 继续循环让 AI 执行 ask_user
        }
        // 元认知决策: continue → 注入策略提示
        if (metaOutput.decision.action === 'continue' || metaOutput.decision.action === 'switch_strategy') {
          this.emit('meta:decision', { action: metaOutput.decision.action, strategy: metaOutput.strategy.name, confidence: metaOutput.confidence.overall });
        }
      } catch (metaErr: any) {
        // 元认知模块不可用时，降级到硬编码规则，不影响主流程
        console.warn('[meta-cognitive] fallback to hardcoded rules:', metaErr?.message);
      }

      // ═══ 置信度评估: AI 知道自己"不知道什么" ═══
      // 在元认知决策后, 对纯文本回复做置信度评估
      // 低置信度 → 自动触发补充动作 (搜索/追问), 不瞎编
      try {
        const { ConfidenceEstimator } = await import('./meta/confidence-estimator.js');
        const estimator = new ConfidenceEstimator();

        // 收集置信度信号
        const toolCallCount = this.context.appendOnlyLog.filter(m => m.role === 'tool').length;
        const hasWebSearch = this.context.appendOnlyLog.some(m => m.role === 'tool' && (m as any).name === 'web_search');
        const hasReadFile = this.context.appendOnlyLog.some(m => m.role === 'tool' && (m as any).name === 'read_file');
        const responseText = (res.content || '').trim();

        // 信号1: 工具覆盖度 — 调了多少工具
        estimator.addSignal('tool_coverage', 0.25, Math.min(toolCallCount / 3, 1));

        // 信号2: 证据密度 — 是否搜索/读取了外部信息
        estimator.addSignal('evidence_density', 0.30, (hasWebSearch ? 0.5 : 0) + (hasReadFile ? 0.5 : 0));

        // 信号3: 不确定性标记 — 回复中是否包含犹豫词汇
        const uncertaintyWords = /可能|大概|也许|似乎|不确定|猜测|估计|大概|应该|或许|probably|maybe|might|guess|uncertain/i;
        const hasUncertainty = uncertaintyWords.test(responseText);
        estimator.addSignal('uncertainty_markers', 0.10, hasUncertainty ? 0.2 : 0.9);

        // 信号4: 语义完整性 — 回复长度是否足够
        estimator.addSignal('semantic_completeness', 0.15, Math.min(responseText.length / 200, 1));

        // 信号5: 一致性 — 多次推理是否一致 (简化: 检查是否有自我修正)
        const hasSelfCorrection = /等等|不对|修正|更正|实际上|actually|correction|wait/i.test(responseText);
        estimator.addSignal('consistency', 0.20, hasSelfCorrection ? 0.4 : 0.8);

        const report = estimator.evaluate();

        // 低置信度 → 区分: 知识不足(搜索) vs 需求不明确(追问用户)
        if (report.overallScore < 0.4 && this.iteration < this.opts.maxIterations * 0.7) {
          // 检测是否为需求不明确 (回复中包含反问/不确定用户意图的词汇)
          const needsClarification = /你(想要|希望|需要|指的是|是想|是要)|不确定你(的|想)|请(告诉|说明|确认|明确)|which|what do you|clarify/i.test(responseText);
          if (needsClarification) {
            // 需求不明确 → 追问用户
            this.context.appendOnlyLog.push({
              role: 'user',
              content: `[SYSTEM 置信度检查] 你似乎不确定用户的需求 (置信度 ${(report.overallScore * 100).toFixed(0)}%)。请立即调用 ask_user 工具向用户追问，提供具体选项让用户选择，不要猜测。`,
            });
          } else {
            // 知识不足 → 搜索
            const action = report.recommendation === 'retry_with_different_strategy'
              ? '请使用 web_search 搜索相关信息后再回答, 不要凭猜测回复。'
              : '请调用 read_file 或 web_search 补充信息, 确保回答有据可依。';
            this.context.appendOnlyLog.push({
              role: 'user',
              content: `[SYSTEM 置信度检查] 你的置信度较低 (${(report.overallScore * 100).toFixed(0)}%), ${action}`,
            });
          }
          this.emit('confidence:low', { score: report.overallScore, recommendation: report.recommendation, iteration: this.iteration });
          continue;
        }

        this.emit('confidence:eval', { score: report.overallScore, level: report.level, recommendation: report.recommendation });
      } catch (confErr: any) {
        // 置信度评估不可用时不影响主流程
      }

      const text = (res.content || '').trim();
      const len = text.length;
      const hasPriorTools = this.context.appendOnlyLog.some(
        m => m.role === 'tool' && typeof m.content === 'string' && !m.content.startsWith('[SYSTEM]')
      );

      // 规则1: 已使用工具 + 有实质回复 + 明确完成标记 → 任务完成
      const completionMarkers = /任务已完成|全部完成|已完成|完成！|done|finished|completed/i;
      if (hasPriorTools && len > 30 && completionMarkers.test(text)) break;

      // 规则2: 描述性回复但无实际操作 → 继续执行
      const userMessageStr = typeof userMessage === 'string' ? userMessage : '';
      const isChitChat = /^(你好|嗨|hi|hello|好的|谢谢|没问题|ok|嗯|对|是|不|行|可以|能|在吗|你在|怎么样|能不能|会不会|为什么|怎么|什么|如何|哪里|哪个)/i.test(userMessageStr.trim())
        || userMessageStr.trim().length < 15;
      const isNoKeyResponse = /\[.*no-key\]/i.test(text);

      // 检测告别/结束语: 用户说退出 或 AI 回复告别
      const isGoodbye = /退出|结束|不用了|不需要了|算了|拜拜|再见|goodbye|bye|没事了|over|final_end/i.test(userMessageStr)
        || /再见|祝你|祝您|拜拜|下次见|随时|欢迎.*回来|需要.*随时|期待.*再次|have a|goodbye|bye|告别/i.test(text);

      if (hasPriorTools && len > 60 && this.iteration < this.opts.maxIterations * 0.7) {
        const isUserChitChat = messageText.trim().length < 10;
        const isAnalysisTask = /^(审查|分析|检查|评估|review|analyze|inspect|audit|诊断)/i.test(messageText.trim());
        const isDescriptive = /我(看到|发现|了解|注意到|观察到|查看了|分析了)|让我(先|来)|这是|看起来|似乎|大概|目前|现状|情况/i.test(text);
        const hasAction = /已(创建|修改|写入|删除|安装|执行|生成)|成功|✅|完成/i.test(text);
        if (isDescriptive && !hasAction && !isUserChitChat && !isAnalysisTask) {
          this.context.appendOnlyLog.push({
            role: 'user',
            content: '[SYSTEM] 你只是描述了现状, 但还没有执行实际操作。请继续: 用 write_file/multi_edit 修改代码, 用 run_code 验证, 用 npm_install 安装依赖。不要只分析不行动!',
          });
          continue;
        }
        // 有操作标记 → 不在此处 break, 继续向下判断
      }

      // 规则3: 长回复但无工具 + 非闲聊 + 非告别 + 早期迭代 → 提示使用工具
      if (len > 200 && !hasPriorTools && this.iteration < this.opts.maxIterations * 0.5 && !isChitChat && !isGoodbye) {
        this.context.appendOnlyLog.push({
          role: 'user',
          content: '[SYSTEM] 你的回复很长但没有调用任何工具。如果用户需要你执行操作, 请立即调用工具。如果只是回答问题, 请明确说"回答完毕"。',
        });
        continue;
      }

      // 规则4: 短回复 + 无工具 + 还有恢复次数 + 非告别 → 自动恢复
      if (!hasPriorTools && len < 200 && autoResumeCount < MAX_AUTO_RESUME && !isNoKeyResponse && !isChitChat && !isGoodbye) {
        autoResumeCount++;
        this.context.appendOnlyLog.push({
          role: 'user',
          content: '[SYSTEM] 你的回答太简短了。请深入执行任务: 先调用 list_directory 或 directory_tree 了解工作区结构, 然后用 read_file/write_file/generate_image 等具体工具完成任务。如果缺少信息, 用 ask_user 追问用户。不要只说"我来做"而不实际调用工具。',
        });
        continue;
      }

      // 默认: finish_reason='stop' + 无 tool_calls → 自然结束
      break;
    }

    // ═══ 任务完成总结: 有工具调用但无明确总结 → 追加一轮总结 ═══
    const hasPriorToolCalls = this.context.appendOnlyLog.some(
      m => m.role === 'tool' && typeof m.content === 'string' && !m.content.startsWith('[SYSTEM]')
    );
    const lastText = (lastResponse?.content || '').trim();
    const alreadySummarized = /任务已完成|全部完成|已完成|完成！|done|finished|completed|总结|summary/i.test(lastText);
    if (hasPriorToolCalls && !alreadySummarized && lastText.length < 100 && this.iteration < this.opts.maxIterations - 1) {
      try {
        this.context.appendOnlyLog.push({
          role: 'user',
          content: '[SYSTEM] 任务已执行完毕。请用 2-3 句话简要总结你完成了什么工作、修改了哪些文件、关键结果是什么。不要重复执行操作，仅做总结。',
        });
        const summaryReq: ChatRequest = {
          model: this.opts.model as ProviderId,
          subModel: this.opts.modelName || undefined,
          messages: [...this.context.immutablePrefix, ...this.context.appendOnlyLog],
          tools: [],
          userId: this.opts.userId,
          workspace: this.opts.workspace,
          stream: true,
          onDelta: (delta: string) => { this.emit('llm:delta', { delta }); },
        };
        const summaryRes = await this.router.chat(summaryReq);
        if (summaryRes?.content) {
          this.context.appendOnlyLog.push({ role: 'assistant', content: summaryRes.content });
          lastResponse = { ...lastResponse!, content: (lastResponse?.content || '') + '\n\n' + summaryRes.content };
          this.emit('log:appended', { role: 'assistant', content: summaryRes.content });
        }
      } catch (e: any) {
        console.warn('[summary] task summary failed:', e?.message);
      }
    }

    // ═══ 上下文修剪: 同步执行, 确保实际生效 ═══
    // 1. 同步修剪旧工具输出 (廉价, 不调 LLM)
    if (this.iteration >= 3 && this.context.appendOnlyLog.length > 20) {
      try {
        const { pruneOldToolResults } = await import('./context-manager.js');
        const { pruned, savedTokens } = pruneOldToolResults(this.context.appendOnlyLog, 10);
        if (pruned > 0) {
          console.log(`[context] pruned ${pruned} old tool results, saved ~${savedTokens} tokens`);
        }
      } catch (e: any) {
        console.warn('[context] prune failed:', e?.message);
      }
    }

    // 2. appendOnlyLog 上限: 超过60条时截断, 保留 system + 最近消息
    const MAX_LOG_SIZE = 60;
    if (this.context.appendOnlyLog.length > MAX_LOG_SIZE) {
      const systemMsgs = this.context.appendOnlyLog.filter(m => m.role === 'system');
      const recentMsgs = this.context.appendOnlyLog.slice(-MAX_LOG_SIZE);
      this.context.appendOnlyLog = [...systemMsgs, ...recentMsgs];
      console.log(`[context] log trimmed to ${this.context.appendOnlyLog.length} entries`);
    }

    if (!lastResponse) {
      return { content: '任务已处理，但未能生成最终回复。请重新描述需求。', provider: 'agentai', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0, cacheHit: false, source: 'estimated' as const }, iterations: this.iteration, durationMs: Date.now() - startedAt };
    }

    // 自动计划: 标记所有阶段完成
    try {
      const { _active_plan } = await import('./tools.js');
      if (_active_plan) {
        for (const t of _active_plan.subtasks) {
          t.status = 'completed';
        }
      }
    } catch { /* plan completion optional */ }

    this.emit('loop:done', { iterations: this.iteration, response: lastResponse });

    // ============== 反思门 (Reflector) 闭环 ==============
    // 异步触发, 不阻塞返回
    const lastUserMsg = [...this.context.appendOnlyLog].reverse().find(m => m.role === 'user');
    const lastUserText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';
    if (this.opts.reflectEvery && this.opts.reflectEvery > 0) {
      this.runReflector(lastResponse, lastUserText).catch((e) => {
        console.warn('[reflector] failed:', (e as Error).message);
      });
    }

    // ============== 行业洞察自动提取 (授人以渔: 让AI自主积累行业知识) ==============
    try {
      const { insightAccumulator } = await import('./insight-accumulator.js');
      const assistantText = typeof lastResponse.content === 'string' ? lastResponse.content : '';
      const insight = insightAccumulator.extractInsight(lastUserText, assistantText);
      if (insight) {
        console.log(`[insight] extracted: [${insight.category}] ${insight.content.slice(0, 60)}... (industry: ${insight.industryName})`);
        this.emit('insight:extracted', insight);
      }
    } catch (e: any) { /* insight extraction optional */ }
    return {
      ...lastResponse,
      iterations: this.iteration,
      content: modelRecommendation
        ? modelRecommendation + (lastResponse.content || '')
        : lastResponse.content,
    };
  }

  /**
   * 收集本轮所有 tool calls + 调 Reflector 反思
   */
  private async runReflector(lastResponse: any, userText: string): Promise<void> {
    // 收集本轮 tool calls (从 appendOnlyLog 中提取)
    const toolCalls: Array<{ name: string; args: any; result: any; success: boolean; durationMs: number }> = [];
    for (const msg of this.context.appendOnlyLog) {
      if (msg.role === 'tool' && msg.name && (msg as any).tool_call_id) {
        const tc = lastResponse.toolCalls?.find((c: any) => c.id === (msg as any).tool_call_id);
        toolCalls.push({
          name: msg.name,
          args: tc?.args,
          result: typeof msg.content === 'string' ? msg.content.slice(0, 200) : '',
          success: true, // 已写入 log 视为成功
          durationMs: 0,
        });
      }
    }

    try {
      const { reflect } = await import('./reflector.js');
      await reflect(this.router, {
        userMessage: userText,
        finalResponse: lastResponse.content || '',
        toolCalls,
        iterations: this.iteration,
        success: !!lastResponse.content,
      }, {
        reflectEvery: this.opts.reflectEvery,
        userId: this.opts.userId,
        workspace: this.opts.workspace,
      });
    } catch (e) {
      console.warn('[reflector] import/exec failed:', (e as Error).message);
    }
  }

  /**
   * 分发 tool calls (学自 tool-registry.dispatch, 加 abort 支持)
   */
  private async dispatchToolCalls(
    calls: Array<{ id: string; name: string; args: Record<string, any> }>,
  ): Promise<Array<{ id: string; name: string; output: string; data?: any }>> {
    const ctx: any = {
      userId: this.opts.userId,
      workspace: this.opts.workspace,
      abortSignal: this.opts.abortSignal,
      priorMessages: this.context.appendOnlyLog,
      _router: this.router,
      _registry: this.registry,
    };

    // SelfModify 审批: multi_edit / write_file / delete_file → emit approval_required → 等待用户决定
    // 接入 SelfModifier: 对 gateway 自身代码修改做安全扫描 + 编译验证
    // 🎯 智能决策优化: 扩展白名单，减少不必要的审批
    const approvedCalls: string[] = [];
    const rejectedResults: Array<{ id: string; name: string; output: string; data: null }> = [];
    for (const tc of calls) {
      // 🚀 扩展白名单: 以下工具自动通过审批（安全操作）
      const autoApproveTools = [
        'list_directory', 'read_file', 'search_codebase', 'grep', 'glob',
        'web_fetch', 'web_search', 'run_code', 'npm_install', 'pip_install',
        'ask_user', 'discover_model_api', 'save_api_key',
      ];

      if (autoApproveTools.includes(tc.name)) {
        approvedCalls.push(tc.id);
        continue; // 自动通过，跳过审批
      }

      if (['multi_edit', 'write_file', 'delete_file'].includes(tc.name)) {
        const filePath = tc.args.file_path || tc.args.edits?.[0]?.file_path || 'unknown';

        // 白名单检查: 用户已信任的命令模式自动跳过审批
        if (isTrustedCommand(tc.name, filePath)) {
          approvedCalls.push(tc.id);
          continue;
        }

        // 🎯 智能决策: 检查是否是安全的修改操作
        // 以下情况自动通过审批：
        // 1. 修改非核心文件（如测试文件、配置文件）
        // 2. 创建新文件（非删除操作）
        // 3. 修改用户工作空间文件（非gateway自身）
        const isSafeModification = this._isSafeFileModification(tc.name, filePath);
        if (isSafeModification) {
          approvedCalls.push(tc.id);
          console.log(`[智能决策] 自动批准安全操作: ${tc.name} ${filePath}`);
          continue;
        }

        // SelfModifier 安全扫描: 检查是否修改 gateway 自身代码
        let selfModifyCheck: { allowed: boolean; reason?: string } = { allowed: true };
        if (filePath.includes('agentai-gateway/src')) {
          try {
            const { getSelfModifier } = await import('./workers/self-modify.js');
            const modifier = getSelfModifier();
            const newCode = tc.name === 'write_file' ? tc.args.content : '';
            if (newCode) {
              const proposal = await modifier.generateProposal(
                { targetFile: filePath, reason: 'AI self-modification', desiredOutcome: 'Improve gateway behavior' },
                '', // originalCode not available here
                newCode,
              );
              if (proposal.status === 'rejected') {
                const violations = proposal.securityScan.violations?.join('; ') || 'Security check failed';
                selfModifyCheck = { allowed: false, reason: `SelfModify 安全扫描拒绝: ${violations}` };
                this.emit('self-modify:rejected', { file: filePath, violations });
              } else {
                this.emit('self-modify:pending', { file: filePath, proposalId: proposal.id });
              }
            }
          } catch (e: any) { console.warn('[SelfModify] proposal failed:', e?.message); }
        }
        if (!selfModifyCheck.allowed) {
          rejectedResults.push({
            id: tc.id,
            name: tc.name,
            output: `[ERROR] ${selfModifyCheck.reason}`,
            data: null,
          });
          this.emit('tool:result', { callId: tc.id, name: tc.name, result: `[ERROR] ${selfModifyCheck.reason}`, ok: false, durationMs: 0 });
          continue;
        }

        const approvalId = `approval-${Date.now()}-${tc.id}`;
        this.emit('approval:required', {
          id: approvalId,
          type: tc.name === 'delete_file' ? 'delete' : 'modify',
          filePath,
          summary: `AI 请求执行 ${tc.name}: ${filePath}`,
          riskLevel: tc.name === 'delete_file' ? 'high' : 'medium',
          toolName: tc.name,
        });
        // 等待用户审批（超时 60s 自动拒绝）
        const granted = await this.waitForApproval(approvalId);
        if (!granted) {
          rejectedResults.push({
            id: tc.id,
            name: tc.name,
            output: `[ERROR] 用户拒绝了此操作 (${tc.name}: ${filePath})`,
            data: null,
          });
          this.emit('tool:result', { callId: tc.id, name: tc.name, result: `[ERROR] 用户拒绝了此操作`, ok: false, durationMs: 0 });
        } else {
          approvedCalls.push(tc.id);
        }
      } else {
        approvedCalls.push(tc.id);
      }
    }
    // 只 dispatch 未被拒绝的 calls
    const callsToDispatch = calls.filter(c => approvedCalls.includes(c.id));
    // 发射 tool:start 事件 (仅被批准的)
    for (const c of callsToDispatch) this.emit('tool:start', { callId: c.id, name: c.name, args: c.args });
    const results = callsToDispatch.length > 0 ? await this.registry.dispatch(callsToDispatch, ctx) : [];
    // 发射 tool:result 事件 (仅被批准的)
    for (const c of callsToDispatch) {
      const r = results.find(x => x.id === c.id);
      this.emit('tool:result', { callId: c.id, name: c.name, result: r?.result?.output || '', ok: r?.result?.success !== false, durationMs: r?.result?.durationMs || 0 });
    }
    // 合并结果: 批准的 + 被拒绝的
    const approvedResults = callsToDispatch.map(c => {
      const r = results.find(x => x.id === c.id);
      return {
        id: c.id,
        name: c.name,
        output: r ? this.formatToolResult(r.result) : '[no result]',
        data: r?.result?.data || null,
      };
    });
    return [...approvedResults, ...rejectedResults];
  }

  private formatToolResult(r: ToolResult): string {
    if (r.success) {
      return typeof r.output === 'string' ? r.output : JSON.stringify(r.output);
    }
    return `[ERROR] ${r.error || 'unknown error'}\n${r.output}`;
  }

  /**
   * 🎯 智能决策: 检查是否是安全的文件修改操作
   * 
   * 安全修改的判断标准：
   * 1. 修改非核心文件（测试文件、配置文件、文档文件）
   * 2. 创建新文件（非删除操作）
   * 3. 修改用户工作空间文件（非gateway自身）
   * 4. 修改临时文件或缓存文件
   */
  private _isSafeFileModification(toolName: string, filePath: string): boolean {
    // 1. 删除操作：更严格检查
    if (toolName === 'delete_file') {
      // 只允许删除临时文件、缓存文件、测试文件
      const safeDeletePatterns = [
        /\/tmp\//, /\/temp\//, /\/cache\//, /\/\.cache\//,
        /\/test\//, /\/tests\//, /\/__tests__\//,
        /\.test\./, /\.spec\./, /\.tmp$/, /\.bak$/,
      ];
      return safeDeletePatterns.some(p => p.test(filePath));
    }

    // 2. 创建新文件：自动通过（非删除）
    if (toolName === 'write_file') {
      // 检查文件是否存在（如果不存在，是创建新文件，安全）
      try {
        const fs = require('fs');
        if (!fs.existsSync(filePath)) {
          console.log(`[智能决策] 创建新文件，自动批准: ${filePath}`);
          return true;
        }
      } catch (e) {
        // 文件检查失败，保守处理
        return false;
      }
    }

    // 3. 修改非核心文件：自动通过
    const safeModifyPatterns = [
      // 测试文件
      /\/test\//, /\/tests\//, /\/__tests__\//, /\.test\./, /\.spec\./,
      // 配置文件
      /\.json$/, /\.yaml$/, /\.yml$/, /\.toml$/, /\.ini$/, /\.env\.example$/,
      // 文档文件
      /\.md$/, /\.txt$/, /\.rst$/, /\.adoc$/,
      // 临时文件
      /\/tmp\//, /\/temp\//, /\.tmp$/, /\.log$/,
      // 用户工作空间文件（非gateway自身）
      /^f:\\agentai-platform\\packages\\agentai-gui\//,
      /^f:\\agentai-platform\\packages\\agentai-desktop\//,
      /^f:\\agentai-platform\\packages\\agentai-qqbot\//,
      /^f:\\agentai-platform\\packages\\agentai-skills\//,
    ];

    // 检查是否匹配安全模式
    if (safeModifyPatterns.some(p => p.test(filePath))) {
      console.log(`[智能决策] 修改非核心文件，自动批准: ${filePath}`);
      return true;
    }

    // 4. 检查是否修改gateway自身代码（需要严格审批）
    if (filePath.includes('agentai-gateway/src')) {
      console.log(`[智能决策] 修改gateway核心代码，需要审批: ${filePath}`);
      return false;
    }

    // 5. 默认：保守处理，需要审批
    return false;
  }

  /**
   * 目标驱动执行: Goal 模式 (学习 ZCode 3.0)
   * ----------------------------------------------------
   * 与 run() 的区别:
   *   - run(): 单轮对话, LLM 自行判断结束 (while true + 启发式终止)
   *   - runWithGoal(): 多阶段迭代, 每阶段验证验收标准, 不通过自动修正
   *
   * 流程:
   *   1. LLM 拆解目标 → 3-5 个阶段
   *   2. 逐阶段执行 → 每个阶段独立的 AgentAILoop
   *   3. 验证门 → 不通过最多重试 2 次
   *   4. 子智能体委派 → 可并行的阶段交给 subagent
   *   5. 生成最终报告
   *
   * @param goal 用户目标描述
   * @returns GoalResult { success, content, stages, durationMs }
   */
  async runWithGoal(goal: string): Promise<GoalResult> {
    const { runWithGoal } = await import('./goal-runner.js');
    return runWithGoal(goal, this, this.router, this.registry, this.opts);
  }

  /**
   * 反思门 (学 WorkBuddy auto_reflect + Reasonix telemetry)
   * 自创: 把反思写进三层记忆 + 智能可视化触发
   * 规则: 只在用户任务需要可视化时才触发, 不是每次结构化数据都画图
   */
  private async reflect(): Promise<void> {
    this.emit('reflect:start', { sessionId: this.context.sessionId });

    // 简化: 统计最近 N 轮的失败/成本
    const recent = this.context.appendOnlyLog.slice(-this.opts.reflectEvery);
    const userTurns = recent.filter(m => m.role === 'user').length;
    const toolErrors = recent.filter(m => {
      if (m.role !== 'tool') return false;
      const c = m.content;
      return typeof c === 'string' && c.startsWith('[ERROR]');
    }).length;

    const summary = `[reflect ${new Date().toISOString()}] session=${this.context.sessionId} turns=${userTurns} tool_errors=${toolErrors}`;

    // === 智能可视化: 只在用户任务需要时才触发, 不做无意义的画图 ===
    const userMessages = recent.filter(m => m.role === 'user');
    const lastUserMsg = userMessages[userMessages.length - 1]?.content || '';
    const isTextUserMsg = typeof lastUserMsg === 'string' ? lastUserMsg : '';

    // 判断用户任务是否"适合"可视化 — 严格收紧条件, 只在明确需要画图时才触发
    const needsVisualization = (() => {
      // 明确请求画图/流程图/图表 → 绝对需要
      if (/请.*画|画.*图|生成.*图表|流程图|架构图|思维导图|时间线图|可视化/i.test(isTextUserMsg)) return true;

      // 明确要求"展示"架构/流程/关系 → 可能需要
      if (/(画|生成|展示|绘制|创建).*(架构|流程|关系|依赖|拓补)/i.test(isTextUserMsg)) return true;

      // 其他情况默认不需要, 避免误触发干扰 AI 正常执行
      return false;
    })();

    if (needsVisualization) {
      // 检查最近的工具调用是否产生了足够的素材来画图
      const recentlyExecutedTools = recent.filter(m => m.role === 'tool' && m.name);
      const hasEnoughContext = recentlyExecutedTools.length >= 3;

      if (hasEnoughContext) {
        const diagHint = `
[可视化建议] 用户明确要求/适合可视化, 且已收集了 ${recentlyExecutedTools.length} 个工具的执行结果。
考虑调用 generate_diagram 生成对应图表:
- 系统审查/代码架构分析 → 架构图 (architecture)
- 流程/步骤说明 → 流程图 (flowchart)
- 方案对比/排行榜 → 对比图 (comparison)
- 数据分析/统计 → 关系图/思维导图 (mindmap)

**原则: 只在用户任务真正需要时才画图, 不要为了画图而画图。**`;
        this.context.appendOnlyLog.push({ role: 'system', content: diagHint });
        console.log(`[reflect] 💡 可视化建议触发: 用户需求明确, 已提供 ${recentlyExecutedTools.length} 个工具结果`);
      } else {
        console.log(`[reflect] ℹ️  可视化建议: 用户需求明确, 但工具结果还不够 (${recentlyExecutedTools.length}/3)`);
      }
    } else {
      // 简单任务, 不需要画图 — 静默跳过
      // console.log(`[reflect] ℹ️  无可视化需求: 用户任务不需要图`);
    }

    this.emit('reflect:done', { summary, userTurns, toolErrors, needsVisualisation: needsVisualization });

    // 写 volatile scratch (不发 LLM)
    this.context.volatileScratch += summary + '\n';
  }

  getContext(): Readonly<AgentContext> {
    return this.context;
  }
}
