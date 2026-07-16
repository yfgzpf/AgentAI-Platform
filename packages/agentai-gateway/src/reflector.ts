/**
 * Reflector - 反思门 + CSSL 元指令生成
 * ----------------------------------------------------
 * 基于CSSL（Coach-Style Supervised Learning）理念：
 *   不替换弱模型，而是生成元指令教会弱模型如何变强。
 *
 * 工作流程:
 *   1. AgentAILoop 结束 → reflect() 触发
 *   2. 收集本轮工具调用 + 用户消息 + AI回复
 *   3. 用 LLM 诊断：是否存在信息缺失/推理错误/知识不足/过度自信/未验证假设
 *   4. 生成元指令（不是答案！而是"应该如何重新思考"的引导）
 *   5. 写入 evolution.jsonl 作为 meta_instruction 类型
 *   6. 下次 buildImmutablePrefix → recallEvolution → extractPatterns → 注入 system prompt
 *
 * 闭环:
 *   loop → reflector(生成元指令) → evolution → 下次 loop 的 immutable prefix
 *
 * @see .trae/rules/重构说明 (CSSL方案)
 */

import { AgentAIRouter } from './llm-router.js';
import { writeEvolution, readEvolution, type EvolutionEntry } from './evolution.js';
import { log } from './logger-stub.js';

export interface ReflectorOptions {
  /** 每多少轮反思一次 (默认 10) */
  reflectEvery?: number;
  /** 反思时读取最近多少条 evolution (默认 20) */
  historyLimit?: number;
  /** 用户上下文 (workspace/userId) */
  userId?: string;
  workspace?: string;
  /** 强制反思 (不依赖 reflectEvery 判断) */
  force?: boolean;
  /** 2026-06-25 CSSL: 任务类型（用于元指令召回） */
  taskType?: 'coding' | 'research' | 'general' | 'industry';
  /** 2026-06-25 CSSL: 行业（用于元指令召回） */
  industry?: string;
  /** 2026-06-25 CSSL: 关键词（用于元指令召回） */
  keywords?: string[];
}

export interface ReflectorContext {
  /** 用户的最新消息 */
  userMessage: string;
  /** 助手最终回复 */
  finalResponse: string;
  /** 工具调用历史 (本轮) */
  toolCalls: Array<{ name: string; args: any; result: any; success: boolean; durationMs: number }>;
  /** 总迭代次数 */
  iterations: number;
  /** 成功/失败 */
  success: boolean;
}

/** CSSL 诊断结果类型 */
interface DiagnosisResult {
  /** 是否需要修正 */
  needsCorrection: boolean;
  /** 诊断类型 */
  diagnosisType: 'information_gap' | 'reasoning_error' | 'knowledge_gap' | 'over_confidence' | 'unverified_assumption' | 'none';
  /** 元指令内容（精炼的引导，不是答案） */
  metaInstruction: string;
}

/**
 * 触发反思 + 生成 CSSL 元指令
 * 不抛异常, 失败时静默
 */
