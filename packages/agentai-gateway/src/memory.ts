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
import { createReadStream } from 'fs';
import readline from 'readline';
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
 * ═══ 2026-10-17 P0: 有界尾部读取 (治 1.6GB default.jsonl 事故) ═══
 *
 * 背景: readMemory / compressMemoryFile / cleanupOldMemory 都用
 * `fs.readFile(file, 'utf-8')` 整读进字符串。Node 字符串上限约 512MB
 * (2^29-24) — 超过即抛 `Invalid string length`, 而三处调用全部
 * `.catch(() => '')` / try-catch 吞掉 → 表现是"静默返回 0 条记忆"。
 * 实测用户目录 default.jsonl 已涨到 1.6GB: 每次 recall 回退都要白读
 * 7.5s 磁盘再抛错 (agent loop 里就是一次 7s 卡死), 且 compress/cleanup
 * 在同一文件上同步失效 → 文件只涨不减, 恶性循环。
 *
 * JSONL 是 append-only 按时间追加的, 尾部即最新; 读取方 (readMemory)
 * 只取 limit 条且按分数排序 (时效衰减 favor 新条目), compress/cleanup
 * 也有条数上限 — 所以"只读尾部 N 字节"在语义上安全, 且内存/耗时都有界。
 *
 * @param maxBytes 尾部窗口, 默认 4MB (约 8k 条典型记忆, 远超各方 200/1000 上限)
 */
const TAIL_READ_MAX_BYTES = 4 * 1024 * 1024;
export async function readTailLines(filePath: string, maxBytes: number = TAIL_READ_MAX_BYTES): Promise<string[]> {
  let size = 0;
  try {
    size = (await fs.stat(filePath)).size;
  } catch {
    return []; // 不存在 — 与旧行为一致 (readFile 抛 ENOENT 被吞)
  }
  let raw: string;
  if (size <= maxBytes) {
    raw = await fs.readFile(filePath, 'utf-8');
  } else {
    // 只读尾部窗口: 开 fd 定位到 size-maxBytes, 避免整文件进内存
    const fd = await fs.open(filePath, 'r');
    try {
      const buf = Buffer.allocUnsafe(maxBytes);
      const { bytesRead } = await fd.read(buf, 0, maxBytes, size - maxBytes);
      raw = buf.toString('utf-8', 0, bytesRead);
    } finally {
      await fd.close();
    }
  }
  const lines = raw.split('\n');
  // 窗口首行大概率被截断 (也可能正好截在多字节 UTF-8 字符中间) — 直接丢弃
  if (size > maxBytes) lines.shift();
  return lines;
}

/** 文件级变异排队: append/prune/rewrite 共用同一 per-file 队列, 防止写入交错 */
async function withFileQueue<T>(filePath: string, op: () => Promise<T>): Promise<T> {
  const prev = writeQueues.get(filePath) || Promise.resolve();
  // 队列里排的是"已封口的 void 结果" — 与 Map<string, Promise<void>> 类型一致;
  // 泛型 T 只作为对外返回值, 不入 Map (原实现把 Promise<T> 直接 set 进 Map, 触发 TS2345)
  const next: Promise<void> = prev.then(async () => { await op(); }).finally(() => {
    if (writeQueues.get(filePath) === next) writeQueues.delete(filePath);
  });
  writeQueues.set(filePath, next);
  return next as unknown as Promise<T>; // 调用方均 await 且不消费返回值 (void 语义)
}

/**
 * 排队原子重写整个文件内容。
 * rename 优先 (原子); Windows 上目标被占用会 EPERM — 此时退化为
 * unlink + writeFile (与 compressMemoryFile 的既有教训一致, 有极小崩溃窗口,
 * 但比 6h 清理跑不动、文件永远膨胀要好)。tmp 名确定性, 失败即清理。
 */
async function atomicRewrite(filePath: string, content: string): Promise<void> {
  await withFileQueue(filePath, async () => {
    const tmpPath = `${filePath}.rewrite.tmp`;
    try {
      await fs.writeFile(tmpPath, content, 'utf-8');
      await fs.rename(tmpPath, filePath);
    } catch (renameErr: any) {
      await fs.unlink(tmpPath).catch(() => {});
      try {
        await fs.unlink(filePath).catch(() => {});
        await fs.writeFile(filePath, content, 'utf-8');
      } catch (writeErr: any) {
        console.warn(`[memory:atomicRewrite] both rename and direct write failed for ${filePath}:`, writeErr?.message || renameErr?.message);
        throw writeErr;
      }
    }
  });
}

