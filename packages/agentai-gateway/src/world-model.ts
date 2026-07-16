/**
 * WorldModel - 世界模型因果知识图谱
 * 
 * 创新理念：跨任务沉淀结构化知识(实体+关系+因果)
 * 所有后续任务可查询推理
 * 从单任务上下文 → 跨任务共享经验库
 */

import { EventEmitter } from 'events';
import { AgentAIRouter } from './llm-router.js';

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

export interface Entity {
  id: string;
  name: string;
  type: 'concept' | 'object' | 'process' | 'agent' | 'event';
  properties: Record<string, any>;
  confidence: number; // 0-1
  source: string; // 来源任务
  createdAt: number;
  updatedAt: number;
}

export interface Relation {
  id: string;
  sourceId: string;
  targetId: string;
  type: 'is-a' | 'part-of' | 'depends-on' | 'causes' | 'enables' | 'prevents' | 'similar-to';
  strength: number; // 0-1
  evidence: string[]; // 支持证据
  confidence: number;
  createdAt: number;
}

export interface CausalRule {
  id: string;
  cause: string; // 实体ID或描述
  effect: string; // 实体ID或描述
  conditions: string[]; // 适用条件
  probability: number; // 发生概率
  exceptions: string[]; // 例外情况
  sourceTasks: string[];
  verified: boolean;
  createdAt: number;
}

export interface KnowledgeQuery {
  entityName?: string;
  entityType?: string;
  relationType?: string;
  causalQuery?: string; // "X导致Y吗？"
  similarTo?: string;
  limit?: number;
}

export interface QueryResult {
  entities: Entity[];
  relations: Relation[];
  causalRules: CausalRule[];
  inferences: string[]; // 推理结论
}

export interface Experience {
  id: string;
  taskType: string;
  situation: string;
  action: string;
  outcome: string;
  entities: string[]; // 涉及的实体ID
  lessons: string[];
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════
// 世界模型核心类
// ═══════════════════════════════════════════════════════════

export class WorldModel extends EventEmitter {
  private entities: Map<string, Entity> = new Map();
  private relations: Map<string, Relation> = new Map();
  private causalRules: Map<string, CausalRule> = new Map();
  private experiences: Map<string, Experience> = new Map();
  private llmRouter: AgentAIRouter;

  constructor(llmRouter: AgentAIRouter) {
    super();
    this.llmRouter = llmRouter;
  }

  /**
   * 从任务执行中提取知识
   */
  async extractKnowledge(task: {
    id: string;
    type: string;
    input: string;
    output: string;
    steps: Array<{ action: string; result: string }>;
  }): Promise<{ entities: Entity[]; relations: Relation[]; rules: CausalRule[] }> {
    const prompt = `分析以下任务执行过程，提取结构化知识：

任务类型: ${task.type}
输入: ${task.input}
输出: ${task.output}
执行步骤:
${task.steps.map((s, i) => `${i + 1}. ${s.action} → ${s.result}`).join('\n')}

请提取：
1. 涉及的实体（概念、对象、过程）
2. 实体之间的关系
3. 因果规则（如果X则Y）

输出JSON格式：
{
  "entities": [{"name": "", "type": "", "properties": {}}],
  "relations": [{"source": "", "target": "", "type": "", "strength": 0.8}],
  "causalRules": [{"cause": "", "effect": "", "conditions": [], "probability": 0.9}]
}`;

    try {
      const response = await this.llmRouter.chat({
        model: 'agentai',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      });

      const content = typeof response.content === 'string' 
        ? response.content 
        : JSON.stringify(response.content);

      // 提取JSON
      const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) || content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { entities: [], relations: [], rules: [] };
      }

      const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      
      // 创建实体
      const entities: Entity[] = [];
      for (const e of parsed.entities || []) {
        const entity: Entity = {
          id: `ent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: e.name,
          type: e.type || 'concept',
          properties: e.properties || {},
          confidence: 0.7,
          source: task.id,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        this.entities.set(entity.id, entity);
        entities.push(entity);
      }

      // 创建关系
      const relations: Relation[] = [];
      for (const r of parsed.relations || []) {
        const sourceEnt = entities.find(e => e.name === r.source);
        const targetEnt = entities.find(e => e.name === r.target);
        
        if (sourceEnt && targetEnt) {
          const relation: Relation = {
            id: `rel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            sourceId: sourceEnt.id,
            targetId: targetEnt.id,
            type: r.type || 'depends-on',
            strength: r.strength || 0.5,
            evidence: [task.id],
            confidence: 0.6,
            createdAt: Date.now(),
          };
          this.relations.set(relation.id, relation);
          relations.push(relation);
        }
      }

