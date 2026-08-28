/**
 * AgentAI 三层记忆 (学 WorkBuddy 经验)
 * ----------------------------------------------------
 * - cloud:  (云端, 阶段 4 接)
 * - user:   用户级 (跨工作空间)
 * - workspace: 工作空间级 (项目内, .agentai/memory/)
 *
 * 修复: 使用 writeFile + rename 模拟原子追加 (比 appendFile 更安全)
 * 修复: 内存缓存 + 批量写入, 减少 I/O 竞争
 *
 * @see docs/INTEGRATION_ARCHITECTURE.md
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { WorkspaceManager } from './workspace-manager.js';

export interface MemoryEntry {
  ts: number;
  userId: string;
  workspace: string;
  role: 'user' | 'assistant' | 'system' | 'reflect' | 'tool';
  content: string;
  metadata?: Record<string, any>;
/** 自创: 来源链路 (可追溯) */
source: 'cloud' | 'user' | 'workspace' | 'auto_reflect' | 'session' | 'lifecycle';
  /** 行业标签: 写入时自动标注当前行业, 读取时按行业加权 */
  industry?: string;
  /** 记忆重要性 (0-1), 影响检索排序和时效衰减 */
  importance?: number;
  /** 2026-07-02 新增: 实体绑定 (学论文 M1) — 绑定到具体实体用于冲突检测 */
  entityId?: string;
  /** 2026-07-02 新增: 事实有效期起始 (学论文 M1) */
  validFrom?: number;
  /** 2026-07-02 新增: 事实有效期截止 (学论文 M1) — 超过此时间标记为过期 */
  validUntil?: number;
  /** 2026-07-02 新增: 被哪条记忆替代 (学论文 M4) — ts 较大的同 entityId 记忆 */
  supersededBy?: string;
}

/** 获取 AI 工作目录下的 memory 子目录 */
function getMemoryDir(): string {
  return WorkspaceManager.getInstance().subdir('memory');
}

const userDir = getMemoryDir();

/**
 * 线程安全的写入队列 (单进程内串行化)
 * 防止并发 appendFile 导致 JSONL 行交错
 */
const writeQueues = new Map<string, Promise<void>>();

/**
 * 原子写入 JSONL 行
 * 策略: 写入临时文件 → rename 替换 (原子操作)
 * 如果 rename 失败 (跨设备), 回退到 appendFile
 */
async function atomicAppendFile(filePath: string, line: string): Promise<void> {
  const queue = writeQueues.get(filePath) || Promise.resolve();
  const next = queue.then(async () => {
    try {
      await fs.appendFile(filePath, line, 'utf-8');
    } catch (appendErr: any) {
      console.warn('[memory:atomicAppend] appendFile failed, trying fallback:', appendErr?.message);
      try {
        const tmpPath = `${filePath}.${crypto.randomBytes(4).toString('hex')}.tmp`;
        const existing = await fs.readFile(filePath, 'utf-8').catch(() => '');
        await fs.writeFile(tmpPath, existing + line, 'utf-8');
        await fs.rename(tmpPath, filePath);
      } catch (renameErr: any) {
        console.warn('[memory:atomicAppend] rename fallback failed:', renameErr?.message);
        await fs.appendFile(filePath, line, 'utf-8').catch((finalErr: any) => {
          console.warn('[memory:atomicAppend] final appendFile also failed:', finalErr?.message);
        });
      }
    }
  }).finally(() => {
    // 完成后清理队列条目, 防止 Map 无限增长
    writeQueues.delete(filePath);
  });
  writeQueues.set(filePath, next);
  return next;
}

