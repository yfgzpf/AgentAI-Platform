/**
 * SkillDNA - 技能DNA组合式进化系统
 * 
 * 创新理念：技能拆解为可复用/可重组/可继承/可变异的DNA片段
 * 新技能通过"杂交"已有DNA快速生成
 * 从整体重写 → 增量精准进化
 */

import { EventEmitter } from 'events';

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

export interface SkillDNA {
  id: string;
  name: string;
  /** DNA片段类型 */
  type: 'capability' | 'pattern' | 'knowledge' | 'constraint';
  /** 功能描述 */
  description: string;
  /** 代码/逻辑片段 */
  code?: string;
  /** 元数据 */
  metadata: {
    language?: string;
    dependencies: string[];
    complexity: 'simple' | 'medium' | 'complex';
    reusability: number; // 0-1
  };
  /** 使用统计 */
  stats: {
    usedInSkills: string[];
    executionCount: number;
    successRate: number;
  };
  /** 版本历史 */
  versions: DNAVersion[];
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
}

export interface DNAVersion {
  version: number;
  code: string;
  changeDescription: string;
  createdAt: number;
}

export interface SkillGenome {
  skillId: string;
  skillName: string;
  /** 组成这个技能的DNA片段 */
  dnaFragments: string[]; // DNA IDs
  /** DNA组合方式 */
  composition: {
    type: 'sequential' | 'parallel' | 'conditional' | 'loop';
    config: Record<string, any>;
  };
  /** 适应性评分 */
  fitness: number; // 0-1
  /** 进化代数 */
  generation: number;
  /** 父代技能 */
  parents: string[];
}

export interface DNACrossoverResult {
  newDNA: Partial<SkillDNA>;
  inheritedFrom: string[];
  mutations: DNAMutation[];
  fitness: number;
}

export interface DNAMutation {
  type: 'add' | 'remove' | 'modify' | 'reorder';
  target: string;
  description: string;
  impact: 'positive' | 'neutral' | 'negative';
}

export interface HybridizationRequest {
  parentSkillIds: string[];
  targetCapability: string;
  constraints?: string[];
}

export interface HybridizationResult {
  success: boolean;
  newGenome?: SkillGenome;
  dnaUsed: string[];
  mutations: DNAMutation[];
  estimatedFitness: number;
  error?: string;
}

// ═══════════════════════════════════════════════════════════
// 技能DNA系统
// ═══════════════════════════════════════════════════════════

export class SkillDNAEvolution extends EventEmitter {
  private dnaLibrary: Map<string, SkillDNA> = new Map();
  private genomes: Map<string, SkillGenome> = new Map();

  /**
   * 从技能提取DNA
   */
  extractDNA(skillId: string, skillCode: string, skillDescription: string): SkillDNA[] {
    const dnaFragments: SkillDNA[] = [];
    
    // 1. 提取能力DNA（主要功能）
    const capabilityDNA = this.extractCapabilityDNA(skillId, skillCode, skillDescription);
    if (capabilityDNA) {
      dnaFragments.push(capabilityDNA);
    }
    
    // 2. 提取模式DNA（代码模式）
    const patternDNAs = this.extractPatternDNA(skillId, skillCode);
    dnaFragments.push(...patternDNAs);
    
    // 3. 提取知识DNA（领域知识）
    const knowledgeDNA = this.extractKnowledgeDNA(skillId, skillDescription);
    if (knowledgeDNA) {
      dnaFragments.push(knowledgeDNA);
    }
    
    // 4. 提取约束DNA（限制条件）
    const constraintDNA = this.extractConstraintDNA(skillId, skillCode);
    if (constraintDNA) {
      dnaFragments.push(constraintDNA);
    }
    
    // 存储到库
    for (const dna of dnaFragments) {
      this.dnaLibrary.set(dna.id, dna);
    }
    
    this.emit('dna:extracted', { skillId, dnaCount: dnaFragments.length });
    
    return dnaFragments;
  }

  /**
   * 创建技能基因组
   */
  createGenome(skillId: string, skillName: string, dnaIds: string[]): SkillGenome {
    const genome: SkillGenome = {
      skillId,
      skillName,
      dnaFragments: dnaIds,
      composition: {
        type: 'sequential',
        config: {},
      },
      fitness: 0.5,
      generation: 1,
      parents: [],
    };
    
    this.genomes.set(skillId, genome);
    
    // 更新DNA使用统计
    for (const dnaId of dnaIds) {
      const dna = this.dnaLibrary.get(dnaId);
      if (dna) {
        if (!dna.stats.usedInSkills.includes(skillId)) {
          dna.stats.usedInSkills.push(skillId);
        }
        dna.updatedAt = Date.now();
      }
    }
    
    this.emit('genome:created', genome);
    
    return genome;
  }