      // 创建因果规则
      const rules: CausalRule[] = [];
      for (const cr of parsed.causalRules || []) {
        const rule: CausalRule = {
          id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          cause: cr.cause,
          effect: cr.effect,
          conditions: cr.conditions || [],
          probability: cr.probability || 0.5,
          exceptions: cr.exceptions || [],
          sourceTasks: [task.id],
          verified: false,
          createdAt: Date.now(),
        };
        this.causalRules.set(rule.id, rule);
        rules.push(rule);
      }

      // 创建经验记录
      const experience: Experience = {
        id: `exp-${Date.now()}`,
        taskType: task.type,
        situation: task.input,
        action: task.steps.map(s => s.action).join(' → '),
        outcome: task.output,
        entities: entities.map(e => e.id),
        lessons: this.extractLessons(task),
        createdAt: Date.now(),
      };
      this.experiences.set(experience.id, experience);

      this.emit('knowledge:extracted', { task: task.id, entities, relations, rules });

      return { entities, relations, rules };
    } catch (error) {
      console.error('[WorldModel] 知识提取失败:', error);
      return { entities: [], relations: [], rules: [] };
    }
  }

  /**
   * 查询知识图谱
   */
  query(query: KnowledgeQuery): QueryResult {
    const result: QueryResult = {
      entities: [],
      relations: [],
      causalRules: [],
      inferences: [],
    };

    // 实体查询
    if (query.entityName) {
      const matched = Array.from(this.entities.values()).filter(e => 
        e.name.toLowerCase().includes(query.entityName!.toLowerCase())
      );
      result.entities.push(...matched);
    }

    if (query.entityType) {
      const matched = Array.from(this.entities.values()).filter(e => 
        e.type === query.entityType
      );
      result.entities.push(...matched);
    }

    // 去重
    result.entities = [...new Map(result.entities.map(e => [e.id, e])).values()];

    // 关系查询
    if (query.relationType) {
      const entityIds = new Set(result.entities.map(e => e.id));
      const matched = Array.from(this.relations.values()).filter(r => 
        r.type === query.relationType &&
        (entityIds.has(r.sourceId) || entityIds.has(r.targetId))
      );
      result.relations.push(...matched);
    }

    // 因果查询
    if (query.causalQuery) {
      const rules = this.queryCausal(query.causalQuery);
      result.causalRules.push(...rules);
      
      // 生成推理结论
      for (const rule of rules) {
        result.inferences.push(
          `${rule.cause} 导致 ${rule.effect} (概率: ${Math.round(rule.probability * 100)}%)`
        );
      }
    }

    // 相似性查询
    if (query.similarTo) {
      const similar = this.findSimilar(query.similarTo);
      result.entities.push(...similar);
    }

    // 限制数量
    if (query.limit) {
      result.entities = result.entities.slice(0, query.limit);
      result.relations = result.relations.slice(0, query.limit);
      result.causalRules = result.causalRules.slice(0, query.limit);
    }

    return result;
  }

  /**
   * 因果推理
   */
  causalInference(cause: string, effect: string): {
    possible: boolean;
    probability: number;
    paths: string[][];
    explanation: string;
  } {
    // 直接规则匹配
    const directRules = Array.from(this.causalRules.values()).filter(r => 
      r.cause.includes(cause) && r.effect.includes(effect)
    );

    if (directRules.length > 0) {
      const bestRule = directRules.reduce((best, r) => 
        r.probability > best.probability ? r : best
      );
      return {
        possible: true,
        probability: bestRule.probability,
        paths: [[cause, effect]],
        explanation: `直接因果规则: ${bestRule.cause} → ${bestRule.effect}`,
      };
    }

    // 间接路径推理
    const paths = this.findCausalPaths(cause, effect);
    
    if (paths.length > 0) {
      // 计算路径概率
      const pathProbabilities = paths.map(path => {
        let prob = 1;
        for (let i = 0; i < path.length - 1; i++) {
          const rule = this.findRule(path[i], path[i + 1]);
          if (rule) {
            prob *= rule.probability;
          } else {
            prob *= 0.5; // 未知关系默认0.5
          }
        }
        return prob;
      });

      const maxProb = Math.max(...pathProbabilities);
      const bestPath = paths[pathProbabilities.indexOf(maxProb)];

      return {
        possible: true,
        probability: maxProb,
        paths,
        explanation: `间接因果路径: ${bestPath.join(' → ')}`,
      };
    }

    return {
      possible: false,
      probability: 0,
      paths: [],
      explanation: '未找到因果关系',
    };
  }

  /**
   * 预测可能的结果
   */
  predictOutcomes(action: string): Array<{
    outcome: string;
    probability: number;
    confidence: number;
    supportingEvidence: string[];
  }> {
    const predictions: Array<{
      outcome: string;
      probability: number;
      confidence: number;
      supportingEvidence: string[];
    }> = [];

    // 查找相关因果规则
    const relevantRules = Array.from(this.causalRules.values()).filter(r =>
      r.cause.includes(action) || action.includes(r.cause)
    );

    for (const rule of relevantRules) {
      predictions.push({
        outcome: rule.effect,
        probability: rule.probability,
        confidence: rule.verified ? 0.9 : 0.5,
        supportingEvidence: rule.sourceTasks,
      });
    }

    // 查找相似经验
    const similarExps = Array.from(this.experiences.values()).filter(exp =>
      exp.action.includes(action) || action.includes(exp.action)
    );

    for (const exp of similarExps) {
      predictions.push({
        outcome: exp.outcome,
        probability: 0.7,
        confidence: 0.6,
        supportingEvidence: [exp.id],
      });
    }

    // 按概率排序
    return predictions.sort((a, b) => b.probability - a.probability).slice(0, 5);
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    entityCount: number;
    relationCount: number;
    causalRuleCount: number;
    experienceCount: number;
    entityTypes: Record<string, number>;
    relationTypes: Record<string, number>;
    verifiedRules: number;
  } {
    const entityTypes: Record<string, number> = {};
    for (const e of this.entities.values()) {
      entityTypes[e.type] = (entityTypes[e.type] || 0) + 1;
    }

    const relationTypes: Record<string, number> = {};
    for (const r of this.relations.values()) {
      relationTypes[r.type] = (relationTypes[r.type] || 0) + 1;
    }

    return {
      entityCount: this.entities.size,
      relationCount: this.relations.size,
      causalRuleCount: this.causalRules.size,
      experienceCount: this.experiences.size,
      entityTypes,
      relationTypes,
      verifiedRules: Array.from(this.causalRules.values()).filter(r => r.verified).length,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 私有方法
  // ═══════════════════════════════════════════════════════════

  private extractLessons(task: any): string[] {
    const lessons: string[] = [];
    
    // 从步骤结果中提取教训
    for (const step of task.steps) {
      if (step.result.includes('error') || step.result.includes('失败')) {
        lessons.push(`${step.action} 需要注意: ${step.result}`);
      }
    }
    
    return lessons;
  }

  private queryCausal(query: string): CausalRule[] {
    // 简单关键词匹配
    const keywords = query.toLowerCase().split(/\s+/);
    
    return Array.from(this.causalRules.values()).filter(rule => {
      const ruleText = `${rule.cause} ${rule.effect}`.toLowerCase();
      return keywords.some(kw => ruleText.includes(kw));
    });
  }

  private findSimilar(entityName: string): Entity[] {
    const target = Array.from(this.entities.values()).find(e => 
      e.name.toLowerCase() === entityName.toLowerCase()
    );
    
    if (!target) return [];
    
    // 找相似实体（共享关系）
    const relatedIds = new Set<string>();
    
    for (const rel of this.relations.values()) {
      if (rel.sourceId === target.id) {
        relatedIds.add(rel.targetId);
      } else if (rel.targetId === target.id) {
        relatedIds.add(rel.sourceId);
      }
    }
    
    return Array.from(this.entities.values()).filter(e => 
      e.id !== target.id && relatedIds.has(e.id)
    );
  }

  private findCausalPaths(start: string, end: string, maxDepth: number = 3): string[][] {
    const paths: string[][] = [];
    const visited = new Set<string>();

    const dfs = (current: string, path: string[], depth: number) => {
      if (depth > maxDepth) return;
      if (current.includes(end) || end.includes(current)) {
        paths.push([...path, end]);
        return;
      }

      visited.add(current);

      // 找下一个可能的节点
      for (const rule of this.causalRules.values()) {
        if (rule.cause.includes(current) || current.includes(rule.cause)) {
          if (!visited.has(rule.effect)) {
            dfs(rule.effect, [...path, rule.effect], depth + 1);
          }
        }
      }

      visited.delete(current);
    };

    dfs(start, [start], 0);
    return paths;
  }

  private findRule(cause: string, effect: string): CausalRule | undefined {
    return Array.from(this.causalRules.values()).find(r =>
      (r.cause.includes(cause) || cause.includes(r.cause)) &&
      (r.effect.includes(effect) || effect.includes(r.effect))
    );
  }
}

// 单例导出
let worldModelInstance: WorldModel | null = null;

export function getWorldModel(llmRouter: AgentAIRouter): WorldModel {
  if (!worldModelInstance) {
    worldModelInstance = new WorldModel(llmRouter);
  }
  return worldModelInstance;
}
