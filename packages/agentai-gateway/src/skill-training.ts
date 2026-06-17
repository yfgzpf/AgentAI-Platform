// @ts-nocheck
/**
 * SkillOpt 风格的训练流程 — 系统化技能优化
 *
 * 核心能力：
 * 1. 验证门控机制：只有严格提升验证分数才接受修改
 * 2. 训练循环：rollout → reflect → aggregate → select → update → evaluate
 * 3. 学习率预算：控制修改幅度（增加、删除、替换文字的数量）
 * 4. 拒绝编辑缓冲区：存储失败的修改，避免重复错误
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 训练配置 */
export interface TrainingConfig {
  /** 学习率预算：单次修改最多允许的字符数 */
  learningRateBudget: number;
  /** 验证门控阈值：只有分数提升超过此值才接受修改 */
  validationGateThreshold: number;
  /** 拒绝编辑缓冲区大小 */
  rejectBufferSize: number;
  /** 训练轮次上限 */
  maxEpochs: number;
  /** 验证任务数量 */
  validationTasks: number;
}

const DEFAULT_TRAINING_CONFIG: TrainingConfig = {
  learningRateBudget: 100, // 单次修改最多100个字符
  validationGateThreshold: 0.05, // 分数提升至少5%才接受
  rejectBufferSize: 50, // 缓存50个失败的修改
  maxEpochs: 10, // 最多训练10轮
  validationTasks: 5, // 每轮验证5个任务
};

/** Rollout 结果 */
export interface RolloutResult {
  skillId: string;
  skillName: string;
  taskId: string;
  taskDescription: string;
  success: boolean;
  score: number; // 0-10
  latencyMs: number;
  output: string;
  errors: string[];
}

/** Reflect 结果 */
export interface ReflectResult {
  skillId: string;
  rolloutResults: RolloutResult[];
  analysis: string;
  successPatterns: string[];
  failurePatterns: string[];
  suggestedEdits: SkillEdit[];
}

/** Skill 编辑建议 */
export interface SkillEdit {
  type: 'add' | 'delete' | 'replace';
  position: number; // 文档中的位置
  content: string;
  reason: string;
  confidence: number;
}

/** Aggregate 结果 */
export interface AggregateResult {
  skillId: string;
  allReflects: ReflectResult[];
  commonPatterns: string[];
  aggregatedEdits: SkillEdit[];
  confidence: number;
}

/** Select 结果 */
export interface SelectResult {
  skillId: string;
  selectedEdits: SkillEdit[];
  rejectReasons: string[];
}

/** Update 结果 */
export interface UpdateResult {
  skillId: string;
  originalContent: string;
  updatedContent: string;
  appliedEdits: SkillEdit[];
  editCount: number;
}

/** Evaluate 结果 */
export interface EvaluateResult {
  skillId: string;
  beforeScore: number;
  afterScore: number;
  improvement: number;
  passedGate: boolean;
  reason: string;
}

/** 拒绝编辑记录 */
export interface RejectedEdit {
  skillId: string;
  edit: SkillEdit;
  reason: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// SkillTrainer
// ---------------------------------------------------------------------------

export class SkillTrainer {
  private config: TrainingConfig;
  private rejectBuffer: RejectedEdit[];
  private skillContents: Map<string, string>; // skillId → content

  constructor(config?: Partial<TrainingConfig>) {
    this.config = { ...DEFAULT_TRAINING_CONFIG, ...config };
    this.rejectBuffer = [];
    this.skillContents = new Map();
  }

  // ---------------------------------------------------------------------------
  // 训练循环：rollout → reflect → aggregate → select → update → evaluate
  // ---------------------------------------------------------------------------