/**
 * 原子写入 JSONL 行
 * 策略: 写入临时文件 → rename 替换 (原子操作)
 * 如果 rename 失败 (跨设备), 回退到 appendFile
 *
 * ═══ 2026-10-17 P0 修复 (两项) ═══
 * ① tmp 文件泄漏: 原回退路径每次随机生成 `file.<8hex>.tmp`, rename 失败
 *    (Windows EPERM: 目标被占用) 后 catch 里再 appendFile 也失败 → 错误被吞,
 *    tmp 永久残留。实测用户目录攒了 **10,931 个 0 字节 tmp** (目录列表 847KB)。
 *    现改为: 确定性 tmp 名 (每文件最多 1 个, 重试自动复用) + 失败即 unlink。
 * ② 大文件回退读整文件: rename 回退要 `readFile(whole)+writeFile(tmp)+rename`,
 *    在 >512MB 文件上 readFile 直接 Invalid string length → 追加静默丢失。
 *    现改为: 超过 RENAME_FALLBACK_MAX_BYTES 跳过 tmp 舞步, 直接重试 append。
 */
const RENAME_FALLBACK_MAX_BYTES = 8 * 1024 * 1024;
async function atomicAppendFile(filePath: string, line: string): Promise<void> {
  return withFileQueue(filePath, async () => {
    try {
      await fs.appendFile(filePath, line, 'utf-8');
      return;
    } catch (appendErr: any) {
      console.warn('[memory:atomicAppend] appendFile failed, trying fallback:', appendErr?.message);
    }
    // ── 回退 1: 大文件不做 tmp+rename (读整文件必炸), 直接重试 append ──
    let size = 0;
    try { size = (await fs.stat(filePath)).size; } catch { /* 不存在: size=0 */ }
    if (size > RENAME_FALLBACK_MAX_BYTES) {
      try {
        await fs.appendFile(filePath, line, 'utf-8');
        return;
      } catch (retryErr: any) {
        console.warn('[memory:atomicAppend] large-file append retry failed:', retryErr?.message);
        throw retryErr;
      }
    }
    // ── 回退 2: 小文件 tmp+rename (确定性 tmp 名, 失败即清理, 不再泄漏) ──
    const tmpPath = `${filePath}.tmp`;
    try {
      const existing = await fs.readFile(filePath, 'utf-8').catch(() => '');
      await fs.writeFile(tmpPath, existing + line, 'utf-8');
      await fs.rename(tmpPath, filePath);
    } catch (renameErr: any) {
      await fs.unlink(tmpPath).catch(() => {});   // ★ 无论成败都清掉 tmp, 杜绝残留
      console.warn('[memory:atomicAppend] rename fallback failed:', renameErr?.message);
      try {
        await fs.appendFile(filePath, line, 'utf-8');
      } catch (finalErr: any) {
        console.warn('[memory:atomicAppend] final appendFile also failed:', finalErr?.message);
        throw finalErr;   // ★ 不再无条件吞掉 — 调用方 (writeMemory) 需要知道写入失败
      }
    }
  });
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
  //    异步 fire-and-forget, 带重试保护
  // ══════════════════════════════════════════════════════
  if (full.workspace) {
    (async () => {
      const MAX_RETRIES = 3;
      for (let i = 0; i < MAX_RETRIES; i++) {
        try {
          const mod = await import('./memory-manager.js');
          const mgr = mod.getMemoryManager(full.workspace);
          const md = full.metadata || {};
          const kvKey = ((md as any).kvKey as string) || full.entityId || `mem:${full.source}:${full.role}:${full.ts}`;
          const scope = (((md as any).kvScope as string) || 'project') as 'user' | 'session' | 'project' | 'global';
          const priority = (full.importance || 0) >= 0.8 ? 'high' : 'normal';
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
          break; // 成功则退出重试循环
        } catch (e: any) {
          if (i < MAX_RETRIES - 1) {
            console.warn(`[memory] reverseMirror 重试 ${i + 1}/${MAX_RETRIES}: ${e?.message}`);
            await new Promise(r => setTimeout(r, 100 * (i + 1)));
          } else {
            console.warn(`[memory] reverseMirror 失败 (${MAX_RETRIES}次重试): ${e?.message}`);
          }
        }
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

export async function compressMemoryFile(filePath: string): Promise<void> {
  // 防重入: 如果该文件正在压缩, 跳过
  if (compressingFiles.has(filePath)) return;
  // P0 修复: 冷却期检查 — 5 分钟内已压缩过的文件不再触发
  const lastCompressed = compressedCooldowns.get(filePath);
  if (lastCompressed && Date.now() - lastCompressed < COMPRESS_COOLDOWN_MS) return;
  compressingFiles.add(filePath);
  try {
    // ★ 2026-10-17 P0-2: 大文件不做"尾部读 + 整体覆写"式压缩。
    //   窗口外条目会被静默蒸发 (位置截断 ≠ 压缩, 见 cleanupOldMemory 头注释)。
    //   缩容交给 cleanupOldMemory 的流式清理 (30 天 + 1000 条), 回到窗口内
    //   再走本函数做重要性精压。跳过不进冷却 — 缩容后下次写入应能立即重试。
    const cst = await fs.stat(filePath).catch(() => null);
    if (cst && cst.isFile() && cst.size > TAIL_READ_MAX_BYTES) {
      console.warn(`[memory:compress] skip oversized file ${(cst.size / 1024 / 1024).toFixed(1)}MB > 4MB: ${path.basename(filePath)} (等 cleanupOldMemory 流式缩容)`);
      return;
    }

    const { evaluateBatch, generateSummary } = await import('./memory-importance.js');

    // ★ 2026-10-17 P0: 有界尾部读取 — 原 readFile 整读在大文件上抛
    //   Invalid string length 被 .catch(() => '') 吞掉 → 压缩静默失效 (文件只涨不减)
    //   压缩本身有 KEEP_HIGH_VALUE/KEEP_RECENT 上限, 尾部窗口语义兼容
    const lines = (await readTailLines(filePath)).filter(Boolean);
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
      // ★ 2026-10-17 P0: 有界尾部读取 — 整读会在 >512MB 文件上抛
      //   Invalid string length 被 catch 吞掉 (表现: 静默 0 条记忆 + 每次 7s 白读)
      const lines = await readTailLines(file);
      for (const line of lines) {
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
 *
 * ═══ 2026-10-17 P0 重写 ═══
 * 原实现三个致命问题 (实测 default.jsonl 1.6GB 全中):
 *   ① `fs.readFile` 整读 — >512MB 抛 Invalid string length 被 catch 吞 →
 *      "清理成功"但一条没删, 文件永远只涨不减 (且无调用方发现, 因为从没人调过它)
 *   ② 写回用 `fs.writeFile` 直写 — 不走 append 队列, 与并发 append 交错丢行
 *   ③ **全代码库零调用** — evolution/task-snapshot/persistent-memory 都有 6h
 *      清理循环, 唯独 JSONL 记忆没有 → 用户级文件 (<userDir>/<userId>.jsonl)
 *      只被 writeMemory 双写追加, 没有任何机制 prune
 * 现在: 有界尾部读取 + 排队原子重写 + 真实条数上限, 且由
 * `startMemoryCleanupLoop()` 每 6h 驱动 (index.ts / app.ts 启动处接线)。
 *
 * ═══ 2026-10-17 P0-2 补丁: 大文件流式路径 ═══
 * 尾部读 (4MB 窗口) + 整体覆写 (atomicRewrite) 的组合在**超过窗口大小**的文件上
 * 会把窗口外条目静默蒸发 — 不是"清理", 是"截断": 窗口外的真实记忆 (哪怕在保留期
 * 内) 连评估都不会参与。实测最接近红线的: `user.jsonl` 5.0MB/10,581 条 (用户主
 * 记忆), 一旦无参 cleanup 扫到它, 头部 ~1MB 的真实条目直接蒸发。小文件 (<4MB)
 * readTailLines 等于全读, 语义不受影响; 大文件必须走 streamFilterFile 流式全量
 * 过滤 (读用 readline 流不载入全文字符串, survivors ≤1000 条很小可直接拼写)。
 */
const MAX_MEMORY_ENTRIES_PER_FILE = 1000;
const MEMORY_RETENTION_DAYS = 30;

/**
 * 大文件 (>TAIL_READ_MAX_BYTES) 的流式全量清理 — 见 cleanupOldMemory 头注释 P0-2。
 * 读: readline 流逐行 (不把整个文件载入字符串, 避开 512MB 字符串上限);
 * 判: cutoff 保留期过滤 + 坏行原样保留 + 超上限按 ts 取最新 maxKeep 条;
 * 写: survivors ≤ maxKeep 条, 拼字符串走 atomicRewrite (rename 原子替换)。
 */
async function streamFilterFile(
  filePath: string,
  cutoff: number,
  maxKeep: number,
): Promise<{ deleted: number; rewritten: boolean }> {
  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });
  const kept: Array<{ ts: number; line: string }> = [];
  let deleted = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.ts >= cutoff) {
        kept.push({ ts: entry.ts, line });
      } else {
        deleted++;
      }
    } catch {
      kept.push({ ts: 0, line }); // 坏行保留 — 与尾部读路径同语义
    }
  }
  if (deleted === 0) return { deleted: 0, rewritten: false };
  let finalLines = kept;
  if (kept.length > maxKeep) {
    const sorted = [...kept].sort((a, b) => a.ts - b.ts);
    finalLines = sorted.slice(sorted.length - maxKeep);
    deleted += kept.length - finalLines.length;
  }
  const newContent = finalLines.map(k => k.line).join('\n') + '\n';
  await atomicRewrite(filePath, newContent);
  return { deleted, rewritten: true };
}

export async function cleanupOldMemory(
  userId?: string,
  workspace?: string,
): Promise<{ deleted: number; tmpSwept: number }> {
  let deleted = 0;
  let tmpSwept = 0;
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
      const st = await fs.stat(file).catch(() => null);
      if (!st || !st.isFile()) continue;
      if (st.size > TAIL_READ_MAX_BYTES) {
        // ★ 2026-10-17 P0-2: 大文件必须流式全量过滤。
        //   尾部读窗口 + 整体覆写 = 位置截断: 窗口外的真实记忆 (哪怕在保留期内)
        //   连评估都不参与就被蒸发。实测红线: user.jsonl 5.0MB/10,581 条。
        const r = await streamFilterFile(file, cutoff, MAX_MEMORY_ENTRIES_PER_FILE);
        deleted += r.deleted;
        continue;
      }
      // 小文件 (<4MB): 尾部读等于全读, 语义不受影响, 保持原路径。
      const lines = (await readTailLines(file)).filter(l => l.trim());
      const kept: Array<{ ts: number; line: string }> = [];
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.ts >= cutoff) {
            kept.push({ ts: entry.ts, line });
          } else {
            deleted++;
          }
        } catch {
          kept.push({ ts: 0, line }); // 坏行保留 — JSON parse failure per line is expected
        }
      }
      // 超过上限 → 按 ts 只保留最新的 N 条 (原实现靠文件序 slice, 尾部读取后显式排序更稳)
      let finalLines = kept;
      if (kept.length > MAX_MEMORY_ENTRIES_PER_FILE) {
        const sorted = [...kept].sort((a, b) => a.ts - b.ts);
        finalLines = sorted.slice(sorted.length - MAX_MEMORY_ENTRIES_PER_FILE);
        deleted += kept.length - finalLines.length;
      }
      const newContent = finalLines.map(k => k.line).join('\n') + '\n';
      // 只有真变了才写 (避免每 6h 无意义重写整个文件)
      const before = lines.join('\n') + '\n';
      if (newContent === before) continue;
      await atomicRewrite(file, newContent);
    } catch (e: any) {
      // 文件不存在或不可读, 跳过 (单文件失败不影响其他文件)
      console.warn(`[memory:cleanupOldMemory] skip ${file}: ${e?.message}`);
    }
  }

  // ★ 2026-10-17 P0: 清扫本模块回退路径产生的 tmp 残留。
  //   ⚠️ 范围严格限定: 只匹配**新代码的确定性 tmp 名** (.jsonl.tmp /
  //   .jsonl.rewrite.tmp / .jsonl.prune.tmp / .jsonl.cleanup.tmp /
  //   .jsonl.compress.tmp) — 这些只可能由当前版本的 atomicAppendFile /
  //   atomicRewrite / pruneMemoryFile 创建 (每文件最多 1 个, 失败即 unlink,
  //   残留只可能是进程被硬杀), 且只删 1 小时以上 + ≤1MB 的 (在用的必是秒级)。
  //   **不匹配**旧版的随机名 `*.jsonl.<8hex>.tmp` (2026-10-17 实测用户目录
  //   攒了 10,931 个) — 那是历史遗留物, 删它们需要用户明确同意 (见汇报),
  //   自动清理绝不未经同意动用户目录里的历史文件。
  try {
    const entries = await fs.readdir(userDir);
    const tmpCutoff = Date.now() - 60 * 60 * 1000;
    for (const name of entries) {
      if (!/\.jsonl\.(tmp|rewrite\.tmp|prune\.tmp|cleanup\.tmp|compress\.tmp)$/.test(name)) continue;
      const p = path.join(userDir, name);
      try {
        const st = await fs.stat(p);
        if (!st.isFile() || st.size > 1024 * 1024) continue;
        if (st.mtimeMs < tmpCutoff) {
          await fs.unlink(p);
          tmpSwept++;
        }
      } catch { /* 并发删除/不存在, 忽略 */ }
    }
  } catch { /* userDir 不存在, 忽略 */ }

  return { deleted, tmpSwept };
}

