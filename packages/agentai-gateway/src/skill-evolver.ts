/**
 * Skill 自进化循环 — 基于 knowledge-cache 数据驱动 Skill 生命周期管理
 * 
 * 核心逻辑：
 * - Skill 使用次数 × 平均评分 = fitness score
 * - 连续 10 次评分 < 3 → deprecated
 * - 功能重叠 > 70% → 建议合并
 * - 高质量 Skill 自动提升路由权重
 *
 * 新增 SkillOpt 风格训练流程：
 * - 验证门控机制：只有严格提升验证分数才接受修改
 * - 训练循环：rollout → reflect → aggregate → select → update → evaluate
 * - 学习率预算：控制修改幅度
 * - 拒绝编辑缓冲区：避免重复错误
 */

import { SkillTrainer, EvaluateResult } from './skill-training.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Skill 元数据 */
export interface SkillMeta {
  id: string;
  name: string;
  category: string;
  description: string;
  version: string;
  created_at: string;
  updated_at: string;
  usage_count: number;
  total_score: number;
  avg_score: number;
  fitness_score: number; // usage_count * avg_score
  status: 'active' | 'deprecated' | 'merged';
}

/** Skill 使用记录 */
export interface SkillUsageRecord {
  skill_id: string;
  skill_name: string;
  category: string;
  score: number;
  latency_ms: number;
  timestamp: string;
}

/** 进化决策 */
export interface EvolutionDecision {
  type: 'promote' | 'demote' | 'deprecated' | 'merge' | 'create';
  skill_id: string;
  skill_name: string;
  reason: string;
  new_status?: SkillMeta['status'];
  confidence: number; // 0-1
}

// ---------------------------------------------------------------------------
// SkillEvolver
// ---------------------------------------------------------------------------

/** 进化阈值配置 */
interface EvolverConfig {
  /** 连续低分次数阈值，达到后标记 deprecated */
  deprecated_threshold: number;
  /** fitness_score 高于此值时提升路由权重 */
  promote_threshold: number;
  /** 功能重叠率 > 此值时建议合并 */
  merge_similarity_threshold: number;
  /** 最低使用次数阈值，低于此值不纳入统计 */
  min_usage_count: number;
  /** 评分窗口大小（最近 N 次使用） */
  score_window_size: number;
}

const DEFAULT_CONFIG: EvolverConfig = {
  deprecated_threshold: 10,
  promote_threshold: 50,
  merge_similarity_threshold: 0.7,
  min_usage_count: 3,
  score_window_size: 20,
};

export class SkillEvolver {
  private config: EvolverConfig;
  private skillRegistry: Map<string, SkillMeta>;
  private usageBuffer: SkillUsageRecord[];
  private trainer: SkillTrainer; // 新增：SkillOpt 风格训练器

  constructor(config?: Partial<EvolverConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.skillRegistry = new Map();
    this.usageBuffer = [];
    this.trainer = new SkillTrainer(); // 初始化训练器
  }

  // ---- SkillOpt 风格训练 ----

  /**
   * 训练技能：使用验证门控和训练循环优化技能文档
   */
  async trainSkill(skillId: string, skillContent: string, validationTasks: string[]): Promise<EvaluateResult> {
    console.log(`[SkillEvolver] 开始 SkillOpt 风格训练: ${skillId}`);
    return await this.trainer.trainSkill(skillId, skillContent, validationTasks);
  }

  /**
   * 获取拒绝编辑缓冲区
   */
  getRejectBuffer() {
    return this.trainer.getRejectBuffer();
  }

  /**
   * 清空拒绝编辑缓冲区
   */
  clearRejectBuffer() {
    this.trainer.clearRejectBuffer();
  }

  // ---- 记录使用 ----

  /** 记录一次 Skill 使用 */
  recordUsage(record: SkillUsageRecord): void {
    this.usageBuffer.push(record);
    // 维护滑动窗口
    if (this.usageBuffer.length > this.config.score_window_size * 100) {
      this.usageBuffer = this.usageBuffer.slice(-this.config.score_window_size * 50);
    }
  }

  /** 批量记录 */
  recordBatch(records: SkillUsageRecord[]): void {
    this.usageBuffer.push(...records);
  }

  // ---- 技能生命周期 ----

  /**
   * 计算所有 Skill 的 fitness score 并返回进化决策
   * 
   * 进化逻辑：
   * 1. 从 usageBuffer 中按 skill_id 聚合统计数据
   * 2. 计算 avg_score, fitness_score
   * 3. 根据阈值做出进化决策
   */
  evaluate(): EvolutionDecision[] {
    const decisions: EvolutionDecision[] = [];
    const stats = this._aggregateStats();

    for (const [skillId, skillStats] of stats) {
      const meta = this.skillRegistry.get(skillId);
      const currentStatus = meta?.status ?? 'active';

      // 更新 Skill 元数据
      const newMeta: SkillMeta = {
        id: skillId,
        name: skillStats.name,
        category: skillStats.category,
        description: meta?.description ?? '',
        version: meta?.version ?? '1.0',
        created_at: meta?.created_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
        usage_count: skillStats.count,
        total_score: skillStats.totalScore,
        avg_score: skillStats.avgScore,
        fitness_score: skillStats.fitness,
        status: currentStatus,
      };

      // 决策 1: 连续低分 → deprecated
      if (skillStats.consecutiveLowScore >= this.config.deprecated_threshold && currentStatus === 'active') {
        newMeta.status = 'deprecated';
        decisions.push({
          type: 'demote',
          skill_id: skillId,
          skill_name: skillStats.name,
          reason: `连续 ${skillStats.consecutiveLowScore} 次评分 < 3，标记为 deprecated`,
          new_status: 'deprecated',
          confidence: 0.95,
        });
      }

      // 决策 2: 高质量 → promote
      if (newMeta.fitness_score >= this.config.promote_threshold && currentStatus === 'active') {
        decisions.push({
          type: 'promote',
          skill_id: skillId,
          skill_name: skillStats.name,
          reason: `fitness_score=${newMeta.fitness_score.toFixed(1)}，提升路由权重`,
          new_status: 'active',
          confidence: 0.85,
        });
      }

      // 决策 3: 首次使用 → 记录创建
      if (skillStats.count === 1 && !meta) {
        decisions.push({
          type: 'create',
          skill_id: skillId,
          skill_name: skillStats.name,
          reason: `新 Skill 首次使用，建议人工审核`,
          new_status: 'active',
          confidence: 0.5,
        });
      }

      // 更新 registry
      this.skillRegistry.set(skillId, newMeta);
    }

    return decisions;
  }