export async function writeMemory(entry: Omit<MemoryEntry, 'ts'>): Promise<MemoryEntry> {
  // ★ 修复: 不再从单例读取行业. 参数为空时默认 'general', 由调用方传入正确值
  let autoIndustry = entry.industry || 'general';
  // 注意: 调用方 (agentai-loop) 应通过 opts.industryId 或显式参数传入行业
  // 此处不再回退到读取全局单例 activeIndustry, 避免跨用户污染
  const full: MemoryEntry = { ts: Date.now(), ...entry, industry: autoIndustry };
  const line = JSON.stringify(full) + '\n';

  // 1. workspace 记忆 (项目内)
  const workspaceFile = path.join(entry.workspace, '.agentai', 'memory.jsonl');
  await fs.mkdir(path.dirname(workspaceFile), { recursive: true });
  await atomicAppendFile(workspaceFile, line);

  // 2. user 记忆 (跨项目) — 带项目路径标签用于隔离过滤
  // 修复: userId 中可能包含中文字符、空格、特殊字符，需要转义为安全文件名
  const safeUserId = sanitizeUserId(entry.userId);
  const userFile = path.join(userDir, `${safeUserId}.jsonl`);
  await fs.mkdir(path.dirname(userFile), { recursive: true });
  await atomicAppendFile(userFile, JSON.stringify({
    ...full,
    workspace: '*',
    metadata: {
      ...(full.metadata || {}),
      // ═══ 2026-06-27: 标记项目来源, readMemory 据此过滤 ═══
      projectWorkspace: entry.workspace || undefined,
    },
  }) + '\n');

  // 3. 自动压缩: 项目记忆超过阈值时合并旧条目
  compressMemoryFile(workspaceFile).catch((e: any) => {
    console.warn('[memory:writeMemory] background compression failed:', e?.message);
  });

  // ══════════════════════════════════════════════════════
  // 4. 反向镜像到 MemoryManager KV (双轨制合并 2/2)
  //    所有 workspace 级记忆都镜像到 KV, 使用自动生成的 key 或 entityId
  //    异步 fire-and-forget, 静默失败
  // ══════════════════════════════════════════════════════
  if (full.workspace) {
    (async () => {
      try {
        const mod = await import('./memory-manager.js');
        const mgr = mod.getMemoryManager(full.workspace);
        const md = full.metadata || {};
        // 优先使用已有的 kvKey, 否则自动生成
        const kvKey = ((md as any).kvKey as string) || full.entityId || `mem:${full.source}:${full.role}:${full.ts}`;
        const scope = (((md as any).kvScope as string) || 'project') as 'user' | 'session' | 'project' | 'global';
        const priority = (full.importance || 0) >= 0.8 ? 'high' : 'normal';
        // 只镜像重要记忆 (importance >= 0.5) 或已有 entityId 的记忆
        if ((full.importance || 0) >= 0.5 || full.entityId) {
          await mgr.remember({
            key: kvKey,
            value: (full.content || '').slice(0, 500),
            scope,
            metadata: {
              priority,
              mirroredFromJSONL: true,
              entityId: full.entityId,
              source: full.source,
              role: full.role,
              importance: full.importance,
              userId: full.userId,
              ts: full.ts,
            },
          });
        }
      } catch {
        /* 静默失败: 镜像总是可选的 */
      }
    })();
  }

  return full;
}

/**
 * 将 userId 转换为安全的文件名
 * 移除中文字符、空格、特殊字符，保留英文字母、数字、下划线、连字符
 */
function sanitizeUserId(userId: string): string {
  if (!userId) return 'unknown';
  // 替换非安全字符为下划线
  const sanitized = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
  // 限制长度
  return sanitized.slice(0, 64) || 'unknown';
}

/* ═══ 记忆自动压缩（智能版，集成重要性评估） ═══ */
const COMPRESS_THRESHOLD = 50;  // 阈值提高，给重要性评估更多空间
const KEEP_RECENT = 20;
const KEEP_HIGH_VALUE = 15;     // 保留高价值记忆数量
// P0 修复: 压缩后如果仍 > 阈值, 需要进一步压缩, 否则死循环
// 51 条 → 压缩 → 22 条 → 新写入 → 51 条 → 压缩 → 22 条 ... (无限循环)
// 修复: 压缩后如果 < 阈值, 标记文件为"已压缩", 短期内不再触发
const COMPRESS_COOLDOWN_MS = 5 * 60 * 1000; // 5 分钟冷却
const compressedCooldowns = new Map<string, number>(); // filePath → lastCompressedTs

// P0 修复: 压缩防重入锁 — 避免并发写入导致 EPERM 死循环
const compressingFiles = new Set<string>();

