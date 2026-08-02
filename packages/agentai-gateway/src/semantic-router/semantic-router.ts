/**
 * 语义路由: LLM 驱动的意图识别和技能匹配
 *
 * 替代 SkillOrchestrator 的关键词匹配，让 LLM 理解用户意图并匹配最相关的技能。
 *
 * 安全特性:
 * 1. 输入消毒 (防 SQL 注入/命令注入/ReDoS)
 * 2. 成本治理 (每日 ¥5 封顶)
 * 3. 观察性 (Governor 能力追踪)
 * 4. 缓存 (减少不必要的 LLM 调用)
 */

import { createHash } from 'crypto';
import { PromptBuilder } from './prompt-builder';
import { ScoreParser, RoutingDecision } from './score-parser';
import { SkillOrchestrator, SkillDescriptor } from '../skill-orchestrator';
import { getKnowledgeCache } from '../knowledge-cache';
import { getTracker, type TaskType } from '../governor/runtime-capability-tracker';
import { log as auditLog } from '../audit';
import { AgentAIRouter } from '../llm-router';

// 成本限额配置
const DAILY_COST_CAP_CNY = 5.0;
const CONFIDENCE_THRESHOLD = 0.75;
const ROUTING_TIMEOUT_MS = 3000;

export class SemanticRouter {
  private orchestrator: SkillOrchestrator;
  private llmRouter: AgentAIRouter;
  private dailyCostCNY = 0;

  constructor(orchestrator: SkillOrchestrator) {
    this.orchestrator = orchestrator;
    this.llmRouter = new AgentAIRouter();
  }

  /**
   * 重置成本计数器（可用于每日重置）
   */
  resetDailyCost(): void {
    this.dailyCostCNY = 0;
  }

  /**
   * 路由用户消息到最佳技能
   * 
   * 流程:
   * 1. 输入消毒
   * 2. 缓存查询 (hash(message))
   * 3. 成本检查
   * 4. LLM 语义路由 (PromptBuilder → llm-router → ScoreParser)
   * 5. 置信度判断: >= 0.75 → 返回 skill; < 0.75 → fallback 到 smartDispatch()
   * 6. 成本追踪 + Governor 记录 + 审计日志
   */
  async routeSkill(userMessage: string, ctx?: { userId?: string; workspace?: string }): Promise<RoutingDecision> {
    const startTime = Date.now();
    const userId = ctx?.userId || 'anonymous';
    const workspace = ctx?.workspace || 'default';

    // 前置防御: 空/null 输入直接返回
    if (!userMessage || typeof userMessage !== 'string' || userMessage.trim().length === 0) {
      return { skillName: '', confidence: 0.0, reason: '空输入', method: 'fallback' };
    }

    // 步骤 1: 输入消毒
    const sanitizedMsg = this.sanitizeInput(userMessage);
    if (sanitizedMsg && sanitizedMsg.length > 0) {
      // 消息被修改了，标记为 sanitized，fallback 到关键词匹配
      auditLog({ userId, workspace, action: 'semantic-router.sanitize', result: 'warning', detail: 'Input sanitized during routing' });
      return {
        skillName: '',
        confidence: 0.0,
        reason: '输入已消毒，降级到关键词匹配',
        method: 'fallback',
      };
    }

    // 步骤 2: 缓存查询
    const cacheKey = this.hashMessage(userMessage);
    const cache = getKnowledgeCache();
    const cached = cache.query(cacheKey);
    if (cached.found && cached.entry?.avgScore !== undefined && cached.entry.avgScore >= 0.75) {
      auditLog({ userId, workspace, action: 'semantic-router.cache-hit', result: 'ok', detail: `Cached skill: ${cached.entry.templateId}` });
      return {
        skillName: cached.entry.templateId,
        confidence: cached.entry.avgScore,
        reason: '缓存命中',
        method: 'cache',
      };
    }

    // 步骤 3: 成本检查
    if (this.dailyCostCNY >= DAILY_COST_CAP_CNY) {
      auditLog({ userId, workspace, action: 'semantic-router.cost-cap', result: 'warning', detail: 'Daily cost cap reached' });
      return {
        skillName: '',
        confidence: 0.0,
        reason: '今日语义路由成本已达上限，降级到关键词匹配',
        method: 'fallback',
      };
    }

    // 步骤 4: LLM 语义路由
    try {
      const decision = await this.executeRouting(userMessage);
      const elapsed = Date.now() - startTime;

      if (decision.skillName && decision.confidence >= CONFIDENCE_THRESHOLD) {
        // 步骤 5: 写入缓存
        cache.upsert(
          cacheKey,
          decision.skillName,
          decision.confidence,
          'semantic-router'
        );

        // 步骤 6: Governor 记录
        const tracker = getTracker();
        tracker.recordToolResult(
          'semantic-router',
          'skill-match' as TaskType,
          'llm',
          true,
          elapsed
        );

        // 步骤 7: 审计日志
        auditLog({
          userId,
          workspace,
          action: 'semantic-router.success',
          result: 'ok',
          detail: JSON.stringify({ skill: decision.skillName, confidence: decision.confidence }),
          durationMs: elapsed,
        });

        return decision;
      } else {
        // 低置信度，fallback 到关键词匹配
        return {
          skillName: '',
          confidence: decision.confidence,
          reason: `语义路由置信度过低 (${decision.confidence.toFixed(2)})，降级到关键词匹配`,
          method: 'fallback',
        };
      }
    } catch (error) {
      // LLM 调用失败，fallback
      const elapsed = Date.now() - startTime;
      auditLog({ userId, workspace, action: 'semantic-router.error', result: 'error', detail: String(error), durationMs: elapsed });
      
      const tracker = getTracker();
      tracker.recordToolResult(
        'semantic-router',
        'skill-match' as TaskType,
        'llm',
        false,
        elapsed
      );

      return {
        skillName: '',
        confidence: 0.0,
        reason: `LLM 调用失败: ${(error as Error).message}`,
        method: 'fallback',
      };
    }
  }