export async function reflect(
  router: AgentAIRouter,
  ctx: ReflectorContext,
  opts: ReflectorOptions = {},
): Promise<void> {
  const every = opts.reflectEvery ?? 10;

  if (!opts.force && ctx.iterations % every !== 0) return;
  if (ctx.toolCalls.length === 0 && ctx.success) return; // 无工具调用且成功，无需反思

  const t0 = Date.now();

  // 1. 收集最近历史 (含本次)
  const recent = readEvolution(opts.historyLimit ?? 20);

  // 2. 构造诊断 prompt
  const prompt = buildDiagnosisPrompt(ctx, recent);

  try {
    // 3. 调用 LLM 诊断 (走最便宜的 provider, 节省成本)
    const result = await router.chat({
      model: 'cheap',
      messages: [
        { role: 'system', content: CSSL_DIRECTOR_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      maxTokens: 300,
    });

    // 4. 解析诊断结果
    const diagnosis = parseDiagnosis(result.content.trim());

    // 5. 写入 evolution
    if (diagnosis.needsCorrection && diagnosis.metaInstruction) {
      // 有价值的元指令 → 写入 meta_instruction 类型
      writeEvolution({
        type: 'meta_instruction',
        content: diagnosis.metaInstruction,
        metadata: {
          iterations: ctx.iterations,
          toolCount: ctx.toolCalls.length,
          durationMs: Date.now() - t0,
          diagnosisType: diagnosis.diagnosisType === 'none' ? undefined : diagnosis.diagnosisType,
        },
        sessionId: opts.userId,
        userId: opts.userId,
        workspace: opts.workspace,
        taskType: opts.taskType,
        industry: opts.industry,
        keywords: opts.keywords,
        diagnosisType: diagnosis.diagnosisType === 'none' ? undefined : diagnosis.diagnosisType,
      });

      log?.info?.(`[reflector] CSSL元指令生成 (${Date.now() - t0}ms, ${diagnosis.diagnosisType}): ${diagnosis.metaInstruction.slice(0, 60)}...`);
    } else {
      // 无需修正 → 写入 success 类型（保持向后兼容）
      const summary = ctx.success ? '任务顺利完成' : '任务完成但质量待验证';
      writeEvolution({
        type: ctx.success ? 'success' : 'failure',
        content: summary,
        metadata: {
          iterations: ctx.iterations,
          toolCount: ctx.toolCalls.length,
          durationMs: Date.now() - t0,
        },
        sessionId: opts.userId,
        userId: opts.userId,
        workspace: opts.workspace,
        taskType: opts.taskType,
        industry: opts.industry,
        keywords: opts.keywords,
      });

      log?.info?.(`[reflector] 反思完成 (${Date.now() - t0}ms, 无需修正)`);
    }
  } catch (e) {
    // 反思失败不影响主流程
    log?.warn?.(`[reflector] 反思失败: ${(e as Error).message}`);
  }
}

/**
 * CSSL 教导主任 System Prompt
 * 核心原则：不给答案，只给"如何思考"的引导
 */
const CSSL_DIRECTOR_PROMPT = `你是AI教导主任，职责是诊断初级AI助手的输出，生成元指令引导它改进。

【关键原则】
- 你绝不直接给出修正后的完整答案
- 你只给出元指令：告诉助手"应该如何重新思考"
- 元指令要精炼、可执行、有约束条件
- 如果助手输出没有明显缺陷，直接返回 needsCorrection=false

【诊断维度】
1. information_gap（信息缺失）：助手缺少必要信息就回答了
2. reasoning_error（推理错误）：逻辑链有断裂或跳跃
3. knowledge_gap（知识不足）：助手在超出其知识范围的领域编造了内容
4. over_confidence（过度自信）：助手过于确定但证据不足
5. unverified_assumption（未验证假设）：助手依赖了未经验证的假设

【输出格式（严格JSON）】
{
  "needsCorrection": true,
  "diagnosisType": "information_gap",
  "metaInstruction": "你依赖了用户会提供API密钥的假设。请检查对话历史，如果没有密钥信息，生成一个追问。不要编造密钥。"
}

如果无需修正，返回：
{"needsCorrection": false, "diagnosisType": "none", "metaInstruction": ""}

只输出JSON，不要其他内容。`;

/**
 * 构造诊断 prompt
 */
function buildDiagnosisPrompt(ctx: ReflectorContext, recent: EvolutionEntry[]): string {
  const lines: string[] = [];

  lines.push('## 当前任务');
  lines.push(`用户: ${ctx.userMessage.slice(0, 500)}`);
  lines.push(`助手: ${ctx.finalResponse.slice(0, 500)}`);
  lines.push(`迭代: ${ctx.iterations} 次`);
  lines.push(`结果: ${ctx.success ? '成功' : '失败'}`);

  lines.push('\n## 工具调用');
  for (const t of ctx.toolCalls.slice(0, 10)) {
    const status = t.success ? '✓' : '✗';
    const resultStr = typeof t.result === 'string' ? t.result.slice(0, 100) : JSON.stringify(t.result).slice(0, 100);
    lines.push(`${status} ${t.name}(${t.durationMs}ms) → ${resultStr}`);
  }

  // 注入历史元指令（让教导主任知道之前教过什么，避免重复）
  const pastInstructions = recent.filter(e => e.type === 'meta_instruction').slice(-3);
  if (pastInstructions.length > 0) {
    lines.push('\n## 历史教练建议（已教过的，避免重复）');
    for (const p of pastInstructions) {
      lines.push(`- [${p.diagnosisType || 'unknown'}] ${p.content.slice(0, 80)}`);
    }
  }

  if (recent.length > 0) {
    lines.push('\n## 最近执行记录');
    for (const r of recent.slice(-5)) {
      lines.push(`- [${r.type}] ${r.content.slice(0, 60)}`);
    }
  }

  lines.push('\n## 请诊断');
  lines.push('分析助手的输出是否存在问题，如果有，生成一条元指令引导它改进。');

  return lines.join('\n');
}

/**
 * 解析诊断结果
 * 容错处理：LLM 可能不总是返回标准 JSON
 */
function parseDiagnosis(raw: string): DiagnosisResult {
  // 默认：无需修正
  const noCorrection: DiagnosisResult = {
    needsCorrection: false,
    diagnosisType: 'none',
    metaInstruction: '',
  };

  if (!raw || !raw.trim()) return noCorrection;

  // 尝试提取 JSON
  let jsonStr = raw.trim();

  // 处理 markdown 代码块
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch?.[1]) {
    jsonStr = jsonMatch[1].trim();
  }

  // 尝试找到 JSON 边界
  const start = jsonStr.indexOf('{');
  const end = jsonStr.lastIndexOf('}');
  if (start >= 0 && end > start) {
    jsonStr = jsonStr.slice(start, end + 1);
  }

  try {
    const parsed = JSON.parse(jsonStr);
    return {
      needsCorrection: !!parsed.needsCorrection,
      diagnosisType: parsed.diagnosisType || 'none',
      metaInstruction: String(parsed.metaInstruction || '').trim(),
    };
  } catch {
    // JSON 解析失败，尝试从文本中提取有价值信息
    // 如果 LLM 返回了有意义的文本（非 JSON），也当作元指令
    if (raw.length > 20 && raw.length < 300) {
      return {
        needsCorrection: true,
        diagnosisType: 'reasoning_error',
        metaInstruction: raw.slice(0, 200),
      };
    }
    return noCorrection;
  }
}
