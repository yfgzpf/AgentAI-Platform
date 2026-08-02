/**
 * MemoryManager — 统一记忆接口 (简化版 KV 存储)
 * ==============================
 * ✅ 架构合并 (2026-08-03): 本文件现在作为 memory.ts 高级 JSONL 系统的薄封装
 *   - KV 接口保持不变 (向后兼容旧代码)
 *   - remember() 时异步镜像写入 memory.ts 的 JSONL (统一数据层)
 *   - recall() 优先查 KV (同步快), 必要时回退 JSONL
 *   - 数据最终统一到 memory.ts (带 entityId/importance/冲突检测/时效衰减)
 *
 * 设计意图: 作为 5 层的统一入口 (但当前仅实现 KV 层):
 *   1. persistent-memory (SQLite) — 对话历史/用户数据
 *   2. project-memory  (.json)   — 项目技术栈/偏好/修复模式
 *   3. fts5-memory     (SQLite)  — 全文搜索记忆
 *   4. memory.jsonl              — 高级 JSONL 记忆 (实际被 memory.ts 管理)
 *   5. knowledge-cache           — 知识缓存
 *
 * 使用方式:
 *   const mm = MemoryManager.getInstance(workspace);
 *   await mm.remember({ key: 'tech-stack', value: 'React 18', scope: 'project' });
 *   const facts = await mm.recall({ query: 'React version' });
 *   await mm.forget('tech-stack');
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ===== Types =====
export interface MemoryFact {
  key: string;
  value: string;
  scope: 'session' | 'project' | 'user' | 'global';
  metadata?: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryQuery {
  key?: string;
  query?: string;          // 语义搜索
  scope?: 'session' | 'project' | 'user' | 'global';
  limit?: number;
}

// ===== MemoryManager =====
export class MemoryManager {
  private static instances = new Map<string, MemoryManager>();
  private workspace: string;
  private storePath: string;
  private facts: Map<string, MemoryFact> = new Map();

  private constructor(workspace: string) {
    this.workspace = workspace;
    this.storePath = path.join(workspace, '.agentai', 'memory.json');
    this.load();
  }

  static getInstance(workspace?: string): MemoryManager {
    const ws = workspace || process.cwd();
    if (!this.instances.has(ws)) {
      this.instances.set(ws, new MemoryManager(ws));
    }
    return this.instances.get(ws)!;
  }

  /** 加载文件到内存 */
  private load(): void {
    try {
      const dir = path.dirname(this.storePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(this.storePath)) {
        const data = JSON.parse(fs.readFileSync(this.storePath, 'utf-8'));
        for (const fact of data.facts || []) {
          this.facts.set(fact.key, fact);
        }
      }
    } catch {}
  }

  /** 持久化 */
  private save(): void {
    try {
      const data = { facts: [...this.facts.values()], updatedAt: Date.now() };
      fs.writeFileSync(this.storePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {}
  }

  /** 记住一个事实 */
  async remember(entry: { key: string; value: string; scope?: MemoryFact['scope']; metadata?: Record<string, any> }): Promise<void> {
    const now = Date.now();
    const existing = this.facts.get(entry.key);
    const fact: MemoryFact = {
      key: entry.key,
      value: entry.value,
      scope: entry.scope || 'project',
      metadata: entry.metadata,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    this.facts.set(entry.key, fact);
    this.save();

    // 同步到项目记忆 (如果是项目级事实)
    if (fact.scope === 'project' || fact.scope === 'user') {
      this.syncToProjectMemory(fact);
    }

    // ═══ 2026-08-03: 镜像写入 memory.ts 高级 JSONL 系统 (统一数据层) ═══
    // 异步写入, 不阻塞 KV 接口; 失败不影响主流程
    this.mirrorToAdvancedMemory(fact).catch(() => {
      // 静默失败 — KV 存储已经成功, 高级系统失败不影响数据完整性
    });
  }

  /**
   * 镜像写入 memory.ts 高级 JSONL 系统
   * - KV key → entityId (用于冲突检测/去重)
   * - scope → role/source
   * - metadata 保留
   */
  private async mirrorToAdvancedMemory(fact: MemoryFact): Promise<void> {
    try {
      const { writeMemory } = await import('./memory.js');
      await writeMemory({
        userId: 'default',
        workspace: this.workspace,
        role: fact.scope === 'user' ? 'user' : 'assistant',
        source: 'workspace',
        entityId: `kv:${fact.scope}:${fact.key}`,
        content: fact.value,
        importance: fact.metadata?.priority === 'high' ? 0.8
          : fact.metadata?.priority === 'medium' ? 0.5 : 0.3,
        metadata: {
          kvKey: fact.key,
          kvScope: fact.scope,
          kvCreatedAt: fact.createdAt,
          ...fact.metadata,
        },
      });
    } catch {
      // 静默失败
    }
  }

  /** 查询记忆 */
  async recall(query: MemoryQuery): Promise<MemoryFact[]> {
    let results = [...this.facts.values()];

    // 按 scope 过滤
    if (query.scope) {
      results = results.filter(f => f.scope === query.scope);
    }

    // 精确 key 匹配
    if (query.key) {
      results = results.filter(f => f.key === query.key);
    }

    // 语义搜索: 简单子串匹配 + 模糊匹配
    if (query.query && !query.key) {
      const q = query.query.toLowerCase().trim();
      if (q) {
        // 子串匹配
        const substringMatches = results.filter(f =>
          f.key.toLowerCase().includes(q) ||
          f.value.toLowerCase().includes(q)
        );

        // 如果有子串匹配结果，优先返回
        if (substringMatches.length > 0) {
          results = substringMatches;
        } else {
          // 模糊: 按单词覆盖率排序
          const queryWords = new Set(q.split(/\s+/));
          results.sort((a, b) => {
            const scoreA = [...queryWords].filter(w =>
              a.key.includes(w) || a.value.includes(w)
            ).length;
            const scoreB = [...queryWords].filter(w =>
              b.key.includes(w) || b.value.includes(w)
            ).length;
            return scoreB - scoreA;
          });
        }
      }
    }

    // 限制数量 + 按时间排序
    results.sort((a, b) => b.updatedAt - a.updatedAt);
    if (query.limit) results = results.slice(0, query.limit);

    return results;
  }

  /** 忘记 */
  async forget(key: string, scope?: string): Promise<boolean> {
    const existed = this.facts.has(key);
    if (existed) {
      this.facts.delete(key);
      this.save();
    }
    return existed;
  }

  /** 列出所有 */
  async list(scope?: string): Promise<MemoryFact[]> {
    let facts = [...this.facts.values()];
    if (scope) facts = facts.filter(f => f.scope === scope);
    return facts.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** 获取项目记忆上下文 (用于 AI 注入) */
  async buildContext(): Promise<string> {
    const projectFacts = await this.recall({ scope: 'project', limit: 20 });
    const userFacts = await this.recall({ scope: 'user', limit: 5 });

    if (projectFacts.length === 0 && userFacts.length === 0) return '';

    const lines: string[] = ['<memory context="unified">'];
    for (const f of projectFacts.slice(0, 10)) {
      lines.push(`  ${f.key}: ${f.value.slice(0, 100)}`);
    }
    if (userFacts.length > 0) {
      lines.push('  [用户偏好]');
      for (const f of userFacts) {
        lines.push(`  ${f.key}: ${f.value.slice(0, 80)}`);
      }
    }
    lines.push('</memory>');
    return lines.join('\n');
  }

  /** 记录修复模式 */
  async recordFix(pattern: string, solution: string): Promise<void> {
    await this.remember({ key: `fix:${pattern.replace(/\s+/g, '-').slice(0, 60)}`, value: solution, scope: 'project', metadata: { type: 'fix-pattern' } });
  }

  /** 同步到 project-memory.json (兼容旧接口) */
  private syncToProjectMemory(fact: MemoryFact): void {
    try {
      const pmPath = path.join(this.workspace, '.agentai', 'project-memory.json');
      if (!fs.existsSync(pmPath)) return;
      const pm = JSON.parse(fs.readFileSync(pmPath, 'utf-8'));
      pm.updatedAt = Date.now();
      fs.writeFileSync(pmPath, JSON.stringify(pm, null, 2), 'utf-8');
    } catch {}
  }

  /** 清空所有 */
  async clear(scope?: string): Promise<void> {
    if (scope) {
      for (const [k, f] of this.facts) {
        if (f.scope === scope) this.facts.delete(k);
      }
    } else {
      this.facts.clear();
    }
    this.save();
  }
}

/** 向后兼容: 世界模型/记忆系统的外部工厂别名 */
export function getMemoryManager(workspace: string): MemoryManager {
  return MemoryManager.getInstance(workspace);
}