  /**
   * DNA杂交：组合多个技能的DNA创建新技能
   */
  hybridize(request: HybridizationRequest): HybridizationResult {
    try {
      const { parentSkillIds, targetCapability, constraints = [] } = request;
      
      // 获取父代基因组
      const parentGenomes = parentSkillIds
        .map(id => this.genomes.get(id))
        .filter((g): g is SkillGenome => g !== undefined);
      
      if (parentGenomes.length === 0) {
        return { success: false, dnaUsed: [], mutations: [], estimatedFitness: 0, error: '找不到父代技能' };
      }
      
      // 收集所有DNA片段
      const allDNA = new Set<string>();
      for (const genome of parentGenomes) {
        for (const dnaId of genome.dnaFragments) {
          allDNA.add(dnaId);
        }
      }
      
      // 选择相关DNA
      const selectedDNA = this.selectRelevantDNA(
        Array.from(allDNA),
        targetCapability,
        constraints
      );
      
      // 生成变异
      const mutations = this.generateMutations(selectedDNA, targetCapability);
      
      // 计算预期适应度
      const estimatedFitness = this.estimateFitness(selectedDNA, mutations);
      
      // 创建新基因组
      const newGenomeId = `skill-hybrid-${Date.now()}`;
      const newGenome: SkillGenome = {
        skillId: newGenomeId,
        skillName: `Hybrid: ${targetCapability}`,
        dnaFragments: selectedDNA,
        composition: {
          type: 'sequential',
          config: { targetCapability },
        },
        fitness: estimatedFitness,
        generation: Math.max(...parentGenomes.map(g => g.generation)) + 1,
        parents: parentSkillIds,
      };
      
      this.genomes.set(newGenomeId, newGenome);
      
      this.emit('hybrid:created', { genome: newGenome, parents: parentSkillIds });
      
      return {
        success: true,
        newGenome,
        dnaUsed: selectedDNA,
        mutations,
        estimatedFitness,
      };
    } catch (error: any) {
      return {
        success: false,
        dnaUsed: [],
        mutations: [],
        estimatedFitness: 0,
        error: error.message,
      };
    }
  }

  /**
   * DNA变异：对现有技能进行增量改进
   */
  mutate(skillId: string, mutationType: 'optimize' | 'simplify' | 'extend'): DNAMutation[] {
    const genome = this.genomes.get(skillId);
    if (!genome) {
      return [];
    }
    
    const mutations: DNAMutation[] = [];
    
    switch (mutationType) {
      case 'optimize':
        // 优化：替换低效DNA
        mutations.push(...this.optimizeDNA(genome));
        break;
      case 'simplify':
        // 简化：移除冗余DNA
        mutations.push(...this.simplifyDNA(genome));
        break;
      case 'extend':
        // 扩展：添加新能力DNA
        mutations.push(...this.extendDNA(genome));
        break;
    }
    
    // 应用变异
    for (const mutation of mutations) {
      this.applyMutation(genome, mutation);
    }
    
    genome.generation++;
    this.genomes.set(skillId, genome);
    
    this.emit('dna:mutated', { skillId, mutations });
    
    return mutations;
  }

  /**
   * 评估技能适应度
   */
  evaluateFitness(skillId: string, executionStats: {
    successRate: number;
    avgLatency: number;
    userSatisfaction: number;
  }): number {
    const genome = this.genomes.get(skillId);
    if (!genome) return 0;
    
    // 多维度适应度计算
    const fitness = (
      executionStats.successRate * 0.4 +
      (1 - Math.min(executionStats.avgLatency / 10000, 1)) * 0.3 +
      executionStats.userSatisfaction * 0.3
    );
    
    genome.fitness = fitness;
    this.genomes.set(skillId, genome);
    
    return fitness;
  }