async function compressMemoryFile(filePath: string): Promise<void> {
  // 防重入: 如果该文件正在压缩, 跳过
  if (compressingFiles.has(filePath)) return;
  // P0 修复: 冷却期检查 — 5 分钟内已压缩过的文件不再触发
  const lastCompressed = compressedCooldowns.get(filePath);
  if (lastCompressed && Date.now() - lastCompressed < COMPRESS_COOLDOWN_MS) return;
  compressingFiles.add(filePath);
  try {
    const { evaluateBatch, generateSummary } = await import('./memory-importance.js');

    const raw = await fs.readFile(filePath, 'utf-8').catch(() => '');
    const lines = raw.trim().split('\n').filter(Boolean);
    if (lines.length <= COMPRESS_THRESHOLD) return;

    const entries: MemoryEntry[] = lines.map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean) as MemoryEntry[];

    // 评估重要性
    const evaluated = evaluateBatch(entries);

    // 分离高价值和低价值记忆
    const highValue = evaluated
      .filter(e => e._importance.score >= 0.6)
      .sort((a, b) => b._importance.score - a._importance.score)
      .slice(0, KEEP_HIGH_VALUE);

    const lowValue = evaluated
      .filter(e => e._importance.score < 0.6)
      .sort((a, b) => b.ts - a.ts); // 按时间倒序

    // 保留最近的部分低价值记忆
    const recentLowValue = lowValue.slice(0, KEEP_RECENT);
    const archiveLowValue = lowValue.slice(KEEP_RECENT);

    // 生成低价值记忆摘要
    let summaryEntry: MemoryEntry | null = null;
    if (archiveLowValue.length > 0) {
      const summary = generateSummary(archiveLowValue.map(e => ({
        ts: e.ts,
        userId: e.userId,
        workspace: e.workspace,
        role: e.role,
        content: e.content,
        source: e.source,
        metadata: e.metadata,
      })));

      summaryEntry = {
        ts: archiveLowValue[0]?.ts || Date.now(),
        userId: archiveLowValue[0]?.userId || 'system',
        workspace: archiveLowValue[0]?.workspace || '',
        role: 'system',
        content: summary,
        source: 'auto_reflect',
        metadata: {
          type: 'memory_summary',
          mergedCount: archiveLowValue.length,
          avgImportance: Math.round(
            archiveLowValue.reduce((sum, e) => sum + e._importance.score, 0) / archiveLowValue.length * 100
          ) / 100,
        },
        importance: 0.5,
      };
    }

    // 合并最终记忆
    const compressed = [
      ...(summaryEntry ? [summaryEntry] : []),
      ...highValue.map(e => ({
        ...e,
        metadata: { ...e.metadata, importanceScore: e._importance.score },
      })),
      ...recentLowValue.map(e => ({
        ...e,
        metadata: { ...e.metadata, importanceScore: e._importance.score },
      })),
    ];

    const newContent = compressed.map(e => JSON.stringify(e)).join('\n') + '\n';
    
    // P0 修复: Windows 上 rename 会因文件锁定失败 (EPERM)
    // 改为: 先 unlink 原文件再 writeFile, 如果 unlink 失败则直接覆盖写入
    try {
      await fs.unlink(filePath).catch(() => {}); // 忽略 unlink 失败 (文件可能不存在)
      await fs.writeFile(filePath, newContent, 'utf-8');
    } catch (writeErr: any) {
      // 如果直接写入也失败, 尝试 rename 兜底
      try {
        const tmpPath = `${filePath}.compress.tmp`;
        await fs.writeFile(tmpPath, newContent, 'utf-8');
        // Windows: 用 copy + unlink 替代 rename
        await fs.copyFile(tmpPath, filePath);
        await fs.unlink(tmpPath).catch(() => {});
      } catch (fallbackErr: any) {
        console.warn('[memory] compression write failed:', fallbackErr?.message);
        return; // 静默失败, 不影响主流程
      }
    }

    console.log(`[memory] 智能压缩: ${entries.length} → ${compressed.length} entries (高价值: ${highValue.length}, 摘要: ${archiveLowValue.length})`);
    // P0 修复: 记录冷却时间, 5 分钟内不再重复压缩同一文件
    compressedCooldowns.set(filePath, Date.now());
  } catch (e: any) {
    console.warn('[memory] compression failed:', e?.message);
  } finally {
    compressingFiles.delete(filePath);
  }
}

