/**
 * 多 Agent 竞争合作博弈引擎
 * 
 * 核心逻辑：
 * 1. N 个 Agent 并行对同一任务生成方案
 * 2. 每个 Agent 使用不同的 Persona + 工具组合
 * 3. LLM-as-Judge 交叉评分（防止自卖自夸）
 * 4. 胜出方案执行，失败方案用于改进
 * 5. 合作模式：Top-2 方案融合
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Agent 身份 */
export interface AgentIdentity {
  id: string;
  name: string;
  persona: string;
  tools: string[];
}

/** 博弈模式 */
export type BattleMode = 'compete' | 'cooperate' | 'hybrid';

/** 博弈配置 */
export interface BattleConfig {
  /** 参与 Agent 数量 */
  numAgents: number;
  /** 博弈模式 */
  battleMode: BattleMode;
  /** 评分阈值（0-100） */
  scoreThreshold?: number;
}

const DEFAULT_CONFIG: BattleConfig = {
  numAgents: 3,
  battleMode: 'hybrid',
  scoreThreshold: 70,
};

/** 方案 */
export interface Solution {
  agentId: string;
  agentName: string;
  persona: string;
  output: string;
  score: number;
  reasoning: string[];
}

/** 失败分析 */
export interface FailurePattern {
  agentId: string;
  reason: string;
  lesson: string;
}

/** 博弈结果 */
export interface BattleResult {
  mode: BattleMode;
  solutions: Solution[];
  winner: Solution;
  losers: Solution[];
  failurePatterns: FailurePattern[];
  merged?: Solution; // 合作模式下可能融合
  totalAgents: number;
}

// ---------------------------------------------------------------------------
// AgentBattle
// ---------------------------------------------------------------------------

/** 预定义 Agent 模板（不同 Persona + 工具组合） */
const DEFAULT_AGENTS: AgentIdentity[] = [
  { id: 'analytical', name: '分析师', persona: '数据分析师', tools: ['search', 'calculator'] },
  { id: 'creative', name: '创意官', persona: '创意设计师', tools: ['web_search', 'image_gen'] },
  { id: 'critical', name: '批判者', persona: '安全审查员', tools: ['code_executor', 'validator'] },
  { id: 'pragmatic', name: '实干家', persona: '高级工程师', tools: ['code_executor', 'web_search'] },
  { id: 'reviewer', name: '评审员', persona: '代码审查员', tools: ['code_executor', 'validator'] },
];

export class AgentBattle {
  private config: BattleConfig;

  constructor(config?: Partial<BattleConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 启动博弈
   * 
   * @param query - 任务描述
   * @param solutions - 预生成的 N 个方案（实际生产由 LLM 生成，测试中直接传入）
   * @returns 博弈结果
   */
  run(query: string, solutions: Solution[]): BattleResult {
    if (solutions.length === 0) {
      return {
        mode: this.config.battleMode,
        solutions: [],
        winner: { agentId: 'none', agentName: 'none', persona: 'none', output: '', score: 0, reasoning: ['No solutions provided'], },
        losers: [],
        failurePatterns: [],
        merged: undefined,
        totalAgents: 0,
      };
    }

    // Step 1: 交叉评分（每个方案由其他方案 judge 打分）
    const scoredSolutions = this._crossScore(query, solutions);

    // Step 2: 排序找冠军
    const sorted = scoredSolutions.sort((a, b) => b.score - a.score);
    const winner = sorted[0]!;
    const losers = sorted.slice(1);

    // Step 3: 生成失败分析
    const failurePatterns = this._analyzeFailures(query, losers);

    // Step 4: 根据模式处理
    let merged: Solution | undefined;
    if (this.config.battleMode === 'cooperate' || this.config.battleMode === 'hybrid') {
      if (losers.length > 0) {
        merged = this._mergeTop2(winner, losers[0]!);
      }
    }

    return {
      mode: this.config.battleMode,
      solutions: scoredSolutions,
      winner,
      losers,
      failurePatterns,
      merged,
      totalAgents: solutions.length,
    };
  }

  /**
   * 交叉评分：用规则引擎给每个方案打分
   * 
   * 评分维度：
   * - 完整性：query 关键词覆盖率
   * - 安全性：含敏感操作 -10
   * - 结构质量：JSON 格式 +5, 纯文本 -2
   */
  private _crossScore(query: string, solutions: Solution[]): Solution[] {
    return solutions.map((sol) => {
      const newScores = this._scoreSolution(query, sol);
      return { ...sol, score: newScores.total, reasoning: newScores.reasons };
    });
  }

  /** 单个方案评分 */
  private _scoreSolution(query: string, solution: Solution): { total: number; reasons: string[] } {
    const reasons: string[] = [];
    let total = 0;

    // 完整性
    const queryWords = query.split(/\s+/).filter((w) => w.length > 1);
    const matched = queryWords.filter((w) => solution.output.toLowerCase().includes(w.toLowerCase()));
    const coverage = queryWords.length > 0 ? matched.length / queryWords.length : 1;
    total += Math.round(coverage * 50);
    reasons.push(`完整性 ${Math.round(coverage * 100)}%: +${Math.round(coverage * 50)}`);

    // 安全性
    const dangerPatterns = ['rm -rf', 'delete', 'drop table', 'exec(', 'eval('];
    const hasDanger = dangerPatterns.some((p) => solution.output.toLowerCase().includes(p));
    if (hasDanger) {
      total -= 20;
      reasons.push('安全风险: -20');
    } else {
      total += 5;
      reasons.push('安全检查通过: +5');
    }

    // 结构质量
    if (solution.output.trim().startsWith('{') && solution.output.trim().endsWith('}')) {
      total += 10;
      reasons.push('JSON 格式: +10');
    } else if (solution.output.includes('\n---') || solution.output.includes('\n#')) {
      total += 5;
      reasons.push('半结构化: +5');
    } else {
      total -= 2;
      reasons.push('纯文本: -2');
    }

    return { total, reasons };
  }

  /** 分析失败方案 */
  private _analyzeFailures(_query: string, losers: Solution[]): FailurePattern[] {
    return losers.map((sol) => ({
      agentId: sol.agentId,
      reason: `Score ${sol.score} below winner ${losers.length > 0 ? (losers[0]?.score ?? 0) : 0}`,
      lesson: `Consider ${sol.persona} approach for similar future tasks`,
    }));
  }

  /** 融合 Top-2 方案 */
  private _mergeTop2(winner: Solution, runnerUp: Solution): Solution {
    return {
      agentId: 'merged',
      agentName: `${winner.agentName} + ${runnerUp.agentName}`,
      persona: `${winner.persona} × ${runnerUp.persona}`,
      output: `[MERGED]\n\n=== ${winner.agentName} ===\n${winner.output}\n\n=== ${runnerUp.agentName} ===\n${runnerUp.output}`,
      score: (winner.score + runnerUp.score) / 2,
      reasoning: [`Merged winner (${winner.agentName}, ${winner.score}) with runner-up (${runnerUp.agentName}, ${runnerUp.score})`],
    };
  }

  /** 获取默认 Agent 列表 */
  static getDefaultAgents(count: number): AgentIdentity[] {
    return DEFAULT_AGENTS.slice(0, Math.min(count, DEFAULT_AGENTS.length));
  }
}

// ---------------------------------------------------------------------------
// 单例导出
// ---------------------------------------------------------------------------

let _battle: AgentBattle | null = null;

export function getAgentBattle(config?: Partial<BattleConfig>): AgentBattle {
  if (!_battle) {
    _battle = new AgentBattle(config);
  }
  return _battle;
}
