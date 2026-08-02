/**
 * Evolution - 自进化记忆系统 (跨项目学习)
 * ----------------------------------------------------
 * 闭环设计:
 *   1. AgentAILoop 每次结束 → writeEvolution()
 *   2. 后台任务每 6 小时 → cleanupEvolution() 限制文件大小
 *   3. AgentAILoop 启动时 → readEvolution() 作为长期记忆上下文
 *
 * @see docs/INTEGRATION_ARCHITECTURE.md
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/** 扩展错误类型 */
export type ErrorType =
  // 基础类型
  | 'TypeError' | 'ReferenceError' | 'SyntaxError' | 'NetworkError' | 'FileSystemError' | 'PermissionError' | 'TimeoutError' | 'UnknownError'
  // API/服务相关
  | 'RateLimitError'      // 429 限流
  | 'AuthError'           // 401/403 认证授权失败
  | 'ServiceUnavailable'  // 503 服务不可用
  | 'BadRequest'          // 400 请求参数错误
  // 资源相关
  | 'ResourceExhausted'   // 资源耗尽 (内存/磁盘/配额)
  | 'QuotaExceeded'       // API 配额超限
  // 逻辑错误
  | 'ValidationError'     // 数据校验失败
  | 'ConflictError'       // 409 资源冲突
  | 'NotFoundError'       // 404 资源不存在
  // 外部依赖
  | 'DependencyError'     // 外部依赖失败
  | 'ExternalAPIError';   // 第三方 API 错误

export interface EvolutionEntry {
  ts: number;
  type: 'success' | 'failure' | 'preference' | 'tool_stats' | 'meta_instruction' | 'self-eval-insight' | 'self_modify_proposal' | 'self_modify_executed' | 'self_modify_rollback' | 'feedback_negative' | 'tool_iteration';
  content: string;
  /** 是否成功 */
  success?: boolean;
  metadata?: Record<string, any>;
  /** 关联的 session id (可追溯) */
  sessionId?: string;
  /** 关联的 user id */
  userId?: string;
  /** 关联的工作空间 */
  workspace?: string;
  /** 2026-06-24 新增: 任务类型（用于智能召回） */
  taskType?: 'coding' | 'research' | 'general' | 'industry';
  /** 2026-06-24 新增: 行业（用于智能召回） */
  industry?: string;
  /** 2026-06-24 新增: 错误类型（用于智能召回） */
  errorType?: ErrorType;
  /** 2026-06-24 新增: 关键词（用于智能召回） */
  keywords?: string[];
  /** 2026-06-25 CSSL 新增: 元指令的诊断类型 */
  diagnosisType?: 'information_gap' | 'reasoning_error' | 'knowledge_gap' | 'over_confidence' | 'unverified_assumption';
  /** 2026-07-02 新增: 失因分类 (学 EmbodiSkill) — 区分技能缺陷 vs 执行失误 */
  failureCategory?: 'skill_defect' | 'execution_error' | 'environment_issue' | 'unknown';
  /** 2026-07-02 新增: 关联的技能名 (失因分类时关联到具体技能) */
  relatedSkill?: string;
  /** 2026-07-30 新增: 自编程相关字段 */
  proposalId?: string;
  targetFile?: string;
  reason?: string;
  failureInfo?: string;
  proposal?: any;
  result?: any;
  /** 2026-07-30 新增: 工具调用历史分析字段 */
  toolCall?: {
    toolName: string;
    params: any;
    duration: number;
    retryCount: number;
  };
}

/**
 * 2026-07-02 新增: 失因分类 (学 EmbodiSkill 技能感知反思机制)
 * ----------------------------------------------------------------
 * 区分两种失败:
 *   - skill_defect: 技能/规则本身写错了 → 需要修改技能
 *   - execution_error: 技能正确但执行出错 (网络超时/权限不足等) → 只记录教训, 不改技能
 *   - environment_issue: 环境问题 (依赖缺失/路径不存在等) → 修复环境, 不改技能
 *
 * 这样可以避免「网络超时就去改技能逻辑」这类错误进化
 */
