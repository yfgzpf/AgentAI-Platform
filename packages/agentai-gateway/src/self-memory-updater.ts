/**
 * self-memory-updater.ts — AI 主动更新项目记忆
 * =================================================
 *
 * 解决问题:
 *   AI 在长任务中会产生关键发现/决策/教训, 但不会主动写入项目记忆
 *   导致下次会话又从零开始, 重复同样的探索
 *
 * 触发时机:
 *   1. 每轮工具调用后: 检查是否有值得记忆的发现
 *   2. 任务完成时: 自动总结写入
 *   3. 错误修复后: 记录 bug → solution 模式
 *   4. 用户偏好显现时: 记录偏好
 *   5. 上下文压力 critical 时: 紧急持久化关键事实
 *
 * 记忆分类 (5 类):
 *   - bug_fix:        Bug 修复模式 (症状 → 根因 → 解决方案)
 *   - decision:       关键决策 (选择 + 理由)
 *   - pattern:        代码/架构模式 (项目特定规律)
 *   - user_preference: 用户偏好 (风格/工具/方法)
 *   - project_fact:   项目事实 (架构/依赖/约束)
 *
 * 防冗余:
 *   - 写入前 queryExisting: 相同 entityId + scope 不重复写
 *   - 重要性评分 < 3 的不写入
 *   - 单次会话最多写入 20 条 (防刷屏)
 */

import { writeMemory, readMemory, MemoryEntry } from './memory.js';
import { workspaceJournal } from './memory.js';

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

export type MemoryCategory =
  | 'bug_fix'
  | 'decision'
  | 'pattern'
  | 'user_preference'
  | 'project_fact';

export interface MemoryCandidate {
  /** 记忆分类 */
  category: MemoryCategory;
  /** 简短标题 (用于展示) */
  title: string;
  /** 核心内容 */
  content: string;
  /** 实体 ID (用于去重, 如 "bug:llm-router-comments" / "decision:use-bm25") */
  entityId: string;
  /** 重要性 1-5 (5 = 必须记住, 1 = 可有可无) */
  importance: number;
  /** 标签 */
  tags?: string[];
  /** 关联工具 */
  sourceTool?: string;
}

export interface UpdateResult {
  written: boolean;
  reason?: string;
  entry?: MemoryEntry;
}

// ═══════════════════════════════════════════════════════════
// 内部状态
// ═══════════════════════════════════════════════════════════

/** 单次会话写入计数 (防刷屏) */
let sessionWriteCount = 0;
const MAX_SESSION_WRITES = 20;

/** 已写入的 entityId 集合 (内存去重) */
const writtenEntityIds = new Set<string>();

// ═══════════════════════════════════════════════════════════
// 核心函数
// ═══════════════════════════════════════════════════════════

/**
 * 评估候选记忆是否值得写入
 */
export function shouldRemember(candidate: MemoryCandidate): {
  should: boolean;
  reason: string;
} {
  // 1. 重要性太低
  if (candidate.importance < 3) {
    return { should: false, reason: `重要性 ${candidate.importance} < 3, 跳过` };
  }

  // 2. 单次会话写入过多
  if (sessionWriteCount >= MAX_SESSION_WRITES) {
    return { should: false, reason: `已达单次会话上限 ${MAX_SESSION_WRITES} 条` };
  }

  // 3. 同一 entityId 已写入
  if (writtenEntityIds.has(candidate.entityId)) {
    return { should: false, reason: `本次会话已写入: ${candidate.entityId}` };
  }

  // 4. 内容太短
  if (!candidate.content || candidate.content.length < 10) {
    return { should: false, reason: '内容过短 (<10 字符)' };
  }

  return { should: true, reason: '通过' };
}

/**
 * 主动写入项目记忆
 */
export async function rememberThis(
  workspace: string,
  candidate: MemoryCandidate
): Promise<UpdateResult> {
  const check = shouldRemember(candidate);
  if (!check.should) {
    return { written: false, reason: check.reason };
  }

  try {
    // 查询是否已存在相同 entityId (readMemory 不支持 entityId 过滤, 需查询后过滤)
    const existing = await readMemory({
      userId: 'default',
      workspace,
      limit: 100,
    });
    const dupes = existing.filter(
      (m) => m.entityId === candidate.entityId && !m.supersededBy
    );

    if (dupes.length > 0) {
      // 已存在, 不重复写
      return {
        written: false,
        reason: `记忆已存在: ${candidate.entityId} (共 ${dupes.length} 条)`,
      };
    }

    // 写入 (category/title/tags/sourceTool 放到 metadata, 因为 MemoryEntry 没有这些字段)
    const entry = await writeMemory({
      userId: 'default',
      workspace,
      role: 'assistant',
      source: 'auto_reflect',
      entityId: candidate.entityId,
      content: candidate.content,
      importance: candidate.importance / 5, // 归一化到 0-1
      metadata: {
        category: candidate.category,
        title: candidate.title,
        tags: candidate.tags || [],
        sourceTool: candidate.sourceTool,
      },
    });

    writtenEntityIds.add(candidate.entityId);
    sessionWriteCount++;

    return {
      written: true,
      entry,
    };
  } catch (e: any) {
    return {
      written: false,
      reason: `写入失败: ${e.message}`,
    };
  }
}

/**
 * 批量评估并写入
 */