// ═══════════════════════════════════════════════════════
// 记忆文件定期清理 (2026-10-17 P0 新增)
// ═══════════════════════════════════════════════════════
// 背景: cleanupOldMemory 自出生起就没有任何调用方 (evolution/task-snapshot/
// persistent-memory 都有 6h 循环, 唯独 JSONL 记忆没有) → 用户级记忆文件
// 无限增长 (实测 1.6GB / 约 320 万条, 绝大多数是测试跑出来的 auto_reflect)。
// 本循环补上这个缺口: 每 6h 跑一次全量清理 (保留 30 天 + 最新 1000 条/文件
// + 清扫泄漏 tmp)。与 task-snapshot 的清理循环同模式: 启动即跑一次 + unref。

const MEMORY_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
let memoryCleanupTimer: NodeJS.Timeout | null = null;

export function startMemoryCleanupLoop(): void {
  if (memoryCleanupTimer) return;
  const run = () => {
    cleanupOldMemory()
      .then((r) => {
        if (r.deleted > 0 || r.tmpSwept > 0) {
          console.log(`[memory:cleanup] pruned ${r.deleted} entries, swept ${r.tmpSwept} stale tmp files`);
        }
      })
      .catch((e: any) => console.warn('[memory:cleanup] failed:', e?.message));
  };
  run(); // 启动即执行一次 (修复已存在的巨文件)
  memoryCleanupTimer = setInterval(run, MEMORY_CLEANUP_INTERVAL_MS);
  memoryCleanupTimer.unref?.();
}