export function classifyFailure(opts: {
  errorMessage: string;
  errorType?: ErrorType;
  toolName?: string;
  skillName?: string;
  statusCode?: number;
}): EvolutionEntry['failureCategory'] {
  const msg = (opts.errorMessage || '').toLowerCase();
  const statusCode = opts.statusCode;

  // 根据 HTTP 状态码快速判断
  if (statusCode) {
    if (statusCode === 429) return 'execution_error'; // Rate limit → 重试
    if (statusCode === 401 || statusCode === 403) return 'environment_issue'; // Auth → 检查密钥
    if (statusCode === 503 || statusCode === 502) return 'execution_error'; // 服务不可用 → 重试
    if (statusCode === 400) return 'skill_defect'; // 请求错误 → 检查参数
    if (statusCode === 404) return 'environment_issue'; // 资源不存在 → 检查路径
    if (statusCode === 409) return 'execution_error'; // 冲突 → 可能需要重试
  }

  // 根据 errorType 判断
  if (opts.errorType) {
    // 环境问题
    if (['FileSystemError', 'PermissionError', 'NotFoundError', 'ResourceExhausted'].includes(opts.errorType)) {
      return 'environment_issue';
    }
    // 执行失误 (可重试)
    if (['NetworkError', 'TimeoutError', 'RateLimitError', 'ServiceUnavailable', 'ExternalAPIError', 'DependencyError'].includes(opts.errorType)) {
      return 'execution_error';
    }
    // 技能缺陷
    if (['SyntaxError', 'TypeError', 'ReferenceError', 'ValidationError', 'BadRequest'].includes(opts.errorType)) {
      return 'skill_defect';
    }
  }

  // 环境问题: 依赖缺失、路径不存在、权限不足
  if (/module not found|cannot find module|enoent|no such file|permission denied|eacces/.test(msg)) {
    return 'environment_issue';
  }
  // 资源耗尽
  if (/out of memory|memory leak|disk full|quota exceeded|rate limit exceeded/.test(msg)) {
    return 'environment_issue';
  }

  // 执行失误: 网络超时、连接失败、临时性错误
  if (/timeout|econnrefused|econnreset|socket hang up|fetch failed|network/.test(msg)) {
    return 'execution_error';
  }
  // 限流
  if (/rate limit|too many requests|429|throttled/.test(msg)) {
    return 'execution_error';
  }
  // 认证失败
  if (/unauthorized|authentication failed|invalid.*token|api.*key|401|403/.test(msg)) {
    return 'environment_issue';
  }
  // 服务不可用
  if (/service unavailable|temporarily unavailable|503|502|bad gateway/.test(msg)) {
    return 'execution_error';
  }

  // 技能缺陷: 语法错误、类型错误、引用错误 — 说明技能/代码本身有问题
  if (/syntaxerror|typeerror|referenceerror|is not a function|is not defined|unexpected token|invalid arguments/.test(msg)) {
    return 'skill_defect';
  }
  // 参数错误
  if (/parameter.*missing|parameter.*required|invalid.*param|missing.*param|wrong.*arg|argument.*not|validation.*failed/.test(msg)) {
    return 'skill_defect';
  }
  // 数据校验失败
  if (/validation|schema|invalid.*format|type.*mismatch/.test(msg)) {
    return 'skill_defect';
  }

  // 工具名存在但报参数错误 → 大概率是技能描述/参数定义有问题
  if (opts.toolName && /invalid.*param|missing.*param|wrong.*arg|argument.*not/.test(msg)) {
    return 'skill_defect';
  }

  return 'unknown';
}

/**
 * 2026-07-30 新增: 智能错误类型识别
 * 从错误消息中识别具体的错误类型
 */