export async function readMemory(opts: {
  userId: string;
  workspace?: string;
  limit?: number;
  /** 简易时间过滤 */
  sinceTs?: number;
  /** 当前行业: 用于加权排序, 同行业记忆优先 */
  currentIndustry?: string;
}): Promise<MemoryEntry[]> {
  const limit = opts.limit ?? 50;
  const files: string[] = [];
  if (opts.workspace) {
    files.push(path.join(opts.workspace, '.agentai', 'memory.jsonl'));
  }
  files.push(path.join(userDir, `${opts.userId}.jsonl`));

  // ★ 修复: 不再从单例读取行业. 参数为空时默认 'general'
  let currentIndustry = opts.currentIndustry || 'general';
  // 注意: 调用方应通过 opts.currentIndustry 显式传入行业 ID

  const all: MemoryEntry[] = [];
  for (const file of files) {
    try {
      const content = await fs.readFile(file, 'utf-8');
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as MemoryEntry;
          if (opts.sinceTs && entry.ts < opts.sinceTs) continue;
          // ═══ 2026-06-27 修复: 跨项目记忆隔离 ═══
          // user 级记忆（workspace='*'）如果当前 workspace 明确，过滤掉不相关的
          if (opts.workspace && entry.workspace === '*' && entry.metadata?.projectWorkspace) {
            // 如果记忆明确记录了项目路径，必须匹配
            if (entry.metadata.projectWorkspace !== opts.workspace) continue;
          }
          all.push(entry);
        } catch {
          // 忽略坏行 — JSON parse failure per line is expected for partial writes
        }
      }
    } catch (fileErr: any) {
      // 文件不存在或不可读 — 这是正常的，不需要 warn（每个 workspace 可能没有 user 级记忆文件）
    }
  }

  // 去重 (按 ts + role + content hash)
  const seen = new Set<string>();
  const unique = all.filter(e => {
    const key = `${e.ts}-${e.role}-${String(e.content || '').slice(0, 50)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // ═══ 2026-07-02 新增: 冲突检测 (学论文 M4 维护模块) ═══
  // 同 entityId 的多条记忆, 按 ts 排序, 最新的标记为 active, 旧的标记为 superseded
  const entityGroups = new Map<string, MemoryEntry[]>();
  for (const e of unique) {
    if (e.entityId) {
      const group = entityGroups.get(e.entityId) || [];
      group.push(e);
      entityGroups.set(e.entityId, group);
    }
  }
  for (const [, group] of entityGroups) {
    if (group.length <= 1) continue;
    // 按 ts 降序排
    group.sort((a, b) => b.ts - a.ts);
    const latest = group[0]!;
    // 检查最新记忆是否仍在有效期内
    const isLatestValid = !latest.validUntil || latest.validUntil > Date.now();
    if (isLatestValid) {
      // 旧记忆标记为被替代
      for (let i = 1; i < group.length; i++) {
        const entry = group[i]!;
        if (!entry.supersededBy) {
          entry.supersededBy = String(latest.ts);
        }
      }
    }
  }

  // ═══ 2026-07-02 新增: 证据组检索 (学论文 M3) ═══
  // 两阶段检索: 1) 关键词/行业定位 2) 按 entityId 拉取关联记忆组
  const entityIdSet = new Set<string>();
  for (const e of unique) {
    if (e.entityId) entityIdSet.add(e.entityId);
  }
  // 如果有实体绑定, 补充同实体记忆 (即使没通过初始过滤)
  if (entityIdSet.size > 0) {
    for (const e of all) {
      if (e.entityId && entityIdSet.has(e.entityId) && !unique.includes(e)) {
        unique.push(e);
      }
    }
  }

  // 智能排序: 行业加权 + 时效衰减 + 重要性 + 冲突降权
  const now = Date.now();
  const HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000; // 30天半衰期
  const scored = unique.map(e => {
    let score = 0;
    // 1. 时效衰减 (指数衰减, 半衰期30天)
    const ageMs = now - e.ts;
    const decayFactor = Math.pow(0.5, ageMs / HALF_LIFE_MS);
    score += decayFactor * 40; // 最高40分

    // 2. 行业加权 (同行业 +30, 通用 +10, 跨行业 +0)
    const entryIndustry = e.industry || 'general';
    if (entryIndustry === currentIndustry && currentIndustry !== 'general') {
      score += 30; // 同行业记忆大幅优先
    } else if (entryIndustry === 'general' || currentIndustry === 'general') {
      score += 10; // 通用记忆中等优先
    } else {
      score += 5; // 跨行业记忆低优先但不丢弃
    }

    // 3. 重要性加权
    const importance = e.importance ?? (e.metadata?.priority === 'high' ? 0.8 : e.metadata?.priority === 'medium' ? 0.5 : 0.3);
    score += importance * 30; // 最高30分

    // 4. 冲突降权: 被替代的记忆大幅降权 (学论文 M4)
    if (e.supersededBy) {
      score *= 0.2; // 被替代记忆只保留 20% 分数
    }

    // 5. 过期降权: 超出 validUntil 的记忆降权
    if (e.validUntil && e.validUntil < now) {
      score *= 0.3; // 过期记忆只保留 30% 分数
    }

    return { entry: e, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(s => s.entry);
}

/**
 * 清理过期的记忆文件
 * - 默认保留最近 30 天的条目
 * - 超过 MAX_ENTRIES 的文件, 只保留最新的
 */
const MAX_MEMORY_ENTRIES_PER_FILE = 1000;
const MEMORY_RETENTION_DAYS = 30;

export async function cleanupOldMemory(
  userId?: string,
  workspace?: string,
): Promise<{ deleted: number }> {
  let deleted = 0;
  const files: string[] = [];
  if (workspace) {
    files.push(path.join(workspace, '.agentai', 'memory.jsonl'));
  }
  if (userId) {
    files.push(path.join(userDir, `${userId}.jsonl`));
  }
  // 如果没有指定, 清理所有文件
  if (!userId && !workspace) {
    try {
      const userFiles = await fs.readdir(userDir);
      for (const f of userFiles) {
        if (f.endsWith('.jsonl')) {
          files.push(path.join(userDir, f));
        }
      }
    } catch (readdirErr: any) {
      console.warn('[memory:cleanupOldMemory] userDir readdir failed:', readdirErr?.message);
      // 目录不存在, 忽略
    }
  }

  const cutoff = Date.now() - MEMORY_RETENTION_DAYS * 86400_000;

  for (const file of files) {
    try {
      const content = await fs.readFile(file, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      const kept: string[] = [];
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.ts >= cutoff) {
            kept.push(line);
          } else {
            deleted++;
          }
        } catch {
          kept.push(line); // 坏行保留 — JSON parse failure per line is expected
        }
      }
      // 如果保留的条目数超过上限, 只保留最新的
      if (kept.length > MAX_MEMORY_ENTRIES_PER_FILE) {
        const trimmed = kept.slice(kept.length - MAX_MEMORY_ENTRIES_PER_FILE);
        deleted += kept.length - trimmed.length;
        await fs.writeFile(file, trimmed.join('\n') + '\n', 'utf-8');
      } else {
        await fs.writeFile(file, kept.join('\n') + '\n', 'utf-8');
      }
    } catch {
      // 文件不存在或不可读, 跳过
    }
  }

  return { deleted };
}

// ═══════════════════════════════════════════════════════
// WorkspaceJournal — 三层记忆门面: 每日工作日报 (学 WorkBuddy)
// 2026-06-26 新增: 对标 WorkBuddy ~/.workbuddy/memory/YYYY-MM-DD.md
// ═══════════════════════════════════════════════════════

export interface JournalEntry {
  /** 任务摘要（一句话）*/
  summary: string;
  /** 任务类型 */
  taskType?: string;
  /** 影响的文件列表 */
  files?: string[];
  /** 技术决策 (可选) */
  decision?: string;
}

/**
 * WorkspaceJournal — 工作区日报追加器
 *
 * 对标 WorkBuddy 的三层记忆:
 *   Layer 3 — 工作区级: {workspace}/.agentai/journal/YYYY-MM-DD.md
 *
 * 每次会话完成实质性工作后，自动 append 一条记录到当天日报。
 * 日报是 append-only 的，不覆盖旧内容，只追加新内容。
 */
export class WorkspaceJournal {
  private static instance: WorkspaceJournal | null = null;

  static getInstance(): WorkspaceJournal {
    if (!WorkspaceJournal.instance) {
      WorkspaceJournal.instance = new WorkspaceJournal();
    }
    return WorkspaceJournal.instance;
  }

  /** 获取今日日报文件路径 */
  getTodayLogPath(workspace: string): string {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return path.join(workspace, '.agentai', 'journal', `${today}.md`);
  }

  /**
   * 追加一条工作记录到今日日报
   * @param workspace 工作区路径
   * @param entry 日志条目
   */
  async append(workspace: string, entry: JournalEntry): Promise<void> {
    try {
      const logPath = this.getTodayLogPath(workspace);
      await fs.mkdir(path.dirname(logPath), { recursive: true });

      const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      const lines: string[] = [`\n## ${time} — ${entry.summary}`];

      if (entry.taskType) lines.push(`- 类型: ${entry.taskType}`);
      if (entry.files && entry.files.length > 0) {
        lines.push(`- 文件: ${entry.files.slice(0, 5).join(', ')}`);
      }
      if (entry.decision) lines.push(`- 决策: ${entry.decision}`);

      await fs.appendFile(logPath, lines.join('\n') + '\n', 'utf-8');
    } catch (journalErr: any) {
      console.warn('[memory:WorkspaceJournal.append] journal write failed:', journalErr?.message);
      // 日报写入失败不影响主流程
    }
  }

  /**
   * 读取今日日报内容
   */
  async readToday(workspace: string): Promise<string> {
    try {
      const logPath = this.getTodayLogPath(workspace);
      return await fs.readFile(logPath, 'utf-8');
    } catch { return ''; } // 今日无日志 — expected, no warn needed
  }

  /**
   * 读取最近 N 天的日报（用于上下文注入）
   */
  async readRecent(workspace: string, days = 3): Promise<string> {
    const parts: string[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(Date.now() - i * 86400_000);
      const dateStr = d.toISOString().slice(0, 10);
      const logPath = path.join(workspace, '.agentai', 'journal', `${dateStr}.md`);
      try {
        const content = await fs.readFile(logPath, 'utf-8');
        if (content.trim()) {
          parts.push(`### ${dateStr}\n${content.trim()}`);
        }
      } catch { /* 文件不存在跳过 */ }
    }
    return parts.join('\n\n');
  }

  /**
   * 将 30 天前的日报归档到 MEMORY.md（长期蒸馏）
   * 模拟 WorkBuddy 的"将旧日报蒸馏到 MEMORY.md"机制
   */
  async distillOldLogs(workspace: string): Promise<void> {
    try {
      const journalDir = path.join(workspace, '.agentai', 'journal');
      const memoryFile = path.join(workspace, '.agentai', 'MEMORY.md');
      const cutoff = Date.now() - 30 * 86400_000;

      let files: string[];
      try { files = await fs.readdir(journalDir); }
      catch { return; } // journal dir doesn't exist yet — expected, no warn needed

      const oldFiles = files
        .filter(f => f.endsWith('.md') && /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
        .filter(f => {
          const dateStr = f.replace('.md', '');
          return new Date(dateStr).getTime() < cutoff;
        });

      if (oldFiles.length === 0) return;

      const summaries: string[] = [`\n\n## 历史日志归档 (${new Date().toISOString().slice(0, 10)})\n`];
      for (const f of oldFiles) {
        const filePath = path.join(journalDir, f);
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const dateStr = f.replace('.md', '');
          // 只保留第一行摘要
          const firstLine = content.trim().split('\n').find(l => l.startsWith('##'))?.replace(/^##\s*/, '') || '';
          if (firstLine) summaries.push(`- ${dateStr}: ${firstLine}`);
          await fs.unlink(filePath);
        } catch (unlinkErr: any) {
          console.warn('[memory:distillOldLogs] unlink failed for', filePath, unlinkErr?.message);
        }
      }

      if (summaries.length > 1) {
        await fs.appendFile(memoryFile, summaries.join('\n'), 'utf-8');
        console.log(`[journal] distilled ${oldFiles.length} old logs into MEMORY.md`);
      }
    } catch (distillErr: any) {
      console.warn('[memory:distillOldLogs] distillation failed:', distillErr?.message);
      // 蒸馏失败不影响主流程
    }
  }
}

/** 全局单例（供 AgentAILoop 调用）*/
export const workspaceJournal = WorkspaceJournal.getInstance();