export async function rememberBatch(
  workspace: string,
  candidates: MemoryCandidate[]
): Promise<{ written: number; skipped: number; details: UpdateResult[] }> {
  const details: UpdateResult[] = [];
  let written = 0;
  let skipped = 0;

  for (const c of candidates) {
    const r = await rememberThis(workspace, c);
    details.push(r);
    if (r.written) written++;
    else skipped++;
  }

  return { written, skipped, details };
}

// ═══════════════════════════════════════════════════════════
// 场景化快捷方法
// ═══════════════════════════════════════════════════════════

/**
 * 记录 Bug 修复模式
 */
export async function rememberBugFix(
  workspace: string,
  args: {
    symptom: string;
    rootCause: string;
    solution: string;
    file?: string;
    sourceTool?: string;
  }
): Promise<UpdateResult> {
  return rememberThis(workspace, {
    category: 'bug_fix',
    title: `Bug: ${args.symptom.slice(0, 40)}`,
    entityId: `bug:${args.file || 'global'}:${args.symptom.slice(0, 30)}`,
    importance: 4,
    tags: ['bug-fix', args.file || 'global'],
    sourceTool: args.sourceTool,
    content: `症状: ${args.symptom}\n根因: ${args.rootCause}\n解决方案: ${args.solution}${args.file ? `\n文件: ${args.file}` : ''}`,
  });
}

/**
 * 记录关键决策
 */
export async function rememberDecision(
  workspace: string,
  args: {
    decision: string;
    rationale: string;
    alternatives?: string;
    sourceTool?: string;
  }
): Promise<UpdateResult> {
  return rememberThis(workspace, {
    category: 'decision',
    title: `决策: ${args.decision.slice(0, 40)}`,
    entityId: `decision:${args.decision.slice(0, 30)}`,
    importance: 5,
    tags: ['decision'],
    sourceTool: args.sourceTool,
    content: `决策: ${args.decision}\n理由: ${args.rationale}${args.alternatives ? `\n备选方案: ${args.alternatives}` : ''}`,
  });
}

/**
 * 记录项目事实
 */
export async function rememberProjectFact(
  workspace: string,
  args: {
    fact: string;
    category?: string;
    sourceTool?: string;
  }
): Promise<UpdateResult> {
  return rememberThis(workspace, {
    category: 'project_fact',
    title: `事实: ${args.fact.slice(0, 40)}`,
    entityId: `fact:${args.fact.slice(0, 30)}`,
    importance: 3,
    tags: ['project-fact', args.category || 'general'],
    sourceTool: args.sourceTool,
    content: args.fact,
  });
}

/**
 * 记录用户偏好
 */
export async function rememberUserPreference(
  workspace: string,
  args: {
    preference: string;
    evidence: string;
    sourceTool?: string;
  }
): Promise<UpdateResult> {
  return rememberThis(workspace, {
    category: 'user_preference',
    title: `偏好: ${args.preference.slice(0, 40)}`,
    entityId: `pref:${args.preference.slice(0, 30)}`,
    importance: 4,
    tags: ['user-preference'],
    sourceTool: args.sourceTool,
    content: `偏好: ${args.preference}\n证据: ${args.evidence}`,
  });
}

/**
 * 记录代码/架构模式
 */
export async function rememberPattern(
  workspace: string,
  args: {
    pattern: string;
    description: string;
    file?: string;
    sourceTool?: string;
  }
): Promise<UpdateResult> {
  return rememberThis(workspace, {
    category: 'pattern',
    title: `模式: ${args.pattern.slice(0, 40)}`,
    entityId: `pattern:${args.pattern.slice(0, 30)}`,
    importance: 3,
    tags: ['pattern', args.file || 'global'],
    sourceTool: args.sourceTool,
    content: `模式: ${args.pattern}\n说明: ${args.description}${args.file ? `\n文件: ${args.file}` : ''}`,
  });
}

// ═══════════════════════════════════════════════════════════
// 会话级管理
// ═══════════════════════════════════════════════════════════

/**
 * 获取本次会话写入统计
 */
export function getSessionStats(): {
  written: number;
  remaining: number;
  writtenEntityIds: string[];
} {
  return {
    written: sessionWriteCount,
    remaining: Math.max(0, MAX_SESSION_WRITES - sessionWriteCount),
    writtenEntityIds: Array.from(writtenEntityIds),
  };
}

/**
 * 重置会话计数 (新会话开始时调用)
 */
export function resetSession(): void {
  sessionWriteCount = 0;
  writtenEntityIds.clear();
}

/**
 * 紧急持久化 (上下文压力 critical 时调用)
 * 把本次会话已写入的 entityId 列表写入工作日志, 防止丢失
 */
export async function emergencyPersist(
  workspace: string,
  pendingCandidates: MemoryCandidate[]
): Promise<void> {
  try {
    await workspaceJournal.append(workspace, {
      summary: `Emergency persist: ${pendingCandidates.length} candidates, session wrote ${sessionWriteCount}`,
      taskType: 'memory_emergency_persist',
      decision: JSON.stringify({
        written: sessionWriteCount,
        writtenEntityIds: Array.from(writtenEntityIds),
        pending: pendingCandidates.map(c => ({
          entityId: c.entityId,
          title: c.title,
          category: c.category,
        })),
      }),
    });
  } catch (e: any) {
    console.warn('[self-memory-updater] emergencyPersist failed:', e.message);
  }
}