export function detectErrorType(errorMessage: string, statusCode?: number): ErrorType {
  const msg = errorMessage.toLowerCase();

  // HTTP 状态码优先
  if (statusCode === 429) return 'RateLimitError';
  if (statusCode === 401 || statusCode === 403) return 'AuthError';
  if (statusCode === 503) return 'ServiceUnavailable';
  if (statusCode === 400) return 'BadRequest';
  if (statusCode === 404) return 'NotFoundError';
  if (statusCode === 409) return 'ConflictError';
  if (statusCode === 422) return 'ValidationError';

  // 模式匹配
  if (/rate limit|too many requests|throttled/.test(msg)) return 'RateLimitError';
  if (/unauthorized|authentication|invalid.*token|api.*key|401|403/.test(msg)) return 'AuthError';
  if (/service unavailable|503/.test(msg)) return 'ServiceUnavailable';
  if (/bad request|invalid request|400/.test(msg)) return 'BadRequest';
  if (/not found|404|enoent/.test(msg)) return 'NotFoundError';
  if (/conflict|409/.test(msg)) return 'ConflictError';
  if (/validation|schema|invalid.*format/.test(msg)) return 'ValidationError';
  if (/timeout|etimedout/.test(msg)) return 'TimeoutError';
  if (/network|econnrefused|econnreset|fetch failed/.test(msg)) return 'NetworkError';
  if (/out of memory|memory|disk full|quota/.test(msg)) return 'ResourceExhausted';
  if (/quota exceeded/.test(msg)) return 'QuotaExceeded';
  if (/dependency|external api|third party/.test(msg)) return 'DependencyError';
  if (/permission|eacces|eperm/.test(msg)) return 'PermissionError';
  if (/syntax|unexpected token/.test(msg)) return 'SyntaxError';
  if (/type.*error|is not a function|is not defined/.test(msg)) return 'TypeError';
  if (/reference.*error/.test(msg)) return 'ReferenceError';
  if (/filesystem|enoent/.test(msg)) return 'FileSystemError';

  return 'UnknownError';
}

/**
 * 2026-07-02 新增: 根据失因分类决定是否应该触发技能修改
   * 只有 skill_defect 才应该触发技能/规则修改
 * execution_error 和 environment_issue 只记录教训
 */
export function shouldTriggerSkillUpdate(failureCategory: EvolutionEntry['failureCategory']): boolean {
  return failureCategory === 'skill_defect';
}

const EVOLUTION_DIR = process.env.AGENTAI_EVOLUTION_DIR || path.join(os.homedir(), '.agentai', 'evolution');
const EVOLUTION_FILE = process.env.AGENTAI_EVOLUTION_FILE || path.join(EVOLUTION_DIR, 'evolution.jsonl');

/** 写入队列 (线程安全) */
const writeQueues = new Map<string, Promise<void>>();

function atomicAppend(filePath: string, line: string): Promise<void> {
  const queue = writeQueues.get(filePath) || Promise.resolve();
  const next = queue.then(async () => {
    try {
      await fs.promises.appendFile(filePath, line, 'utf-8');
    } catch (appendErr: any) {
      console.warn('[evolution:atomicAppend] appendFile failed:', appendErr?.message);
      // 文件可能不存在
    }
  }).finally(() => {
    writeQueues.delete(filePath);
  });
  writeQueues.set(filePath, next);
  return next;
}

/**
 * 写入 evolution 记录
 * 适用于 AgentAILoop 完成时调用
 */
export function writeEvolution(entry: Omit<EvolutionEntry, 'ts'>): void {
  try {
    fs.mkdirSync(EVOLUTION_DIR, { recursive: true });
    const full = { ...entry, ts: Date.now() };
    atomicAppend(EVOLUTION_FILE, JSON.stringify(full) + '\n');
  } catch (writeErr: any) {
    console.warn('[evolution:writeEvolution] failed:', writeErr?.message);
  }
}

/**
 * 异步版本 (不阻塞主流程)
 */
export function writeEvolutionAsync(entry: Omit<EvolutionEntry, 'ts'>): Promise<void> {
  return new Promise((resolve) => {
    try {
      fs.promises.mkdir(EVOLUTION_DIR, { recursive: true })
        .then(() => atomicAppend(EVOLUTION_FILE, JSON.stringify({ ...entry, ts: Date.now() }) + '\n'))
        .then(() => resolve());
    } catch (asyncErr: any) {
      console.warn('[evolution:writeEvolutionAsync] failed:', asyncErr?.message);
      resolve();
    }
  });
}

/**
 * 读取 evolution 记录
 */
export function readEvolution(limit: number = 50): EvolutionEntry[] {
  try {
    if (!fs.existsSync(EVOLUTION_FILE)) return [];
    const lines = fs.readFileSync(EVOLUTION_FILE, 'utf-8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map(l => {
      try { return JSON.parse(l); } catch { return null; } // JSON parse per line — expected for partial writes
    }).filter(Boolean);
  } catch (readErr: any) {
    console.warn('[evolution:readEvolution] failed:', readErr?.message);
    return [];
  }
}

/**
 * 启动时的批量预热 (读取相关 user/workspace 的历史)
 */