  /**
   * 核心路由逻辑: PromptBuilder → LLM → ScoreParser
   */
  private async executeRouting(userMessage: string): Promise<RoutingDecision> {
    const skills = this.orchestrator.list();
    const prompt = PromptBuilder.buildPrompt(userMessage, skills);

    // 调用 llm-router.chat()
    const llmResult = await this.llmRouter.chat({
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: userMessage },
      ],
      maxTokens: 500,
      temperature: 0.1, // 低温度保证稳定 JSON 输出
    });

    // 累加成本
    this.dailyCostCNY += llmResult.usage.cost;

    return ScoreParser.parse(llmResult.content, 'llm');
  }

  /**
   * 输入消毒: 防止 SQL 注入/命令注入/ReDoS
   * 返回被清理的内容（如果修改过），或空字符串（如果未修改）
   */
  sanitizeInput(input: string): string {
    if (!input || typeof input !== 'string') return '';

    let cleaned = input.toLowerCase();

    // SQL 注入防护 (移除常见 SQL 关键字 + 分号/括号)
    cleaned = cleaned.replace(/\b(drop|delete|update|insert|alter|create|exec|execute|truncate|rename)\b/gi, '');
    cleaned = cleaned.replace(/[;()'"]\s*(--|\/\*|\*\/)/g, '');

    // Shell 注入防护 (移除危险的 shell 元字符)
    cleaned = cleaned.replace(/[|;&`$(){}]/g, '');

    // 变量注入防护
    cleaned = cleaned.replace(/\$\{.*?\}/g, '');

    // 如果输入被修改了，返回修改后的结果；未修改则返回空字符串表示"无需消毒"
    // 注意：由于 cleaned 可能全部转为小写，需要用原始输入来比较
    const originalLower = input.toLowerCase();
    return cleaned === originalLower ? '' : cleaned;
  }

  /**
   * 消息哈希 — 使用 crypto SHA-256
   * 
   * 使用 SHA-256 生成消息的唯一标识，用于缓存查询。
   * 相比简化版 djb2，SHA-256 具有更低的碰撞概率和更好的分布特性。
   */
  hashMessage(msg: string): string {
    return createHash('sha256').update(msg, 'utf-8').digest('hex');
  }
}
