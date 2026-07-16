// ===========================================================================
// src/tool-factory.ts — Agent 自发明工具工厂
// ===========================================================================
/**
 * 职责：当 Agent 遇到现有工具都无法完成的任务时，
 * 让它自己写一个小脚本（工具），注册回 ToolRegistry。
 *
 * v2: 接入真正的 LLM 生成 handler 代码（非硬编码模式匹配）
 * v1: 硬编码模式匹配（仅支持 计算/格式化/echo）
 */

import { ToolRegistry, ToolEntry, ToolHandler, ToolContext } from './tool-registry.js';
import { CodeRunner, SandboxRules } from './sandbox/executor.js';
import { writeEvolutionAsync } from './evolution.js';
import { SelfEvaluator, quickScore } from './judge/self-eval.js';
import type { AgentAIRouter } from './llm-router.js';

// ===== 类型 =====
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handlerCode: string;  // JS 代码字符串
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
}

export interface ToolFactoryResult {
  success: boolean;
  toolEntry?: ToolEntry;
  error?: string;
  validationScore?: number;
  evolutionRecord?: { type: string; content: string };
}

// ===== 工具生成提示模板 =====
const TOOL_GENERATION_PROMPT = `你是一位工具开发专家。请根据以下任务描述和失败原因，生成一个 JavaScript 函数作为新工具。

【任务描述】
{taskDescription}

【现有工具列表】
{existingTools}

【失败原因分析】
{failureReason}

【要求】
1. 只输出一个 JS 函数，接收 args 参数
2. 函数返回 { success: boolean, output: string, data?: any }
3. 不要使用危险 API（fs, child_process, net 等）
4. 函数必须健壮，处理边界情况
5. 只输出代码，不要解释`;

// ===== 工具工厂 =====
export class ToolFactory {
  private registry: ToolRegistry;
  private sandbox: CodeRunner;
  private evaluator: SelfEvaluator;
  private router?: AgentAIRouter;

  constructor(
    registry: ToolRegistry,
    limits?: { timeoutMs?: number; maxOutputBytes?: number },
    router?: AgentAIRouter,
  ) {
    this.registry = registry;
    this.sandbox = new CodeRunner(limits);
    this.evaluator = new SelfEvaluator();
    this.router = router;
  }

  /**
   * 核心方法：从失败任务自动生成工具
   * @param taskDescription - 任务描述
   * @param failedTools - 已尝试但失败的工具列表
   * @param failureReason - 失败原因分析
   */
  async inventTool(
    taskDescription: string,
    failedTools: string[],
    failureReason: string,
  ): Promise<ToolFactoryResult> {
    // 1. 获取现有工具列表（用于避免重复）
    const existingTools = this.registry.list().map(t => `${t.name}: ${t.description}`).join('\n') || '无';

    // 2. 生成工具代码（v2: LLM 驱动，v1 降级: 模式匹配）
    const generatedCode = await this._generateHandlerCode(taskDescription, existingTools, failureReason);

    // 3. 安全检查
    const safetyCheck = SandboxRules.checkDanger(generatedCode);
    if (!safetyCheck.safe) {
      return {
        success: false,
        error: `Generated tool contains dangerous patterns: ${safetyCheck.patterns.join(', ')}`,
        evolutionRecord: { type: 'failure', content: `Tool generation rejected: ${safetyCheck.patterns.join(',')}` },
      };
    }

    // 4. 沙盒预验证
    const validationResult = await this._validateToolCode(generatedCode);
    if (!validationResult.success) {
      return {
        success: false,
        error: validationResult.error,
        validationScore: validationResult.score,
        evolutionRecord: { type: 'failure', content: `Tool validation failed: ${validationResult.error}` },
      };
    }

    // 5. 评分
    const score = this.evaluator.evaluate(
      taskDescription,
      generatedCode,
      'code_review' as any,
      { checkJSON: false, checkSafety: true },
    );

    // 6. 注册工具
    const toolEntry = this._buildToolEntry(taskDescription, generatedCode, score);
    this.registry.register(toolEntry);

    // 7. 记录进化
    await writeEvolutionAsync({
      type: 'success',
      content: `New tool invented: ${toolEntry.name}`,
      metadata: { score: score.totalScore, failedTools },
    });

    return {
      success: true,
      toolEntry,
      validationScore: score.totalScore,
      evolutionRecord: { type: 'success', content: `Tool "${toolEntry.name}" created (score: ${score.totalScore})` },
    };
  }

  /**
   * 生成 handler 代码
   * v2: 优先调用 LLM 生成真实代码，降级到硬编码模式匹配
   */
  private async _generateHandlerCode(
    taskDescription: string,
    existingTools: string,
    failureReason: string,
  ): Promise<string> {
    // === 策略1: LLM 生成 (v2) ===
    if (this.router) {
      try {
        const prompt = TOOL_GENERATION_PROMPT
          .replace('{taskDescription}', taskDescription)
          .replace('{existingTools}', existingTools)
          .replace('{failureReason}', failureReason);

        const response = await this.router.chat({
          model: 'agentai',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          maxTokens: 2000,
        });

        if (response?.content && response.content.length > 50) {
          // 提取代码块：优先 ```js ... ``` 或 ```javascript ... ```
          const codeMatch = response.content.match(/```(?:js|javascript)?\s*\n?([\s\S]*?)```/);
          const code = codeMatch ? codeMatch[1].trim() : response.content.trim();

          // 验证：必须包含 function 和 return
          if (code.includes('function') && code.includes('return')) {
            console.log('[tool-factory] LLM-generated handler for:', taskDescription.slice(0, 50));
            return code;
          }
        }
        console.warn('[tool-factory] LLM response unusable, falling back to patterns');
      } catch (e: any) {
        console.warn('[tool-factory] LLM call failed:', e.message, 'falling back to patterns');
      }
    }

    // === 策略2: 降级 — 硬编码模式匹配 (原始逻辑) ===
    return this._generateHandlerCodePatterns(taskDescription);
  }