export function readEvolutionForContext(opts: { userId?: string; workspace?: string; limit?: number }): EvolutionEntry[] {
  const all = readEvolution(opts.limit || 100);
  if (!opts.userId && !opts.workspace) return all;

  return all.filter(e => {
    if (opts.userId && e.userId && e.userId !== opts.userId) return false;
    if (opts.workspace && e.workspace && e.workspace !== opts.workspace) return false;
    return true;
  });
}

/**
 * 2026-06-24 新增: 智能召回进化记忆
 * 按任务类型、行业、错误类型、关键词智能召回相关记忆
 */
export function recallEvolution(criteria: {
  taskType?: 'coding' | 'research' | 'general' | 'industry';
  industry?: string;
  errorType?: 'TypeError' | 'ReferenceError' | 'SyntaxError' | 'NetworkError' | 'FileSystemError' | 'PermissionError' | 'TimeoutError' | 'UnknownError';
  keywords?: string[];
  userId?: string;
  workspace?: string;
  limit?: number;
}): EvolutionEntry[] {
  const all = readEvolution(200);
  
  return all.filter(e => {
    // 1. 任务类型匹配
    if (criteria.taskType && e.taskType && e.taskType !== criteria.taskType) {
      return false;
    }
    
    // 2. 行业匹配
    if (criteria.industry && e.industry && e.industry !== criteria.industry) {
      return false;
    }
    
    // 3. 错误类型匹配
    if (criteria.errorType && e.errorType && e.errorType !== criteria.errorType) {
      return false;
    }
    
    // 4. 关键词匹配（至少匹配一个关键词）
    if (criteria.keywords && e.keywords) {
      const hasMatch = criteria.keywords.some(k => e.keywords!.includes(k));
      if (!hasMatch) return false;
    }
    
    // 5. 用户匹配
    if (criteria.userId && e.userId && e.userId !== criteria.userId) {
      return false;
    }
    
    // 6. 工作空间匹配
    if (criteria.workspace && e.workspace && e.workspace !== criteria.workspace) {
      return false;
    }
    
    return true;
  }).slice(0, criteria.limit || 10);
}

/**
 * 2026-06-24 新增: 提取进化记忆规律
 * 从历史记忆中提取规律，用于注入system prompt
 */
export function extractPatterns(entries: EvolutionEntry[]): string[] {
  const patterns: string[] = [];
  
  // 0. 提取 CSSL 元指令（教练建议）— 最高优先级
  const metaInstructions = entries.filter(e => e.type === 'meta_instruction');
  const instructionPatterns = new Map<string, number>();
  for (const m of metaInstructions) {
    const key = (m.content || '').slice(0, 80);
    instructionPatterns.set(key, (instructionPatterns.get(key) || 0) + 1);
  }
  // 元指令出现 2 次以上即提取（比失败模式的 3 次阈值更低，因为元指令更有价值）
  for (const [pattern, count] of instructionPatterns.entries()) {
    if (count >= 2) {
      patterns.push(`教练建议: ${pattern} (验证${count}次)`);
    }
  }
  // 即使只出现 1 次的元指令，如果带有诊断类型也提取（覆盖面更广）
  for (const m of metaInstructions.slice(-3)) {
    const content = (m.content || '').slice(0, 80);
    if (!instructionPatterns.has(content) || (instructionPatterns.get(content) || 0) < 2) {
      patterns.push(`教练建议: ${content}`);
    }
  }

  // 1. 提取失败模式 — 按失因分类分组 (学 EmbodiSkill)
  const failures = entries.filter(e => e.type === 'failure');
  const failurePatterns = new Map<string, number>();
  const skillDefects = new Map<string, number>(); // 技能缺陷单独统计
  for (const f of failures) {
    const pattern = (f.content || '').slice(0, 50);
    failurePatterns.set(pattern, (failurePatterns.get(pattern) || 0) + 1);
    // 技能缺陷单独标记 — 这些是需要修改技能/规则的模式
    if (f.failureCategory === 'skill_defect') {
      skillDefects.set(pattern, (skillDefects.get(pattern) || 0) + 1);
    }
  }
  
  // 2. 提取高频失败模式（出现3次以上）
  for (const [pattern, count] of failurePatterns.entries()) {
    if (count >= 3) {
      const isSkillDefect = (skillDefects.get(pattern) || 0) >= 2;
      const tag = isSkillDefect ? '⚠️ 技能缺陷' : '避免';
      patterns.push(`${tag}: ${pattern} (出现${count}次${isSkillDefect ? ', 建议修改技能' : ''})`);
    }
  }
  
  // 3. 提取偏好模式
  const preferences = entries.filter(e => e.type === 'preference');
  for (const p of preferences.slice(0, 5)) {
    patterns.push(`偏好: ${p.content || ''}`);
  }
  
  // 4. 提取成功模式
  const successes = entries.filter(e => e.type === 'success');
  const successPatterns = new Map<string, number>();
  for (const s of successes) {
    const pattern = (s.content || '').slice(0, 50);
    successPatterns.set(pattern, (successPatterns.get(pattern) || 0) + 1);
  }
  
  // 5. 提取高频成功模式（出现3次以上）
  for (const [pattern, count] of successPatterns.entries()) {
    if (count >= 3) {
      patterns.push(`推荐: ${pattern} (成功${count}次)`);
    }
  }
  
  return patterns.slice(0, 10);
}

