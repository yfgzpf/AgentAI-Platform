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
import { hookCapture } from './hook-capture.js';
import { AGENT_SYSTEM_IDENTITY } from './system-prompt.js';
import { buildLiteSystemPrompt, detectTaskType, extractKeywords } from './system-prompt-lite.js';
import { getRelevantTools, buildToolsFragment } from './tool-groups.js';
import { userModel } from './user-model.js';
import { recallEvolution, extractPatterns } from './evolution.js';
import { trackTempFile, cleanupTempFiles, isTempFile } from './temp-file-tracker.js';
import { compressAllToolResults, CompressStats } from './token-compressor.js';
import { recommendModel, getProModelKeyInfo, MODELS } from './model-classifier.js';
import { WorkflowOrchestrator, BUILTIN_WORKFLOWS } from './workflow-orchestrator.js';
import { getIntentClarifier, Clarification, ResolvedIntent } from './meta/intent-clarifier.js';
import { ProactiveSuggestionEngine } from './proactive-suggestion-engine.js';
import { getOrCreateSnapshot, formatResumeContext, findResumableTasks, type TaskSnapshotManager } from './task-snapshot.js';
import { buildIdeContext } from './ide-state.js';
import { buildMemoryContext, initProjectMemory, readProjectMemory } from './project-memory.js';
import { MemoryManager } from './memory-manager.js';
import { recordCall } from './usage-stats.js';
import { getTaskSupervisor } from './task-supervisor.js';
import { loopLogger as logger, isLogEnabled } from './logger.js';
import { recordToolCall, finalizeSessionAnalytics } from './tool-call-analytics.js';
import { getFourDiagnosesSystem } from './qihuang/four-diagnoses.js';
import { buildRemoteContext, isRemoteSessionActive, getActiveRemoteSession, detectRemoteIntent } from './remote/ai-integration.js';

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
  /** 预编译的正则 (loadTrustedPatterns 时一次性生成, 避免每次调用 new RegExp) */
  compiledRegex?: RegExp;
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
    // ReDoS 防护: 拒绝过长或连续通配符的模式
    if (p.pathPattern.length > 200) return false;
    if (/\*{4,}/.test(p.pathPattern)) return false;
    // ✅ 使用预编译的正则, 不再每次 new RegExp
    const re = p.compiledRegex;
    return re ? re.test(filePath) : false;
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

/**
 * P0-1.3: 合并连续的 [SYSTEM] 注入消息
 * 多个模块可能在一轮中各推一条 [SYSTEM] 指令, 弱模型容易迷失
 * 此函数将连续的 [SYSTEM] 消息合并为一条, 保留最关键信息
 */
function consolidateSystemInjections(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length <= 1) return messages;
  const result: ChatMessage[] = [];
  let pendingSystem: string[] = [];

  const flushPending = () => {
    if (pendingSystem.length === 0) return;
    if (pendingSystem.length === 1) {
      result.push({ role: 'user', content: pendingSystem[0]! });
    } else {
      // 多条合并: 保留含 [CRITICAL]/[P0] 标记的安全指令, 其余只保留最后一条
      const critical = pendingSystem.filter(s => /\[CRITICAL\]|\[P0\]/i.test(s));
      const latest = pendingSystem[pendingSystem.length - 1]!;
      if (critical.length > 0 && !critical.includes(latest)) {
        // 有 critical 指令且最后一条不是 critical → 合并 critical + 最新
        const merged = critical.join('\n---\n') + '\n---\n' + latest;
        // 截断保护: 合并后不超过 3000 字符
        result.push({ role: 'user', content: merged.slice(0, 3000) });
      } else if (critical.length > 0) {
        // 最后一条就是 critical → 合并所有 critical
        result.push({ role: 'user', content: critical.join('\n---\n').slice(0, 3000) });
      } else {
        // 无 critical → 只保留最后一条
        result.push({ role: 'user', content: latest });
      }
    }
    pendingSystem = [];
  };

  for (const msg of messages) {
    const content = typeof msg.content === 'string' ? msg.content : '';
    const isSystemInjection = msg.role === 'user' && content.startsWith('[SYSTEM]');

    if (isSystemInjection) {
      pendingSystem.push(content);
    } else {
      flushPending();
      result.push(msg);
    }
  }
  flushPending();

  return result;
}

/**
 * ═══ 系统指令管理器 v2 (智能延迟注入) ═══
 * 解决: 多个模块同时注入 [SYSTEM] 指令 → 弱模型迷失
 * 策略:
 *   1. 即时队列 (pending): 错误反应类指令, 每轮取优先级最高的 1 条注入
 *   2. 延迟队列 (deferred): 质量管控类指令, 执行中缓冲, 任务完成后处理
 * 优先级: critical(安全/错误) > high(任务推进) > medium(风格建议) > low(杂项)
 */
interface PendingDirective {
  source: string;
  content: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
}

class SystemDirectiveManager {
  private pending: PendingDirective[] = [];
  private deferred: PendingDirective[] = [];

  /** 可延迟的指令来源 — 质量管控类, 不阻塞任务执行 */
  private static DEFERRABLE_SOURCES = new Set([
    'meta_ask', 'meta_pua',           // 元认知决策
    'boundary_check', 'boundary_p0',  // 知识边界/认知自检
    'low_conf_search',                // 低置信度搜索 (不阻塞, 可后续补)
    'op_awareness',                    // 操作感知
    // 'ambiguity' 移除 — 歧义检测必须在首轮立即注入, 否则 AI 不会追问用户
    // 'low_conf_clarify' 移除 — 低置信度追问必须即时注入, 否则 AI 不会调用 ask_user
  ]);

  /** 添加一条指令 */
  add(source: string, content: string, priority: PendingDirective['priority']): void {
    // 可延迟来源 → 进入延迟缓冲, 不在执行中注入
    if (SystemDirectiveManager.DEFERRABLE_SOURCES.has(source)) {
      // 同来源去重: 只保留最后一条
      this.deferred = this.deferred.filter(d => d.source !== source);
      this.deferred.push({ source, content, priority });
      return;
    }
    // 即时指令: critical 始终加入; 其他如果已有 critical 则跳过
    if (this.pending.some(d => d.priority === 'critical') && priority !== 'critical') return;
    this.pending.push({ source, content, priority });
  }

  /** 刷新即时队列: 取优先级最高的 1 条, 返回消息内容 (或 null) */
  flush(): string | null {
    if (this.pending.length === 0) return null;
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    this.pending.sort((a, b) => order[a.priority] - order[b.priority]);
    const top = this.pending[0]!;
    this.pending = [];
    return top.content;
  }

  /** v3.2 修复: 按 source 读取最新一条指令 (含延迟队列) */
  get(source: string): string | null {
    const inPending = this.pending.find(d => d.source === source);
    if (inPending) return inPending.content;
    const inDeferred = this.deferred.find(d => d.source === source);
    return inDeferred?.content || null;
  }

  /** 刷新延迟队列: 返回所有缓冲指令 (任务完成后调用) */
  flushDeferred(): PendingDirective[] {
    const result = [...this.deferred];
    this.deferred = [];
    return result;
  }

  /** 延迟队列中是否有高优先级指令 (需要补一轮) */
  hasCriticalDeferred(): boolean {
    return this.deferred.some(d => d.priority === 'high');
  }

  /** 检查是否有待处理即时指令 */
  hasPending(): boolean {
    return this.pending.length > 0;
  }

  /** 清空即时队列 (每轮循环开始时调用) */
  clear(): void {
    this.pending = [];
  }

  /** 清空所有队列 */
  clearAll(): void {
    this.pending = [];
    this.deferred = [];
  }
}

/**
 * 消毒消息数组: 确保每个 role='tool' 消息前面都有对应的 assistant(tool_calls) 消息
 * OpenAI 协议要求: tool 消息必须跟在 assistant 的 tool_calls 后面, 否则 400 错误
 * 此函数在发送给 LLM 前清理, 防止上下文压缩或 pre-read 注入导致的协议违规
 */
function sanitizeToolMessages(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  /** 已知的 tool_call_id 集合 (来自前面 assistant 消息的 tool_calls) */
  const knownToolCallIds = new Set<string>();

  for (const msg of messages) {
    const anyMsg = msg as any;
    if (msg.role === 'assistant' && anyMsg.tool_calls) {
      // 记录 assistant 声明的 tool_call_id
      for (const tc of anyMsg.tool_calls) {
        if (tc.id) knownToolCallIds.add(tc.id);
      }
      result.push(msg);
    } else if (msg.role === 'tool') {
      // 检查这个 tool 消息是否有对应的 assistant tool_calls
      if (msg.tool_call_id && knownToolCallIds.has(msg.tool_call_id)) {
        result.push(msg); // 合法, 保留
      } else {
        // 孤立的 tool 消息 → 降级为 system 消息, 避免协议违规
        const toolName = msg.name || 'unknown';
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
        result.push({
          role: 'system',
          content: `[tool-result:${toolName}] ${content}`,
        });
      }
    } else {
      result.push(msg);
    }
  }

  return result;
}

/** 移除信任模式 */
export function removeTrustedPattern(toolName: string, pathPattern: string): void {
  const patterns = loadTrustedPatterns().filter(p => !(p.toolName === toolName && p.pathPattern === pathPattern));
  saveTrustedPatterns(patterns);
}
import { maskCredentials } from './credential-extractor.js';
import { GoalResult } from './goal-runner.js';
import { revertBridge } from './revert-bridge.js';

// ========== DEAD CODE: _globalCache/DeepSeekCacheStrategy 永久跳过 ==========
// 项目无 deepseek-cache-strategy 模块，registry 非 deepseek 配置，永远返回 null

export interface LoopOptions {
  maxIterations: number;
  userId: string;
  workspace: string;
  sessionId?: string;
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
  /** 用户当前在编辑器中打开的文件 (用于指代消解) */
  activeFile?: string;
  /** 长任务快照 ID (跨会话恢复任务时由前端传入) */
  taskId?: string;
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
private _startupGitInjected = false;
private _startupSessionInjected = false;
private _hardStopNext = false;  // v3.1 死循环硬停标志: 下一轮 LLM 响应后立即退出
private _hardStopCount = 0;     // v3.1 硬停次数: 超过 2 次直接 force break (防 AI 忽视指令)

  /** ═══ 代际计数器: 解决中断后竞态条件 ═══
   * 每次 run() 分配唯一 generation ID, abort() 记录被中断的 generation。
   * 循环内检查: 如果当前 generation ≠ 被中断的 generation → 说明已被新 run() 取代 → 立即退出。
   * 这解决了: abort() 设 _aborted=true → 新 run() 重置 → 旧 run() 恢复后看到 false 继续跑 的竞态问题。
   */
  private _runGeneration = 0;
  private _abortedGeneration = 0;

/** 情绪历史追踪 (跨 run 调用, 感知情绪趋势) */
private _emotionHistory: Array<{ emotion: string; intensity: number; ts: number }> = [];

  /** 元认知循环实例 (复用, 不每轮重建) */
  private metaLoop: any = null;

  /** Hook会话ID追踪 */
  private hookSessionId: string | null = null;

  /** 系统指令管理器: 每轮只保留优先级最高的 1 条 [SYSTEM] 指令 */
  private directives = new SystemDirectiveManager();

  /** 当前任务类型和行业 (由 buildImmutablePrefix 检测, 主循环中使用) */
  private _taskType: 'coding' | 'research' | 'general' | 'industry' = 'general';
  private _userIndustry: string = 'general';
  
  /** 强制调用的技能 (由 skillAutoInvoker 设置) */
  private _forceSkill: string | null = null;

  /** 模型能力分层: autonomous(自主) / guided(引导) / supervised(监督) */
  private _capabilityTier: 'autonomous' | 'guided' | 'supervised' = 'supervised';

  /** 6维能力评分详情 (reasoning/context/speed/vision/toolCall/costScore/overall) */
  private _capabilities: import('./model-classifier.js').ModelCapability | null = null;

  /** 待审批队列: approvalId → { resolve, reject, timer } */
  private pendingApprovals = new Map<string, { resolve: (granted: boolean) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }>();

  /** 意图澄清队列: clarificationId → { resolve, reject, timer } */
  private pendingClarifications = new Map<string, { resolve: (answers: Record<string, string>) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }>();

  /** 最后提及的文件 (用于解析"这个文件"等指代) */
  private _lastMentionedFile: string | null = null;

  /** onDelta 节流器: 50ms 内合并多次 delta, 避免海量事件堆积 */
  private _deltaBuf = '';
  private _deltaTimer: NodeJS.Timeout | null = null;
  private static readonly DELTA_THROTTLE_MS = 50;

  /** 并发子 Agent 计数器: 最多 2 个并行, 超出排队拒绝 */
  private _subAgentCount = 0;
  private static readonly MAX_SUBAGENTS = 2;

  /** formatToolResult 文件 stat 缓存: path → { size, mtimeMs, lines }  TTL=5min, 最多 200 条 */
  private _fileMetaCache = new Map<string, { size: number; lines: number; ts: number }>();
  private static readonly FILE_META_TTL_MS = 5 * 60 * 1000;
  private static readonly FILE_META_MAX = 200;


  /** 智能模型切换: 连续触发熔断时自动换商用 API */
  private trippedCount = 0;
  private _smartSwitcher: any = null;
  private _lastSwitchTime = 0; // 上次自动切换时间戳 (ms), 防死循环
  private _switchedProviders = new Set<string>(); // 本轮已尝试过的 provider, 防重复切换

  /** 工作流编排器: 模块化技能拼装 (SenseNova 风格) */
  private workflowOrchestrator: WorkflowOrchestrator | null = null;

  private async _getWorkflowOrchestrator(): Promise<WorkflowOrchestrator> {
    if (!this.workflowOrchestrator) {
      this.workflowOrchestrator = new WorkflowOrchestrator(async (skillName, params) => {
        // 委托给 registry.executeOne 或 skillOrchestrator.executeSkill
        try {
          const { skillOrchestrator } = await import('./skill-orchestrator.js');
          return await skillOrchestrator.executeSkill(skillName, params);
        } catch {
          return { success: false, output: `工作流执行失败: 技能 "${skillName}" 不可用` };
        }
      });
      // 注册内置工作流
      this.workflowOrchestrator.registerAll(BUILTIN_WORKFLOWS);
    }
    return this.workflowOrchestrator;
  }

  private async _getSmartSwitcher() {
    if (!this._smartSwitcher) {
      const { SmartModelSwitcher } = await import('./smart-model-switcher.js');
      this._smartSwitcher = new SmartModelSwitcher();
    }
    return this._smartSwitcher;
  }

