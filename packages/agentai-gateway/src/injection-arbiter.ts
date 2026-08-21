/**
 * injection-arbiter.ts — 引擎注入优先级仲裁器
 * ============================================================
 * 解决问题: 32+ 引擎同时注入系统消息, AI 上下文被淹没
 * 
 * 核心策略:
 *   1. 每个引擎声明: 名称、相关条件、优先级、token预算
 *   2. 仲裁器根据当前消息评分所有引擎的相关性
 *   3. 只注入 top N (默认 5) 最相关的引擎
 *   4. 总 token 预算控制在 3000 字符以内
 *   5. 关键引擎 (高风险/错误) 无论如何都注入
 */

/** 引擎声明 */
export interface EngineDeclaration {
  /** 引擎名称 */
  name: string;
  /** 引擎类别 */
  category: 'safety' | 'context' | 'cognitive' | 'industry' | 'memory' | 'strategy' | 'evolution';
  /** 优先级 (越高越优先) */
  basePriority: number; // 1-10
  /** token 预算 (字符数) */
  tokenBudget: number;
  /** 内容生成函数 — 返回 null 表示不激活 */
  generate: () => string | null;
  /** 激活条件 — 返回相关性评分 0-1 */
  relevance: (message: string, context: EngineContext) => number;
}

/** 仲裁器上下文 */
export interface EngineContext {
  /** 是否有工作区 */
  hasWorkspace: boolean;
  /** 是否是第一次对话 */
  isFirstMessage: boolean;
  /** 消息长度 */
  messageLength: number;
  /** 是否有工具调用历史 */
  hasToolHistory: boolean;
  /** 当前迭代 */
  iteration: number;
}

/** 注入决策 */
export interface InjectionDecision {
  /** 选中的引擎 */
  selected: { name: string; content: string; priority: number; score: number }[];
  /** 被过滤掉的引擎 */
  skipped: { name: string; reason: string }[];
  /** 总 token 使用量 */
  totalTokens: number;
}

/** 仲裁器配置 */
export interface ArbiterConfig {
  /** 最大注入引擎数 */
  maxEngines: number;
  /** 最大总 token (字符数) */
  maxTotalTokens: number;
  /** 最低相关性阈值 (低于此值不注入) */
  minRelevance: number;
  /** 关键引擎无论相关性都注入 */
  alwaysInjectCategories: string[];
}

const DEFAULT_CONFIG: ArbiterConfig = {
  maxEngines: 5,
  maxTotalTokens: 3000,
  minRelevance: 0.3,
  alwaysInjectCategories: ['safety'],
};

/**
 * 引擎注入仲裁器
 */
export class InjectionArbiter {
  private engines: EngineDeclaration[] = [];
  private config: ArbiterConfig;
  
  // 效果追踪: 引擎名 → { injected, helpful }
  private effectTracker: Map<string, { injected: number; helpful: number }> = new Map();

  constructor(config?: Partial<ArbiterConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** 注册引擎 */
  register(engine: EngineDeclaration): void {
    this.engines.push(engine);
    if (!this.effectTracker.has(engine.name)) {
      this.effectTracker.set(engine.name, { injected: 0, helpful: 0 });
    }
  }

  /**
   * 仲裁 — 选择最相关的引擎注入
   */
  arbitrate(message: string, context: EngineContext): InjectionDecision {
    const selected: InjectionDecision['selected'] = [];
    const skipped: InjectionDecision['skipped'] = [];
    let totalTokens = 0;

    // 1. 评分所有引擎
    const scored = this.engines.map(engine => {
      const relevance = engine.relevance(message, context);
      const effectBoost = this.getEffectBoost(engine.name);
      const score = relevance * engine.basePriority + effectBoost;
      return { engine, relevance, score };
    });

    // 2. 排序
    scored.sort((a, b) => b.score - a.score);

    // 3. 选择 top N
    for (const { engine, relevance, score } of scored) {
      // 关键引擎无论相关性都注入
      const isCritical = this.config.alwaysInjectCategories.includes(engine.category);
      
      if (!isCritical && relevance < this.config.minRelevance) {
        skipped.push({ name: engine.name, reason: `相关性 ${relevance.toFixed(2)} < ${this.config.minRelevance}` });
        continue;
      }

      // 生成内容
      const content = engine.generate();
      if (!content) {
        skipped.push({ name: engine.name, reason: '内容为空' });
        continue;
      }

      // 检查 token 预算
      if (totalTokens + content.length > this.config.maxTotalTokens) {
        // 如果是关键引擎, 截断而非跳过
        if (isCritical) {
          const remaining = this.config.maxTotalTokens - totalTokens;
          const truncated = content.slice(0, Math.max(100, remaining));
          selected.push({ name: engine.name, content: truncated, priority: engine.basePriority, score });
          totalTokens += truncated.length;
          this.recordInjection(engine.name);
        } else {
          skipped.push({ name: engine.name, reason: `token 预算不足 (${content.length} 字符)` });
        }
        continue;
      }

      selected.push({ name: engine.name, content, priority: engine.basePriority, score });
      totalTokens += content.length;
      this.recordInjection(engine.name);

      // 达到最大引擎数
      if (selected.length >= this.config.maxEngines) {
        // 剩余的全部跳过
        for (const rest of scored.slice(selected.length)) {
          skipped.push({ name: rest.engine.name, reason: '已达到最大引擎数' });
        }
        break;
      }
    }

    return { selected, skipped, totalTokens };
  }

  /**
   * 合并选中的引擎内容为一条系统消息
   */
  static mergeSelected(selected: InjectionDecision['selected']): string {
    if (selected.length === 0) return '';
    // 按优先级排序
    const sorted = [...selected].sort((a, b) => b.priority - a.priority);
    return sorted.map(s => s.content).join('\n\n');
  }

  /** 记录注入 */
  private recordInjection(name: string): void {
    const tracker = this.effectTracker.get(name);
    if (tracker) tracker.injected++;
  }

  /** 记录效果 — 外部调用, 标记某引擎是否帮助了任务 */
  recordEffect(name: string, helpful: boolean): void {
    const tracker = this.effectTracker.get(name);
    if (tracker && helpful) tracker.helpful++;
  }

  /** 获取效果提升 — 被验证有用的引擎获得加分 */
  private getEffectBoost(name: string): number {
    const tracker = this.effectTracker.get(name);
    if (!tracker || tracker.injected === 0) return 0;
    const helpfulRate = tracker.helpful / tracker.injected;
    return helpfulRate * 2; // 最多 +2 分
  }

  /** 获取统计 */
  getStats(): { name: string; injected: number; helpful: number; rate: number }[] {
    return Array.from(this.effectTracker.entries()).map(([name, { injected, helpful }]) => ({
      name, injected, helpful, rate: injected > 0 ? helpful / injected : 0,
    })).sort((a, b) => b.rate - a.rate);
  }
}