  /**
   * 检测功能重叠的 Skill 对，建议合并
   */
  detectMergable(): Array<{
    skillA: string;
    skillB: string;
    similarity: number;
    reason: string;
  }> {
    const candidates = Array.from(this.skillRegistry.values()).filter(
      (s) => s.status === 'active' && s.usage_count >= this.config.min_usage_count,
    );

    const pairs: Array<{
      skillA: string;
      skillB: string;
      similarity: number;
      reason: string;
    }> = [];

    for (let i = 0; i < candidates.length; i++) {
      const a = candidates[i]!;
      for (let j = i + 1; j < candidates.length; j++) {
        const b = candidates[j]!;
        const sim = this._calcSimilarity(a, b);
        if (sim >= this.config.merge_similarity_threshold) {
          pairs.push({
            skillA: a.id,
            skillB: b.id,
            similarity: sim,
            reason: `类别相同 (${a.category})，名称重叠率 ${Math.round(sim * 100)}%，建议合并`,
          });
        }
      }
    }

    return pairs;
  }

  // ---- 内部辅助 ----

  /** 按 skill_id 聚合统计数据 */
  private _aggregateStats(): Map<string, {
    name: string;
    category: string;
    count: number;
    totalScore: number;
    avgScore: number;
    fitness: number;
    consecutiveLowScore: number;
  }> {
    const map = new Map<string, Array<{ score: number }>>();

    for (const record of this.usageBuffer) {
      if (!map.has(record.skill_id)) map.set(record.skill_id, []);
      map.get(record.skill_id)!.push({ score: record.score });
    }

    const result = new Map<string, {
      name: string;
      category: string;
      count: number;
      totalScore: number;
      avgScore: number;
      fitness: number;
      consecutiveLowScore: number;
    }>();

    for (const [id, scores] of map) {
      const first = this.usageBuffer.find((r) => r.skill_id === id);
      if (!first) continue;

      const count = scores.length;
      const totalScore = scores.reduce((s, x) => s + x.score, 0);
      const avgScore = totalScore / count;
      const fitness = count * avgScore;

      // 计算连续低分次数
      let consecutiveLow = 0;
      for (let i = scores.length - 1; i >= 0; i--) {
        if (scores[i]!.score < 3) consecutiveLow++;
        else break;
      }

      result.set(id, {
        name: first.skill_name,
        category: first.category,
        count,
        totalScore,
        avgScore,
        fitness,
        consecutiveLowScore: consecutiveLow,
      });
    }

    return result;
  }

  /**
   * 计算两个 Skill 的相似度
   * 基于类别 + 名称编辑距离
   */
  private _calcSimilarity(a: SkillMeta, b: SkillMeta): number {
    // 类别相同 +20%
    const categorySim = a.category === b.category ? 0.2 : 0;

    // 名称重叠率
    const aTokens = a.name.split(/[\s\-\_]/).filter(Boolean);
    const bTokens = b.name.split(/[\s\-\_]/).filter(Boolean);
    const shared = aTokens.filter((t) => bTokens.includes(t)).length;
    const total = Math.max(aTokens.length, bTokens.length);
    const nameSim = total > 0 ? shared / total : 0;

    return Math.min(1, categorySim + nameSim * 0.8);
  }

  // ---- 状态查询 ----

  /** 获取所有 Skill 元数据 */
  getRegistry(): SkillMeta[] {
    return Array.from(this.skillRegistry.values());
  }

  /** 获取特定 Skill 元数据 */
  getSkill(id: string): SkillMeta | undefined {
    return this.skillRegistry.get(id);
  }

  /** 获取活跃 Skill 列表 */
  getActiveSkills(): SkillMeta[] {
    return this.getRegistry().filter((s) => s.status === 'active');
  }

  /** 获取待淘汰 Skill 列表 */
  getDeprecatedSkills(): SkillMeta[] {
    return this.getRegistry().filter((s) => s.status === 'deprecated');
  }
}

// ---------------------------------------------------------------------------
// 单例导出
// ---------------------------------------------------------------------------

let _evolver: SkillEvolver | null = null;

export function getSkillEvolver(config?: Partial<EvolverConfig>): SkillEvolver {
  if (!_evolver) {
    _evolver = new SkillEvolver(config);
  }
  return _evolver;
}