  /**
   * 获取DNA库统计
   */
  getStats(): {
    totalDNA: number;
    totalGenomes: number;
    dnaByType: Record<string, number>;
    avgReusability: number;
    topDNA: string[];
  } {
    const dnas = Array.from(this.dnaLibrary.values());
    const genomes = Array.from(this.genomes.values());
    
    const dnaByType: Record<string, number> = {};
    for (const dna of dnas) {
      dnaByType[dna.type] = (dnaByType[dna.type] || 0) + 1;
    }
    
    const avgReusability = dnas.length > 0
      ? dnas.reduce((sum, d) => sum + d.metadata.reusability, 0) / dnas.length
      : 0;
    
    const topDNA = dnas
      .sort((a, b) => b.stats.executionCount - a.stats.executionCount)
      .slice(0, 10)
      .map(d => d.name);
    
    return {
      totalDNA: dnas.length,
      totalGenomes: genomes.length,
      dnaByType,
      avgReusability,
      topDNA,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 私有方法
  // ═══════════════════════════════════════════════════════════

  private extractCapabilityDNA(skillId: string, code: string, description: string): SkillDNA | null {
    // 提取主要功能逻辑
    const mainFunction = code.match(/async\s+function\s+(\w+)\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
    if (!mainFunction) return null;
    
    return {
      id: `dna-cap-${skillId}-${Date.now()}`,
      name: `${skillId}-capability`,
      type: 'capability',
      description: `核心能力: ${description.slice(0, 100)}`,
      code: mainFunction[0],
      metadata: {
        language: 'javascript',
        dependencies: this.extractDependencies(code),
        complexity: code.length > 500 ? 'complex' : code.length > 200 ? 'medium' : 'simple',
        reusability: 0.7,
      },
      stats: {
        usedInSkills: [skillId],
        executionCount: 0,
        successRate: 0.5,
      },
      versions: [{
        version: 1,
        code: mainFunction[0],
        changeDescription: '初始提取',
        createdAt: Date.now(),
      }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  private extractPatternDNA(skillId: string, code: string): SkillDNA[] {
    const patterns: SkillDNA[] = [];
    
    // 检测常见模式
    const patterns_to_detect = [
      { name: 'error-handling', regex: /try\s*\{[\s\S]*?\}\s*catch/ },
      { name: 'async-await', regex: /await\s+\w+/ },
      { name: 'file-operation', regex: /fs\.(read|write|append)/ },
      { name: 'http-request', regex: /fetch\s*\(|axios\.|request\s*\(/ },
      { name: 'data-validation', regex: /if\s*\([^)]*(?:null|undefined|typeof)\)/ },
    ];
    
    for (const { name, regex } of patterns_to_detect) {
      if (regex.test(code)) {
        patterns.push({
          id: `dna-pat-${skillId}-${name}`,
          name: `pattern-${name}`,
          type: 'pattern',
          description: `代码模式: ${name}`,
          code: `// Pattern: ${name}\n// Detected in ${skillId}`,
          metadata: {
            language: 'javascript',
            dependencies: [],
            complexity: 'simple',
            reusability: 0.8,
          },
          stats: {
            usedInSkills: [skillId],
            executionCount: 0,
            successRate: 0.5,
          },
          versions: [{
            version: 1,
            code: `// Pattern: ${name}`,
            changeDescription: '模式识别',
            createdAt: Date.now(),
          }],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    }
    
    return patterns;
  }

  private extractKnowledgeDNA(skillId: string, description: string): SkillDNA | null {
    // 提取领域知识
    const knowledgeKeywords = ['算法', '协议', '格式', '标准', '最佳实践', '设计模式'];
    const hasKnowledge = knowledgeKeywords.some(kw => description.includes(kw));
    
    if (!hasKnowledge) return null;
    
    return {
      id: `dna-know-${skillId}-${Date.now()}`,
      name: `${skillId}-knowledge`,
      type: 'knowledge',
      description: `领域知识: ${description.slice(0, 100)}`,
      metadata: {
        language: 'text',
        dependencies: [],
        complexity: 'simple',
        reusability: 0.6,
      },
      stats: {
        usedInSkills: [skillId],
        executionCount: 0,
        successRate: 0.5,
      },
      versions: [{
        version: 1,
        code: description,
        changeDescription: '知识提取',
        createdAt: Date.now(),
      }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  private extractConstraintDNA(skillId: string, code: string): SkillDNA | null {
    // 提取约束条件（安全检查、限制等）
    const constraints = code.match(/if\s*\([^)]*(?:check|validate|limit|max|min|size|length)\)[^;]*;/gi);
    if (!constraints || constraints.length === 0) return null;
    
    return {
      id: `dna-const-${skillId}-${Date.now()}`,
      name: `${skillId}-constraints`,
      type: 'constraint',
      description: `约束条件: ${constraints.length}个检查点`,
      code: constraints.join('\n'),
      metadata: {
        language: 'javascript',
        dependencies: [],
        complexity: 'simple',
        reusability: 0.9,
      },
      stats: {
        usedInSkills: [skillId],
        executionCount: 0,
        successRate: 0.5,
      },
      versions: [{
        version: 1,
        code: constraints.join('\n'),
        changeDescription: '约束提取',
        createdAt: Date.now(),
      }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  private extractDependencies(code: string): string[] {
    const deps: string[] = [];
    const requireMatches = code.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
    if (requireMatches) {
      for (const match of requireMatches) {
        const dep = match.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/)?.[1];
        if (dep && !dep.startsWith('.')) {
          deps.push(dep);
        }
      }
    }
    return deps;
  }

  private selectRelevantDNA(dnaIds: string[], targetCapability: string, constraints: string[]): string[] {
    const selected: string[] = [];
    
    for (const dnaId of dnaIds) {
      const dna = this.dnaLibrary.get(dnaId);
      if (!dna) continue;
      
      // 检查是否与目标能力相关
      const relevance = this.calculateRelevance(dna, targetCapability);
      
      // 检查是否满足约束
      const meetsConstraints = constraints.every(c => 
        dna.description.includes(c) || dna.metadata.dependencies.some(d => d.includes(c))
      );
      
      if (relevance > 0.3 && meetsConstraints) {
        selected.push(dnaId);
      }
    }
    
    return selected;
  }

  private calculateRelevance(dna: SkillDNA, target: string): number {
    const targetWords = target.toLowerCase().split(/\s+/);
    const descWords = dna.description.toLowerCase().split(/\s+/);
    
    let matches = 0;
    for (const word of targetWords) {
      if (descWords.some(dw => dw.includes(word) || word.includes(dw))) {
        matches++;
      }
    }
    
    return matches / targetWords.length;
  }

  private generateMutations(dnaIds: string[], targetCapability: string): DNAMutation[] {
    const mutations: DNAMutation[] = [];
    
    // 添加变异
    mutations.push({
      type: 'add',
      target: targetCapability,
      description: `添加目标能力: ${targetCapability}`,
      impact: 'positive',
    });
    
    // 可能的优化变异
    if (dnaIds.length > 3) {
      mutations.push({
        type: 'reorder',
        target: 'execution-order',
        description: '优化执行顺序',
        impact: 'positive',
      });
    }
    
    return mutations;
  }

  private estimateFitness(dnaIds: string[], mutations: DNAMutation[]): number {
    let baseFitness = 0.5;
    
    // DNA质量影响
    for (const dnaId of dnaIds) {
      const dna = this.dnaLibrary.get(dnaId);
      if (dna) {
        baseFitness += dna.stats.successRate * 0.1;
        baseFitness += dna.metadata.reusability * 0.1;
      }
    }
    
    // 变异影响
    for (const mutation of mutations) {
      if (mutation.impact === 'positive') baseFitness += 0.05;
      if (mutation.impact === 'negative') baseFitness -= 0.05;
    }
    
    return Math.min(0.95, Math.max(0.1, baseFitness));
  }

  private optimizeDNA(genome: SkillGenome): DNAMutation[] {
    // 识别可优化的DNA
    const mutations: DNAMutation[] = [];
    
    for (const dnaId of genome.dnaFragments) {
      const dna = this.dnaLibrary.get(dnaId);
      if (dna && dna.metadata.complexity === 'complex') {
        mutations.push({
          type: 'modify',
          target: dnaId,
          description: `优化复杂DNA: ${dna.name}`,
          impact: 'positive',
        });
      }
    }
    
    return mutations;
  }

  private simplifyDNA(genome: SkillGenome): DNAMutation[] {
    // 识别冗余DNA
    const mutations: DNAMutation[] = [];
    
    if (genome.dnaFragments.length > 5) {
      mutations.push({
        type: 'remove',
        target: 'redundant-dna',
        description: '移除冗余DNA片段',
        impact: 'neutral',
      });
    }
    
    return mutations;
  }

  private extendDNA(genome: SkillGenome): DNAMutation[] {
    // 添加新能力
    return [{
      type: 'add',
      target: 'new-capability',
      description: '扩展新能力',
      impact: 'positive',
    }];
  }

  private applyMutation(genome: SkillGenome, mutation: DNAMutation): void {
    // 应用变异到基因组
    switch (mutation.type) {
      case 'add':
        // 添加新DNA
        break;
      case 'remove':
        // 移除DNA
        break;
      case 'modify':
        // 修改DNA
        break;
      case 'reorder':
        // 重排序
        break;
    }
  }
}

// 单例导出
let evolutionInstance: SkillDNAEvolution | null = null;

export function getSkillDNAEvolution(): SkillDNAEvolution {
  if (!evolutionInstance) {
    evolutionInstance = new SkillDNAEvolution();
  }
  return evolutionInstance;
}