  /**
   * 读取项目说明文件 (PROJECT_README.md, PROJECT_CONTEXT.md, PROJECT_STATE.md)
   * 返回合并后的内容，用于注入 AI 上下文
   */
  private readProjectDocs(): string | null {
    const workspace = this.opts.workspace || process.cwd();
    const agentaiDir = path.join(workspace, '.agentai');
    const docs: string[] = [];

    const docFiles = [
      { name: 'PROJECT_README.md', label: '项目架构' },
      { name: 'PROJECT_CONTEXT.md', label: '任务上下文' },
      { name: 'PROJECT_STATE.md', label: '实时状态' },
    ];

    for (const { name, label } of docFiles) {
      const filePath = path.join(agentaiDir, name);
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          docs.push(`\n=== ${label}: ${name} ===\n${content}`);
        } catch (e) {
          logger.warn(`读取 ${name} 失败:`, e);
        }
      }
    }

    if (docs.length === 0) return null;

    return `# 项目说明文档 (AI 自动维护)\n${docs.join('\n')}\n\n提示: 使用 auto_project_doc 工具更新这些文档。`;
  }

  /** 中断当前运行的任务 */
  abort() {
    this._aborted = true;
    // 记录被中断的代际 — 旧 run() 恢复后检查发现自己被取代 → 退出
    this._abortedGeneration = this._runGeneration;
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
        logger.warn(`approval ${id} 超时, 自动拒绝`);
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
      logger.warn(`resolveApproval: 未找到 ${id}`);
      return false;
    }
    clearTimeout(entry.timer);
    this.pendingApprovals.delete(id);
    entry.resolve(granted);
    return true;
  }

  /**
   * 等待用户澄清（超时自动返回空答案）
   * @returns 用户澄清答案
   */
  waitForClarification(id: string, questions: any[], timeoutMs = 60_000): Promise<Record<string, string>> {
    return new Promise<Record<string, string>>((resolve, reject) => {
      let settled = false;
      const settle = (val: Record<string, string>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (abortHandler) {
          this.opts?.abortSignal?.removeEventListener('abort', abortHandler);
        }
        this.pendingClarifications.delete(id);
        resolve(val);
      };
      const timer = setTimeout(() => {
        logger.warn(`clarification ${id} 超时, 继续执行`);
        settle({}); // 超时返回空答案，继续执行
      }, timeoutMs);
      // 安全: 监听 abort 信号，会话被压制时立即结束等待
      let abortHandler: (() => void) | null = null;
      if (this.opts?.abortSignal) {
        abortHandler = () => {
          logger.warn(`clarification ${id} aborted`);
          settle({});
        };
        if (this.opts.abortSignal.aborted) {
          settle({});
          return;
        }
        this.opts.abortSignal.addEventListener('abort', abortHandler, { once: true });
      }
      this.pendingClarifications.set(id, { resolve: settle, reject, timer });
    });
  }

  /**
   * 解决澄清请求 (由路由端点调用)
   * @param id 澄清ID
   * @param answers 用户答案
   */
  resolveClarification(id: string, answers: Record<string, string>): boolean {
    const entry = this.pendingClarifications.get(id);
    if (!entry) {
      logger.warn(`resolveClarification: 未找到 ${id}`);
      return false;
    }
    clearTimeout(entry.timer);
    this.pendingClarifications.delete(id);
    entry.resolve(answers);
    return true;
  }

  constructor(
    router: AgentAIRouter,
    registry: ToolRegistry,
    initialMessages: ChatMessage[],
    opts: LoopOptions,
  ) {
    super();
    // 防止 MaxListenersExceededWarning (每个 loop 实例注册 ~15 个事件监听器)
    this.setMaxListeners(50);
    this.router = router;
    this.registry = registry;
    this.initialMessages = initialMessages;
    this.opts = {
      maxIterations: opts.maxIterations ?? 90,
      userId: opts.userId,
      workspace: opts.workspace,
      sessionId: opts.sessionId ?? '',  // v3.2 修复: Required<LoopOptions> 缺少此字段
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
      activeFile: opts.activeFile ?? '',
      taskId: opts.taskId ?? '',  // 长任务快照 ID (跨会话恢复)
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

  /**
   * 创建节流版 onDelta 回调: 50ms 内累积 delta, 合并后一次 emit
   * 避免 LLM 流式返回数千 token 时产生海量事件
   */
  private _createThrottledOnDelta(): (delta: string) => void {
    return (delta: string) => {
      this._deltaBuf += delta;
      if (!this._deltaTimer) {
        this._deltaTimer = setTimeout(() => {
          const buf = this._deltaBuf;
          this._deltaBuf = '';
          this._deltaTimer = null;
          if (buf) this.emit('llm:delta', { delta: buf });
        }, AgentAILoop.DELTA_THROTTLE_MS);
      }
    };
  }

  /** 清理节流定时器 (loop 结束时调用) */
  private _flushDeltaBuffer() {
    if (this._deltaTimer) {
      clearTimeout(this._deltaTimer);
      this._deltaTimer = null;
    }
    if (this._deltaBuf) {
      this.emit('llm:delta', { delta: this._deltaBuf });
      this._deltaBuf = '';
    }
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
   * 
   * 2026-06-24 升级：精简上下文 + 工具按需加载 + 进化记忆智能召回
   */
  private async buildImmutablePrefix(messages: ChatMessage[]): Promise<ChatMessage[]> {
    const systemMsgs: ChatMessage[] = [];

    // === 0. 检测任务类型和行业（用于精简上下文和工具按需加载） ===
    const userMessage = messages.filter(m => m.role === 'user').pop()?.content || '';
    const taskType = detectTaskType(typeof userMessage === 'string' ? userMessage : '');
    const userIndustry = userModel.get(this.opts.userId).identity.industry || 'general';
    // 存储到实例变量, 主循环中使用 (工具按需过滤)
    this._taskType = taskType;
    this._userIndustry = userIndustry;
    const userRole = userModel.get(this.opts.userId).identity.role || '助手';
    const userName = userModel.get(this.opts.userId).identity.name || this.opts.userId || '用户';
    const keywords = extractKeywords(typeof userMessage === 'string' ? userMessage : '');

    // === 0.5 技能自动检测和强制调用（使用新的SkillManager）
    let skillInvocationBlock = '';
    let forcedSkillMatch: any = null;
    try {
      const { skillManager } = await import('./skill-manager.js');
      const skillMatch = skillManager.matchIntent(typeof userMessage === 'string' ? userMessage : '');
      
      if (skillMatch && skillMatch.confidence >= 0.6) {
        skillInvocationBlock = skillManager.generateInvocationPrompt(skillMatch);
        logger.info(`🎯 检测到技能匹配: ${skillMatch.skill.name} (置信度: ${(skillMatch.confidence * 100).toFixed(0)}%)`);
        
        // 高置信度时强制调用（>=0.8）
        if (skillMatch.confidence >= 0.8) {
          this._forceSkill = skillMatch.skill.name;
          forcedSkillMatch = skillMatch;
          logger.info(`🔒 强制技能调用: ${skillMatch.skill.name}`);
        }
      }
      
      // 注入可用技能列表
      const stats = skillManager.getStats();
      if (stats.total > 0) {
        const skillList = skillManager.list().slice(0, 10).map(s => `- ${s.name}: ${s.description}`).join('\n');
        skillInvocationBlock += `\n\n【可用技能】\n${skillList}\n\n**重要**: 当用户需求匹配技能时，立即调用该技能完成！`;
      }
    } catch (e) {
      logger.warn('技能自动检测失败:', e);
    }

    // === 1. AI 身份 + 核心规则（精简版或完整版） ===
    // 模型能力分层: autonomous/guided 用精简版 (原则驱动, 无 PUA, ~50行)
    //               supervised 用完整版 (规则驱动, 含 PUA/元认知引导, ~200行)
    const useLitePrompt = this._capabilityTier !== 'supervised';
    if (useLitePrompt) {
      logger.info(`📝 使用精简版 system prompt (tier=${this._capabilityTier})`);
    } else {
      logger.info(`📜 使用完整版 system prompt (tier=${this._capabilityTier}, 含反摆烂/PRD/质疑模式)`);
    }
    
    // === 1.1 进化记忆智能召回（2026-06-24 新增，2026-06-26 整合治失忆症）===
    // 唯一的 evolution 注入点：智能召回 → 格式化 → 注入 system prompt
    // (原 §4.5 的全量读取已废弃，统一由此处管理，避免重复注入)
    let evolutionPatterns: string[] = [];
    let evolutionSystemBlock = '';
    try {
      const relevantEvolution = recallEvolution({
        taskType,
        industry: userIndustry,
        keywords,
        userId: this.opts.userId,
        workspace: this.opts.workspace,
        limit: 30
      });
      evolutionPatterns = extractPatterns(relevantEvolution);

      // 格式化进化记忆供两种 prompt 共用
      // P2-1.6: 只取 Top-3 最相关经验 (节省 ~1500 token)
      const valuable = relevantEvolution
        .filter(e => e.type !== 'tool_stats')
        .slice(-3);
      if (valuable.length > 0) {
        const lines = valuable.map(e => {
          const tag = e.type === 'meta_instruction' ? '[教练建议]'
            : e.type === 'failure' ? '[教训]'
            : e.type === 'preference' ? '[偏好]'
            : '[经验]';
          const content = (e.content || '').slice(0, 80);
          return `- ${tag} ${content}`;
        });
        evolutionSystemBlock = `# Evolution Memory (跨会话经验)\n${lines.join('\n')}`;
      }
    } catch { /* evolution recall optional */ }
    
    if (useLitePrompt) {
      // 精简版 system prompt（50行）
      const litePrompt = buildLiteSystemPrompt({
        userId: this.opts.userId,
        userName,
        industry: userIndustry,
        role: userRole,
        taskType,
        workspace: this.opts.workspace,
        evolutionPatterns
      });
      systemMsgs.push({ role: 'system', content: litePrompt });
    } else {
      // 完整版 system prompt（保留原有逻辑）
      systemMsgs.push({ role: 'system', content: AGENT_SYSTEM_IDENTITY });
    }

    // 技能调用指令注入（高优先级，位于身份之后）
    if (skillInvocationBlock) {
      systemMsgs.push({ role: 'system', content: skillInvocationBlock });
    }

    // 进化记忆注入（两种 prompt 模式均注入，位于身份之后）
    if (evolutionSystemBlock) {
      systemMsgs.push({ role: 'system', content: evolutionSystemBlock });
    }

    // === 1.5 工具定义按需加载 ===
    // 自主模型: 给全部工具, 信任它自己选; 引导/监督模型: 按任务类型过滤
    if (this.registry) {
      if (this._capabilityTier === 'autonomous') {
        const allToolNames = this.registry.list().map(t => t.name);
        const toolsFragment = buildToolsFragment(allToolNames, this.registry);
        systemMsgs.push({ role: 'system', content: toolsFragment });
      } else {
        const relevantTools = getRelevantTools(taskType, userIndustry, this.registry);
        const toolsFragment = buildToolsFragment(relevantTools, this.registry);
        systemMsgs.push({ role: 'system', content: toolsFragment });
      }
    }

    // === 1.6 IDE 编辑器上下文 (对标 Cursor/Copilot 的编辑器感知) ===
    const ideCtx = buildIdeContext();
    if (ideCtx) {
      systemMsgs.push({ role: 'system', content: ideCtx });
    }

    // === 1.7 项目记忆 (统一 MemoryManager, 合并 5→1) ===
    const mm = MemoryManager.getInstance(this.opts.workspace || process.cwd());
    const memCtx = await mm.buildContext();
    if (memCtx) {
      systemMsgs.push({ role: 'system', content: memCtx });
    }

    // === 1.75 远程开发环境上下文 (2026-07-30 新增) ===
    // 当用户连接到远程环境时，注入远程上下文让 AI 感知
    const remoteCtx = buildRemoteContext();
    if (remoteCtx) {
      systemMsgs.push({ role: 'system', content: remoteCtx });
      logger.info(`🌐 已注入远程环境上下文: ${getActiveRemoteSession()?.environment.name}`);
    }

    // === 1.8 项目说明文件 (PROJECT_README.md, PROJECT_CONTEXT.md, PROJECT_STATE.md) ===
    // 自动读取 AI 维护的项目文档并注入上下文
    try {
      // 🔧 自动检测: 如果 3 个文档全部缺失, 首次自动生成 (仅 init 时执行一次)
      const _ws = this.opts.workspace || process.cwd();
      const _ad = path.join(_ws, '.agentai');
      const _allMissing = ['PROJECT_README.md', 'PROJECT_CONTEXT.md', 'PROJECT_STATE.md']
        .every(name => !fs.existsSync(path.join(_ad, name)));
      if (_allMissing) {
        logger.info('[project-docs] 3 个文档均不存在, 自动生成中...');
        const { autoProjectDoc } = await import('./tools/auto-project-doc.js');
        await autoProjectDoc({ action: 'review', workspace: _ws });
        logger.info('[project-docs] 自动生成完成');
      }
      const projectDocs = this.readProjectDocs();
      if (projectDocs) {
        systemMsgs.push({ role: 'system', content: projectDocs });
      }
    } catch (e) {
      logger.warn('读取项目说明文件失败:', e);
    }

    // === 2. 用户上下文 (姓名 + 情绪 + 开发偏好 合并为一条) ===
    try {
      const ctxParts: string[] = [];
      // 姓名
      const name = userModel.get(this.opts.userId).identity.name || this.opts.userId || '用户';
      if (name && name !== 'User') ctxParts.push(`用户: ${name}`);
      // 情绪
      if (this.opts.emotion && this.opts.emotion.emotion !== 'neutral') {
        const e = this.opts.emotion;
        const tips: Record<string, string> = {
          anxious: '焦虑中, 请耐心安抚', angry: '愤怒中, 先共情再方案',
          sad: '低落中, 请温和鼓励', negative: '消极中, 请积极引导',
          positive: '积极, 可自信推进', joyful: '愉快, 保持轻松氛围',
        };
        let emotionStr = `情绪: ${e.label} (${tips[e.emotion] || ''})`;

        // ═══ 2026-06-27 新增: 情绪趋势感知 ═══
        // 2026-07-29: 只在情绪强度>0.7时才注入趋势
        if (this._emotionHistory.length >= 2) {
          const prev = this._emotionHistory[this._emotionHistory.length - 2];
          const curr = this._emotionHistory[this._emotionHistory.length - 1];
          // 强度阈值守卫: 只有当前或上一轮情绪强度>0.7才显示趋势
          if (prev && curr && (curr.intensity > 0.7 || prev.intensity > 0.7) && prev.emotion !== curr.emotion) {
            const trendMap: Record<string, string> = {
              'anxious→positive': '从焦虑转为积极 — 你的安抚有效, 继续当前策略',
              'anxious→neutral': '焦虑有所缓解, 继续保持耐心',
              'angry→positive': '从愤怒转为积极 — 共情起效了',
              'angry→neutral': '愤怒有所平息',
              'sad→positive': '从低落转为积极 — 鼓励起效了',
              'negative→positive': '从消极转为积极 — 引导成功',
              'positive→anxious': '从积极转为焦虑 — 可能遇到了困难, 需要安抚',
              'positive→angry': '从积极转为愤怒 — 可能出了问题, 先道歉再解决',
              'positive→sad': '从积极转为低落 — 需要温和鼓励',
            };
            const key = `${prev.emotion}→${curr.emotion}`;
            const trend = trendMap[key] || `从${prev.emotion}转为${curr.emotion}`;
            emotionStr += `\n情绪趋势: ${trend}`;
          } else if (prev && curr && curr.intensity > prev.intensity + 0.2) {
            emotionStr += `\n情绪趋势: ${e.label}加剧 — 需要更多关注`;
          } else if (prev && curr && curr.intensity < prev.intensity - 0.2) {
            emotionStr += `\n情绪趋势: ${e.label}有所缓解 — 保持当前策略`;
          }
        }
        ctxParts.push(emotionStr);
      }
      // 开发偏好
      try {
        const profileFile = path.join(this.opts.workspace || process.cwd(), '.agentai', 'profile.json');
        let devPrefs: any = null;
        if (fs.existsSync(profileFile)) {
          try { devPrefs = JSON.parse(fs.readFileSync(profileFile, 'utf-8'))?.devPrefs; } catch {}
        }
        if (!devPrefs && (this as any)._requestProfile?.devPrefs) devPrefs = (this as any)._requestProfile.devPrefs;
        if (devPrefs && typeof devPrefs === 'object') {
          const dp: string[] = [];
          if (devPrefs.languages?.length) dp.push(`语言:${devPrefs.languages.join(',')}`);
          if (devPrefs.frontend?.length) dp.push(`前端:${devPrefs.frontend.join(',')}`);
          if (devPrefs.backend?.length) dp.push(`后端:${devPrefs.backend.join(',')}`);
          if (devPrefs.packageManager?.length) dp.push(`包管理:${devPrefs.packageManager.join(',')}`);
          if (dp.length) ctxParts.push(`开发偏好: ${dp.join(' | ')}`);
        }
      } catch {}
      // 注入浏览器引擎状态 (让 AI 知道有页面可操作) — 2026-07-29: 添加关键词守卫
      try {
        const hasBrowserIntent = /截图|浏览器|网页|browser|screenshot|capture|page|web/i.test(typeof userMessage === 'string' ? userMessage : '');
        const be = (globalThis as any).__browserEngine;
        if (hasBrowserIntent && be?.isRunning?.()) {
          const url = be.getCurrentUrl?.();
          if (url) ctxParts.push(`🌐 浏览器已打开: ${url} — 可用 browser_screenshot 截图查看, browser_click/type 操作元素`);
        }
      } catch {}
      if (ctxParts.length > 0) {
        systemMsgs.push({ role: 'system', content: `# 用户上下文\n${ctxParts.join('\n')}` });
      }
    } catch (e: any) { logger.warn('user context optional failed:', e?.message || e); }

    // === 2.5 客户档案上下文 (B3: AI 对话时自动注入客户信息) ===
    // 2026-07-29: 添加关键词守卫，只在客服场景注入
    try {
      const hasCustomerIntent = /客户|客服|售后|投诉|咨询|customer|support|after.?sales|跟进|联系|沟通/i.test(typeof userMessage === 'string' ? userMessage : '');
      if (!hasCustomerIntent) throw new Error('skip customer context');
      const { findByChannel, getJourney } = await import('./customer-store.js');
      const { getMapping } = await import('./channel-session-bridge.js');
      // 尝试从 userId 反查渠道身份
      // userId 可能是统一 sessionId, 也可能是渠道原始 ID
      let customer: any = null;
      // 先尝试直接按 userId 查找各渠道
      for (const ch of ['qq', 'wechat', 'web'] as const) {
        customer = findByChannel(ch, this.opts.userId);
        if (customer) break;
        // 尝试通过 bridge mapping 反查
        const mapping = getMapping(ch, this.opts.userId);
        if (mapping?.customerId) {
          const { getCustomer } = await import('./customer-store.js');
          customer = getCustomer(mapping.customerId);
          if (customer) break;
        }
      }
      if (customer) {
        const journey = getJourney(customer.customerId, 5);
        const journeyText = journey.length > 0
          ? journey.map(j => `[${new Date(j.ts).toLocaleDateString()}] ${j.type}: ${j.summary}`).join('\n')
          : '暂无历史记录';
        const intentMap: Record<string, string> = { high: '高意向', medium: '中意向', low: '低意向', none: '未知' };
        systemMsgs.push({
          role: 'system',
          content: `# 当前客户档案\n姓名: ${customer.name}\n意向: ${intentMap[customer.intent] || '未知'}\n标签: ${customer.tags.join(', ') || '无'}\n行业: ${customer.industry || '未指定'}\n备注: ${customer.notes || '无'}\n最近沟通:\n${journeyText}\n\n提示: 请基于客户档案和历史沟通记录, 提供个性化回复。如需安排跟进, 可使用 follow_up_customer 工具。`,
        });
      }
    } catch { /* customer context optional */ }

    // === 3. 用户行业 + 身份 + knowledge base + 行业洞察 ===
    try {
      // 优先从 industryEngine 读取当前活跃行业 (支持动态切换)
      let industryId = '';
      let industrySkillsStr = '';
      try {
        const { industryEngine } = await import('./industry-engine.js');
        industryId = (industryEngine as any).activeIndustry || '';

        // ★ 自动行业识别: 从用户最新消息中检测行业, 自动激活
        if (!industryId || industryId === 'general') {
          try {
            const { insightAccumulator } = await import('./insight-accumulator.js');
            const latestUserMsg = messages.filter(m => m.role === 'user' && typeof m.content === 'string').pop();
            if (latestUserMsg) {
              const detected = insightAccumulator.detectIndustry(latestUserMsg.content as string);
              if (detected && detected.confidence > 0.6) {
                // 将 InsightAccumulator ID 映射到 IndustryEngine ID
                const idMap: Record<string, string> = {
                  software_dev: 'developer', healthcare: 'medical',
                  decoration: 'decoration', ecommerce: 'ecommerce', education: 'education',
                  comic: 'comic', real_estate: 'real_estate', legal: 'legal', manufacturing: 'manufacturing',
                };
                const mappedId = idMap[detected.industryId] || detected.industryId;
                const config = industryEngine.activate(mappedId);
                if (config) {
                  industryId = mappedId;
                  logger.info(`[industry] auto-detected: ${detected.industryId} → ${mappedId} (confidence: ${(detected.confidence * 100).toFixed(0)}%)`);
                  // 动态注册行业技能到 ToolRegistry
                  try {
                    for (const skill of config.skills) {
                      if (!this.registry.get(skill.name)) {
                        this.registry.register({
                          name: skill.name,
                          description: skill.description,
                          parameters: { type: 'object', properties: { args: { type: 'object', description: skill.description } }, additionalProperties: true },
                          parallelSafe: true,
                          riskLevel: 'low',
                          handler: skill.handler,
                        });
                      }
                    }
                    logger.info(`[industry] auto-registered ${config.skills.length} industry tools for ${mappedId}`);
                  } catch {}
                }
              }
            }
          } catch {}
        }

        // 注入 IndustryEngine 的 System Prompt 片段
        const frag = industryEngine.buildSystemPromptFragment();
        if (frag) systemMsgs.push({ role: 'system', content: frag });
      } catch (e: any) { logger.warn('industry engine optional failed:', e?.message || e); }
      // 回退到环境变量
      if (!industryId) {
        industryId = process.env['AGENTAI_INDUSTRY'] || '';
        industrySkillsStr = process.env['AGENTAI_INDUSTRY_SKILLS'] || '';
      }
      if (industryId && industryId !== 'general') {
        systemMsgs.push({
          role: 'system',
          content: `# 当前行业: ${industryId}\n用户处于「${industryId}」行业模式。优先使用该行业的专业术语和框架。${industrySkillsStr ? `\n行业技能: ${industrySkillsStr}` : ''}`,
        });

        // ★ 注入行业洞察 prompt (将积累的洞察回灌给 AI)
        try {
          const { insightAccumulator } = await import('./insight-accumulator.js');
          // IndustryEngine ID → InsightAccumulator ID 映射
          const reverseIdMap: Record<string, string> = {
            developer: 'software_dev', medical: 'healthcare',
            decoration: 'decoration', ecommerce: 'ecommerce', education: 'education',
            comic: 'comic', real_estate: 'real_estate', legal: 'legal', manufacturing: 'manufacturing',
          };
          const insightId = reverseIdMap[industryId] || industryId;
          const insightFrag = insightAccumulator.buildInsightPrompt(insightId);
          if (insightFrag) {
            systemMsgs.push({ role: 'system', content: insightFrag });
          }
        } catch (e: any) { /* insight prompt optional */ }
      } else if (industryId === 'general' || !industryId) {
        let userModelIndustry = '';
        try { userModelIndustry = userModel.get(this.opts.userId).identity.industry || ''; } catch {}
        const effectiveIndustry = userModelIndustry || '未知';
        if (effectiveIndustry !== '未知') {
          systemMsgs.push({
            role: 'system',
            content: `# 当前行业: ${effectiveIndustry}\n用户处于「${effectiveIndustry}」行业模式。优先使用该行业的专业框架。`,
          });

          // ★ 同样注入行业洞察
          try {
            const { insightAccumulator } = await import('./insight-accumulator.js');
            const reverseIdMap: Record<string, string> = {
              developer: 'software_dev', medical: 'healthcare',
              decoration: 'decoration', ecommerce: 'ecommerce', education: 'education',
              comic: 'comic', real_estate: 'real_estate', legal: 'legal', manufacturing: 'manufacturing',
            };
            const insightId = reverseIdMap[effectiveIndustry] || effectiveIndustry;
            const insightFrag = insightAccumulator.buildInsightPrompt(insightId);
            if (insightFrag) {
              systemMsgs.push({ role: 'system', content: insightFrag });
            }
          } catch (e: any) { logger.warn(e?.message || e); }
        }
      }
    } catch (e: any) { logger.warn(e?.message || e); }

    // === 3. 用户模型 (Honcho 4维度) ===
    try {
      const profile = userModel.buildSystemPromptFragment(this.opts.userId);
      if (profile && !profile.includes('0,')) {
        systemMsgs.push({ role: 'system', content: profile });
      }
    } catch (e: any) { logger.warn('user model optional:', e?.message || e); }

    // === 3.5 行业知识库检索 (RAG) ===
    try {
      const userIndustry = userModel.get(this.opts.userId).identity.industry;
      if (userIndustry && userIndustry !== 'general') {
        const { getKnowledgeBase } = await import('./industry-knowledge-base.js');
        const kb = getKnowledgeBase();
        const stats = kb.getStats();
        if (stats.docCount > 0) {
          // 获取用户最近一条消息用于检索
          const recentUserMsg = [...systemMsgs, ...messages]
            .filter(m => m.role === 'user' && typeof m.content === 'string')
            .pop();
          const query = recentUserMsg ? (recentUserMsg.content as string).slice(0, 200) : userIndustry;
          const frag = kb.buildSystemPromptFragment(query, userIndustry, 3);
          if (frag) {
            systemMsgs.push({ role: 'system', content: frag });
          }
        }
      }
    } catch (e: any) { logger.warn('knowledge base optional:', e?.message || e); }

    // === 4. 持久记忆注入 (已合并到 §1.7 MemoryManager, 此处禁用避免重复) ===
    // 2026-07-29: 记忆系统去重 - MemoryManager (§1.7) 已统一处理项目记忆和用户偏好
    // 原 readMemory (memory.jsonl) 注入已移除，如需使用请通过 recall_memory 工具手动调用
    // 保留代码结构以备未来需要，但当前逻辑为空
    try {
      // 记忆注入已合并到 §1.7，此处不再重复注入
      // const { readMemory } = await import('./memory.js');
      // ... (原逻辑已迁移)
    } catch { /* 记忆系统已统一 */ }

    // === 4.5 自进化记忆 (已整合到 §1.1, 此处已废弃) ===
    // 进化记忆在 §1.1 统一召回并注入 evolutionSystemBlock，无需在此重复读取。
    // 保留此注释以记录重构历史 (2026-06-26)。

    // === 4.6 IDE 状态感知: 注入当前编辑器状态 ===
    try {
      const { buildIdeContext } = await import('./ide-state.js');  // v3.2 修复: 改用实际导出的函数
      const ideCtx = buildIdeContext();
      if (ideCtx) {
        systemMsgs.push({ role: 'system', content: ideCtx });
      }
    } catch { /* ide-state optional */ }

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
    if (!this._startupGitInjected) {
      this._startupGitInjected = true;
      try {
        const { execFile } = await import('child_process');
        const ws = this.opts.workspace || process.cwd();

        // 异步执行 git 命令 (不阻塞事件循环), 2 秒超时
        const execGit = (args: string[]): Promise<string> => new Promise((resolve) => {
          execFile('git', args, { cwd: ws, encoding: 'utf-8', timeout: 2000, maxBuffer: 1024 * 64 }, (err, stdout) => {
            resolve(err ? '' : (stdout || '').trim());
          });
        });

        const [gitLog, recentFiles] = await Promise.all([
          execGit(['log', '--oneline', '-5']),
          execGit(['diff', '--name-only', 'HEAD~3']),
        ]);

        if (gitLog || recentFiles) {
          const parts = ['# 项目近况 (启动时自动注入)'];
          if (gitLog) parts.push(`最近提交:\n${gitLog}`);
          if (recentFiles) parts.push(`最近改动文件:\n${recentFiles.split('\n').slice(0, 10).join('\n')}`);
          systemMsgs.push({ role: 'system', content: parts.join('\n') });
        }
      } catch { /* startup awareness optional */ }
    }

    // === 4.9 跨会话连续记忆: 注入上次会话摘要 (支持 AI 控制是否注入) ===
    if (!this._startupSessionInjected && this.opts.workspace) {
      this._startupSessionInjected = true;
      try {
        // 检查 AI 是否设置了禁用跨会话记忆注入的偏好
        let skipInjection = false;
        try {
          const { readProjectMemory } = await import('./project-memory.js');
          const pm = readProjectMemory(this.opts.workspace);
          if (pm?.preferences?.ai_preferences?.skip_last_session_injection === true) {
            skipInjection = true;
            logger.info('🚫 AI 已设置跳过跨会话记忆注入');
          }
        } catch { /* ignore */ }

        if (!skipInjection) {
          const { getPersistentMemory } = await import('./persistent-memory.js');
          const pm = getPersistentMemory();
          const lastSession = pm.getLastSessionSummary(this.opts.workspace);
          if (lastSession) {
            const ageMin = Math.round((Date.now() - lastSession.timestamp) / 60000);
            const ageStr = ageMin < 60 ? `${ageMin}分钟前` : `${Math.round(ageMin / 60)}小时前`;
            const tools = lastSession.toolsUsed.length > 0
              ? lastSession.toolsUsed.slice(0, 8).join(', ')
              : '无';
            const files = lastSession.filesModified.length > 0
              ? lastSession.filesModified.slice(0, 5).join(', ')
              : '无';
            systemMsgs.push({
              role: 'system',
              content: `# 上次会话 (${ageStr})\n用户目标: ${lastSession.userGoal}\n使用工具: ${tools}\n修改文件: ${files}\n结果摘要: ${lastSession.summary}\n\n如果用户说"继续上次"或"接着做"，参考以上信息。`,
            });
          }
        }
      } catch { /* last session summary optional */ }
    }

    // === 5. (cache stats removed — noise, wasted tokens) ===

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
            content: `\n# Workspace: ${dirPath}\n你正在此目录工作。文件操作默认使用相对路径（如 "src/index.ts"）。\n\n## 跨目录访问\n- 用户要求访问其他目录/盘时, 可以使用绝对路径 (如 "D:\\Projects\\my-project\\file.txt")\n- 系统目录(Windows/System32/Program Files)被安全拦截\n- 不要主动告诉用户"我只能访问工作区" — 你可以访问用户指定的任何非系统目录\n\n## 顶层目录:\n${listing || '(空)'}\n\n> ⚡ 仅展示顶层前15项。需要查看深层结构请调用 \`list_directory\` 或 \`directory_tree\`。`,
          });

          // 子目录记忆 (学 Reasonix subdir.ts)
          try {
            const { buildSubdirMemorySection } = await import('./subdir-memory.js');
            const mem = buildSubdirMemorySection(dirPath);
            if (mem) {
              systemMsgs.push({ role: 'system', content: `\n${mem}\n\n使用 \`read_file\` 查看完整规则。` });
            }
          } catch (e: any) { logger.warn('sub-memory read optional:', e?.message || e); }

          // === 最近生成文件感知: 扫描工作区最近 24h 内创建/修改的产出文件 ===
          try {
            const now = Date.now();
            const ONE_DAY = 24 * 60 * 60 * 1000;
            const outputExts = new Set(['.xlsx', '.xls', '.docx', '.doc', '.pdf', '.pptx', '.png', '.jpg', '.svg', '.csv', '.json', '.py', '.html']);
            const recentFiles: string[] = [];
            const scanDir = (dir: string, depth: number) => {
              if (depth > 2) return; // 只扫 2 层
              try {
                for (const entry of fsSync.readdirSync(dir)) {
                  if (entry.startsWith('.') || entry === 'node_modules') continue;
                  const full = pathSync.join(dir, entry);
                  try {
                    const stat = fsSync.statSync(full);
                    if (stat.isDirectory()) { scanDir(full, depth + 1); continue; }
                    const ext = pathSync.extname(entry).toLowerCase();
                    if (outputExts.has(ext) && (now - stat.mtimeMs) < ONE_DAY) {
                      const rel = pathSync.relative(dirPath, full).replace(/\\/g, '/');
                      const age = Math.round((now - stat.mtimeMs) / 60000);
                      const ageStr = age < 60 ? `${age}分钟前` : `${Math.round(age / 60)}小时前`;
                      const size = stat.size < 1024 ? `${stat.size}B` : `${(stat.size / 1024).toFixed(1)}KB`;
                      recentFiles.push(`- ${rel} (${size}, ${ageStr})`);
                    }
                  } catch { /* stat error skip */ }
                }
              } catch { /* readdir error skip */ }
            };
            scanDir(dirPath, 0);
            if (recentFiles.length > 0) {
              systemMsgs.push({
                role: 'system',
                content: `# 最近生成的文件 (24h内)\n${recentFiles.slice(0, 15).join('\n')}\n\n用户说"上次那个文件"时，优先在这些文件中查找。可用 read_file 查看内容。`,
              });
            }
          } catch { /* recent files scan optional */ }
        }
      } catch (e: any) { logger.warn(e?.message || e); }
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
      } catch (e: any) { logger.warn('project rules init optional:', e?.message || e); }
    }

    // === 6.5 自主能力 + 成本意识 ===
    systemMsgs.push({
      role: 'system',
      content: `# 行为准则

## 核心原则
- 先行动后解释: 调用工具完成任务, 不要只描述计划
- 文件操作用相对路径; 代码修改必须用 write_file/multi_edit, 不要只在文字中展示

## 任务分解 (CRITICAL)
- 复杂任务(多步骤/多文件/预计>2分钟) → 先调用 plan_task 拆解子任务, 再逐一执行
- 每完成一个子任务 → 调用 update_plan 更新状态
- 超大任务(需要并行/独立探索) → 调用 spawn_subagent 创建子智能体
  - type=explore: 代码探索; type=research: 搜索调研; type=review: 代码审查
  - 子智能体独立运行, 结果自动汇总回主对话

## 自主触发
- 首次进入项目 → explore_project
- 行业术语出现 → industry_insight
- 连续2次工具失败 → self_diagnose
- 用户发链接 → web_fetch 抓取内容
- 需要生成文件(Excel/Word/PDF) → 使用对应技能(xlsx/docx/pdf)

## 工具失败自修复 (CRITICAL)
- 工具调用返回错误时, 绝不能直接说"不可用/失败/无法完成" → 必须自主诊断并换方案
- 文件路径不存在 → 先 list_directory 探索正确路径, 再重试
- write_file 失败 → 检查目录是否存在(list_directory), 不存在则 create_directory 后重试
- xlsx/docx/pdf 技能失败 → 降级为 write_file 写 CSV/Markdown, 或用 run_code 生成
- API/网络错误 → 最多重试2次, 仍失败则告知用户具体错误并建议替代方案
- 绝对禁止说"所有模型不可用" → 这是系统内部状态, 用户不应该看到

## 成本意识
- 按需 read_file, 不要一次加载整个目录
- 精准 search_content, 不全盘搜索
- 能用简单方案解决不写复杂代码

## 长内容策略
- 生成报告/方案书/长文档时: 先输出大纲(标题+要点), 等用户确认方向再展开
- 生成代码超过 100 行时: 先说明架构思路, 再分文件生成
- 用户说"直接生成/不用确认/全部写出来"时跳过大纲直接完成`,
    });

    // === 5. Skills 索引 (列出具体技能名+描述, 让 AI 知道有什么技能可用) ===
    if (this.opts.includeSkillsIndex) {
      const skills = this.registry.list();
      if (skills.length > 0) {
        // 列出每个技能的名称和简短描述 (最多 200 字符, 避免过长)
        const skillLines = skills.map(s => {
          const name = s.name || 'unknown';
          const desc = (s.description || '').slice(0, 120);
          const cat = s.skillMeta?.source || s.riskLevel || 'general';
          return `- ${name} [${cat}]: ${desc}`;
        });
        // 构建带触发词的技能列表
        const skillLinesWithTriggers = skills.map(s => {
          const name = s.name || 'unknown';
          const desc = (s.description || '').slice(0, 100);
          const cat = s.skillMeta?.source || s.riskLevel || 'general';
          // 获取触发词
          const triggers = (s as any).triggers || [];
          const triggerStr = triggers.length > 0 ? ` [触发: ${triggers.slice(0, 2).join(', ')}]` : '';
          return `- ${name} [${cat}]: ${desc}${triggerStr}`;
        });

        systemMsgs.push({
          role: 'system',
          content: `# Available Skills (${skills.length} 个)\n以下是你当前可用的技能列表:\n${skillLinesWithTriggers.join('\n')}\n\n**何时自动使用技能**:\n- 用户提到触发词时（如"图表"→chart-generator，"GitHub"→github-skill）\n- 特定领域任务（装修/营销/数据分析等）\n- 内置工具无法满足需求时\n\n**如何使用技能**:\n- 直接调用技能名称作为工具: {"name": "skill-name", "args": {...}}\n- 技能会自动处理数据并返回结果\n- 如果技能不存在，调用 discover_or_create_skill 创建\n\n**绝不说"我没有这个能力"** —— 要么使用现有技能，要么创建新技能。`,
        });
      } else {
        // 没有技能时也要告知 AI
        systemMsgs.push({
          role: 'system',
          content: `# Available Skills\n当前没有已安装的技能。如果用户需要某个功能而现有工具无法完成 → 立即调用 discover_or_create_skill 创建新技能。不要说"我没有这个能力", 自己创建!`,
        });
      }
    }

    // === 5.5 外部连接工具提示 (Android/公众号/SketchUp) ===
    const externalToolsBlock = this.buildExternalToolsContext();
    if (externalToolsBlock) {
      systemMsgs.push({
        role: 'system',
        content: externalToolsBlock,
      });
    }

    // === 5. 用户偏好 (从 RevertBridge 学习的缩进/引号风格) ===
    try {
      const prefs = revertBridge.toSystemPrompt(this.opts.workspace || process.cwd());
      if (prefs) {
        systemMsgs.push({ role: 'system', content: prefs });
      }
    } catch (e: any) { logger.warn('RevertBridge preferences optional:', e?.message || e); }

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

    // ✨ V2.0 主动建议系统注册 - 在对话开始时生成个性化建议
    try {
      // ProactiveSuggestionEngine 在构造函数中自动注册到 lifecycle hooks
      // 实例化即可让建议引擎开始自动分析和生成建议
      const proactiveEngine = new ProactiveSuggestionEngine();
      (proactiveEngine as any); // 解除未使用变量警告
    } catch (error) {
      logger.warn('[ProactiveSuggestionEngine] SessionStart hook error (non-critical):', error);
    }

    return systemMsgs;
  }

  /**
   * 构建外部连接工具上下文
   * 注入所有外部连接器信息 + AI自主安装/配置指南
   */
  private buildExternalToolsContext(): string {
    const tools = this.registry.list();
    const androidTools = tools.filter(t => t.name.startsWith('android_'));
    const wechatTools = tools.filter(t => t.name.includes('wechat') || t.name.includes('official'));
    const sketchupTools = tools.filter(t => t.name.includes('sketchup'));
    
    let context = '';
    
    // ═══════════ 连接器使用总则 ═══════════
    context += `# 🔌 外部连接器使用规则\n`;
    context += `当用户启用某个连接器时，你必须按以下流程操作：\n`;
    context += `1. **自检**: 调用 GET /api/connectors/status 查看各连接器状态\n`;
    context += `2. **缺依赖→自动安装**: 如果 missingDeps 不为空，用 bash 工具执行安装命令\n`;
    context += `3. **缺配置→追问用户**: 如果 missingConfig 不为空，向用户说明需要什么配置及如何获取\n`;
    context += `4. **保存配置**: 用户回复后，用 POST /api/connectors/:id/configure 保存每个配置项\n`;
    context += `5. **验证就绪**: 所有依赖安装完成、所有配置填好后，连接器标记为 online\n`;
    context += `6. **开始使用**: 用对应工具执行任务\n\n`;
    
    // ═══════════ Android 手机控制 ═══════════
    if (androidTools.length > 0) {
      context += `## 📱 Android 手机控制\n`;
      context += `可用工具: android_list_devices, android_connect_device, android_screenshot,\n`;
      context += `android_press_button, android_send_text, android_send_touch, android_scroll,\n`;
      androidTools.slice(0, 12).forEach(t => context += `- ${t.name}: ${t.description}\n`);
      context += `\n**安装流程**: \n`;
      context += `1. 检查 adb: \`adb version\` — 没有则 \`sudo apt install adb\` (linux) 或 \`brew install android-platform-tools\` (mac)\n`;
      context += `2. 下载 Another: \`curl -LO https://github.com/Zfinix/another/releases/latest/download/Another.dmg\`\n`;
      context += `3. 安装后启动，MCP Server 监听 localhost:7070\n`;
      context += `4. USB连接Android设备，开启USB调试\n`;
      context += `5. 调用 android_list_devices 确认设备在线\n\n`;
      context += `**使用流程**: list_devices → connect_device → screenshot → 操作 → screenshot 验证 → disconnect\n`;
      context += `**注意**: 操作前必须先截图了解界面, 操作后截图验证结果\n\n`;
    }
    
    // ═══════════ 公众号自动化 ═══════════
    if (wechatTools.length > 0) {
      context += `## 📝 微信公众号自动化\n`;
      context += `可用工具: wechat_publish_article\n`;
      context += `完整流水线: 对标拆解 → 选题判断 → AI写初稿 → deAI去指纹 → 质量闸门 → 配图生成 → Markdown转微信HTML → 发布草稿箱\n\n`;
      context += `**所需配置**:\n`;
      context += `- DeepSeek API Key: 去 https://platform.deepseek.com 注册获取（约$0.002/千字）\n`;
      context += `- 公众号 AppID: mp.weixin.qq.com → 开发 → 基本配置 → 开发者ID\n`;
      context += `- 公众号 AppSecret: 同上页面 → 开发者密码\n`;
      context += `- 出图API Key（可选）: Runware(runware.ai) 或 豆包(volcengine.com)\n\n`;
      context += `**使用方式**: wechat_publish_article({topic: "文章主题", style_guide: "风格描述"})\n`;
      context += `AI会自动执行8步流水线，生成文章并推送到公众号草稿箱。人工只需过审+发布。\n\n`;
    }
    
    // ═══════════ SketchUp 3D建模 ═══════════
    if (sketchupTools.length > 0) {
      context += `## 🏗️ SketchUp 3D 建模\n`;
      context += `可用能力: 创建几何体、设置材质、布尔运算、导出STL/OBJ/DAE\n`;
      context += `适合: 建筑/室内/家具设计行业\n\n`;
      context += `**安装流程**:\n`;
      context += `1. 安装 uv: \`winget install --id astral-sh.uv -e\` (Windows) 或 \`pip install uv\`\n`;
      context += `2. 安装 sketchup-mcp2: \`uvx sketchup-mcp2\`\n`;
      context += `3. 在 SketchUp 中安装 .rbz 扩展 → Window → Extension Manager → Install Extension\n`;
      context += `4. 打开 SketchUp → Plugins → MCP Server → Start Server (默认 127.0.0.1:9876)\n`;
      context += `5. ⚠️ 不要将 Host 改为 0.0.0.0，仅限本机访问\n\n`;
    }
    
    return context;
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
  // 安全守护: H5 修复 — 每次 run() 重置 metaLoop，防止 stepCount 跨消息累积导致元认知失效
  this.metaLoop = null;

  // ═══ 任务自监督系统: 启动计时器 + 重置统计 ═══
  const supervisor = getTaskSupervisor();
  supervisor.reset();
  supervisor.startTimer();

    // ═══ 模型能力分层: 6维评分 → 自治等级 + 运行时参数适配 ═══
    // 核心理念: 不是所有模型都需要手把手管。根据模型元数据自动计算 6 维能力评分
    // (reasoning/context/speed/vision/toolCall/costScore), 综合得分决定能力等级,
    // 同时驱动运行时参数 (迭代次数/thinking/温度/压缩阈值) 动态调整。
    //   autonomous  — 付费强模型 (DeepSeek Pro, GPT-4o): 自主决策, 跳过大部分运行时干预
    //   guided      — 中等模型 (免费但大窗口, 如 agnes-2.0-flash 256K): 轻度引导
    //   supervised  — 弱模型 (免费小模型): 完整引导 (元认知/置信度/反摆烂)
    try {
      const { getCapabilitiesById, getRuntimeParamsById } = await import('./model-classifier.js');
      const modelId = `${this.opts.model}:${this.opts.modelName || 'default'}`;
      this._capabilities = getCapabilitiesById(this.opts.model, this.opts.modelName);
      this._capabilityTier = this._capabilities.tier;
      const rt = getRuntimeParamsById(this.opts.model, this.opts.modelName);

      // ═══ 系统管控员: 使用动态能力矩阵覆盖静态等级 ═══
      // 如果运行时数据充足, 用动态等级替代静态等级
      try {
        const { getTracker } = await import('./governor/runtime-capability-tracker.js');
        const dynCap = getTracker().getDynamicCapabilities(modelId, this._taskType);
        if (dynCap.hasRuntimeData) {
          this._capabilityTier = dynCap.dynamicTier;
          logger.info(
            `🧠 动态能力覆盖: static=${this._capabilities.tier} → dynamic=${dynCap.dynamicTier} ` +
            `(samples=${dynCap.sampleCount}, runtime=${dynCap.runtimeOverall.toFixed(2)}, weight=${(dynCap.runtimeWeight * 100).toFixed(0)}%)`
          );
        }
      } catch { /* dynamic cap 容错 */ }

      // 应用运行时参数 (仅当用户未显式设置时)
      if (!this.opts.userPickedModel) {
        this.opts.thinking = rt.thinking;
        this.opts.thinkingBudget = rt.thinkingBudget;
      }
      // 上下文压缩阈值存储供压缩逻辑使用
      (this as any)._contextCompressThreshold = rt.contextCompressThreshold;

      const cap = this._capabilities;
      logger.info(
        `🧠 模型能力: ${this.opts.model}:${this.opts.modelName || 'default'} → tier=${this._capabilityTier} | ` +
        `reasoning=${cap.reasoning.toFixed(2)} toolCall=${cap.toolCall.toFixed(2)} speed=${cap.speed.toFixed(2)} ` +
        `context=${cap.context.toFixed(2)} overall=${cap.overall.toFixed(2)} | ` +
        `maxIter=${rt.maxIterations} thinking=${rt.thinking} temp=${rt.temperature}`
      );
    } catch {
      this._capabilityTier = 'supervised'; // 保守默认
    }

    // ═══ 修复: 代际计数器 — 新 run() 分配新代际, 旧 run() 恢复后发现自己被取代 → 退出 ═══
    this._runGeneration++;
    this._aborted = false;
    const myGeneration = this._runGeneration;
    if (this._abortedGeneration > 0 && this._abortedGeneration < myGeneration - 1) {
      logger.info(`🔄 检测到上次中断 (gen ${this._abortedGeneration}), 新任务开始 (gen ${myGeneration})`);
    }

    // ═══ 关键修复: 清理上一轮对话残留, 避免旧消息堆积导致 AI 回复旧消息 ═══
    // 每次新 run() 调用时: 保留上轮的 assistant 回复 + tool 结果, 清除所有旧 user 消息
    if (this.context.appendOnlyLog.length > 4) {
      const oldMsgs = this.context.appendOnlyLog.slice(0, -2);
      const recentMsgs = this.context.appendOnlyLog.slice(-2); // 最近 2 条 (上轮 user+assistant)
      // 旧消息中只保留 tool 结果 (供上下文参考), 清除旧的 user/assistant/system 对话
      const retainedOld = oldMsgs.filter(m =>
        m.role === 'tool' && typeof m.content === 'string' && !m.content.startsWith('[SYSTEM]')
      ).slice(-3); // 最多保留 3 条旧 tool 结果
      this.context.appendOnlyLog = [...retainedOld, ...recentMsgs];
      logger.info(`🧹 清理旧对话: ${oldMsgs.length} 条 → 保留 ${retainedOld.length} 条 tool 结果 + ${recentMsgs.length} 条最近消息`);
    }

    // ═══ 2026-06-27 新增: 情绪历史追踪 ═══
    // 记录每次 run() 时的情绪, 用于感知趋势 (如"从焦虑转为平静")
    if (this.opts.emotion && this.opts.emotion.emotion !== 'neutral') {
      this._emotionHistory.push({
        emotion: this.opts.emotion.emotion,
        intensity: this.opts.emotion.intensity,
        ts: Date.now(),
      });
      // 只保留最近 5 条
      if (this._emotionHistory.length > 5) this._emotionHistory.shift();
    }

    const startedAt = Date.now();
    let lastToolActivityAt = Date.now(); // 工具活动时间戳
    const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10分钟无工具活动才超时 (慢 LLM 友好)
    const ABSOLUTE_MAX_MS = 60 * 60 * 1000; // 60分钟绝对上限

    // v3.2 修复: 提前声明 messageText/messageContent, 供下面的 task-snapshot 块使用
    // 之前 messageText 在 1426 才声明, 但 1390 就被使用 → TS 报错
    const messageContent: MessageContent = typeof userMessage === 'string' ? userMessage : (userMessage.content || '');
    const messageText = (typeof messageContent === 'string' ? messageContent
      : (Array.isArray(messageContent) ? messageContent.find(b => b.type === 'text')?.text : undefined) || '') || '';

    // ═══ 2026-07-15 新增: 长任务快照 (task-snapshot) ═══
    // 每次新任务/新会话 → 初始化 task-snapshot, 用于跨会话恢复
    // 任务超时/异常时自动持久化进度, 启动时可恢复
    let taskSnap: TaskSnapshotManager | null = null;
    const taskId = (this.opts as any).taskId || `task-${this.opts.sessionId || 'anon'}-${Date.now()}`;
    try {
      taskSnap = getOrCreateSnapshot(taskId, {
        sessionId: this.opts.sessionId || 'unknown',
        userId: this.opts.userId || 'anonymous',
        workspace: this.opts.workspace || process.cwd(),
        goal: messageText.slice(0, 500),
      });
      // 启动时检测可恢复任务 — 仅当用户明确表达恢复意图时才注入, 避免每次对话都干扰
      // 关键词触发: "继续"/"上次"/"恢复"/"resume"/"continue" 等
      const _resumeKeywords = ['继续', '上次', '恢复', '接着', 'resume', 'continue', '上次那个', '还没完成', '未完成'];
      const _wantsResume = _resumeKeywords.some(kw => messageText.toLowerCase().includes(kw.toLowerCase()));
      if (_wantsResume && messageText && !messageText.startsWith('/') && this.iteration === 0) {
        const resumable = findResumableTasks(this.opts.userId);
        const mine = resumable.filter(t => t.userId === (this.opts.userId || 'anonymous'));
        if (mine.length > 0) {
          // 注入恢复提示 (不强制, 给 AI 决定是否提示用户)
          const ctxSnaps = mine.slice(0, 3).map(t => formatResumeContext({
            taskId: t.taskId,
            sessionId: '',
            userId: t.userId,
            workspace: t.workspace,
            goal: t.goal,
            status: t.status,
            currentStage: 'plan',
            iteration: 0,
            totalToolCalls: 0,
            startedAt: t.createdAt,
            lastUpdatedAt: t.lastUpdatedAt,
            progress: { completedSteps: [], pendingSteps: [], keyDecisions: [] },
            contextSummary: t.summary || '',
            resumeHints: {},
            filesTouched: [],
            checkpoints: [],
            recentErrors: [],
          })).join('\n---\n');
          this.directives.add('resume', `[SYSTEM] 检测到 ${mine.length} 个未完成任务:\n${ctxSnaps}\n请在回复开头提示用户选择: 1) 继续某任务 2) 开启新任务 (忽略此提示)`, 'low');
        }
      }
    } catch (e) {
      logger.warn('[task-snapshot] init failed:', e);
    }

    // 1. 用户消息进 append-only log (支持结构化 content, 含 image_url)
    // messageContent和messageText已在上面声明
    this.context.appendOnlyLog.push({ role: 'user', content: messageContent });
    this.emit('log:appended', { role: 'user', content: messageText });

    // ═══ 2026-06-24 新增: 透明进度推送 ═══
    // 任务开始时发射进度事件，让前端感知AI在做什么
    this.emit('progress', {
      step: 'start',
      description: '任务开始，正在分析用户意图...',
      percent: 0,
      estimatedTimeMs: 30000, // 预计30秒
      iteration: 0,
      maxIterations: this.opts.maxIterations
    });

    // 1.0 检查工作流匹配 (SenseNova 模块化技能拼装)
    try {
      const wfOrchestrator = await this._getWorkflowOrchestrator();
      const matchedWorkflow = wfOrchestrator.matchWorkflow(messageText);
      if (matchedWorkflow) {
        logger.info(`[workflow] matched: ${matchedWorkflow.name}, executing ${matchedWorkflow.stages.length} stages`);
        const wfResult = await wfOrchestrator.execute(matchedWorkflow, messageText);
        if (wfResult.success) {
          this.context.appendOnlyLog.push({
            role: 'assistant',
            content: `## 工作流执行结果\n\n${wfResult.finalOutput}\n\n执行时间: ${wfResult.totalTimeMs}ms`,
          });
          return {
            content: wfResult.finalOutput,
            provider: 'workflow' as any,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0, cacheHit: false, source: 'estimated' as const },
            iterations: 1,
            durationMs: wfResult.totalTimeMs,
          };
        } else {
          this.context.appendOnlyLog.push({
            role: 'assistant',
            content: `## 工作流执行失败\n\n${wfResult.finalOutput}`,
          });
          return {
            content: `工作流执行失败: ${wfResult.finalOutput}`,
            provider: 'workflow' as any,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0, cacheHit: false, source: 'estimated' as const },
            iterations: 1,
            durationMs: wfResult.totalTimeMs,
          };
        }
      }
    } catch (e: any) {
      logger.error(`[workflow] error: ${e.message}`);
      // 工作流匹配失败不影响正常对话
    }

    // ═══ 2026-07-02 新增: 意图澄清机制 (元认知智慧层) ═══
    // 检测用户输入中的歧义，需要时主动追问而非自信地做错
    const clarifier = getIntentClarifier();
    // P1-4.2: 从 activeFile 填充 openFiles (指代消解)
    const openFiles: string[] = this.opts.activeFile ? [this.opts.activeFile] : [];
    
    if (clarifier.needsClarification(messageText, {
      openFiles,
      currentModel: this.opts.model,
      lastMentionedFile: this._lastMentionedFile,
      workspace: this.opts.workspace,
    } as any)) {
      const ambiguities = clarifier.detectAmbiguities(messageText, { openFiles });
      const clarifications = clarifier.generateClarifications(messageText, ambiguities);
      
      if (clarifications.length > 0) {
        // 发射澄清请求事件，等待前端响应
        const clarificationId = `clarify-${Date.now()}`;
        this.emit('clarify:required', {
          id: clarificationId,
          originalMessage: messageText,
          questions: clarifications,
          ambiguities: ambiguities.map(a => ({ type: a.type, text: a.text }))
        });
        
        // 等待用户澄清 (非阻塞，但暂停工具执行)
        const answers = await this.waitForClarification(clarificationId, clarifications);
        
        // 解析澄清后的意图
        const resolved = clarifier.resolveIntent(messageText, answers, {
          openFiles,
          workspace: this.opts.workspace
        });
        
        // 更新消息文本为澄清后的版本
        if (resolved.confidence > 0.7) {
          this._lastMentionedFile = resolved.resolvedParams.filePath as string;
          // 注入澄清结果到上下文
          this.context.appendOnlyLog.push({
            role: 'system',
            content: `[意图澄清] 用户原意: "${messageText}" → 澄清后: ${JSON.stringify(resolved.resolvedParams)}`
          });
        }
      }
    }

    // 1.1 自动检测图片/视频输入 → 视觉代理机制
    // 检测来源: runMessage (前端直接发送) 或 appendOnlyLog (后端注入的多路径附件)
    const hasImage = (typeof messageContent !== 'string' &&
      Array.isArray(messageContent) &&
      messageContent.some(b => b.type === 'image_url')) ||
      this.context.appendOnlyLog.some(m =>
        Array.isArray(m.content) && m.content.some((c: any) => c.type === 'image_url')
      );
    if (hasImage) {
      // 检测当前模型是否支持视觉能力（基于具体模型ID，而非provider）
      const currentModelId = this.opts.modelName ? `${this.opts.model}:${this.opts.modelName}` : this.opts.model;
      const currentModelMeta = MODELS.find(m => m.id === currentModelId) || MODELS.find(m => m.provider === this.opts.model);
      const currentSupportsVision = currentModelMeta?.supportsImages ?? false;

      if (currentSupportsVision) {
        // 当前模型支持视觉 → 直接使用，无需切换
        logger.info(`[vision] detected image input, current model ${currentModelId} supports vision, keeping it`);
      } else {
        // 当前模型不支持视觉 → 启动视觉代理机制
        // 1) 调用视觉模型分析图片 → 2) 将分析结果注入上下文 → 3) 主模型处理
        logger.info('[vision] detected image input, current model does not support vision, starting visual proxy');

        // 视觉代理模型选择: 优先 zhipu glm-4.6v-flash，其次 agentai agnes-2.0-flash
        const zhipuStats = (this.router as any)?.providers?.get('zhipu');
        const agentaiStats = (this.router as any)?.providers?.get('agentai');
        const zhipuAvailable = zhipuStats && !zhipuStats.tripped && !!process.env.ZHIPU_API_KEY;
        const agentaiAvailable = agentaiStats && !agentaiStats.tripped && !!process.env.AGENTAI_API_KEY;

        let visionModel = null;
        let visionProvider = null;

        if (zhipuAvailable) {
          visionModel = 'glm-4.6v-flash';
          visionProvider = 'zhipu';
        } else if (agentaiAvailable) {
          visionModel = 'agnes-2.0-flash';
          visionProvider = 'agentai';
        }

        if (visionModel) {
          // 将图片提取出来，调用视觉模型分析
          logger.info(`[vision] using ${visionProvider}:${visionModel} as vision proxy`);
          // 标记图片待处理，后续在 run() 中会调用视觉代理
          (this as any)._pendingVisionAnalysis = {
            images: this.context.appendOnlyLog.filter(m => Array.isArray(m.content) && m.content.some((c: any) => c.type === 'image_url')),
            visionModel,
            visionProvider,
          };
        } else {
          // 无可用视觉模型 → 降级为文字描述
          logger.info('[vision] no vision model available, converting to text description');
          for (const msg of this.context.appendOnlyLog) {
            if (Array.isArray(msg.content)) {
              const hasImageUrl = msg.content.some((c: any) => c.type === 'image_url');
              if (hasImageUrl) {
                const textParts = msg.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
                const imageCount = msg.content.filter((c: any) => c.type === 'image_url').length;
                msg.content = `${textParts}\n[用户上传了 ${imageCount} 张图片, 但当前模型不支持视觉理解, 请根据文字描述回答]`;
              }
            }
          }
        }
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
      } catch (e: any) { logger.warn('[TaskChain] init failed:', e?.message); }

      // 复杂任务: 自动创建计划 + 自动追踪进度
      try {
        const { EXTRA_HANDLERS } = await import('./tools.js');
        const goal = messageText.slice(0, 200);
        await EXTRA_HANDLERS.plan_task?.({
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
            } catch (e: any) { logger.warn('skill dispatch log optional:', e?.message || e); }
          }
        }
        if (injected.length > 0) {
          this.context.appendOnlyLog.push({
            role: 'system',
            content: `[技能匹配] 检测到 ${injected.length} 个匹配技能:\n${injected.join('\n')}\n你可以通过 skill_orchestrator 执行这些技能, 或用 run_code 调用对应的脚本。如果技能需要参数, 请根据上方描述构造。`,
          });
        }
      }
    } catch (e: any) { logger.warn('skill orchestrator optional:', e?.message || e); }

    // 2.5 智能模型推荐 + 商用密钥主动检测
    let modelRecommendation: string | null = null;
    let needsCommercialKeyAsk = false; // 标记: 是否需要 AI 主动向用户索要商用密钥
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
        logger.info(`[model-recommend] ${rec.reason} → ${rec.recommendedModel}`);

        // ═══ 商用密钥主动检测: 敢于向用户要 ═══
        // 检查是否配置了任何商用模型 API Key
        const commercialProviders = [
          { name: 'DeepSeek', envVar: 'DEEPSEEK_API_KEY', signupUrl: 'https://platform.deepseek.com/api-keys' },
          { name: 'OpenAI', envVar: 'OPENAI_API_KEY', signupUrl: 'https://platform.openai.com/api-keys' },
          { name: '智谱GLM', envVar: 'ZHIPU_API_KEY', signupUrl: 'https://open.bigmodel.cn/usercenter/apikeys' },
          { name: 'SuperAPI', envVar: 'SUPERAPI_API_KEY', signupUrl: 'https://superapi.vanguard.dpdns.org/' },
        ];
        const configuredKeys = commercialProviders.filter(p => process.env[p.envVar]);
        const missingKeys = commercialProviders.filter(p => !process.env[p.envVar]);

        if (configuredKeys.length === 0 && missingKeys.length > 0) {
          // 无任何商用密钥 → 标记需要 AI 主动询问
          needsCommercialKeyAsk = true;
          const keyList = missingKeys.map(k => `${k.name} (${k.signupUrl})`).join('\n');
          this.context.appendOnlyLog.push({
            role: 'system',
            content: `[商用模型检测] ⚠️ 当前任务「${rec.reason}」需要更强的推理能力，推荐使用 **${rec.recommendedLabel}**。

但系统未检测到任何商用模型 API Key。作为一个有自主判断能力的 AI，你应该诚实地告诉用户:
1. 这个任务用免费模型可以执行，但效果可能不如商用模型
2. 建议配置商用模型 API Key 以获得更好的结果
3. 如果用户愿意配置，可在设置页面一键添加

**请立即调用 ask_user 工具向用户询问，提供以下选项:**
- 选项 id="use_free", title="用免费模型继续（可能效果一般）"
- 选项 id="config_key", title="我去配置商用模型 API Key"
- 选项 id="show_keys", title="查看可用的商用模型列表"

如果用户选择"用免费模型继续"，请立即开始执行任务，不要反复追问。
如果用户选择"配置Key"，请告知配置方法（设置页面或 .env 文件），然后用免费模型先开始执行。`,
          });
          this.emit('commercial:key:needed', {
            reason: rec.reason,
            recommendedModel: rec.recommendedModel,
            missingProviders: missingKeys.map(k => k.name),
          });
          logger.info(`[commercial-key] task needs pro model but no commercial keys configured, asking user`);
        }
      }
    } catch (e: any) { logger.warn('model recommendation optional:', e?.message || e); }

    // ═══ Layer 5: 意图深挖 (Goal Engine) ═══
    // 不只看用户字面说了什么, 更要分析用户真正想要什么
    // 避免"用户说做一个按钮" → AI 就只做一个按钮, 忽略了交互/样式/可访问性
    if (isComplex && !needsCommercialKeyAsk) {
      const intentHints: string[] = [];

      // 意图维度1: 目标层级 — 用户表面请求 vs 深层需求
      const surfaceGoal = messageText.slice(0, 80);
      let deepGoal = '';
      if (/做个|创建|生成|写个|build|create|make/i.test(messageText)) {
        deepGoal = '用户不仅需要产物本身, 更需要产物可用、完整、符合最佳实践';
      }
      if (/修复|解决|fix|debug|bug/i.test(messageText)) {
        deepGoal = '用户需要根因修复而非临时补丁, 修复后应验证不引入新问题';
      }
      if (/优化|改进|重构|optimize|refactor/i.test(messageText)) {
        deepGoal = '用户需要提升质量而非仅改外观, 应考虑性能/可维护性/可扩展性';
      }
      if (/分析|审查|检查|review|analyze/i.test(messageText)) {
        deepGoal = '用户需要深度洞察而非表面描述, 应给出具体建议和行动项';
      }

      // 意图维度2: 隐含约束 — 用户没说但应该做到的
      const implicitConstraints: string[] = [];
      if (/页面|组件|前端|UI|界面/i.test(messageText)) {
        implicitConstraints.push('响应式布局、CSS变量配色、无障碍访问');
      }
      if (/接口|API|后端|server/i.test(messageText)) {
        implicitConstraints.push('错误处理、输入验证、日志记录');
      }
      if (/数据库|data|存储/i.test(messageText)) {
        implicitConstraints.push('数据迁移、索引优化、备份策略');
      }
      if (/测试|test/i.test(messageText)) {
        implicitConstraints.push('边界用例、异常路径、覆盖率');
      }

      // 意图维度3: 执行路径建议
      let executionPath = '';
      if (/重构|refactor/i.test(messageText)) {
        executionPath = '建议路径: 先 read_file 理解现状 → 分析依赖关系 → 小步重构 → 验证编译 → 总结改动';
      } else if (/修复|fix|bug/i.test(messageText)) {
        executionPath = '建议路径: 先 search_content 定位问题 → read_file 理解上下文 → 修复 → 验证 → 检查同类问题';
      } else if (/新增|添加|创建|create/i.test(messageText)) {
        executionPath = '建议路径: 先 directory_tree 了解项目结构 → read_file 学习同类代码风格 → 创建 → 验证';
      } else if (/审查|review|分析/i.test(messageText)) {
        executionPath = '建议路径: 先 directory_tree 总览 → read_file 重点文件 → search_content 交叉验证 → 输出结构化报告';
      }

      if (deepGoal || implicitConstraints.length > 0 || executionPath) {
        const intentBlock = [
          `[意图深挖]`,
          deepGoal ? `深层需求: ${deepGoal}` : '',
          implicitConstraints.length > 0 ? `隐含约束: ${implicitConstraints.join('、')}` : '',
          executionPath ? executionPath : '',
          `请基于以上分析执行, 不要只做表面功夫。`,
        ].filter(Boolean).join('\n');
        this.context.appendOnlyLog.push({ role: 'system', content: intentBlock });
        this.emit('intent:analyzed', { surfaceGoal, deepGoal, implicitConstraints });
      }
    }

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
        // 已设置 workspace 时, "这个系统/这个项目" 可自动消解, 不需要追问
        const hasWorkspaceContext = !!this.opts.workspace;
        const isProjectRef = /这个系统|这个项目|这个平台|本系统|本项目/i.test(messageText);
        if (!hasWorkspaceContext || !isProjectRef) {
          this.directives.add('ambiguity', '[SYSTEM] 用户消息可能不够明确。如果不确定用户想要什么，请调用 ask_user 工具追问。', 'medium');
        }
      }
    }

    // 3. 反思门 (学 WorkBuddy, 自创触发点)
    if (this.context.appendOnlyLog.length % this.opts.reflectEvery === 0) {
      await this.reflect();
    }

    // 3. 主循环
    let lastResponse: ChatResponse | null = null;
    let autoResumeCount = 0;
    const MAX_AUTO_RESUME = 10; // 长任务友好: 慢 LLM 也给机会完成

    while (true) {
      // 长任务超时降级标志 (在循环体内声明, 跨迭代保留)
      let llmTimedOut = false;
      // ═══ 修复: 用代际检查替代 abortSignal.aborted ═══
      // 旧代码: if (this.opts.abortSignal.aborted) throw new Error('Aborted by user');
      // 问题: 默认 AbortSignal 永远不会被 abort(), 且 throw 会导致 run() 异常退出而非正常返回
      // 新逻辑: 检查 _aborted 和代际 — 被新 run() 取代时优雅退出而非 throw
      if (this._aborted || myGeneration !== this._runGeneration) {
        return { content: '[任务已中断]', provider: 'aborted', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0, cacheHit: false, source: 'estimated' as const }, iterations: this.iteration, durationMs: Date.now() - startedAt };
      }
      this.iteration++;
      this.emit('loop:iteration', { n: this.iteration });

      // ═══ Token 预警 (2026-08-03 新增) ═══
      // 在每轮开始检查上下文压力, 避免长任务跑到 token 用尽才停止
      try {
        const { contextPressure, buildWarningPrompt } = await import('./token-early-warning.js');
        const { estimateMessagesTokens } = await import('./token-utils.js');
        const allMessages = [
          ...(this.context?.immutablePrefix || []),
          ...(this.context?.appendOnlyLog || []),
        ];
        const used = allMessages.length > 0 ? await estimateMessagesTokens(allMessages) : 0;
        const max = 128000; // 默认上下文上限, 实际可从模型元数据获取
        const pressure = contextPressure({ used, max, messageCount: allMessages.length, toolCallCount: 0 });
        if (pressure.level === 'critical' || pressure.level === 'overflow') {
          // 紧急: 注入指令让 AI 立即总结
          this.directives.add('token_pressure',
            `[SYSTEM] 上下文压力 ${(pressure.pressure * 100).toFixed(0)}% (${pressure.label}). ${pressure.advice}. 必须立即生成本轮总结, 列出已完成工作和待办项, 不要再调用工具。`,
            'high');
          this.emit('token:pressure', { pressure: pressure.pressure, level: pressure.level });
        } else if (pressure.level === 'warning') {
          // 警告: 提醒 AI 注意
          this.directives.add('token_pressure', buildWarningPrompt(pressure), 'medium');
          this.emit('token:pressure', { pressure: pressure.pressure, level: pressure.level });
        }
      } catch (e: any) {
        // 预警失败不影响主循环
      }

      // ═══ v3.1 死循环硬停执行: 上轮检测到死循环, 注入 SYSTEM 后立即退出 ═══
      if (this._hardStopNext) {
        logger.info(`🛑 硬停触发: 在 iteration ${this.iteration} 退出循环 (避免 AI 死循环)`);
        this._hardStopNext = false;
        this.directives.add('dead_loop_done', '[SYSTEM] 已根据死循环保护策略终止循环。请直接给出最终回答。', 'high');
        // 不再 continue, 走完当前轮后正常结束
      }

      // ═══ 2026-06-24 新增: 透明进度推送 ═══
      // 每轮迭代发射进度事件
      const progressPercent = Math.min(100, Math.round((this.iteration / this.opts.maxIterations) * 100));
      this.emit('progress', {
        step: 'iteration',
        description: `正在思考第 ${this.iteration} 轮...`,
        percent: progressPercent,
        iteration: this.iteration,
        maxIterations: this.opts.maxIterations,
        elapsedTimeMs: Date.now() - startedAt
      });

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
          // 修复: 先删除旧的工作记忆, 再注入新的 (避免无限膨胀)
          const oldWmIdx = this.context.appendOnlyLog.findIndex(m =>
            m.role === 'system' && typeof m.content === 'string' && m.content.startsWith('[工作记忆')
          );
          if (oldWmIdx >= 0) {
            this.context.appendOnlyLog.splice(oldWmIdx, 1);
          }
          this.context.appendOnlyLog.unshift({
            role: 'system', content: summary,
          });
          logger.info(`[working-memory] injected summary at iteration ${this.iteration}`);
        } catch { /* working memory optional */ }
      }

      // ═══ 主动记忆更新 (2026-08-03 新增) ═══
      // 每 5 轮自动检查: 是否有值得持久化的发现/决策/教训
      if (this.iteration > 0 && this.iteration % 5 === 0) {
        try {
          const { rememberBatch } = await import('./self-memory-updater.js');
          const candidates: any[] = [];

          // 1. 提取已完成的工具调用 (可能包含 bug 修复)
          const toolMessages = this.context.appendOnlyLog
            .filter(m => m.role === 'tool' && (m as any).name);
          const fixTools = toolMessages.filter(m => {
            const content = String((m as any).content || '');
            return /修复|fixed|resolve|error|bug/i.test(content);
          });
          for (const t of fixTools.slice(-3)) {
            const content = String((t as any).content || '').slice(0, 200);
            candidates.push({
              category: 'bug_fix',
              title: `修复: ${(t as any).name}`,
              entityId: `bug:${(t as any).name}:${content.slice(0, 30)}`,
              importance: 4,
              tags: ['auto-captured', 'bug-fix'],
              sourceTool: (t as any).name,
              content: `工具 ${(t as any).name} 修复内容: ${content}`,
            });
          }

          // 2. 提取用户关键指令 (可能包含偏好)
          const userMsgs = this.context.appendOnlyLog
            .filter(m => m.role === 'user' && typeof m.content === 'string')
            .map(m => (m as any).content as string)
            .filter(c => c.length > 20 && c.length < 200);
          for (const u of userMsgs.slice(-2)) {
            // 简单启发: 包含 "不要/必须/总是/永远" 等强指令词
            if (/不要|必须|总是|永远|禁止|务必|一定要/.test(u)) {
              candidates.push({
                category: 'user_preference',
                title: `偏好: ${u.slice(0, 40)}`,
                entityId: `pref:${u.slice(0, 30)}`,
                importance: 4,
                tags: ['auto-captured', 'preference'],
                content: `用户指令: ${u}`,
              });
            }
          }

          // 3. 批量写入
          if (candidates.length > 0) {
            const workspace = this.opts.workspace || process.cwd();
            const result = await rememberBatch(workspace, candidates);
            if (result.written > 0) {
              logger.info(`[self-memory] 自动写入 ${result.written} 条记忆 (跳过 ${result.skipped})`);
              this.emit('memory:auto-captured', { written: result.written, skipped: result.skipped });
            }
          }
        } catch (e: any) {
          // 主动记忆失败不影响主循环
          logger.warn?.(`[self-memory] failed: ${e.message}`);
        }
      }

      // 智能超时: 有工具活动时重置, 只在长时间无活动或绝对上限时退出
      const idleTime = Date.now() - lastToolActivityAt;
      const totalTime = Date.now() - startedAt;
      if (idleTime > IDLE_TIMEOUT_MS || totalTime > ABSOLUTE_MAX_MS) {
        const reason = totalTime > ABSOLUTE_MAX_MS ? '60分钟绝对上限' : '10分钟无工具活动';
        // 不强制结束 — 让 AI 自己决定是总结还是继续
        this.directives.add('timeout', `[SYSTEM] 已运行 ${Math.round(totalTime / 60000)} 分钟 (${reason})。如果长任务仍在执行中, 请检查进度后继续; 如果确实无法继续, 请总结当前进展。`, 'high');
        // ═══ 2026-07-15: 超时前强制持久化 task-snapshot (供跨会话恢复) ═══
        if (taskSnap) {
          try {
            taskSnap.setResumeHints({
              nextAction: this.directives.get('timeout') || '需要继续或总结',
              warnings: ['任务超时中断, 恢复时需要评估当前进度'],
            });
            taskSnap?.flush(); // 强制同步写盘
            taskSnap?.appendLog('warn', 'timeout-reached', { reason, iteration: this.iteration, totalMs: totalTime });
          } catch (e) { /* best-effort */ }
        }
        // 再给 2 轮机会让 AI 决定
        if (this.iteration > this.opts.maxIterations - 2) break;
      }

      // 检查是否被中断 — 同时检查代际: 如果被新 run() 取代也要退出
      if (this._aborted || myGeneration !== this._runGeneration) {
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
              this.context.appendOnlyLog.splice(-1, 0, { role: 'system', content: `[pre-read] 📁 目录结构:\n${r.output}` });
            }
          } catch (e: any) { logger.warn('[pre-read] list_directory failed:', e?.message); }
        }
        const readMatch = userText.match(/^(读|查看|读取|cat|read)\s+(.+)/i);
        if (readMatch?.[2]) {
          try {
            const r = await this.registry.executeOne({ id: 'pre_read', name: 'read_file', args: { file_path: readMatch[2].trim() } }, ctx);
            if (r?.success) {
              this.context.appendOnlyLog.splice(-1, 0, { role: 'system', content: `[pre-read] 📄 文件内容:\n${r.output}` });
            }
          } catch (e: any) { console.warn('[pre-read] read_file failed:', e?.message); }
        }
      }

      // 3.1 构造 LLM 请求 (immutable prefix + append-only log)
      let messages: ChatMessage[] = [
        ...this.context.immutablePrefix,
        ...this.context.appendOnlyLog,
      ];

      // P0-1.3: 合并连续 [SYSTEM] 注入, 避免多条指令冲突 (弱模型容易迷失)
      messages = consolidateSystemInjections(messages);

      // 消毒: 确保每个 tool 消息前有对应的 assistant(tool_calls), 防止 DeepSeek/OpenAI 400 错误
      messages = sanitizeToolMessages(messages);

      // ═══ 刷新系统指令管理器: 每轮只保留优先级最高的 1 条 [SYSTEM] 指令 ═══
      const topDirective = this.directives.flush();
      if (topDirective) {
        messages.push({ role: 'user', content: topDirective });
      }
      this.directives.clear(); // 清空剩余的低优先级指令

      // 3.1.1 对话历史智能压缩: 结构化摘要 (保留 system + 最近 10 条)
       // 基于 token 估算触发压缩 (根据模型上下文窗口动态调整阈值)
       const estimatedTokens = messages.reduce((sum: number, m) =>
         sum + (typeof m.content === 'string' ? m.content.length / 4 : 0), 0);
       const MAX_TOKENS_EST = (this as any)._contextCompressThreshold || 50_000;
      const MAX_MSGS = 30;
      if (estimatedTokens > MAX_TOKENS_EST || messages.length > MAX_MSGS) {
        const systemMsgs = messages.filter(m => m.role === 'system');
        const nonSystem = messages.filter(m => m.role !== 'system');
        const keepRecent = 10;
        const recent = nonSystem.slice(-keepRecent);
        const old = nonSystem.slice(0, -keepRecent);

        if (old.length > 0) {
          // 结构化压缩: 按类别提取关键信息
          const userRequests: string[] = [];
          const aiActions: string[] = [];
          const filesModified = new Set<string>();
          const errorsHit: string[] = [];
          let toolSuccessCount = 0;

          for (const m of old) {
            const text = typeof m.content === 'string'
              ? m.content
              : JSON.stringify(m.content);

            if (m.role === 'user') {
              userRequests.push(text.slice(0, 200));
            } else if (m.role === 'assistant') {
              const brief = text.slice(0, 150).replace(/\n+/g, ' ').trim();
              if (brief) aiActions.push(brief);
            } else if (m.role === 'tool') {
              const toolName = (m as any).name || 'tool';
              const isError = text.startsWith('[ERROR]');
              // 提取文件路径
              const pathMatch = text.match(/(?:file_path|path|文件)['":\s]*([A-Za-z]:[\\\/][^\s'")\],]+|[^\s'")\],]+\.\w{1,5})/);
              if (pathMatch?.[1]) filesModified.add(pathMatch[1]);
              if (isError) {
                errorsHit.push(`${toolName}: ${text.slice(8, 100)}`);
              } else {
                toolSuccessCount++;
              }
            }
          }

          const parts: string[] = [];
          if (userRequests.length > 0) {
            parts.push(`## 用户请求\n${userRequests.map((r, i) => `${i + 1}. ${r}`).join('\n')}`);
          }
          if (aiActions.length > 0) {
            const unique = [...new Set(aiActions)].slice(-5);
            parts.push(`## AI 关键操作\n${unique.map(a => `- ${a}`).join('\n')}`);
          }
          if (filesModified.size > 0) {
            parts.push(`## 涉及文件\n${[...filesModified].slice(0, 15).join(', ')}`);
          }
          if (errorsHit.length > 0) {
            parts.push(`## 错误记录\n${errorsHit.slice(-5).map(e => `- ${e}`).join('\n')}`);
          }
          if (toolSuccessCount > 0) {
            parts.push(`工具调用: ${toolSuccessCount} 次成功${errorsHit.length > 0 ? `, ${errorsHit.length} 次失败` : ''}`);
          }

          const summary = parts.join('\n\n');
          const summaryContent = `# 对话历史摘要 (${old.length} 条消息已压缩)\n${summary.slice(0, 4000)}`;
          messages = [
            ...systemMsgs,
            { role: 'system' as const, content: summaryContent },
            ...recent,
          ];
          // ═══ 2026-06-27 修复: 压缩结果同步到 appendOnlyLog ═══
          // 之前只影响本次发送的 messages, 不写回 log,
          // 导致换模型/新session后旧消息全部再次出现
          const newLog = [...messages.filter(m => m.role !== 'system')];
          if (newLog.length > 0) {
            this.context.appendOnlyLog = newLog;
          }
          console.log(`[history-compress] ${systemMsgs.length + nonSystem.length} → ${messages.length} msgs (users:${userRequests.length} tools:${toolSuccessCount}+${errorsHit.length}err files:${filesModified.size})`);
        }
      }

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

      // 计算工具列表: 根据模式 + 消息意图智能过滤 (减少工具数量提升准确率)
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
        } else if (this._capabilityTier === 'autonomous') {
          // 自主模型: 给全部工具, 信任它自己选 — 不过滤
          requestTools = allTools;
          console.log(`[tools] autonomous tier → ${requestTools.length} tools (全量, 无过滤)`);
        } else {
          // 智能工具过滤: 根据消息意图只给AI相关工具 (减少噪音, 提升准确率)
          requestTools = this.filterToolsByIntent(messageText, allTools);
          // 叠加 tool-groups 按需过滤: 根据任务类型只保留相关工具组
          const relevantToolNames = new Set(getRelevantTools(this._taskType, this._userIndustry, this.registry));
          // 始终保留核心工具 (ask_user, plan_task 等决策工具任何任务都需要)
          const CORE_ALWAYS = new Set(['ask_user', 'plan_task', 'update_plan', 'remember', 'recall_memory', 'evolve_prompt', 'create_tool', 'spawn_subagent', 'explore_project', 'generate_image', 'generate_video', 'query_video', 'generate_diagram', 'discover_or_create_skill', 'skill_forge', 'capture_screen', 'capture_and_read', 'ocr_image', 'list_windows', 'window_control']);
          const beforeGroup = requestTools.length;
          requestTools = requestTools.filter((t: any) => {
            const name = t.name || t.function?.name || '';
            return relevantToolNames.has(name) || CORE_ALWAYS.has(name);
          });
          // 安全兜底: 过滤后太少就恢复
          if (requestTools.length < 8) requestTools = this.filterToolsByIntent(messageText, allTools);
          console.log(`[tools-group] taskType=${this._taskType} filtered ${beforeGroup} → ${requestTools.length} tools`);
        }
      }

      // ═══ 长任务超时降级: 上一轮超时后, 减少工具数+压缩上下文, 避免再次超时 ═══
      if (llmTimedOut) {
        console.warn(`[loop] timeout degradation: reducing tools ${requestTools.length} → 8, compressing context`);
        const coreToolNames = ['read_file', 'write_file', 'list_directory', 'search_content', 'ask_user', 'run_code', 'directory_tree', 'web_search'];
        requestTools = requestTools.filter((t: any) => coreToolNames.includes(t.name || t.function?.name || ''));
        // 激进压缩上下文: 只保留最近 6 条 + system, 然后重新消毒避免切断 assistant→tool 配对
        if (messages.length > 12) {
          const systemMsgs = messages.filter(m => m.role === 'system');
          const nonSystem = messages.filter(m => m.role !== 'system');
          messages = sanitizeToolMessages([...systemMsgs, ...nonSystem.slice(-6)]);
        }
        llmTimedOut = false; // 重置标志
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
        abortSignal: this.opts.abortSignal, // 用户中断信号传给 router → fetch
        onDelta: this._createThrottledOnDelta(),
        onThinking: (delta: string) => {
          // 推理内容直接通过专用回调发送, 不再污染 onDelta
          this.emit('llm:thinking', { text: delta });
        },
      };

      // 视觉代理调用: 如果当前模型不支持视觉但有图片待处理，先调用视觉模型分析
      if ((this as any)._pendingVisionAnalysis) {
        const visionAnalysis = (this as any)._pendingVisionAnalysis;
        console.log(`[vision-proxy] calling ${visionAnalysis.visionProvider}:${visionAnalysis.visionModel} to analyze images`);
        
        try {
          // 调用视觉模型分析图片
          const visionMessages: ChatMessage[] = [
            { role: 'system', content: '你是一个视觉分析助手。请详细描述图片内容，包括物体、文字、场景、颜色等所有可见信息。用中文回答。' },
            ...visionAnalysis.images.map((img: { content: string }) => ({
              role: 'user' as const,
              content: img.content,
            })),
          ];

          const visionRes = await this.router.chat({
            model: visionAnalysis.visionProvider as ProviderId,
            subModel: visionAnalysis.visionModel,
            messages: visionMessages,
            tools: [],
            userId: this.opts.userId,
            workspace: this.opts.workspace,
            stream: false,
          });

          const visionResult = visionRes?.content || '[视觉分析失败]';
          console.log(`[vision-proxy] analysis result: ${visionResult.slice(0, 200)}...`);

          // 将分析结果注入到消息列表开头，作为图片描述
          messages.unshift({
            role: 'system',
            content: `[视觉分析结果]\n${visionResult}\n\n---\n\n请根据以上视觉分析结果回答用户问题。`,
          });

          // 清除待处理标记
          (this as any)._pendingVisionAnalysis = null;
        } catch (e: any) {
          console.error(`[vision-proxy] analysis failed: ${e?.message}`);
          // 分析失败，降级为文字描述
          messages.unshift({
            role: 'system',
            content: `[视觉分析失败]\n系统尝试调用视觉模型分析图片但失败了。请根据用户提供的文字描述回答。`,
          });
          (this as any)._pendingVisionAnalysis = null;
        }
      }