/**
 * 清理 evolution 文件 (限制大小)
 * - 保留最近 7 天
 * - 最多 1000 条
 * - 删除过期的 success/tool_stats, 保留 failure/preference (用于调优)
 */
const MAX_ENTRIES = 1000;
const RETENTION_DAYS = 7;

export async function cleanupEvolution(): Promise<{ deleted: number; kept: number }> {
  let deleted = 0;
  try {
    if (!fs.existsSync(EVOLUTION_FILE)) return { deleted: 0, kept: 0 };
    const content = await fs.promises.readFile(EVOLUTION_FILE, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    const cutoff = Date.now() - RETENTION_DAYS * 86400_000;

    const kept: string[] = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as EvolutionEntry;
        const isImportant = entry.type === 'failure' || entry.type === 'preference' || entry.type === 'meta_instruction';
        const isFresh = entry.ts >= cutoff;

        if (isImportant || isFresh) {
          kept.push(line);
        } else {
          deleted++;
        }
      } catch {
        kept.push(line); // 坏行保留 — JSON parse per line expected
      }
    }

    // 限制最大条数 (只保留最新的)
    let finalKept = kept;
    if (kept.length > MAX_ENTRIES) {
      const trimmed = kept.slice(kept.length - MAX_ENTRIES);
      deleted += kept.length - trimmed.length;
      finalKept = trimmed;
    }

    await fs.promises.writeFile(EVOLUTION_FILE, finalKept.join('\n') + '\n', 'utf-8');
    return { deleted, kept: finalKept.length };
  } catch (cleanupErr: any) {
    console.warn('[evolution:cleanupEvolution] cleanup failed:', cleanupErr?.message);
    return { deleted: 0, kept: 0 };
  }
}

/**
 * 摘要统计
 */
export function getSummary(): {
  successRate: number;
  topPreferences: string[];
  recentTopics: string[];
  failureCount: number;
  totalEntries: number;
} {
  const entries = readEvolution(500);
  const successes = entries.filter(e => e.type === 'success').length;
  const failures = entries.filter(e => e.type === 'failure').length;
  const total = successes + failures;

  // 偏好统计
  const prefCounts = new Map<string, number>();
  for (const e of entries.filter(e => e.type === 'preference')) {
    prefCounts.set(e.content, (prefCounts.get(e.content) || 0) + 1);
  }
  const topPreferences = [...prefCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k);

  // 主题统计
  const topicCounts = new Map<string, number>();
  for (const e of entries) {
    const topic = String(e.content || '').slice(0, 30);
    topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
  }
  const recentTopics = [...topicCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k);

  return {
    successRate: total > 0 ? successes / total : 1.0,
    topPreferences,
    recentTopics,
    failureCount: failures,
    totalEntries: entries.length,
  };
}

/**
 * 启动清理定时器 (每 6 小时执行一次)
 */
let cleanupInterval: NodeJS.Timeout | null = null;
export function startEvolutionCleanupLoop(): void {
  if (cleanupInterval) return;
  // 启动时立即清理一次
  cleanupEvolution().catch((e: any) => {
    console.warn('[evolution:startCleanupLoop] initial cleanup failed:', e?.message);
  });
  cleanupInterval = setInterval(() => {
    cleanupEvolution().catch((e: any) => {
      console.warn('[evolution:startCleanupLoop] scheduled cleanup failed:', e?.message);
    });
  }, 6 * 60 * 60 * 1000); // 6 小时
}

export function stopEvolutionCleanupLoop(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}