  /**
   * 降级策略：基于关键词匹配的模板生成 (保留作为 fallback)
   */
  private _generateHandlerCodePatterns(taskDescription: string): string {
    const taskLower = taskDescription.toLowerCase();

    if (taskLower.includes('计算') || taskLower.includes('math') || taskLower.includes('求')) {
      return `
        module.exports = function(args) {
          const a = args.a || 0;
          const b = args.b || 0;
          const operation = args.operation || 'add';
          let result;
          switch(operation) {
            case 'add': result = a + b; break;
            case 'subtract': result = a - b; break;
            case 'multiply': result = a * b; break;
            case 'divide': result = b !== 0 ? a / b : NaN; break;
            default: result = NaN;
          }
          return { success: true, output: String(result), data: { result } };
        };
      `;
    }

    if (taskLower.includes('格式化') || taskLower.includes('format') || taskLower.includes('转换')) {
      return `
        module.exports = function(args) {
          const input = args.input || '';
          const format = args.format || 'uppercase';
          let output;
          switch(format) {
            case 'uppercase': output = input.toUpperCase(); break;
            case 'lowercase': output = input.toLowerCase(); break;
            case 'title': output = input.replace(/\\b\\w/g, c => c.toUpperCase()); break;
            default: output = input;
          }
          return { success: true, output, data: { format } };
        };
      `;
    }

    // 默认：简单的 echo 工具
    return `
        module.exports = function(args) {
          const input = args.input || '';
          return {
            success: true,
            output: 'Processed: ' + input,
            data: { input }
          };
        };
      `;
  }

  /**
   * 在沙盒中验证生成的代码
   */
  private async _validateToolCode(code: string): Promise<{ success: boolean; error?: string; score?: number }> {
    // 提取 module.exports 部分并执行
    const testCode = `() => {
      let mod = {};
      try { ${code} } catch(e) { return { error: e.message }; }
      if (typeof mod.exports !== 'function') return { error: 'No function exported' };
      const result = mod.exports({ test: 'hello' });
      if (!result || typeof result.success === 'undefined') return { error: 'Invalid return type' };
      return result;
    }`;

    try {
      const result = await this.sandbox.execute(testCode);
      if (result.success && !result.output.includes('[E]')) {
        return { success: true };
      }
      return {
        success: false,
        error: result.output || result.error || 'Unknown validation error',
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * 构建完整的 ToolEntry
   */
  private _buildToolEntry(
    taskDescription: string,
    handlerCode: string,
    score: { totalScore: number },
  ): ToolEntry {
    // 从描述生成工具名
    const name = this._generateToolName(taskDescription);

    // 解析 handler 函数 — 使用沙盒 CodeRunner 执行，避免 new Function() 安全漏洞
    const sandboxRef = this.sandbox;
    const handler: ToolHandler = async (args: Record<string, any>, _ctx: ToolContext) => {
      try {
        // 构建沙盒执行代码：将 handlerCode 包装为可执行箭头函数
        // handlerCode 格式: "module.exports = function(args) { ... }"
        const fnBody = handlerCode.replace(/^\s*module\.exports\s*=\s*function/, 'function');
        const wrappedCode = `() => {
          let module = { exports: {} };
          ${fnBody};
          module.exports(${JSON.stringify(args)});
          return module.exports;
        }`;
        const result = await sandboxRef.execute(wrappedCode, args);
        if (!result.success) {
          return {
            success: false,
            output: '',
            error: result.error || 'Sandbox execution failed',
          };
        }
        // 尝试解析输出为 JSON，否则返回原始文本
        try {
          const parsed = JSON.parse(result.output);
          return {
            success: parsed.success ?? true,
            output: String(parsed.output ?? ''),
            data: parsed.data,
          };
        } catch {
          return {
            success: true,
            output: result.output,
          };
        }
      } catch (err) {
        return {
          success: false,
          output: '',
          error: err instanceof Error ? err.message : String(err),
        };
      }
    };

    return {
      name,
      description: taskDescription,
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Input argument' },
        },
      },
      handler,
      parallelSafe: false,
      riskLevel: score.totalScore >= 6 ? 'low' : score.totalScore >= 3 ? 'medium' : 'high',
      skillMeta: {
        source: 'workspace',
        version: '0.0.1',
        tags: ['auto-generated'],
      },
    };
  }

  /**
   * 从任务描述生成工具名
   */
  private _generateToolName(description: string): string {
    // 尝试提取中文关键词作为名字 (最长匹配)
    const cnMatches = description.match(/[\u4e00-\u9fff]+/g);
    if (cnMatches && cnMatches.length > 0) {
      // 取最长的中文片段作为工具名
      cnMatches.sort((a, b) => b.length - a.length);
      return 'tool_' + cnMatches[0].toLowerCase();
    }
    // 简单规则：提取英文关键词
    const words = description.split(/\s+/).filter(w => w.length > 2);
    if (words.length === 0) return 'auto_tool_1';
    const name = words[0]!.toLowerCase().replace(/[^a-z0-9]/g, '_');
    return name;
  }
}

// ===== 便捷工厂 =====
export function createToolFactory(registry: ToolRegistry, router?: AgentAIRouter): ToolFactory {
  return new ToolFactory(registry, undefined, router);
}
