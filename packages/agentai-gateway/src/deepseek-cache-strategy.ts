/**
 * DeepSeekCacheStrategy — 前缀缓存策略 (学 Reasonix ImmutablePrefix)
 * ----------------------------------------------------------------
 * 核心理念:
 *   DeepSeek API 对重复前缀只收取低价缓存token费用 (约10%).
 *   所以 system prompt + tools 应该在 session 内完全不变.
 * 
 * 实现:
 *   - 启动时构建 immutableSystem (含完整 SKILL.md)
 *   - fingerprint 机制: 内容变 → hash 变 → 需要重建
 *   - Frozen Snapshot (Hermes): 会话中记忆变更不影响 system prompt
 *   - 工具列表如果未变, 复用上次 hash
 * 
 * 学自: Reasonix ImmutablePrefix (fingerprintCache + replaceSystem)
 * 学自: Hermes Frozen Snapshot
 */

import { createHash } from 'node:crypto';

export interface CacheStrategyOptions {
  /** 系统提示词 */
  system: string;
  /** 工具规范 (name + description + parameters) */
  toolDefs?: Array<{ name: string; description: string; parameters?: any }>;
  /** 技能完整内容 (SKILL.md) */
  skillContents?: Array<{ name: string; content: string }>;
}

export class DeepSeekCacheStrategy {
  private system: string;
  private toolDefs: Array<{ name: string; description: string; parameters?: any }>;
  private skillContents: Array<{ name: string; content: string }>;
  private fingerprint: string | null = null;

  constructor(opts: CacheStrategyOptions) {
    this.system = opts.system;
    this.toolDefs = opts.toolDefs || [];
    this.skillContents = opts.skillContents || [];
    this.fingerprint = this.computeFingerprint();
    console.log(`[cache] prefix fingerprint: ${this.fingerprint?.slice(0, 12)} (tools: ${this.toolDefs.length}, skills: ${this.skillContents.length})`);
  }

  /** 替换系统提示词 (触发 cache miss) */
  replaceSystem(newSystem: string): boolean {
    if (this.system === newSystem) return false;
    this.system = newSystem;
    this.fingerprint = this.computeFingerprint();
    console.log(`[cache] system replaced, new fingerprint: ${this.fingerprint?.slice(0, 12)}`);
    return true;
  }

  /** 添加工具 (触发 cache miss — DeepSeek cache key 含完整工具列表) */
  addTool(spec: { name: string; description: string; parameters?: any }): boolean {
    if (this.toolDefs.some(t => t.name === spec.name)) return false;
    this.toolDefs.push(spec);
    this.fingerprint = this.computeFingerprint();
    return true;
  }

  /** 添加 Skill 内容 (不触发 cache miss — skills 不在 immutable prefix 中) */
  addSkillContent(name: string, content: string) {
    const existing = this.skillContents.find(s => s.name === name);
    if (existing) {
      if (existing.content === content) return false;
      existing.content = content;
    } else {
      this.skillContents.push({ name, content });
    }
    return true;
  }

  /** 构建 Immutable System Message (只含 system + tools, 不含动态内容) */
  buildImmutableSystem(): string {
    const parts: string[] = [this.system];

    // Tools (OpenAI format)
    if (this.toolDefs.length > 0) {
      const toolLines = ['\n## Available Tools'];
      for (const t of this.toolDefs) {
        const desc = t.description?.slice(0, 200) || '';
        toolLines.push(`- **${t.name}**: ${desc}`);
      }
      parts.push(toolLines.join('\n'));
    }

    return parts.join('\n');
  }

  /** 构建完整 Skills 参考内容 (动态注入, 不破坏缓存) */
  buildSkillsReference(): string {
    if (this.skillContents.length === 0) return '';
    const lines = ['\n## Available Skills (complete reference)'];
    for (const s of this.skillContents) {
      // 只取 SKILL.md 的关键部分 (少 Token 但 informer 更多)
      const brief = s.content
        .replace(/^---[\s\S]*?---\n?/m, '') // 去掉 YAML frontmatter
        .replace(/#{1,3}\s/g, '**') // 简化标题
        .slice(0, 2000); // 每个 skill 最多 2000 字符
      lines.push(`\n### ${s.name}\n${brief}`);
      if (s.content.length > 2000) lines.push('*(truncated)*');
    }
    return lines.join('\n');
  }

  /** 检查是否缓存命中 (比较 fingerprint) */
  isCacheHit(otherFingerprint?: string): boolean {
    if (!otherFingerprint) return false;
    return this.fingerprint === otherFingerprint;
  }

  getFingerprint(): string | null {
    return this.fingerprint;
  }

  /** 统计缓存友好度 */
  getCacheStats(): { prefixTokens: number; toolsCached: boolean; skillsCount: number } {
    const prefixTokens = Math.round((this.system.length + this.toolDefs.reduce((s, t) => s + (t.description?.length || 0) + t.name.length, 0)) / 2);
    return {
      prefixTokens,
      toolsCached: this.toolDefs.length > 0,
      skillsCount: this.skillContents.length,
    };
  }

  private computeFingerprint(): string {
    const payload = JSON.stringify({
      system: this.system.slice(0, 2000), // 只 hash 前 2000 字符 (其余极少变)
      toolNames: this.toolDefs.map(t => t.name).sort(),
    });
    return createHash('sha256').update(payload).digest('hex').slice(0, 16);
  }
}

/**
 * 检查当前 session 是否需要重建缓存
 * (当工具注册变更或 system prompt 更版时触发)
 */
export function shouldRebuildCache(prevHash: string | null, currentHash: string | null): boolean {
  if (!prevHash || !currentHash) return true;
  return prevHash !== currentHash;
}