  /**
   * 执行完整训练循环
   */
  async trainSkill(skillId: string, skillContent: string, validationTasks: string[]): Promise<EvaluateResult> {
    console.log(`[SkillTrainer] 开始训练 Skill: ${skillId}`);

    // 保存原始内容
    this.skillContents.set(skillId, skillContent);
    const beforeScore = await this._evaluateSkill(skillId, skillContent, validationTasks);

    let currentContent = skillContent;
    let currentScore = beforeScore;
    let epoch = 0;

    while (epoch < this.config.maxEpochs) {
      console.log(`[SkillTrainer] Epoch ${epoch + 1}/${this.config.maxEpochs}`);

      // 1. Rollout：执行多个任务
      const rolloutResults = await this._rollout(skillId, currentContent, validationTasks);

      // 2. Reflect：分析结果
      const reflectResult = await this._reflect(skillId, currentContent, rolloutResults);

      // 3. Aggregate：汇总多个 reflect
      const aggregateResult = await this._aggregate(skillId, [reflectResult]);

      // 4. Select：选择最优编辑
      const selectResult = await this._select(skillId, aggregateResult.aggregatedEdits);

      // 5. Update：应用编辑
      const updateResult = await this._update(skillId, currentContent, selectResult.selectedEdits);

      // 6. Evaluate：验证效果
      const evaluateResult = await this._evaluateAndUpdate(
        skillId,
        currentContent,
        updateResult.updatedContent,
        currentScore,
        validationTasks
      );

      // 验证门控：只有严格提升才接受
      if (evaluateResult.passedGate) {
        currentContent = updateResult.updatedContent;
        currentScore = evaluateResult.afterScore;
        console.log(`[SkillTrainer] 验证通过，分数提升: ${evaluateResult.improvement.toFixed(2)}`);
      } else {
        console.log(`[SkillTrainer] 验证失败，拒绝修改: ${evaluateResult.reason}`);
        // 添加到拒绝缓冲区
        this._addToRejectBuffer(skillId, selectResult.selectedEdits, evaluateResult.reason);
      }

      epoch++;

      // 如果分数已经很高，提前终止
      if (currentScore >= 9.0) {
        console.log(`[SkillTrainer] 分数已达优秀 (${currentScore.toFixed(2)})，提前终止训练`);
        break;
      }
    }

    const finalResult: EvaluateResult = {
      skillId,
      beforeScore,
      afterScore: currentScore,
      improvement: currentScore - beforeScore,
      passedGate: currentScore > beforeScore,
      reason: currentScore > beforeScore ? '训练成功' : '训练失败',
    };

    console.log(`[SkillTrainer] 训练完成: ${beforeScore.toFixed(2)} → ${currentScore.toFixed(2)}`);
    return finalResult;
  }

  // ---------------------------------------------------------------------------
  // 训练步骤实现
  // ---------------------------------------------------------------------------

  /**
   * 1. Rollout：执行多个任务，记录结果
   */
  private async _rollout(skillId: string, skillContent: string, tasks: string[]): Promise<RolloutResult[]> {
    const results: RolloutResult[] = [];

    for (const task of tasks) {
      console.log(`[SkillTrainer] Rollout: 执行任务 "${task}"`);

      // 模拟执行任务（实际应该调用 Agent 执行）
      const result: RolloutResult = {
        skillId,
        skillName: skillId,
        taskId: `task-${Date.now()}`,
        taskDescription: task,
        success: Math.random() > 0.3, // 模拟成功率
        score: Math.random() * 10, // 模拟评分
        latencyMs: Math.random() * 5000,
        output: '模拟输出',
        errors: [],
      };

      results.push(result);
    }

    return results;
  }

  /**
   * 2. Reflect：分析结果，提出编辑建议
   */
  private async _reflect(skillId: string, skillContent: string, rolloutResults: RolloutResult[]): Promise<ReflectResult> {
    console.log(`[SkillTrainer] Reflect: 分析 ${rolloutResults.length} 个结果`);

    const successResults = rolloutResults.filter(r => r.success);
    const failureResults = rolloutResults.filter(r => !r.success);

    const analysis = `成功: ${successResults.length}, 失败: ${failureResults.length}`;
    const successPatterns = successResults.map(r => `任务 "${r.taskDescription}" 成功，分数 ${r.score.toFixed(2)}`);
    const failurePatterns = failureResults.map(r => `任务 "${r.taskDescription}" 失败，错误: ${r.errors.join(', ')}`);

    // 提出编辑建议（模拟）
    const suggestedEdits: SkillEdit[] = [];

    if (failureResults.length > 0) {
      // 建议添加错误处理说明
      suggestedEdits.push({
        type: 'add',
        position: skillContent.length,
        content: '\n\n## 错误处理\n当遇到错误时，请检查以下常见问题...',
        reason: '添加错误处理说明，减少失败率',
        confidence: 0.8,
      });
    }

    if (successResults.length > 0 && successResults[0].score > 8) {
      // 建议优化成功模式
      suggestedEdits.push({
        type: 'replace',
        position: 0,
        content: '# 最佳实践\n\n根据成功案例，建议以下流程...',
        reason: '优化成功模式，提升成功率',
        confidence: 0.9,
      });
    }

    return {
      skillId,
      rolloutResults,
      analysis,
      successPatterns,
      failurePatterns,
      suggestedEdits,
    };
  }

  /**
   * 3. Aggregate：汇总多个 reflect，提取共同模式
   */
  private async _aggregate(skillId: string, reflects: ReflectResult[]): Promise<AggregateResult> {
    console.log(`[SkillTrainer] Aggregate: 汇总 ${reflects.length} 个分析`);

    const allEdits = reflects.flatMap(r => r.suggestedEdits);
    const commonPatterns = reflects.flatMap(r => r.successPatterns);

    // 按置信度排序，选择高置信度的编辑
    const aggregatedEdits = allEdits
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3); // 最多应用3个编辑

    return {
      skillId,
      allReflects: reflects,
      commonPatterns,
      aggregatedEdits,
      confidence: aggregatedEdits.length > 0 ? aggregatedEdits[0].confidence : 0,
    };
  }