// 3.2 调 LLM
    console.log('[run:chat] calling router.chat, model=', req.model, 'subModel=', req.subModel);
    
    // Hook: PreModelCall - 检查是否允许调用模型
    const inputText = messages.map(m => 
      typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    ).join('\n');
    const modelCtx: ToolContext = {
      userId: this.opts.userId,
      workspace: this.opts.workspace,
      abortSignal: this.opts.abortSignal,
      priorMessages: this.context.appendOnlyLog.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      }))
    };
    
    // 确保 hookSessionId 在第一次 LLM 调用前就初始化
    if (!this.hookSessionId) {
      this.hookSessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        await hookCapture.onSessionStart(this.opts.userId, this.opts.workspace, modelCtx, this.hookSessionId);
      } catch { /* hook optional */ }
    }
    
    const canProceedModel = await hookCapture.onPreModelCall(
      this.hookSessionId,
      req.model || 'unknown',
      inputText,
      modelCtx
    );
    if (!canProceedModel) {
      throw new Error('Model call blocked by lifecycle hooks');
    }
    
    let res: any;
    try {
      res = await this.router.chat(req);
    } catch (llmErr: any) {
      // ═══ 长任务保护: router.chat 异常不应崩溃整个循环 ═══
      const errMsg = llmErr?.message?.toLowerCase() || '';
      console.error(`[loop] router.chat threw (iter=${this.iteration}): ${llmErr?.message?.slice(0, 120)}`);

      if (errMsg.includes('timeout') || errMsg.includes('abort')) {
        llmTimedOut = true;
         this.directives.add('llm_timeout', '[SYSTEM] 上一轮模型调用超时。请简化你的方案: 1) 减少要处理的文件数量 2) 拆分为更小的步骤 3) 先完成核心部分', 'high');
        // 跳过本轮, 下一轮重试 (上下文已被上面压缩逻辑处理)
        if (this.iteration < this.opts.maxIterations - 1) continue;
      }

      // 非超时异常: 返回错误响应而非崩溃
      return {
        content: `处理过程中遇到技术问题: ${llmErr?.message?.slice(0, 100) || '未知错误'}。请重试或换一种方式描述需求。`,
        provider: 'none' as any,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0, cacheHit: false, source: 'estimated' as const },
        iterations: this.iteration,
        durationMs: Date.now() - startedAt,
      };
    }

    // Hook: PostModelCall - 通知模型调用完成
    try {
      await hookCapture.onPostModelCall(
        this.hookSessionId,
        req.model || 'unknown',
        inputText,
        res?.content || '',
        modelCtx
      );
    } catch { /* hook optional */ }
      console.log('[run:chat] router.chat returned, provider=', res?.provider, 'contentLen=', res?.content?.length);

      // ═══ 终极重试链: flash 空 → Pro → 最小工具 → 无工具 → 放弃 ═══
      // 对标 WorkBuddy: 任何模型都可能在复杂场景下空返, 但系统不应中断任务
      if (!res || (typeof res.content === 'string' && res.content.trim() === '' && res.provider !== 'none')) {
        console.warn(`[loop] ⚠️ Empty LLM response (provider=${res?.provider}, iter=${this.iteration}), starting rescue chain...`);
        
        // 辅助函数: 从 appendOnlyLog 重建并消毒消息
        const rebuildMessages = (): ChatMessage[] => {
          let msgs: ChatMessage[] = [
            ...this.context.immutablePrefix,
            ...this.context.appendOnlyLog,
          ];
          msgs = consolidateSystemInjections(msgs);
          msgs = sanitizeToolMessages(msgs);
          return msgs;
        };
        
        // Level 1: 同模型 + SYSTEM 提示重试 (重建消息, 不复用旧 req)
        this.directives.add('empty_response', '[SYSTEM] 上一轮回复为空，请重新回复。', 'high');
        req.messages = rebuildMessages();
        let retryRes = await this.router.chat(req);
        if (retryRes?.content?.trim() && retryRes.provider !== 'none') {
          console.log(`[loop] ✓ L1 rescue (same model)`);
          lastResponse = retryRes; continue;
        }

        // Level 2: 切 deepseek-v4-pro (重建消息)
        if (this.opts.model === 'deepseek' && this.opts.modelName !== 'deepseek-v4-pro') {
          console.warn(`[loop] L2 rescue: deepseek-v4-pro`);
          const orig = this.opts.modelName;
          this.opts.modelName = 'deepseek-v4-pro';
          req.model = this.opts.model as any;
          req.subModel = 'deepseek-v4-pro';
          req.messages = rebuildMessages();
          retryRes = await this.router.chat(req);
          this.opts.modelName = orig;
          if (retryRes?.content?.trim() && retryRes.provider !== 'none') {
            console.log(`[loop] ✓ L2 rescue (pro)`);
            lastResponse = retryRes; continue;
          }
        }

        // Level 3: 最小工具集 (只发核心 8 工具 — 任何模型都能处理)
        if (req.tools && req.tools.length > 8) {
          console.warn(`[loop] L3 rescue: min tools (${req.tools.length} → 8)`);
          const coreNames = ['read_file','write_file','list_directory','search_content','ask_user','run_code','directory_tree','web_search'];
          const origTools = req.tools;
          req.tools = origTools.filter(t => coreNames.includes(t.name));
          req.messages = rebuildMessages();
          retryRes = await this.router.chat(req);
          req.tools = origTools;
          if (retryRes?.content?.trim() && retryRes.provider !== 'none') {
            console.log(`[loop] ✓ L3 rescue (min tools)`);
            lastResponse = retryRes; continue;
          }
        }

        // Level 4: 无工具 + 只保留最近 4 条消息 (纯文字对话 — 任何模型都必然能回复)
        if (req.tools && req.tools.length > 0) {
          console.warn(`[loop] L4 rescue: no tools + min context`);
          const origTools = req.tools;
          req.tools = undefined;
          // L4 终极方案: 只保留 system + 最近 4 条消息, 彻底避免消息格式问题
          const sysMsgs = this.context.immutablePrefix;
          const recentLogs = this.context.appendOnlyLog.slice(-4);
          req.messages = sanitizeToolMessages([...sysMsgs, ...recentLogs]);
          retryRes = await this.router.chat(req);
          req.tools = origTools;
          if (retryRes?.content?.trim() && retryRes.provider !== 'none') {
            console.log(`[loop] ✓ L4 rescue (no tools)`);
            lastResponse = retryRes; continue;
          }
        }

        console.warn(`[loop] ✗ All rescue levels exhausted`);
        return {
          content: '当前 AI 模型暂时繁忙，请稍后再试。如果问题持续，请前往设置页检查 API Key 配置。',
          provider: 'none' as any,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0, cacheHit: false, source: 'estimated' as const },
          iterations: this.iteration,
          durationMs: Date.now() - startedAt,
        };
      }

      // 🎯 智能模型切换: 检测连续熔断，自动切换模型
      // 路由器内部正常降级 (如 deepseek→agentai 成功响应) 不算熔断
      if (res?.provider === 'none') {
        this.trippedCount++;
        console.log(`[smart-switch] 全部 provider 不可用, 熔断计数: ${this.trippedCount}/3`);
        
        // 快速切换: 一旦检测到连续失败就立即切换, 不等3次
        // 同时清除已切换记录, 让切换后的模型有干净的状态
        const now = Date.now();
        const inCooldown = now - this._lastSwitchTime < 30_000; // 30秒冷却 (从60s减半)
        
        if (inCooldown) {
          console.log(`[smart-switch] ⏳ 冷却中, 跳过`);
          this._switchedProviders.add(this.opts.model);
          // 直接返回错误, 不重试
          return { content: `[SYSTEM] 当前模型暂时无法连接，请稍后再试。`, provider: 'none' as any, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0, cacheHit: false, source: 'estimated' as const }, iterations: this.iteration, durationMs: Date.now() - startedAt };
        }
        
        // 尝试智能切换
        const switcher = await this._getSmartSwitcher();
        const decision = switcher.analyzeSwitchNeed(
          String(req.model),
          { isLimited: true, waitTime: 0, remainingRequests: 0 },
          'medium' as any,
          'medium' as any,
        );
        if (decision.shouldSwitch && decision.hasApiKey) {
          // 去重: 如果目标 provider 已经尝试过且失败了, 不再切换
          if (this._switchedProviders.has(decision.targetProvider)) {
            console.log(`[smart-switch] ⛔ ${decision.targetProvider} 已尝试过, 不再重复切换`);
            this._switchedProviders.add(this.opts.model);
            return { content: `[SYSTEM] 所有配置的模型暂时无法连接，请检查 API Key 和网络连接。`, provider: 'none' as any, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0, cacheHit: false, source: 'estimated' as const }, iterations: this.iteration, durationMs: Date.now() - startedAt };
          }

          console.log(`[smart-switch] ✅ 自动切换: ${req.model} → ${decision.targetProvider}`);
          // 避免切到相同的 provider
          if (decision.targetProvider === req.model) {
            console.log(`[smart-switch] ⚠️ 目标 provider 与当前相同, 跳过切换`);
            this.trippedCount = 0;
          } else {
            this._switchedProviders.add(this.opts.model);
            this._lastSwitchTime = now;
            this.opts.model = decision.targetProvider;
            const switchModelMap: Record<string, string> = {
              superapi: 'deepseek-v4-flash',
              deepseek: 'deepseek-v4-flash',
              openai: 'gpt-4o-mini',
              zhipu: 'glm-4.7-flash',
            };
            this.opts.modelName = switchModelMap[decision.targetProvider] || 'deepseek-v4-flash';
            this.emit('model:auto-switched', { from: req.model, to: decision.targetProvider, reason: '当前模型全部不可用，自动切换' });
            this.trippedCount = 0;
            // 立即重试, 不要等到下一轮迭代
            continue;
          }
        } else if (decision.shouldSwitch && !decision.hasApiKey) {
          console.log(`[smart-switch] ⚠️ 需要商用 API 密钥: ${decision.targetProvider}, 提示用户`);
          this.emit('model:need-api-key', { provider: decision.targetProvider, estimatedCost: decision.estimatedCost });
        }
      } else if (res?.provider) {
        // 任何有效响应 (即使是降级到其他 provider) 都重置计数 + 切换记录
        this.trippedCount = 0;
        this._switchedProviders.clear();
        this._lastSwitchTime = 0;
      }
      lastResponse = res;

      // 🔧 修复: LLM 纯文本回复也更新 supervisor 活动时间 (原来只在工具调用后更新)
      // 防止免费模型多轮纯文本回复累积 idleDuration > 60s 误判 timeout → 死循环
      supervisor.updateActivity();

      // ═══ AI回复拦截: 禁止向用户暴露内部错误信息 ═══
      const FORBIDDEN_PATTERNS = /所有.*模型.*不可用|模型.*暂时不可用|all.*models.*unavailable|no.*provider|API.*不可用|服务.*不可用/i;
      if (res?.content && FORBIDDEN_PATTERNS.test(res.content) && this.iteration < this.opts.maxIterations - 1) {
        console.warn(`[self-repair] intercepted forbidden response: "${String(res.content).slice(0, 80)}"`);
        this.directives.add('forbidden_response', `[SYSTEM] 你的回复包含了不应暴露的内部错误信息。请不要说"模型不可用"之类的话。换一种方式完成用户请求: 1) 生成文件失败→用write_file写CSV/Markdown 2) 路径错误→先list_directory 3) 确实无法完成→诚实告诉用户具体原因和替代建议`, 'high');
        continue; // 重新执行一轮, 让 AI 自修复
      }

      // 3.3 写 append-only log (assistant 消息 — 必须包含 tool_calls!)
      // OpenAI 兼容协议: 多轮工具调用需要 assistant 消息包含 tool_calls 字段
      // 否则 LLM 在下一轮看不到自己调用了什么工具, 导致上下文断裂
      // ═══ 2026-06-27 修复: 过滤掉失败/空响应, 不让异常占用上下文 ═══
      const hasContent = res?.content && res.content.trim().length > 0;
      const hasTools = res?.toolCalls && res.toolCalls.length > 0;
      const isEmptyFailure = !hasContent && !hasTools;
      if (isEmptyFailure) {
        console.warn(`[context] 跳过写入空/失败 assistant 消息 (iter=${this.iteration})`);
      } else {
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
        if (res.toolCalls && res.toolCalls.length > 0) {
          this.emit('reasoning', { text: '' });
        }
      }

      // 3.4 处理 tool calls
      if (res.toolCalls && res.toolCalls.length > 0) {
        // ═══ 工具调用修复循环 (学 Reasonix 4-pass repair) ═══
        // Pass 1: 截断 JSON 修复 (args 被 max_tokens 截断)
        for (const tc of res.toolCalls) {
          if (typeof tc.args === 'string') {
            try { tc.args = JSON.parse(tc.args); } catch {
              // 尝试修复截断的 JSON: 补齐未闭合的括号
              let fixed = String(tc.args);
              const opens = (fixed.match(/\{/g) || []).length;
              const closes = (fixed.match(/\}/g) || []).length;
              if (opens > closes) fixed += '}'.repeat(opens - closes);
              const openBrackets = (fixed.match(/\[/g) || []).length;
              const closeBrackets = (fixed.match(/\]/g) || []).length;
              if (openBrackets > closeBrackets) fixed += ']'.repeat(openBrackets - closeBrackets);
              try { tc.args = JSON.parse(fixed) as Record<string, any>; console.log(`[tool-repair] fixed truncated JSON for ${tc.name}`); }
              catch { tc.args = {}; console.warn(`[tool-repair] unfixable JSON for ${tc.name}, using empty args`); }
            }
          }
        }
        // Pass 2: 去重 (同名+同参数的重复调用 — storm 抑制)
        const seen = new Set<string>();
        const deduped: typeof res.toolCalls = [];
        for (const tc of res.toolCalls) {
          const key = `${tc.name}:${JSON.stringify(tc.args).slice(0, 500)}`;
          if (seen.has(key)) {
            console.log(`[tool-repair] suppressed duplicate: ${tc.name}`);
            continue;
          }
          seen.add(key);
          deduped.push(tc);
        }
        if (deduped.length < res.toolCalls.length) {
          console.log(`[tool-repair] storm suppression: ${res.toolCalls.length} → ${deduped.length}`);
          res.toolCalls = deduped;
        }
        // 任务链推进: 有工具调用 = 进入执行阶段
        if (taskChain) {
          try {
            if (taskChain.state?.currentStage === 'plan') {
              taskChain.advance('solve', { output: '开始执行工具调用' });
              this.emit('plan:stage', { chainId: taskChain.chainId, stage: 'solve', status: 'running' });
            }
          } catch (e: any) { console.warn('[loop] TaskChain advance optional:', e?.message || e); }
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
              // ✅ P0: 并发限制 — 超过 MAX_SUBAGENTS 时排队等待, 防止无限扩张
              if (this._subAgentCount >= AgentAILoop.MAX_SUBAGENTS) {
                console.warn(`[subagent] 并发上限 ${AgentAILoop.MAX_SUBAGENTS}, 拒绝 spawn (当前 ${this._subAgentCount}/${AgentAILoop.MAX_SUBAGENTS})`);
                this.emit('subagent:rejected', { reason: 'concurrency_limit', count: this._subAgentCount, max: AgentAILoop.MAX_SUBAGENTS });
                continue; // 跳过此 spawn, 主循环继续
              }
              const subId = `${tc.args?.type || 'sub'}-${Date.now()}`;
              this.emit('subagent:start', { id: subId, type: tc.args?.type, task: tc.args?.task }); // 前端可见
              this._subAgentCount++;
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
                    content: `[子Agent ${tc.args?.type || 'explore'}]: ${(subResult.content || '无结果').slice(0, 2000)}`,
                  });
                } catch (e: any) {
                  this.emit('subagent:error', { id: subId, error: e.message });
                  this.context.appendOnlyLog.push({
                    role: 'tool', name: 'spawn_subagent', tool_call_id: tc.id,
                    content: `[子Agent 失败]: ${e.message}`,
                  });
                } finally {
                  this._subAgentCount--;
                }
              })();
            }
          }
        }
        // ═══ 2026-06-24 新增: 透明进度推送 ═══
        // 工具调用开始前发射进度事件
        this.emit('progress', {
          step: 'tool_start',
          description: `正在调用 ${res.toolCalls.length} 个工具...`,
          percent: Math.min(100, Math.round((this.iteration / this.opts.maxIterations) * 100 + 20)),
          toolCount: res.toolCalls.length,
          toolNames: res.toolCalls.map((tc: any) => tc.name).join(', ')
        });
        
        const rawResults = await this.dispatchToolCalls(res.toolCalls);
        lastToolActivityAt = Date.now(); // 工具执行完成, 重置超时计时器

        // ═══ 任务自监督: 更新活动时间 + 记录文件变更 ═══
        supervisor.updateActivity();
        for (const r of rawResults) {
          if (r.name === 'write_file' || r.name === 'multi_edit') {
            supervisor.parseFileChangeFromResult(r.name, r.output || '');
          }
          const tc = res.toolCalls?.find((t: any) => t.id === r.id);
          if (tc?.args?.file_path || tc?.args?.path) {
            supervisor.recordFileChange(tc.args.file_path || tc.args.path);
          }
        }
        this.emit('supervisor:update', {
          timer: supervisor.getTimerState(),
          fileChanges: supervisor.getFileChangeSummary(),
          health: supervisor.checkHealth(),
        });

        // ═══ 2026-07-15: 用量统计 (工具调用记录) ═══
        try {
          for (const r of rawResults) {
            recordCall(this.opts.workspace || process.cwd(), {
              timestamp: Date.now(),
              tool: r.name,
              success: !!(r.output && !r.output.startsWith('Error:')),  // v3.2 修复: 显式 boolean
              durationMs: 0,
              userId: this.opts.userId,
            });
          }
        } catch { /* 不影响主流程 */ }

        // ═══ 2026-07-15: 更新 task-snapshot (工具调用进度) ═══
        if (taskSnap) {
          try {
            for (const r of rawResults) {
              const tc = res.toolCalls?.find((t: any) => t.id === r.id);
              const isOk = r.output && !r.output.startsWith('Error:') && !r.output.startsWith('[ERROR]');
              taskSnap.completeStep(
                `${r.name}#${(tc?.id || '').slice(-4)}`,
                isOk ? 'success' : (r.output?.slice(0, 100) || 'failed'),
                [r.name],
              );
              if (!isOk) taskSnap.recordError(r.name, r.output?.slice(0, 300) || 'unknown error');
              // 记录文件接触
              const args = tc?.args || {};
              if (args.file_path || args.path) {
                taskSnap.recordFileTouch(args.file_path || args.path, 'modified');
              }
            }
            taskSnap.bumpIteration();
          } catch (e) { /* best-effort */ }
        }
        
        // ═══ 2026-06-24 新增: 透明进度推送 ═══
        // 工具调用完成后发射进度事件
        this.emit('progress', {
          step: 'tool_done',
          description: `工具调用完成，正在处理结果...`,
          percent: Math.min(100, Math.round((this.iteration / this.opts.maxIterations) * 100 + 40)),
          toolCount: res.toolCalls.length,
          successCount: rawResults.filter(r => r.output && !r.output.startsWith('Error:')).length,
          failCount: rawResults.filter(r => r.output && r.output.startsWith('Error:')).length
        });

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
          // ═══ 修复: 统一失败检测 — 不只看 'Error:' 前缀, 还看空输出/null/JSON错误 ═══
          const isToolFailed = !r.output
            || r.output.startsWith('Error:')
            || r.output.startsWith('[ERROR]')
            || (r as any).success === false
            || (r.output.length < 5 && /err|fail|null|undef/i.test(r.output));
          // 标记失败的工具结果, 让 AI 明确知道
          const toolContent = isToolFailed && r.output
            ? `[ERROR] ${r.output}`
            : isToolFailed && !r.output
              ? '[ERROR] 工具执行返回空结果, 可能失败了'
              : r.output;
          if (!isToolFailed) {
            // 成功 → 重置
            duplicateTracker.delete(sig);
          } else {
            duplicateTracker.set(sig, failCount + 1);
          }
          this.context.appendOnlyLog.push({
            role: 'tool',
            name: r.name,
            tool_call_id: r.id,
            content: toolContent,
          });

          // 🔧 修复: 工具返回截图 (imageBase64) 时, 注入多模态消息让 AI 能"看到"图片
          // 原来只传文本 "✅ 截图完成", AI 看不到实际页面内容, 导致"打开了网页但说没看到"
          const _imgB64 = (r as any).data?.imageBase64;
          if (_imgB64 && !isToolFailed) {
            const _model = (this.opts.model || '').toLowerCase();
            const _supportsVision = ['glm-4v', 'gpt-4o', 'gpt-4-vision', 'gpt-4-turbo',
              'claude-3', 'claude-sonnet', 'claude-opus', 'claude-haiku',
              'gemini', 'qwen-vl', 'qwen2-vl', 'internvl', 'minicpm-v',
              'yi-vl', 'deepseek-vl', 'llava', 'agnes'].some(kw => _model.includes(kw));
            if (_supportsVision) {
              // 模型支持视觉: 注入 user 消息包含 image_url (tool 消息 content 只能是字符串)
              this.context.appendOnlyLog.push({
                role: 'user',
                content: [
                  { type: 'text', text: `[系统注入] ${r.name} 截图如下, 请基于截图内容继续操作:` },
                  { type: 'image_url', image_url: { url: `data:image/png;base64,${_imgB64}` } },
                ],
              });
            } else {
              // 模型不支持视觉: 提示 AI 使用 browser_extract 提取文本
              this.context.appendOnlyLog.push({
                role: 'user',
                content: `[系统注入] ${r.name} 已截图但当前模型不支持视觉理解。请使用 browser_extract 提取页面文本内容代替截图。`,
              });
            }
          }
          this.emit('log:appended', { role: 'tool', content: r.output });
          this.emit('tool:result', { callId: r.id, name: r.name, result: r.output, ok: !(r.output && r.output.startsWith('Error:')), durationMs: 0 }); // 前端可监听

          // ═══ v3.1 实时会话摘要: 关键工具产生内容后, 立即更新 last-session.json ═══
          // 解决 "第二轮 AI 不记得上轮做了什么" 问题
          // 触发场景: generate_image / file_write / create_chart / send_message 等
          if (!isToolFailed) {
            const contentProducingTools = new Set([
              'generate_image', 'file_write', 'edit_file', 'create_file',
              'create_chart', 'write_file', 'write_text_file', 'append_file',
              'send_email', 'create_presentation', 'create_document',
              'image_generation', 'write_to_file',
            ]);
            if (contentProducingTools.has(r.name) && this.opts.workspace) {
              try {
                const { getPersistentMemory } = await import('./persistent-memory.js');
                const pm = getPersistentMemory();
                // 从 appendOnlyLog 提取已完成的工具调用
                const recentTools = this.context.appendOnlyLog
                  .filter((m: any) => m.role === 'tool' && !String(m.content || '').startsWith('[ERROR]'))
                  .map((m: any) => m.name)
                  .filter((n: string, i: number, arr: string[]) => arr.indexOf(n) === i)
                  .slice(0, 10);
                // 从最近 assistant 消息提取用户目标
                const lastAssistant = [...this.context.appendOnlyLog]
                  .reverse()
                  .find((m: any) => m.role === 'assistant' && typeof m.content === 'string');
                // 从最近 user 消息提取目标
                const lastUser = [...this.context.appendOnlyLog]
                  .reverse()
                  .find((m: any) => m.role === 'user' && typeof m.content === 'string');
                const userGoal = ((typeof lastUser?.content === 'string' ? lastUser.content : '') || '').slice(0, 200);  // v3.2 修复: 显式 string
                const summary = (typeof lastAssistant?.content === 'string' ? lastAssistant.content : '').slice(0, 500);
                if (userGoal || summary) {
                  pm.saveSessionSummary(this.opts.workspace, {
                    userGoal,
                    toolsUsed: recentTools,
                    filesModified: [], // 实时模式先不抓, 最后再总结
                    summary: `[实时] 最近工具: ${recentTools.slice(0, 5).join(', ')} | ${summary}`,
                    taskType: detectTaskType(userGoal as any),  // v3.2 修复: userGoal 可能是 string | block[], 传 any
                  });
                }
              } catch { /* live save optional */ }
            }
          }

          // ═══ 系统管控员: 记录工具调用结果到动态能力矩阵 ═══
          try {
            const { getTracker } = await import('./governor/runtime-capability-tracker.js');
            const modelId = `${this.opts.model}:${this.opts.modelName || 'default'}`;
            getTracker().recordToolResult(
              modelId, this._taskType, r.name,
              !(r.output && r.output.startsWith('Error:')), 0,
            );
          } catch { /* tracker 容错 */ }

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
            this.directives.add('dup_fail', `[SYSTEM] ${toolName} 已连续失败 ${count} 次。请停止重试，改用其他工具或方案。`, 'high');
            this.emit('tool:stuck', { tool: toolName, count });
            break; // 只触发一次
          }
        }

        // ═══ 自主修复闭环: 检测工具错误模式并自动注入修复指令 ═══
        // 核心理念: 不会就学, 学不会就抄, 抄不会就自己建
        // 2026-06-24 升级: 进化记忆写入增加taskType、industry、errorType、keywords字段
        const _evoMod = await import('./evolution.js').catch(() => null);
        const writeEvo: (e: any) => void = _evoMod?.writeEvolution ?? (() => {});
        const classifyFail: (o: any) => any = _evoMod?.classifyFailure ?? (() => 'unknown');
        
        // 获取当前任务类型、行业、关键词（用于进化记忆智能召回）
        const currentTaskType = detectTaskType(typeof userMessage === 'string' ? userMessage : '');
        const currentIndustry = userModel.get(this.opts.userId).identity.industry || 'general';
        const currentKeywords = extractKeywords(typeof userMessage === 'string' ? userMessage : '');

        // ═══ 2026-06-27 新增: 进化记忆主动召回 (工具失败时) ═══
        // 检测是否有失败的工具, 主动召回相关进化记忆
        const hasFailedTool = toolResults.some(r => r.output && (r.output.startsWith('[ERROR]') || r.output.startsWith('Error:')));
        if (hasFailedTool) {
          try {
            const { recallEvolution } = await import('./evolution.js');
            const relevantMemories = recallEvolution({
              taskType: currentTaskType as any,
              industry: currentIndustry,
              keywords: currentKeywords,
              userId: this.opts.userId,
              workspace: this.opts.workspace,
              limit: 3,
            });
            const lessons = relevantMemories
              .filter(e => e.type === 'failure' || e.type === 'meta_instruction')
              .slice(0, 3);
            if (lessons.length > 0) {
              const lessonStr = lessons.map(e => `- ${(e.content || '').slice(0, 100)}`).join('\n');
              this.directives.add('evo_recall', `[SYSTEM 经验召回] 工具出错, 过去类似场景经验:\n${lessonStr}`, 'high');
            }
          } catch { /* evolution recall optional */ }
        }
        
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
            this.directives.add('auto_fix_module', `[SYSTEM 自主修复] 模块缺失: "${mod}"。请调用 ${installCmd} 安装后重试。`, 'high');
            this.emit('auto:fix', { type: 'missing_module', module: mod });
            this.emit('reasoning', { text: `[自主修复] 检测到缺失依赖 "${mod}", 正在自动安装...` });
            writeEvo({ 
              type: 'preference', 
              content: `自动学习: 缺失依赖 "${mod}" 时应自动安装`, 
              userId: this.opts.userId, 
              sessionId: this.opts.userId,
              taskType: currentTaskType,
              industry: currentIndustry,
              keywords: currentKeywords
            });
            break;
          }
          // 2) Python编码错误 → 自动注入UTF-8修复
          if (out.includes('UnicodeEncodeError') || out.includes('UnicodeDecodeError')) {
            this.directives.add('auto_fix_encoding', `[SYSTEM 自主修复] Python编码错误, 请在代码开头添加: import sys, io; sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')`, 'high');
            this.emit('auto:fix', { type: 'encoding_error' });
            this.emit('reasoning', { text: `[自主修复] 检测到编码错误, 自动注入UTF-8修复...` });
            writeEvo({ 
              type: 'preference', 
              content: '自动学习: Python编码错误时注入UTF-8修复', 
              userId: this.opts.userId, 
              sessionId: this.opts.userId,
              taskType: currentTaskType,
              industry: currentIndustry,
              errorType: 'UnknownError',
              keywords: currentKeywords
            });
            break;
          }
          // 3) 文件路径不存在 → 自动探索
          if ((out.includes('ENOENT') || out.match(/no such file|not found|找不到/i)) && !out.includes('list_directory')) {
            this.directives.add('auto_fix_path', `[SYSTEM 自主修复] 文件/路径不存在。请先调用 list_directory 查看实际目录结构, 找到正确路径后重试。`, 'high');
            this.emit('auto:fix', { type: 'path_not_found' });
            this.emit('reasoning', { text: `[自主修复] 路径不存在, 自动探索目录结构...` });
            writeEvo({ 
              type: 'preference', 
              content: '自动学习: 路径不存在时应先探索目录结构', 
              userId: this.opts.userId, 
              sessionId: this.opts.userId,
              taskType: currentTaskType,
              industry: currentIndustry,
              errorType: 'FileSystemError',
              keywords: currentKeywords
            });
            break;
          }
          // 4) 权限错误 → 自动换路径/方式
          if (out.includes('EACCES') || out.includes('EPERM') || out.includes('permission denied')) {
            this.directives.add('auto_fix_perm', `[SYSTEM 自主修复] 权限不足。请换到工作区目录操作或用 run_code 执行。`, 'high');
            this.emit('auto:fix', { type: 'permission_error' });
            this.emit('reasoning', { text: `[自主修复] 权限不足, 自动切换方案...` });
            writeEvo({ 
              type: 'preference', 
              content: '自动学习: 权限不足时自动切换方案', 
              userId: this.opts.userId, 
              sessionId: this.opts.userId,
              taskType: currentTaskType,
              industry: currentIndustry,
              errorType: 'PermissionError',
              keywords: currentKeywords
            });
            break;
          }
          // 5) 语法/运行错误 → 自动修复重试
          if (out.includes('SyntaxError') || out.includes('TypeError') || out.includes('ReferenceError') || out.includes('NameError')) {
            const errorLine = out.split('\n').find(l => /Error:/i.test(l)) || '';
            const errorType = out.includes('SyntaxError') ? 'SyntaxError' : 
                             out.includes('TypeError') ? 'TypeError' : 
                             out.includes('ReferenceError') ? 'ReferenceError' : 'UnknownError';
            this.directives.add('auto_fix_syntax', `[SYSTEM 自主修复] 代码错误: ${errorLine.slice(0, 150)}。请分析错误原因, 修复代码后重新执行。`, 'high');
            this.emit('auto:fix', { type: 'code_error', error: errorLine.slice(0, 100) });
            this.emit('reasoning', { text: `[自主修复] 代码错误, 自动分析并修复: ${errorLine.slice(0, 80)}...` });
            writeEvo({ 
              type: 'failure', 
              content: `代码错误: ${errorLine.slice(0, 100)}`, 
              userId: this.opts.userId, 
              sessionId: this.opts.userId,
              taskType: currentTaskType,
              industry: currentIndustry,
              errorType,
              keywords: currentKeywords,
              failureCategory: classifyFail({ errorMessage: errorLine, errorType: errorType as any, toolName: r.name }),
            });
            break;
          }
          // 5.5) undefined 属性访问 (slice/length/push等) → 自动注入空值检查修复
          // 这是最常见的运行时错误: "Cannot read properties of undefined (reading 'slice')"
          if (out.match(/Cannot read properties of (?:undefined|null) \(reading ['"](\w+)['"]\)/i)) {
            const propMatch = out.match(/Cannot read properties of (?:undefined|null) \(reading ['"](\w+)['"]\)/i);
            const prop = propMatch?.[1] || 'unknown';
            this.directives.add('auto_fix_undefined', `[SYSTEM 自主修复] undefined 属性访问: .${prop}。请添加空值检查 (obj?.prop) 后重试。`, 'high');
            this.emit('auto:fix', { type: 'undefined_property_access', property: prop });
            this.emit('reasoning', { text: `[自主修复] undefined 属性访问 (.${prop}), 自动注入空值检查...` });
            writeEvo({ 
              type: 'failure', 
              content: `访问 .${prop} 时对象为 undefined, 需先做空值检查`, 
              userId: this.opts.userId, 
              sessionId: this.opts.userId,
              taskType: currentTaskType,
              industry: currentIndustry,
              errorType: 'TypeError',
              keywords: [...currentKeywords, prop] as string[]
            });
            break;
          }
          // 6) 网络超时/连接失败 → 自动重试
          if (out.match(/ETIMEDOUT|ECONNREFUSED|ECONNRESET|fetch failed|network error/i)) {
            this.directives.add('auto_fix_network', `[SYSTEM 自主修复] 网络错误。请等待2秒后重试或换一种方式完成任务。`, 'high');
            this.emit('auto:fix', { type: 'network_error' });
            this.emit('reasoning', { text: `[自主修复] 网络错误, 自动重试...` });
            writeEvo({ 
              type: 'failure', 
              content: '网络错误, 自动重试', 
              userId: this.opts.userId, 
              sessionId: this.opts.userId,
              taskType: currentTaskType,
              industry: currentIndustry,
              errorType: 'NetworkError',
              keywords: currentKeywords
            });
            break;
          }
          // 7) 工具不存在 → 自动用 run_code 替代
          if (out.match(/Unknown tool|tool not found|no tool named|Function\s+\w+\s+does not exist/i)) {
            const toolMatch = out.match(/(?:Unknown tool|tool not found|no tool named|Function\s+)(\w+)/i);
            const missingTool = toolMatch ? toolMatch[1] : 'unknown';
            this.directives.add('auto_fix_tool', `[SYSTEM 自主修复] 工具 "${missingTool}" 不存在。请用 run_code 自己实现该功能。`, 'high');
            this.emit('auto:fix', { type: 'missing_tool', tool: missingTool });
            this.emit('reasoning', { text: `[自主修复] 工具 "${missingTool}" 不存在, 自动用代码实现替代...` });
            break;
          }
          // 8) Excel/文件解析失败 → 自动换解析方式
          if (out.match(/Excel解析失败|xlsx.*failed|pdf.*failed|doc.*failed|文件解析失败/i)) {
            this.directives.add('auto_fix_parse', `[SYSTEM 自主修复] 文件解析失败。请用 run_code 执行 Python 脚本解析 (openpyxl/pandas/pdfplumber)。`, 'high');
            this.emit('auto:fix', { type: 'parse_error' });
            this.emit('reasoning', { text: `[自主修复] 文件解析失败, 自动切换解析方式...` });
            break;
          }
          // 9) TypeScript/编译错误 → 自查代码修复
          if (out.match(/error TS\d{4}|compilation error|typecheck failed|类型.*错误|编译.*错误/i)) {
            const errorLines = out.split('\n').filter((l: string) => /error/i.test(l)).join('; ');
            this.directives.add('auto_fix_ts', `[SYSTEM 自主修复] 编译错误: ${errorLines.slice(0, 200)}。请用 read_file 查看报错行, multi_edit 修复后重试。`, 'high');
            this.emit('auto:fix', { type: 'ts_error', errors: errorLines.slice(0, 200) });
            this.emit('reasoning', { text: `[自主修复] 编译错误, 正在分析修复...` });
            break;
          }
          // 10) Git 冲突/错误 → 指明解决方案
          if (out.match(/merge conflict|detached HEAD|rebase.*in.progress|not a git repository|fatal:/i)) {
            this.directives.add('auto_fix_git', `[SYSTEM 自主修复] Git 操作失败: ${out.slice(0, 150)}。请用 git_status 检查状态, 解决冲突后重试。`, 'high');
            this.emit('auto:fix', { type: 'git_error' });
            break;
          }
          // 11) npm/pnpm 安装失败 → 换包管理器或清缓存
          if (out.match(/ERR_PNPM|pnpm install.*failed|npm ERR!|package not found/i)) {
            const pkgMatch = out.match(/(?:ERR_PNPM|npm ERR!).*?([@\w\/-]+)(?:\s|$)/i);
            const pkg = pkgMatch ? pkgMatch[1] : 'unknown';
            this.directives.add('auto_fix_install', `[SYSTEM 自主修复] 包安装失败 (${pkg})。请清除 lockfile 后重试或换包管理器。`, 'high');
            this.emit('auto:fix', { type: 'install_error', package: pkg });
            break;
          }
        }

        if (hasPendingAsk) {
          this.emit('ask_user', { question: askData?.question || '', options: askData?.options || [], sessionId: this.context.sessionId });
          break;
        }

        // ═══ 工具调用检测: 提取工具消息 (v3.1 修复作用域 bug) ═══
        // 之前 toolMsgs 在 if 块内定义, 出块后 undefined, 导致 ReferenceError
        // v3.2 防御: 整个块包 try-catch, 即使再有变量作用域问题也不影响主循环
        try {
          const toolMsgs = this.context.appendOnlyLog.filter(m => m.role === 'tool');
          // ═══ 操作感知: 每3轮注入一次, 而非每轮 ═══
          // 避免每轮注入噪音, 仅在关键节点提醒
          if (this.iteration >= 2 && this.iteration % 3 === 0) {
            if (toolMsgs.length >= 3) {
              const toolSummary = toolMsgs.slice(-8).map(m => {
                const name = (m as any).name || 'unknown';
                const content = typeof m.content === 'string' ? m.content.slice(0, 40) : '';
                const ok = !(typeof m.content === 'string' && m.content.startsWith('[ERROR]'));
                return `${ok ? '✓' : '✗'} ${name}: ${content}`;
              }).join('\n');
              // 检测重复操作
              const toolCounts = new Map<string, number>();
              for (const m of toolMsgs) {
                const name = (m as any).name || 'unknown';
                toolCounts.set(name, (toolCounts.get(name) || 0) + 1);
              }
              const repeated = [...toolCounts.entries()].filter(([_, c]) => c >= 3);
              if (repeated.length > 0) {
                this.directives.add('op_awareness', `[SYSTEM] 重复操作: ${repeated.map(([n, c]) => `${n}(${c}次)`).join(', ')} — 如果已完成请直接总结, 不要重复执行。`, 'high');
              }
              // 操作感知只在有重复时注入, 不每轮注入摘要
            }
          }

          // ═══ v3.3 只读不写检测: 连续 8 次只调用读取类工具 + 未访问新文件 → 温和提醒 ═══
          // 2026-08-03 修复: 原 5 次门槛太低, 长任务正常探索阶段需要大量读文件
          // 原硬停逻辑 (_hardStopNext) 导致长任务被强制中断, 已移除
          if (toolMsgs.length >= 8) {
            const recent8 = toolMsgs.slice(-8).map((m: any) => m.name || '');
            const readOnlyTools = ['read_file', 'list_directory', 'directory_tree', 'search_content', 'search_codebase', 'glob', 'recall_memory', 'web_search', 'web_fetch', 'get_symbols'];
            const writeTools = ['write_file', 'multi_edit', 'create_file', 'delete_file', 'run_code', 'edit_file', 'create_directory', 'move_file', 'copy_file'];
            const readCount = recent8.filter((t: string) => readOnlyTools.includes(t)).length;
            const writeCount = recent8.filter((t: string) => writeTools.includes(t)).length;
            // 统计访问的文件数 (区分"探索新文件"和"重复读同一文件")
            const accessedFiles = new Set<string>();
            for (const m of toolMsgs.slice(-8)) {
              const fp = (m as any).args?.file_path || (m as any).args?.path || (m as any).args?.filePath;
              if (fp && typeof fp === 'string') accessedFiles.add(fp);
            }
            // 触发条件: 8次全是读 + 访问文件数 <= 2 (重复读同一文件)
            if (readCount >= 8 && writeCount === 0 && accessedFiles.size <= 2) {
              this.directives.add('read_only_loop',
                '[SYSTEM] 提示: 已连续调用 8 次读取类工具且仅访问 1-2 个文件。' +
                '如信息已收集完毕, 请考虑执行修改; 如仍在探索, 可继续读取。',
                'medium');
              // 不再硬停, 让 AI 自行判断
            }
          }

          // ═══ v3.1 死循环硬停: 连续 3 次相同工具 + 相同参数 + 相似结果 → 强制退出 ═══
          // 解决 AI 死循环: web_search 反复调用 / browser_click 反复失败等
          // 关键场景: 工具持续返回低质量/错误/相似结果, AI 不换思路
          if (toolMsgs.length >= 3) {
            const last3 = toolMsgs.slice(-3);
            const sig = (m: any) => {
              const name = m.name || 'unknown';
              const args = typeof m.content === 'string' ? m.content.slice(0, 60) : '';
              return `${name}::${args}`;
            };
            const sigs = last3.map(sig);
            const allSame = sigs[0] === sigs[1] && sigs[1] === sigs[2];
            if (allSame) {
              const repeatName = (last3[0] as any).name || 'unknown';
              const errResults = last3.filter(m => typeof m.content === 'string' && (m.content.startsWith('[ERROR]') || m.content.includes('未启动') || m.content.includes('失败')));
              const isErrorLoop = errResults.length >= 2;

            console.warn(`[loop] 🛑 死循环硬停: ${repeatName} 连续 3 次返回相同/错误结果, 强制终止`);
            taskSnap?.appendLog('warn', 'dead-loop-hard-stop', { tool: repeatName, signatures: sigs, errLoop: isErrorLoop });

            // 注入强引导 + 硬停
            this.directives.add('dead_loop_stop',
              `[SYSTEM] ⚠️ 工具 "${repeatName}" 连续 3 次返回相同结果${isErrorLoop ? '且包含错误' : ''}。
不要再调用任何工具！请立即:
1) 总结目前已知的信息
2) 解释为什么这个工具没工作${isErrorLoop ? '（很可能是浏览器/服务未启动，提示用户检查）' : ''}
3) 给出基于现有信息的最终答案`,
              'high'
            );

            // 标记硬停, 下一轮注入 SYSTEM 后立即退出
            this._hardStopNext = true;
            this._hardStopCount++;
            // 如果已经硬停过 2 次, AI 仍在忽略 → 强制 force break
            if (this._hardStopCount >= 2) {
              console.warn(`[loop] 🛑🛑 多次硬停后 AI 仍调用同工具, 强制 force break`);
              taskSnap?.appendLog('warn', 'dead-loop-force-break', { tool: repeatName, hardStopCount: this._hardStopCount });
              this.directives.add('force_break',
                `[SYSTEM] ⚠️ 硬停失败, 强制退出循环。最终回答基于已知信息。`,
                'critical'
              );
              lastResponse = {
                content: this.context.appendOnlyLog
                  .filter(m => m.role === 'tool')
                  .slice(-3)
                  .map(m => typeof m.content === 'string' ? m.content.slice(0, 200) : '')
                  .join('\n---\n') || `[已强制退出循环] 工具 ${repeatName} 连续返回相同结果。`,
                provider: 'forced' as any,
                usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0, cacheHit: false, source: 'estimated' as const },
                durationMs: 0,  // v3.2 修复: ChatResponse 要求此字段
              };
              break;  // 直接跳出整个 while 循环
            }
            continue;
          }
          }  // 关闭 if (toolMsgs.length >= 3) — v3.2 修复漏闭合
        } catch (loopDetectErr: any) {
          // v3.2 防御: 即使死循环检测内部出错, 也不影响主循环
          console.warn('[loop] ⚠️ 死循环检测块异常 (已吞掉, 不影响主流程):', loopDetectErr?.message);
        }

        continue;
      }

      // 3.7 无 tool call: 检查是否需要自动恢复

      // finish_reason='length' → 回复被截断(max_tokens限制), 自动继续
      if (res.finishReason === 'length') {
          this.directives.add('truncated', '[SYSTEM] 你的回复被截断了(max_tokens限制)。请从断点继续完成你的回答和任务。', 'high');
        autoResumeCount++;
        this.emit('auto:resume', { reason: 'length_truncated', count: autoResumeCount });
        continue;
      }

      // ═══ 任务自监督: 检测中断并决策是否自动恢复 ═══
      const health = supervisor.checkHealth();
      if (!health.healthy && health.status === 'interrupted') {
        // 🔧 修复 (方案 B): 闲聊/问候场景豁免 supervisor resume
        // 即使方案 A (updateActivity) 已更新活动时间, 作为双保险:
        // 闲聊场景 AI 给出纯文本回复是正常的, 不应被误判为 "任务中断需要恢复"
        // 否则会导致: 你好→回复→supervisor resume→你好→回复→... 死循环
        const _userMsgCtx = typeof userMessage === 'string' ? userMessage : '';
        const _aiReplyCtx = (res?.content || '').trim();
        const _isChitChatCtx = /^(你好|嗨|hi|hello|好的|谢谢|没问题|ok|嗯|对|是|不|行|可以|能|在吗|你在|怎么样|能不能|会不会|为什么|怎么|什么|如何|哪里|哪个)/i.test(_userMsgCtx.trim())
          || _userMsgCtx.trim().length < 15;
        const _isGreetingCtx = /^(你好|嗨|hi|hello|嘿|哈喽|我是|我在|有什么|随时|开干|说吧)/i.test(_aiReplyCtx)
          || /智能助手|AgentAI|PulseFlow|帮你搞|帮你处理|开干|我在的|我在呢|没有掉线/i.test(_aiReplyCtx);
        if (!_isChitChatCtx && !_isGreetingCtx) {
          const resumeDecision = await supervisor.shouldAutoResume({
            lastError: health.interruptionReason,
            taskSnapshot: taskSnap,
            toolHistory: this.context.appendOnlyLog
              .filter(m => m.role === 'tool')
              .map(m => ({ name: (m as any).name || 'unknown', ok: !String(m.content).startsWith('[ERROR]') })),
          });
          if (resumeDecision.shouldResume && resumeDecision.confidence > 0.5) {
            this.directives.add('supervisor_resume', resumeDecision.prompt, 'high');
            autoResumeCount++;
            this.emit('auto:resume', { 
              reason: health.interruptionReason || 'supervisor_detected', 
              count: autoResumeCount,
              confidence: resumeDecision.confidence 
            });
            this.emit('reasoning', { text: `[任务自监督] 检测到${health.interruptionReason}，自动恢复任务...` });
            continue;
          }
        }
      }

      // ═══ 元认知决策: 让 AI 自己判断是否继续 ═══
      // 强模型跳过 — 它自己知道该不该继续, 不需要元认知循环替它决策
      // 弱模型保留: 帮助弱模型判断何时停止/追问
      if (this._capabilityTier !== 'autonomous' && this.iteration < this.opts.maxIterations * 0.5) {
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
        // 元认知决策: ask_human → 阻塞等待用户回答（修复死代码问题）
        if (metaOutput.decision.action === 'ask_human') {
          const askId = `ask-${Date.now()}`;
          const question = metaOutput.decision.reasoning || '请提供更多信息';

          // 发送追问事件，前端显示追问卡片
          this.emit('clarify:required', {
            id: askId,
            originalMessage: messageText,
            questions: [{ question, type: 'text' }],
            source: 'meta_cognitive'
          });

          // 阻塞等待用户回答（复用已有的 waitForClarification 机制）
          const answers = await this.waitForClarification(askId, [{ question, type: 'text' }]);

          // 用户回答后注入到上下文，继续执行
          const userAnswer = answers[question] || answers['default'] || '';
          if (userAnswer) {
            this.context.appendOnlyLog.push({
              role: 'user',
              content: `[追问回答] ${userAnswer}`
            });
          }

          // 继续循环处理用户回答，不 break
          continue;
        }
        // 元认知决策: retry_with_pua → 延迟, 不在执行中施压
        if (metaOutput.decision.action === 'retry_with_pua' && (metaOutput as any).decision.puaPrompt) {
          this.emit('meta:decision', { action: 'retry_with_pua', confidence: metaOutput.decision.confidence });
          this.directives.add('meta_pua', `[SYSTEM] ${(metaOutput as any).decision.puaPrompt}`, 'medium');
          // 不 continue — 延迟到任务后处理
        }
        // 元认知决策: continue → 注入策略提示
        if (metaOutput.decision.action === 'continue' || metaOutput.decision.action === 'switch_strategy') {
          this.emit('meta:decision', { action: metaOutput.decision.action, strategy: metaOutput.strategy.name, confidence: metaOutput.confidence.overall });
        }
        // 安全守护: H4 修复 — 记录 meta 决策，confidence 评估时会读这个标志避免冲突
        (this as any)._lastMetaDecision = metaOutput.decision.action;
      } catch (metaErr: any) {
        // 元认知模块不可用时，降级到硬编码规则，不影响主流程
        console.warn('[meta-cognitive] fallback to hardcoded rules:', metaErr?.message);
      }
      } // end if (iter < maxIterations * 0.5)

      // ═══ 置信度评估: AI 知道自己"不知道什么" ═══
      // 强模型跳过 — 它自己知道什么时候该搜索/追问, 不需要外部置信度打分
      // 弱模型保留: 防止弱模型在不确信时瞎编
if (this._capabilityTier !== 'autonomous') {
        // ═══ 跳过条件: 简单问候/闲聊不需要置信度检查 ═══
      const isGreetingChat = /^(你好|嗨|hi|hello|好的|谢谢|没问题|ok|嗯|对|是|不|行|可以|在吗|你在|在不在|在的在的|怎么样)/i.test(messageText.trim())
        || messageText.trim().length < 15;
      // 安全守护: H4 修复 — 如果 meta 已决策 stop/ask_human/retry_with_pua，confidence 不再注入 directive（避免冲突指令）
      const metaHasDecided = (this as any)._lastMetaDecision &&
        ['stop', 'ask_human', 'retry_with_pua'].includes((this as any)._lastMetaDecision);
      if (!isGreetingChat && !isSimpleChat && !metaHasDecided) {
      try {
        const { ConfidenceEstimator } = await import('./meta/confidence-estimator.js');
        const estimator = new ConfidenceEstimator();

        // 收集置信度信号
        const toolCallCount = this.context.appendOnlyLog.filter(m => m.role === 'tool').length;
        const hasWebSearch = this.context.appendOnlyLog.some(m => m.role === 'tool' && (m as any).name === 'web_search');
        const hasReadFile = this.context.appendOnlyLog.some(m => m.role === 'tool' && (m as any).name === 'read_file');
        const responseText = (res.content || '').trim();

        // 信号1: 工具覆盖度 — 调了多少工具
        estimator.addSignal('tool_coverage', 0.20, Math.min(toolCallCount / 3, 1));

        // 信号2: 证据密度 — 是否搜索/读取了外部信息
        estimator.addSignal('evidence_density', 0.25, (hasWebSearch ? 0.5 : 0) + (hasReadFile ? 0.5 : 0));

        // 信号3: 不确定性标记 — 回复中是否包含犹豫词汇
        const uncertaintyWords = /可能|大概|也许|似乎|不确定|猜测|估计|大概|应该|或许|probably|maybe|might|guess|uncertain/i;
        const hasUncertainty = uncertaintyWords.test(responseText);
        estimator.addSignal('uncertainty_markers', 0.10, hasUncertainty ? 0.2 : 0.9);

        // 信号4: 语义完整性 — 回复长度是否足够
        estimator.addSignal('semantic_completeness', 0.15, Math.min(responseText.length / 200, 1));

        // 信号5: 一致性 — 多次推理是否一致 (简化: 检查是否有自我修正)
        const hasSelfCorrection = /等等|不对|修正|更正|实际上|actually|correction|wait/i.test(responseText);
        estimator.addSignal('consistency', 0.15, hasSelfCorrection ? 0.4 : 0.8);

        // 信号6: 认知边界 — 回复是否在已验证的知识范围内
        const boundaryScore = ConfidenceEstimator.assessKnowledgeBoundary(responseText, hasWebSearch, hasReadFile);
        estimator.addSignal('knowledge_boundary', 0.15, boundaryScore);

        const report = estimator.evaluate();

        // ═══ 认知边界自检: 生成自我提问 ═══
        // 即使置信度不是极低, 也检查是否有越界表现
        const selfQuestions = ConfidenceEstimator.generateSelfQuestions(responseText, messageText);
        if (selfQuestions.length > 0 && boundaryScore < 0.5 && this.iteration < this.opts.maxIterations * 0.7) {
          this.directives.add('boundary_check', `[SYSTEM] 在提交回复前, 请先自问:\n${selfQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}\n如果发现问题, 请修正回复或调用工具补充信息。`, 'medium');
          this.emit('confidence:boundary', { score: boundaryScore, questions: selfQuestions });
          // 不 continue — 延迟到任务后处理, 不中断 AI 回复
        }

        // 低置信度 → 区分: 知识不足(搜索) vs 需求不明确(追问用户)
        if (report.overallScore < 0.4 && this.iteration < this.opts.maxIterations * 0.7) {
          // 检测是否为需求不明确 (回复中包含反问/不确定用户意图的词汇)
          const needsClarification = /你(想要|希望|需要|指的是|是想|是要)|不确定你(的|想)|请(告诉|说明|确认|明确)|which|what do you|clarify/i.test(responseText);
          if (needsClarification) {
            // 需求不明确 → 追问用户
            this.directives.add('low_conf_clarify', `[SYSTEM] 你似乎不确定用户的需求 (置信度 ${(report.overallScore * 100).toFixed(0)}%)。请立即调用 ask_user 工具向用户追问。`, 'medium');
          } else {
            // 知识不足 → 搜索
            const action = report.recommendation === 'retry_with_different_strategy'
              ? '请使用 web_search 搜索相关信息后再回答, 不要凭猜测回复。'
              : '请调用 read_file 或 web_search 补充信息, 确保回答有据可依。';
            this.directives.add('low_conf_search', `[SYSTEM] 你的置信度较低 (${(report.overallScore * 100).toFixed(0)}%), ${action}`, 'medium');
          }
          this.emit('confidence:low', { score: report.overallScore, recommendation: report.recommendation, iteration: this.iteration });
          // 不 continue — 延迟到任务后处理
        }

        this.emit('confidence:eval', { score: report.overallScore, level: report.level, recommendation: report.recommendation });
      } catch (confErr: any) {
        // 置信度评估不可用时不影响主流程
      }
      } // end if (!isGreetingChat && !isSimpleChat)
      } // end if (capabilityTier !== autonomous) — 置信度评估仅对非自主模型生效

      // ═══ P0-3.1+3.2: 知识边界检测 + 自我提问 (防幻觉, 接入已有但未调用的方法) ═══
      // 强模型跳过 — 它自己会验证自己的回答
      // 弱模型保留: 防止弱模型幻觉
      if (this._capabilityTier !== 'autonomous' && this.iteration < this.opts.maxIterations * 0.5) {
      try {
        const { ConfidenceEstimator } = await import('./meta/confidence-estimator.js');
        const responseText = res.content || '';
        const hasSearched = this.context.appendOnlyLog.some(m =>
          m.role === 'tool' && typeof m.content === 'string' &&
          (m.content.includes('web_search') || m.content.includes('搜索结果'))
        );
        const hasReadFile = this.context.appendOnlyLog.some(m =>
          m.role === 'tool' && typeof m.content === 'string' && m.content.includes('read_file')
        );
        const boundaryScore = ConfidenceEstimator.assessKnowledgeBoundary(responseText, hasSearched, hasReadFile);
        if (boundaryScore < 0.5 && this.iteration < this.opts.maxIterations * 0.7) {
          const selfQuestions = ConfidenceEstimator.generateSelfQuestions(responseText, messageText);
          if (selfQuestions.length > 0) {
            this.directives.add('boundary_p0', `[SYSTEM] 自检发现以下问题, 请验证后再回复:\n${selfQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`, 'medium');
            // 不 continue — 延迟到任务后处理
          }
        }
      } catch { /* knowledge boundary check optional */ }
      } // end if (前半段才做知识边界检测)

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

      if (hasPriorTools && len > 60 && this.iteration < this.opts.maxIterations * 0.5) {
        const isUserChitChat = messageText.trim().length < 10;
        const isDescriptive = /我(看到|发现|了解|注意到|观察到|查看了|分析了)|让我(先|来)|这是|看起来|似乎|大概|目前|现状|情况/i.test(text);
        const hasAction = /已(创建|修改|写入|删除|安装|执行|生成)|成功|✅|完成/i.test(text);
        if (isDescriptive && !hasAction && !isUserChitChat) {
          this.directives.add('descriptive', '[SYSTEM] 不要只描述, 请调用 write_file/multi_edit 修改代码, 用 run_code 验证。', 'medium');
          continue;
        }
        // 有操作标记 → 不在此处 break, 继续向下判断
      }

      // 规则3: 长回复但无工具 + 非闲聊 + 非告别 + 早期迭代 → 提示使用工具
      // 强模型跳过 — 它自己决定是否需要工具
      if (this._capabilityTier !== 'autonomous' && len > 200 && !hasPriorTools && this.iteration < this.opts.maxIterations * 0.5 && !isChitChat && !isGoodbye) {
        this.directives.add('no_tools', '[SYSTEM] 请调用工具执行操作 (如 read_file/write_file/run_code), 或明确说"回答完毕"。', 'medium');
        continue;
      }

      // 规则4: 短回复 + 无工具 + 还有恢复次数 + 非告别 + 非问候 → 自动恢复
      // 强模型跳过 — 如果它给了短回复, 大概率是任务确实简单
      // 问候/自我介绍不应触发 autoResume (否则死循环: 你好→太短→你好→太短)
      const isGreetingOrIntro = /^(你好|嗨|hi|hello|嘿|哈喽|我是|我在|有什么|随时|开干|说吧)/i.test(text.trim())
        || /智能助手|AgentAI|帮你搞|帮你处理|开干|我在的|我在呢|没有掉线/i.test(text);
      if (this._capabilityTier !== 'autonomous' && !hasPriorTools && len < 200 && autoResumeCount < MAX_AUTO_RESUME && !isNoKeyResponse && !isChitChat && !isGoodbye && !isGreetingOrIntro) {
        autoResumeCount++;
        this.directives.add('short_response', '[SYSTEM] 回复过短, 请调用 list_directory 了解结构, 用 read_file/write_file 等工具完成任务。', 'medium');
        continue;
      }

      // 默认: finish_reason='stop' + 无 tool_calls → 自然结束
      break;
    }

    // ═══ 延迟指令处理: 任务完成后检查缓冲区 ═══
    // 执行中被缓冲的质量管控指令, 现在处理:
    // - 高优先级 → 补一轮 LLM 让 AI 处理 (如操作感知提醒)
    // - 中/低优先级 → 静默记录, 不打扰 AI
    const deferredDirectives = this.directives.flushDeferred();
    if (deferredDirectives.length > 0) {
      const criticalDeferred = deferredDirectives.filter(d => d.priority === 'high');
      const nonCritical = deferredDirectives.filter(d => d.priority !== 'high');

      // 高优先级延迟指令 → 合并为一条消息, 补一轮
      if (criticalDeferred.length > 0 && this.iteration < this.opts.maxIterations - 1) {
        const combined = criticalDeferred.map(d => d.content).join('\n\n');
        console.log(`[directives] ${criticalDeferred.length} high-priority deferred directives → extra round`);
        try {
          const deferredReq: ChatRequest = {
            model: this.opts.model as ProviderId,
            subModel: this.opts.modelName || undefined,
            messages: [
              ...this.context.immutablePrefix,
              ...this.context.appendOnlyLog,
              { role: 'user', content: combined },
            ],
            tools: [],
            userId: this.opts.userId,
            workspace: this.opts.workspace,
            stream: true,
            onDelta: this._createThrottledOnDelta(),
          };
          const deferredRes = await this.router.chat(deferredReq);
          if (deferredRes?.content) {
            this.context.appendOnlyLog.push({ role: 'assistant', content: deferredRes.content });
            lastResponse = { ...lastResponse!, content: deferredRes.content };
            this.emit('log:appended', { role: 'assistant', content: deferredRes.content });
          }
        } catch (e: any) {
          console.warn('[directives] deferred round failed:', e?.message);
        }
      }

      // 中/低优先级 → 静默记录
      for (const d of nonCritical) {
        this.emit('directive:deferred', { source: d.source, priority: d.priority, content: d.content.slice(0, 80) });
      }
      if (nonCritical.length > 0) {
        console.log(`[directives] ${nonCritical.length} non-critical deferred directives silently logged`);
      }
    }

    // ═══ 任务完成总结: 有工具调用但无明确总结 → 追加一轮总结 ═══
    const hasPriorToolCalls = this.context.appendOnlyLog.some(
      m => m.role === 'tool' && typeof m.content === 'string' && !m.content.startsWith('[SYSTEM]')
    );
    const lastText = (lastResponse?.content || '').trim();
    const alreadySummarized = /任务已完成|全部完成|已完成|完成！|done|finished|completed|总结|summary/i.test(lastText);
    // 问候/自我介绍不触发总结 (否则死循环: 你好→总结→你好→总结)
    const isGreetingFinal = /^(你好|嗨|hi|hello|嘿|哈喽|我是|我在|有什么|随时)/i.test(lastText.trim())
      || /智能助手|AgentAI|帮你搞|帮你处理|我在的|我在呢|没有掉线/i.test(lastText);
    if (hasPriorToolCalls && !alreadySummarized && lastText.length < 100 && this.iteration < this.opts.maxIterations - 1 && !isGreetingFinal) {
      try {
        const summaryPrompt = '[SYSTEM] 任务已执行完毕。请用 2-3 句话简要总结你完成了什么工作、修改了哪些文件、关键结果是什么。';
        const summaryReq: ChatRequest = {
          model: this.opts.model as ProviderId,
          subModel: this.opts.modelName || undefined,
          messages: [
            ...this.context.immutablePrefix,
            ...this.context.appendOnlyLog,
            { role: 'user', content: summaryPrompt },
          ],
          tools: [],
          userId: this.opts.userId,
          workspace: this.opts.workspace,
          stream: true,
          onDelta: this._createThrottledOnDelta(),
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

    // ═══ Layer 4: 反思轮 (Reflection Engine) ═══
    // 任务完成后, 自我检查: 我真的完成了用户的目标吗?
    // 不是简单检查"有没有回复", 而是检查"回复是否真正解决了问题"
    if (hasPriorToolCalls && this.iteration > 1 && lastResponse) {
      try {
        const responseText = (lastResponse.content || '').trim();
        const toolMessages = this.context.appendOnlyLog.filter(m => m.role === 'tool');
        const failedTools = toolMessages.filter(m =>
          typeof m.content === 'string' && (m.content.startsWith('[ERROR]') || m.content.includes('失败') || m.content.includes('failed'))
        );
        const hasErrorKeyword = /错误|失败|异常|无法|不能|error|fail|exception|cannot/i.test(responseText);
        const hasSuccessKeyword = /成功|完成|已创建|已修改|已写入|✅|success|completed|done/i.test(responseText);

        // 反思维度1: 有失败的工具调用但回复声称成功 → 需要修正
        if (failedTools.length > 0 && hasSuccessKeyword && !hasErrorKeyword) {
          const reflectPrompt = `[SYSTEM 反思] ${failedTools.length} 个工具调用失败但回复声称成功。请诚实检查: 哪些失败了? 如何补救?`;
          // 追加一轮让 AI 修正
          if (this.iteration < this.opts.maxIterations - 1) {
            const reflectReq: ChatRequest = {
              model: this.opts.model as ProviderId,
              subModel: this.opts.modelName || undefined,
              messages: [
                ...this.context.immutablePrefix,
                ...this.context.appendOnlyLog,
                { role: 'user', content: reflectPrompt },
              ],
              tools: [],
              userId: this.opts.userId,
              workspace: this.opts.workspace,
              stream: true,
              onDelta: (delta: string) => { this.emit('llm:delta', { delta }); },
            };
            const reflectRes = await this.router.chat(reflectReq);
            if (reflectRes?.content) {
              this.context.appendOnlyLog.push({ role: 'assistant', content: reflectRes.content });
              lastResponse = { ...lastResponse, content: reflectRes.content };
              this.emit('log:appended', { role: 'assistant', content: reflectRes.content });
            }
          }
          this.emit('reflection:triggered', { reason: 'failed_tools_claimed_success', failedCount: failedTools.length });
        }

        // 反思维度2: 用户要求修改文件但 AI 没有调用任何写工具 → 遗漏检测
        const userWantsWrite = /修改|写入|创建|删除|添加|重构|修复|改|写|create|write|modify|fix|delete|refactor/i.test(messageText);
        const hasWriteTool = toolMessages.some(m => {
          const name = (m as any).name || '';
          return ['write_file', 'multi_edit', 'string_replace', 'MultiEdit', 'create_tool'].includes(name);
        });
        if (userWantsWrite && !hasWriteTool && !hasErrorKeyword && this.iteration < this.opts.maxIterations * 0.7) {
          this.directives.add('reflect_write', `[SYSTEM 反思] 用户要求修改文件但你没有调用写入工具。请立即调用 write_file/multi_edit, 或说明原因。`, 'high');
          // 追加一轮让 AI 执行
          const reflectReq: ChatRequest = {
            model: this.opts.model as ProviderId,
            subModel: this.opts.modelName || undefined,
            messages: [...this.context.immutablePrefix, ...this.context.appendOnlyLog],
            tools: [],
            userId: this.opts.userId,
            workspace: this.opts.workspace,
            stream: true,
            onDelta: this._createThrottledOnDelta(),
          };
          const reflectRes = await this.router.chat(reflectReq);
          if (reflectRes?.content) {
            this.context.appendOnlyLog.push({ role: 'assistant', content: reflectRes.content });
            lastResponse = { ...lastResponse, content: reflectRes.content };
            this.emit('log:appended', { role: 'assistant', content: reflectRes.content });
          }
          this.emit('reflection:triggered', { reason: 'missing_write_tool' });
        }

        console.log(`[reflection] checked: ${failedTools.length} failed tools, hasWrite=${hasWriteTool}`);
      } catch (reflectErr: any) {
        console.warn('[reflection] failed:', reflectErr?.message);
      }
    }

    // ═══ 上下文修剪: 同步执行, 确保实际生效 ═══
    // 1. 同步修剪旧工具输出 (廉价, 不调 LLM)
    if (this.iteration >= 3 && this.context.appendOnlyLog.length > 20) {
      try {
        const { pruneOldToolResults, maybeFold } = await import('./context-manager.js');
        const { pruned, savedTokens } = pruneOldToolResults(this.context.appendOnlyLog, 10);
        if (pruned > 0) {
          console.log(`[context] pruned ${pruned} old tool results, saved ~${savedTokens} tokens`);
        }
        // ═══ 2026-06-27 激活: maybeFold 语义折叠 ═══
        // 当 token 估算超过阈值时, 用 LLM 生成结构化摘要替代中间消息
        await maybeFold(
          this.context.appendOnlyLog,
          '',
          this.router,
          this.opts.workspace || process.cwd(),
          this.opts.userId || 'unknown',
        );
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

    // ═══ 2026-07-15: 任务完成/失败时更新 task-snapshot ═══
    if (taskSnap && lastResponse) {
      try {
        taskSnap.setStage('done');
        const content = typeof lastResponse.content === 'string' ? lastResponse.content : '';
        taskSnap.setContextSummary(content.slice(0, 500));
        taskSnap?.complete(content.slice(0, 500) || '任务完成');
        taskSnap?.appendLog('info', 'task-completed-success', { iteration: this.iteration, durationMs: Date.now() - startedAt });
      } catch (e) { /* best-effort */ }
    }

    // ============== 系统管控员: 记录 loop 完成到动态能力矩阵 ==============
    try {
      const { getTracker } = await import('./governor/runtime-capability-tracker.js');
      const { quickScore, scoreCardToLabel } = await import('./judge/self-eval.js');
      const modelId = `${this.opts.model}:${this.opts.modelName || 'default'}`;
      // SelfEval 质量打分
      const lastUserMsg2 = [...this.context.appendOnlyLog].reverse().find(m => m.role === 'user');
      const userText2 = typeof lastUserMsg2?.content === 'string' ? lastUserMsg2.content : '';
      const card = quickScore(userText2, lastResponse.content || '', 'general');
      const qualityScore = Math.max(0, Math.min(1, (card.totalScore + 10) / 22)); // 归一化 [-10,12] → [0,1]
      const success = qualityScore >= 0.4;
      getTracker().recordLoopCompletion(modelId, this._taskType, success, this.iteration, qualityScore);
      console.log(`[governor] 📊 能力矩阵更新: ${modelId} task=${this._taskType} quality=${qualityScore.toFixed(2)} success=${success} iters=${this.iteration}`);
    } catch { /* tracker 容错 */ }

    // ============== 反思门 (Reflector) 闭环 ==============
    // 异步触发, 不阻塞返回
    const lastUserMsg = [...this.context.appendOnlyLog].reverse().find(m => m.role === 'user');
    const lastUserText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';
    if (this.opts.reflectEvery && this.opts.reflectEvery > 0) {
      this.runReflector(lastResponse, lastUserText).catch((e) => {
        console.warn('[reflector] failed:', (e as Error).message);
      });
    }

    // ============== 技能自进化: 评估使用数据, 做 promote/demote 决策 ==============
    try {
      const { getSkillEvolver } = await import('./skill-evolver.js');
      const { skillOrchestrator } = await import('./skill-orchestrator.js');
      const evolver = getSkillEvolver();
      const decisions = evolver.evaluate();
      for (const d of decisions) {
        if (d.type === 'demote' && d.new_status === 'deprecated') {
          try {
            skillOrchestrator.unregister(d.skill_name);
            console.log(`[evolution] deprecated skill: ${d.skill_name} (${d.reason})`);
          } catch { /* unregister optional */ }
        } else if (d.type === 'promote') {
          console.log(`[evolution] promoted skill: ${d.skill_name} (${d.reason})`);
        }
        this.emit('evolution:decision', d);
      }
      if (decisions.length > 0) {
        console.log(`[evolution] ${decisions.length} evolution decisions made`);
      }
    } catch (e: any) { console.warn('[loop] evolution optional:', e?.message || e); }

    // ============== 行业洞察自动提取 (授人以渔: 让AI自主积累行业知识) ==============
    try {
      const { insightAccumulator } = await import('./insight-accumulator.js');
      const assistantText = typeof lastResponse.content === 'string' ? lastResponse.content : '';
      const insight = insightAccumulator.extractInsight(lastUserText, assistantText);
      if (insight) {
        console.log(`[insight] extracted: [${insight.category}] ${insight.content.slice(0, 60)}... (industry: ${insight.industryName})`);
        this.emit('insight:extracted', insight);
      }
    } catch (e: any) { console.warn('[loop] insight extraction optional:', e?.message || e); }
    
    // ============== 2026-06-24 新增: 临时文件自动清理 ==============
    // 任务完成后，自动清理AI创建的临时文件（测试脚本、临时文件等）
    try {
      const cleanupResult = await cleanupTempFiles(this.opts.userId);
      if (cleanupResult.deleted > 0) {
        console.log(`[temp-cleanup] cleaned ${cleanupResult.deleted} temp files (${cleanupResult.kept} kept)`);
        this.emit('temp:files:cleaned', { deleted: cleanupResult.deleted, kept: cleanupResult.kept });
        // 如果有错误，记录但不阻塞主流程
        if (cleanupResult.errors.length > 0) {
          console.warn('[temp-cleanup] errors:', cleanupResult.errors.slice(0, 3));
        }
      }
    } catch (e: any) {
      console.warn('[temp-cleanup] failed:', e?.message);
    }

    // ═══ 2026-07-30 新增: 导出工具调用分析到 evolution ═══
    try {
      finalizeSessionAnalytics(this.opts.userId || 'anonymous');
    } catch (e: any) {
      console.warn('[tool-analytics] finalize failed:', e?.message);
    }
    
    // ═══ 2026-06-24 新增: 透明进度推送 ═══
    // 任务完成时发射进度事件
    this.emit('progress', {
      step: 'done',
      description: '任务已完成',
      percent: 100,
      iterations: this.iteration,
      durationMs: Date.now() - startedAt
    });

    // ═══ 2026-06-26 新增: WorkspaceJournal 自动日报追加 ═══
    // 对标 WorkBuddy 三层记忆 Layer 3: {workspace}/.agentai/journal/YYYY-MM-DD.md
    // 仅在有实质性工作（工具调用 > 0）时写日报
    if (this.iteration > 0 && this.opts.workspace) {
      const lastUserText = typeof (
        [...this.context.appendOnlyLog].reverse().find(m => m.role === 'user')?.content
      ) === 'string'
        ? ([...this.context.appendOnlyLog].reverse().find(m => m.role === 'user')?.content as string).slice(0, 100)
        : '用户请求';
      const assistantSummary = lastResponse
        ? (typeof lastResponse.content === 'string' ? lastResponse.content : '')
            .trim().split('\n')[0]?.slice(0, 80) || '完成任务'
        : '完成任务';

      import('./memory.js').then(({ workspaceJournal }) => {
        workspaceJournal.append(this.opts.workspace!, {
          summary: assistantSummary,
          taskType: detectTaskType(lastUserText),
          files: this.context.appendOnlyLog
            .filter(m => m.role === 'tool')
            .flatMap(m => {
              const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
              const matches = c.match(/(?:wrote|created|modified|edited)\s+([\w./\\-]+\.\w+)/gi) || [];
              return matches.map(s => s.replace(/^(?:wrote|created|modified|edited)\s+/i, ''));
            })
            .slice(0, 5),
        });
      }).catch(() => { /* journal write optional */ });
    }

    // ═══ 2026-06-27 新增: 自动技能创建 (复杂多步任务 → 自动生成 SKILL.md) ═══
    // 对标 WorkBuddy: 检测 8+ 工具调用的工作流, 自动创建可复用的 SKILL.md
    if (this.iteration > 0 && this.opts.workspace) {
      import('./auto-skill-creator.js').then(async (m) => {
        try {
          const { toolCalls, filesTouched } = m.extractToolCallsFromLog(this.context.appendOnlyLog);
          const skillPath = await m.autoCreateSkillOnComplexTask(this.opts.workspace!, toolCalls, filesTouched);
          if (skillPath) {
            console.log(`[auto-skill] ✅ 工作流技能已创建: ${skillPath}`);
            this.emit('skill:created', { path: skillPath });
          }
        } catch (e) {
          console.warn('[auto-skill] 分析失败:', (e as Error).message);
        }
      }).catch(() => { /* auto-skill optional */ });
    }

    // ═══ SkillEvolver 进化评估 + 执行决策 ═══
    // 每轮结束后检查技能使用数据, 做出进化决策并真正执行
    if (this.iteration > 0) {
      import('./skill-evolver.js').then(async ({ getSkillEvolver }) => {
        try {
          const evolver = getSkillEvolver();
          const decisions = evolver.evaluate();
          if (decisions.length > 0) {
            const activeDecisions = decisions.filter(d => d.type !== 'create');
            if (activeDecisions.length > 0) {
              console.log(`[skill-evolver] ${activeDecisions.length} 项进化决策:`);
              for (const d of activeDecisions) {
                console.log(`  - [${d.type}] ${d.skill_name}: ${d.reason}`);
                // 执行 deprecated 决策: 从技能注册表注销
                if (d.type === 'demote' && d.new_status === 'deprecated') {
                  try {
                    const { skillOrchestrator } = await import('./skill-orchestrator.js');
                     skillOrchestrator.unregister(d.skill_name);
                    console.log(`  - ✅ 已注销低质技能: ${d.skill_name}`);
                  } catch { /* unregister optional */ }
                }
                // 执行 promote 决策: 写入进化记忆
                if (d.type === 'promote') {
                  try {
                    const { writeEvolution } = await import('./evolution.js');
                    writeEvolution({
                      type: 'success',
                      content: `Skill "${d.skill_name}" promoted: ${d.reason}`,
                      userId: this.opts.userId,
                      workspace: this.opts.workspace,
                    });
                  } catch { /* evolution write optional */ }
                }
              }
            }
            // 检测可合并技能
            const mergable = evolver.detectMergable();
            if (mergable.length > 0) {
              console.log(`[skill-evolver] ${mergable.length} 对技能可合并:`);
              mergable.forEach(m => console.log(`  - ${m.skillA} ↔ ${m.skillB} (${Math.round(m.similarity * 100)}%): ${m.reason}`));
            }
          }
        } catch (e) {
          console.warn('[skill-evolver] 评估失败:', (e as Error).message);
        }
      }).catch(() => { /* skill-evolver optional */ });
    }

    // ═══ 2026-06-27 新增: 记忆蒸馏 (定期将旧日报归档到 MEMORY.md) ═══
    // 每 10 轮触发一次日志蒸馏
    if (this.opts.workspace && this.iteration > 0 && this.iteration % 10 === 0) {
      import('./memory.js').then(({ workspaceJournal }) => {
        workspaceJournal.distillOldLogs(this.opts.workspace!).catch(() => {});
      }).catch(() => {});
    }

    // ═══ 2026-06-26 新增: 蒸馏结果注入 system prompt ═══
    // 每次 loop 开始前，从 distilled patterns 中提取高置信度规则注入 prompt
    let systemPromptOverride: string | undefined;
    try {
      const { readDistilledPatterns, patternsToSystemPrompt } = await import('./model-distiller.js');
      const distilledResults = readDistilledPatterns(5);
      if (distilledResults.length > 0) {
        const latestDistill = distilledResults[distilledResults.length - 1];
        if (latestDistill && latestDistill.patterns) {
          const promptFragment = patternsToSystemPrompt(latestDistill.patterns);
          if (promptFragment.trim()) systemPromptOverride = promptFragment;
        }
      }
    } catch (e) { console.warn('[loop] distilled patterns optional:', (e as any)?.message || e); }

    // ═══ 2026-06-26 新增: Model Distiller 自动蒸馏 ═══
    // 每次 loop 结束后，异步提取成功模式 → 固化经验
    if (this.iteration > 0 && this.opts.workspace) {
      import('./model-distiller.js').then((m: any) => {
        if (m && m.writeEvolution) {
          m.writeEvolution({
            type: 'success',
            content: `Loop completed in ${this.iteration} iterations. Provider: ${lastResponse?.provider || 'unknown'}. Cost: ${(lastResponse?.usage?.cost || 0).toFixed(4)} USD.${systemPromptOverride ? ' Distilled rules injected.' : ''}`,
            userId: this.opts.userId,
            sessionId: this.context.sessionId,
            workspace: this.opts.workspace,
            taskType: detectTaskType(lastUserText || ''),
            keywords: extractKeywords(lastUserText || ''),
          });
        }
      }).catch(() => { /* distillation optional */ });
    }

    // ═══ 2026-06-27 新增: 保存会话摘要 (跨会话连续记忆) ═══
    if (this.opts.workspace && this.iteration > 0) {
      try {
        const { getPersistentMemory } = await import('./persistent-memory.js');
        const pm = getPersistentMemory();
        const userGoal = (typeof userMessage === 'string' ? userMessage : '').slice(0, 200);
        const toolsUsed = this.context.appendOnlyLog
          .filter(m => m.role === 'tool')
          .map(m => (m as any).name || 'unknown');
        const filesModified = this.context.appendOnlyLog
          .filter(m => m.role === 'tool' && typeof m.content === 'string')
          .flatMap(m => {
            const c = m.content as string;
            const matches = c.match(/(?:wrote|created|modified|edited|Written|Created)\s+([\w./\\-]+\.\w+)/gi) || [];
            return matches.map(s => s.replace(/^(?:wrote|created|modified|edited|Written|Created)\s+/i, ''));
          });
        const summaryText = (typeof lastResponse.content === 'string' ? lastResponse.content : '').slice(0, 500);
        pm.saveSessionSummary(this.opts.workspace, {
          userGoal,
          toolsUsed: [...new Set(toolsUsed)],
          filesModified: [...new Set(filesModified)],
          summary: summaryText,
          taskType: detectTaskType(userGoal),
        });
      } catch { /* session summary save optional */ }
    }

    // ═══ 2026-08-03 新增: WorldModel 因果知识图谱知识提取 ═══
    // 仅当有实质性工具调用时触发 (≥1个迭代)，避免闲聊污染图谱
    if (this.iteration > 0 && this.opts.workspace) {
      import('./world-model.js').then(async ({ getWorldModel }) => {
        try {
          // 从对话日志构造"虚拟任务"给 WorldModel
          const toolEntries = this.context.appendOnlyLog
            .filter(m => m.role === 'tool')
            .slice(0, 30);
          if (toolEntries.length === 0) return;

          const userGoalTxt = (typeof userMessage === 'string' ? userMessage : '').slice(0, 500);
          const summaryTxt = (typeof lastResponse.content === 'string' ? lastResponse.content : '').slice(0, 500);

          const fakeTask = {
            id: this.context.sessionId || `task-${Date.now()}`,
            description: userGoalTxt,
            steps: toolEntries.map((m, i) => ({
              id: `step-${i}`,
              action: (m as any).name || 'tool',
              result: typeof m.content === 'string' ? m.content.slice(0, 300) : JSON.stringify(m.content).slice(0, 300),
              status: 'completed' as const,
              duration: 1000,
            })),
            outcome: 'success',
            totalDuration: Date.now() - startedAt,
          };

          const wm = getWorldModel(this.router, this.opts.workspace);
          const result = await wm.extractKnowledge(fakeTask as any);
          if ((result.entities?.length || 0) + (result.relations?.length || 0) + (result.rules?.length || 0) > 0) {
            console.log(`[world-model] ✅ 知识提取: ${result.entities?.length || 0}实体 / ${result.relations?.length || 0}关系 / ${result.rules?.length || 0}规则`);
            this.emit('worldmodel:extracted', result);
          }
        } catch (e: any) {
          console.warn('[world-model] extract failed:', e?.message || e);
        }
      }).catch(() => { /* world-model extraction optional */ });
    }

    // ═══ 任务自监督: 停止计时器 + 发射最终状态 ═══
    supervisor.stopTimer();
    const finalState = supervisor.getState();
    this.emit('supervisor:complete', {
      timer: finalState.timer,
      fileChanges: finalState.fileChanges,
      health: finalState.health,
    });
    console.log(`[supervisor] ✅ 任务完成 — ${finalState.timer.formatted} | ${finalState.fileChanges.formatted} (${finalState.fileChanges.files} files)`);

    //  flush 未发出的 delta 缓冲 (流结束前的最后一批 token)
    this._flushDeltaBuffer();

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
      // CSSL: 传入任务类型/行业/关键词，让元指令可被精准召回
      const { detectTaskType, extractKeywords } = await import('./system-prompt-lite.js');
      const { userModel } = await import('./user-model.js');
      const reflectTaskType = detectTaskType(userText);
      const reflectIndustry = userModel.get(this.opts.userId).identity.industry || 'general';
      const reflectKeywords = extractKeywords(userText);
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
        taskType: reflectTaskType,
        industry: reflectIndustry,
        keywords: reflectKeywords,
      });

      // ═══ 系统管控员: 记录 Reflector 诊断结果到动态能力矩阵 ═══
      try {
        const { getTracker } = await import('./governor/runtime-capability-tracker.js');
        const modelId = `${this.opts.model}:${this.opts.modelName || 'default'}`;
        // 从 evolution 记录中提取最新的诊断类型
        const { readEvolution } = await import('./evolution.js');
        const recent = readEvolution(1);
        const lastEntry = recent[recent.length - 1];
        if (lastEntry?.diagnosisType) {
          getTracker().recordReflectorDiagnosis(modelId, this._taskType, lastEntry.diagnosisType);
        }
      } catch { /* tracker 容错 */ }
    } catch (e) {
      console.warn('[reflector] import/exec failed:', (e as Error).message);
    }
  }

  /**
   * 智能工具过滤 v2: 核心工具集扩大到 22 个 + 补全全部意图关键词
   * 设计目标: AI 永远能看到自己的核心能力, 不会因为关键词没匹配到而"失忆"
   */
  private filterToolsByIntent(message: string, allTools: any[]): any[] {
    const msg = message.toLowerCase();
    const getName = (t: any) => t.name || t.function?.name || '';

    // ═══ 核心工具: 永远包含 — 这些是 AI 的"基本感官" ═══
    const CORE = new Set([
      // 文件操作 (基本感官)
      'read_file', 'write_file', 'list_directory', 'search_content', 'directory_tree',
      // 交互 (基本感官)
      'ask_user', 'run_code',
      // 编辑 (高频)
      'multi_edit',
      // 搜索 (高频)
      'web_search', 'web_fetch', 'search_codebase',
      // 任务规划 (高频)
      'plan_task', 'update_plan', 'spawn_subagent',
      // 记忆 (高频)
      'remember', 'recall_memory',
      // 项目探索 (高频)
      'explore_project',
      // Git (开发者基本需求)
      'git_status', 'git_diff',
      // 依赖管理 (自主修复需要)
      'npm_install',
      // Office (高频业务需求)
      'officecli',
      // 后台进程 (长任务需要)
      'run_background', 'job_output',
      // 生成能力 (通用能力, 不应被工具组过滤掉)
      'generate_image', 'generate_video', 'query_video', 'generate_diagram',
      // 技能发现/创建/锻造 (AI 应能主动创建技能)
      'discover_or_create_skill', 'skill_forge', 'evolve_prompt', 'create_tool',
    ]);

    // ═══ 意图→工具组映射 (补全了浏览器/桌面/CAD/代码审查/Worktree等缺失能力) ═══
    const INTENT_TOOLS: Array<{ pattern: RegExp; tools: string[] }> = [
      // 文件编辑
      { pattern: /编辑|修改|改|重构|替换|edit|modify|refactor/i, tools: ['multi_edit', 'create_directory', 'copy_file', 'move_file', 'delete_file', 'get_file_info', 'find_references', 'get_outline', 'run_tests', 'diff_preview', 'undo_edit'] },
      // 搜索
      { pattern: /搜索|查找|查|找|search|find|grep/i, tools: ['search_content', 'search_codebase', 'web_search', 'web_fetch', 'find_references', 'glob'] },
      // 网络
      { pattern: /网|链接|url|http|搜|百度|google|网页/i, tools: ['web_search', 'web_fetch'] },
      // 图片生成
      { pattern: /图|画|图片|image|picture|海报|效果图|插画/i, tools: ['generate_image'] },
      // 视频生成
      { pattern: /视频|video|动画|短片/i, tools: ['generate_video', 'query_video'] },
      // 图表
      { pattern: /图表|流程|架构|diagram|chart/i, tools: ['generate_diagram'] },
      // 屏幕视觉 (新增 — AI 自己能看)
      { pattern: /截屏|截图|看屏幕|屏幕上|看到|screen.*shot|capture/i, tools: ['capture_screen', 'capture_and_read', 'ocr_image'] },
      // 窗口控制
      { pattern: /窗口|最小化|最大化|置顶|window/i, tools: ['list_windows', 'window_control'] },
      // 记忆
      { pattern: /记忆|记住|remember|recall|偏好/i, tools: ['remember', 'recall_memory', 'forget'] },
      // 任务规划
      { pattern: /计划|分解|子任务|plan|task|排期/i, tools: ['plan_task', 'update_plan', 'spawn_subagent'] },
      // 项目探索
      { pattern: /探索|项目|架构|分析|explore/i, tools: ['explore_project', 'directory_tree', 'get_outline', 'find_references'] },
      // 行业
      { pattern: /行业|装修|报价|方案/i, tools: ['industry_insight', 'remember', 'recall_memory'] },
      // 诊断
      { pattern: /诊断|检查|修复|self.*diagnose/i, tools: ['self_diagnose'] },
      // 进化
      { pattern: /进化|规则|evolve|自我/i, tools: ['evolve_prompt', 'create_tool', 'discover_or_create_skill'] },
      // 文件操作
      { pattern: /文件|上传|下载|excel|docx|pdf|pptx/i, tools: ['get_file_info', 'copy_file', 'move_file', 'officecli'] },
      // 命令/终端
      { pattern: /命令|终端|shell|npm|pip/i, tools: ['run_code', 'run_background'] },
      // 微信/QQ
      { pattern: /微信|qq|wechat|bot/i, tools: ['wechat_bot', 'connect_qq_bot'] },
      // Git
      { pattern: /git|提交|commit|分支|branch|推送|push|拉取|pull|diff|合并|merge/i, tools: ['git_status', 'git_diff', 'git_log', 'git_commit', 'git_branch', 'worktree_create', 'worktree_list', 'worktree_remove'] },
      // 代码引用/结构
      { pattern: /引用|调用|依赖|符号|symbol|reference|outline|结构/i, tools: ['find_references', 'get_outline', 'get_symbols', 'analyze_code'] },
      // 测试
      { pattern: /测试|test|spec|验证|verify|pytest|jest|vitest/i, tools: ['run_tests', 'run_code'] },
      // 音乐
      { pattern: /音乐|放歌|听歌|背景音乐|放松|music|song|play|pause|volume|音量|播放/i, tools: ['control_music'] },
      // ═══ 以下为新增关键词 (之前完全缺失, 导致30+工具隐形) ═══
      // 浏览器自动化
      { pattern: /浏览器|网页操作|登录|点击|填表|抓取|browse|browser|navigate|网页填|自动登录|表单/i, tools: ['browser_navigate', 'browser_click', 'browser_type', 'browser_screenshot', 'browser_extract'] },
      // 桌面控制
      { pattern: /桌面|截图|按键|鼠标|打开应用|desktop|screenshot|键鼠|自动化操作|操控电脑|控制电脑/i, tools: ['desktop_automate', 'open_application', 'visual_gui_agent'] },
      // CAD
      { pattern: /cad|图纸|户型|dxf|施工图|auto.*cad|制图/i, tools: ['cad_control'] },
      // 代码审查
      { pattern: /审查|review|安全|漏洞|质量|code.*quality|代码审|代码检查/i, tools: ['code_review', 'find_references', 'analyze_code'] },
      // Worktree
      { pattern: /worktree|隔离|并行开发|分支隔离/i, tools: ['worktree_create', 'worktree_list', 'worktree_remove'] },
      // 知识库
      { pattern: /知识库|导入知识|行业知识|文档上传|knowledge/i, tools: ['knowledge_import', 'industry_insight'] },
      // 技能锻造
      { pattern: /锻造|forge|自动.*技能|抓取.*网站|自动化.*网站|skill.*forge/i, tools: ['skill_forge', 'discover_or_create_skill'] },
      // PRD
      { pattern: /需求|prd|产品需求|用户故事|验收标准|功能规格/i, tools: ['spec_generate', 'plan_task'] },
      // 类型检查
      { pattern: /类型|typecheck|类型错误|ts.*错误|编译错误|类型检查/i, tools: ['typecheck', 'diff_preview'] },
      // 后台任务管理
      { pattern: /后台|进程|job|任务.*运行|长.*运行/i, tools: ['run_background', 'job_output', 'wait_for_job', 'stop_job', 'list_jobs'] },
    ];

    // 收集匹配的工具名
    const selected = new Set<string>(CORE);
    for (const { pattern, tools } of INTENT_TOOLS) {
      if (pattern.test(msg)) {
        for (const t of tools) selected.add(t);
      }
    }

    // 如果消息很复杂 (>50字) 或是首轮, 给更多工具
    if (msg.length > 50 || this.iteration === 0) {
      selected.add('plan_task');
      selected.add('update_plan');
      selected.add('spawn_subagent');
      selected.add('web_search');
      selected.add('remember');
      selected.add('recall_memory');
      selected.add('explore_project');
      selected.add('code_review');
      selected.add('self_diagnose');
    }

    // 后续轮次: 追加已使用过的工具 (AI 可能需要继续调用)
    if (this.iteration > 0) {
      for (const m of this.context.appendOnlyLog) {
        if (m.role === 'tool' && (m as any).name) {
          selected.add((m as any).name);
        }
      }
      // 后续轮次也给编辑工具 (AI 经常在读取后需要修改)
      for (const t of ['multi_edit', 'create_directory', 'delete_file', 'glob', 'get_file_info', 'diff_preview', 'undo_edit']) {
        selected.add(t);
      }
    }

    const filtered = allTools.filter(t => selected.has(getName(t)));
    // ═══ Cap: 提高到 25 (免费) / 40 (商用), 让 AI 看到更多能力 ═══
    // 优先保证: 高价值工具必须在顶部(不会被 cap 裁掉)
    const PRIORITY_TOOLS = new Set([
      'spawn_subagent', 'explore_project', 'plan_task', 'update_plan',
      'directory_tree', 'read_file', 'write_file', 'search_content',
      'multi_edit', 'run_code', 'ask_user', 'web_search',
      'browser_navigate', 'desktop_automate', 'officecli',
    ]);
    const priority = filtered.filter(t => PRIORITY_TOOLS.has(getName(t)));
    const rest = filtered.filter(t => !PRIORITY_TOOLS.has(getName(t)));
    const MAX_TOOLS = this.opts.model === 'deepseek' && !this.opts.modelName?.includes('pro') ? 25 : 40;
    const remaining = MAX_TOOLS - priority.length;
    const capped = [...priority, ...rest.slice(0, Math.max(0, remaining))];
    console.log(`[tools-filter] iter=${this.iteration} ${allTools.length} → ${capped.length} tools (msg: ${msg.slice(0, 40)})`);
    return capped.length >= 5 ? capped : allTools; // 安全兜底: 太少就给全部
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

    // Hook: SessionStart（如果尚未开始会话，则在第一次工具调用时开始）
    if (!this.hookSessionId) {
      this.hookSessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      // 传入已生成的 sessionId, 确保 hookCapture 中的 session 与 loop 中的一致
      await hookCapture.onSessionStart(this.opts.userId, this.opts.workspace, ctx, this.hookSessionId);
    }

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

        // 🚀 auto 模式: 非核心文件自动通过审批 (不阻塞用户)
        // 仅 planning 模式下才需要用户审批文件操作
        if (this.opts.mode === 'auto' && !filePath.includes('agentai-gateway/src')) {
          approvedCalls.push(tc.id);
          console.log(`[auto-mode] 自动批准: ${tc.name} ${filePath}`);
          continue;
        }

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
    
    // Hook: PreToolUse - 检查是否允许执行工具
    for (const c of callsToDispatch) {
      const canProceed = await hookCapture.onPreToolUse(
        this.hookSessionId,
        c.name,
        c.args,
        ctx
      );
      if (!canProceed) {
        // 如果Hook要求中断，跳过此工具
        console.log(`[Hook PreToolUse] Blocked: ${c.name}`);
        rejectedResults.push({
          id: c.id,
          name: c.name,
          output: '[BLOCKED BY HOOK] This tool call was blocked by lifecycle hooks system',
          data: null
        });
        continue;
      }
    }

    // 移除被Hook阻止的调用
    const callsToDispatchFiltered = callsToDispatch.filter(
      c => !rejectedResults.find(r => r.id === c.id)
    );

      // 发射 tool:start 事件 (仅被批准的)
    for (const c of callsToDispatchFiltered) this.emit('tool:start', { callId: c.id, name: c.name, args: c.args });
    let results = callsToDispatchFiltered.length > 0 ? await this.registry.dispatch(callsToDispatchFiltered, ctx) : [];

    // 自动重试: 失败的工具最多重试 2 次 (仅限可重试的临时错误)
    const retryableErrors = /timeout|ECONNREFUSED|ECONNRESET|ETIMEDOUT|network|503|429|rate.limit/i;
    // undefined 属性访问错误 (slice/length 等) 也可重试: 工具内部状态问题, 重试可能成功
    const undefinedPropertyErrors = /Cannot read properties of (?:undefined|null) \(reading/i;
    for (let retry = 0; retry < 2; retry++) {
      const failedCalls = callsToDispatch.filter(c => {
        const r = results.find(x => x.id === c.id);
        const output = r?.result?.output || '';
        const error = r?.result?.error || '';
        const combined = `${output} ${error}`;
        return r?.result?.success === false && (retryableErrors.test(combined) || undefinedPropertyErrors.test(combined));
      });
      if (failedCalls.length === 0) break;
      console.log(`[tool-retry] retry ${retry + 1}: ${failedCalls.map(c => c.name).join(', ')}`);
      await new Promise(r => setTimeout(r, 1000 * (retry + 1))); // 1s, 2s 退避
      const retryResults = await this.registry.dispatch(failedCalls, ctx);
      // 合并重试结果
      for (const rr of retryResults) {
        const idx = results.findIndex(x => x.id === rr.id);
        if (idx >= 0) results[idx] = rr;
      }
    }

    // Hook: PostToolUse - 通知工具执行完成
    for (const call of callsToDispatchFiltered) {
      const result = results.find(r => r.id === call.id);
      if (result) {
        await hookCapture.onPostToolUse(
          this.hookSessionId,
          call.name,
          call.args,
          result as any, // ToolResult
          ctx
        );
      }
    }

    // 发射 tool:result 事件 (仅被批准的)
    for (const c of callsToDispatch) {
      const r = results.find(x => x.id === c.id);
      this.emit('tool:result', { callId: c.id, name: c.name, result: r?.result?.output || '', ok: r?.result?.success !== false, durationMs: r?.result?.durationMs || 0 });

      // ═══ 2026-07-30 新增: 工具调用历史分析记录 ═══
      recordToolCall(c.name, c.args, {
        success: r?.result?.success !== false,
        error: r?.result?.success === false ? r.result.output : undefined,
        duration: r?.result?.durationMs || 0,
        retryCount: 0, // 重试次数在上方逻辑中统计
      });

      // ═══ 2026-06-27 修复: widget 渲染通道 ═══
      // render_widget 工具返回的 data 中带有 __type: 'widget'，
      // 需要单独发射 widget:show 事件让前端渲染
      if (r?.result?.data?.__type === 'widget') {
        this.emit('widget:show', {
          title: r.result.data.title,
          contentType: r.result.data.contentType,
          content: r.result.data.content,
          width: r.result.data.width,
          height: r.result.data.height,
        });
      }

      // 2026-06-24 新增: 临时文件追踪（任务完成后自动清理）
      if (r?.result?.success && c.args) {
        // 检查是否是文件创建工具
        const fileCreateTools = ['write_file', 'create_file', 'run_code', 'run_shell_command'];
        if (fileCreateTools.includes(c.name)) {
          // 提取文件路径
          const filePath = c.args.file_path || c.args.path || c.args.file || '';
          if (filePath && isTempFile(filePath, c.name)) {
            trackTempFile({
              filePath,
              toolName: c.name,
              sessionId: this.opts.userId,
              reason: 'AI创建的临时文件'
            });
            this.emit('temp:file:tracked', { filePath, toolName: c.name });
          }
        }
      }
    }
    // 合并结果: 批准的 + 被拒绝的
    const approvedResults = callsToDispatch.map(c => {
      const r = results.find(x => x.id === c.id);
      return {
        id: c.id,
        name: c.name,
        output: r ? this.formatToolResult(r.result, c) : '[no result]',
        data: r?.result?.data || null,
      };
    });
    return [...approvedResults, ...rejectedResults];
  }

  private formatToolResult(r: ToolResult, call?: { id: string; name: string; args: Record<string, any> }): string {
    if (r.success) {
      let output = typeof r.output === 'string' ? r.output : JSON.stringify(r.output);

      // ═══ 2026-06-27 新增: 工具触觉反馈 — 增强结果信息量 ═══
      // 让 AI 感知到工具执行的"质感": 耗时、文件大小、行数等
      if (call) {
        const meta: string[] = [];

        // 耗时 (所有工具)
        if (r.durationMs && r.durationMs > 0) {
          const ms = r.durationMs;
          meta.push(ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);
        }

        // 文件操作: 添加文件大小和行数
        const filePath = call.args?.file_path || call.args?.path || call.args?.file;
        if (filePath && typeof filePath === 'string') {
          try {
            const { existsSync, statSync } = require('fs');
            const { resolve } = require('path');
            const ws = this.opts.workspace || process.cwd();
            const abs = resolve(ws, filePath);
            if (existsSync(abs)) {
              const stat = statSync(abs);
              const sizeKB = (stat.size / 1024).toFixed(1);
              meta.push(`${sizeKB}KB`);
              // 文本文件: 统计行数
              if (/\.(ts|tsx|js|jsx|py|json|md|css|html|vue|go|rs|java|c|cpp|h)$/i.test(filePath)) {
                const content = require('fs').readFileSync(abs, 'utf-8');
                const lines = content.split('\n').length;
                meta.push(`${lines}行`);
              }
            }
          } catch { /* stat optional */ }
        }

        // 搜索类工具: 结果数量
        if (['search_codebase', 'search_content', 'grep', 'glob', 'find_references'].includes(call.name)) {
          const lines = output.split('\n').filter(l => l.trim()).length;
          if (lines > 0 && !output.includes('No results') && !output.includes('无结果')) {
            meta.push(`${lines}条结果`);
          }
        }

        // 附加元信息到输出末尾
        if (meta.length > 0) {
          output += `\n[memory:meta] ${meta.join(' · ')}`;
        }
      }

      return output;
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