export function stopMemoryCleanupLoop(): void {
  if (memoryCleanupTimer) {
    clearInterval(memoryCleanupTimer);
    memoryCleanupTimer = null;
  }
}

/**
 * 按调用方策略 prune 单个 JSONL 记忆文件 (排队原子重写)
 *
 * 2026-10-17 P0: 为 self-memory-updater.cleanupStaleMemories 提供真实现 —
 * 那个函数原来声称"删除过时记忆"实际一条不删 (条目无 id 字段, toDelete 恒空,
 * 连日志都不打, 纯摆设)。decide 返回要保留的条目, 本函数负责有界读取 +
 * 排队写入, 调用方只写过滤策略。
 */
export async function pruneMemoryFile(
  filePath: string,
  decide: (entries: MemoryEntry[]) => MemoryEntry[],
): Promise<{ before: number; after: number; rewritten: boolean }> {
  const lines = (await readTailLines(filePath)).filter(l => l.trim());
  const entries: MemoryEntry[] = [];
  const badLines: string[] = [];
  for (const line of lines) {
    try { entries.push(JSON.parse(line)); } catch { badLines.push(line); }
  }
  if (entries.length === 0 && badLines.length === 0) return { before: 0, after: 0, rewritten: false };

  const kept = decide(entries);
  const keptLines = kept.map(e => JSON.stringify(e));
  const newContent = [...keptLines, ...badLines].join('\n') + '\n';
  const oldContent = lines.join('\n') + '\n';
  if (newContent === oldContent) {
    return { before: entries.length, after: kept.length, rewritten: false };
  }
  await atomicRewrite(filePath, newContent);
  return { before: entries.length, after: kept.length, rewritten: true };
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