  /**
   * 4. Select：选择最优编辑，应用学习率预算
   */
  private async _select(skillId: string, edits: SkillEdit[]): Promise<SelectResult> {
    console.log(`[SkillTrainer] Select: 选择编辑，应用学习率预算`);

    const selectedEdits: SkillEdit[] = [];
    const rejectReasons: string[] = [];
    let totalChars = 0;

    for (const edit of edits) {
      const editChars = edit.content.length;

      // 检查学习率预算
      if (totalChars + editChars > this.config.learningRateBudget) {
        rejectReasons.push(`编辑 "${edit.reason}" 超出学习率预算 (${editChars} chars)`);
        continue;
      }

      // 检查是否在拒绝缓冲区中
      if (this._isInRejectBuffer(skillId, edit)) {
        rejectReasons.push(`编辑 "${edit.reason}" 已在拒绝缓冲区中`);
        continue;
      }

      selectedEdits.push(edit);
      totalChars += editChars;
    }

    return {
      skillId,
      selectedEdits,
      rejectReasons,
    };
  }

  /**
   * 5. Update：应用编辑到技能文档
   */
  private async _update(skillId: string, content: string, edits: SkillEdit[]): Promise<UpdateResult> {
    console.log(`[SkillTrainer] Update: 应用 ${edits.length} 个编辑`);

    let updatedContent = content;

    for (const edit of edits) {
      if (edit.type === 'add') {
        updatedContent = updatedContent.slice(0, edit.position) + edit.content + updatedContent.slice(edit.position);
      } else if (edit.type === 'delete') {
        updatedContent = updatedContent.slice(0, edit.position) + updatedContent.slice(edit.position + edit.content.length);
      } else if (edit.type === 'replace') {
        updatedContent = updatedContent.slice(0, edit.position) + edit.content + updatedContent.slice(edit.position + edit.content.length);
      }
    }

    return {
      skillId,
      originalContent: content,
      updatedContent,
      appliedEdits: edits,
      editCount: edits.length,
    };
  }

  /**
   * 6. Evaluate：验证效果，应用验证门控
   */
  private async _evaluateAndUpdate(
    skillId: string,
    beforeContent: string,
    afterContent: string,
    beforeScore: number,
    tasks: string[]
  ): Promise<EvaluateResult> {
    console.log(`[SkillTrainer] Evaluate: 验证效果`);

    const afterScore = await this._evaluateSkill(skillId, afterContent, tasks);
    const improvement = afterScore - beforeScore;

    // 验证门控：只有严格提升才接受
    const passedGate = improvement > this.config.validationGateThreshold;

    return {
      skillId,
      beforeScore,
      afterScore,
      improvement,
      passedGate,
      reason: passedGate ? '分数提升超过阈值' : `分数提升不足 (${improvement.toFixed(2)} < ${this.config.validationGateThreshold})`,
    };
  }

  /**
   * 评估技能效果（模拟）
   */
  private async _evaluateSkill(skillId: string, content: string, tasks: string[]): Promise<number> {
    // 模拟评估（实际应该调用 Agent 执行任务并评分）
    const baseScore = 5.0;
    const contentBonus = content.length > 500 ? 1.0 : 0;
    const randomBonus = Math.random() * 2;

    return baseScore + contentBonus + randomBonus;
  }

  // ---------------------------------------------------------------------------
  // 拒绝编辑缓冲区
  // ---------------------------------------------------------------------------

  /**
   * 添加到拒绝缓冲区
   */
  private _addToRejectBuffer(skillId: string, edits: SkillEdit[], reason: string): void {
    for (const edit of edits) {
      this.rejectBuffer.push({
        skillId,
        edit,
        reason,
        timestamp: new Date().toISOString(),
      });
    }

    // 维护缓冲区大小
    if (this.rejectBuffer.length > this.config.rejectBufferSize) {
      this.rejectBuffer = this.rejectBuffer.slice(-this.config.rejectBufferSize);
    }
  }

  /**
   * 检查是否在拒绝缓冲区中
   */
  private _isInRejectBuffer(skillId: string, edit: SkillEdit): boolean {
    return this.rejectBuffer.some(
      r => r.skillId === skillId && r.edit.content === edit.content && r.edit.type === edit.type
    );
  }

  // ---------------------------------------------------------------------------
  // 公开接口
  // ---------------------------------------------------------------------------

  /**
   * 获取拒绝缓冲区内容
   */
  getRejectBuffer(): RejectedEdit[] {
    return this.rejectBuffer;
  }

  /**
   * 清空拒绝缓冲区
   */
  clearRejectBuffer(): void {
    this.rejectBuffer = [];
  }

  /**
   * 获取技能内容
   */
  getSkillContent(skillId: string): string | undefined {
    return this.skillContents.get(skillId);
  }
}