/**
 * SkillCodeGenerator - AI技能代码生成器
 * 
 * 使用LLM生成真实可执行的技能代码，替代占位符
 */

import { AgentAIRouter } from './llm-router.js';

export interface SkillCodeRequest {
  name: string;
  description: string;
  category: string;
  parameters?: Record<string, any>;
  examples?: string[];
}

export interface SkillCodeResult {
  success: boolean;
  code: string;
  explanation: string;
  dependencies: string[];
  error?: string;
}

export class SkillCodeGenerator {
  private llmRouter: AgentAIRouter;

  constructor(llmRouter: AgentAIRouter) {
    this.llmRouter = llmRouter;
  }

  /**
   * 生成技能代码
   */
  async generate(request: SkillCodeRequest): Promise<SkillCodeResult> {
    const prompt = this.buildPrompt(request);

    try {
      const response = await this.llmRouter.chat({
        model: 'deepseek',
        messages: [
          {
            role: 'system',
            content: `你是一个专业的技能代码生成专家。根据用户提供的技能描述，生成完整的、可执行的JavaScript代码。

要求：
1. 代码必须是有效的Node.js JavaScript
2. 使用async/await处理异步操作
3. 返回格式必须是: { success: boolean, output: string, data?: any }
4. 包含适当的错误处理
5. 代码要简洁实用，避免过度工程化
6. 如果技能涉及文件操作，使用fs/promises
7. 如果技能涉及HTTP请求，使用fetch

禁止：
- 不要使用任何需要额外安装的npm包（除非是非常通用的）
- 不要包含测试代码
- 不要包含示例调用代码`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3,
        maxTokens: 2000,
      });

      const content = typeof response.content === 'string' 
        ? response.content 
        : JSON.stringify(response.content);

      // 提取代码块
      const codeMatch = content.match(/```(?:javascript|js)?\s*([\s\S]*?)```/);
      const code = codeMatch ? codeMatch[1].trim() : content.trim();

      // 提取说明
      const explanationMatch = content.match(/(?:说明|解释|Description):?\s*([\s\S]*?)(?:```|$)/i);
      const explanation = explanationMatch 
        ? explanationMatch[1].trim() 
        : 'AI生成的技能代码';

      // 提取依赖
      const deps = this.extractDependencies(code);

      return {
        success: true,
        code,
        explanation,
        dependencies: deps,
      };
    } catch (error: any) {
      return {
        success: false,
        code: '',
        explanation: '',
        dependencies: [],
        error: error.message,
      };
    }
  }

  /**
   * 验证生成的代码
   */
  async validate(code: string): Promise<{ valid: boolean; error?: string }> {
    try {
      // 基本语法检查
      new Function('return ' + code);
      
      // 检查是否包含禁止的模式
      const forbiddenPatterns = [
        /eval\s*\(/,
        /Function\s*\(/,
        /child_process/,
        /exec\s*\(/,
      ];

      for (const pattern of forbiddenPatterns) {
        if (pattern.test(code)) {
          return {
            valid: false,
            error: `代码包含禁止的模式: ${pattern}`,
          };
        }
      }

      // 检查是否包含必要的返回结构
      if (!code.includes('success') || !code.includes('output')) {
        return {
          valid: false,
          error: '代码必须包含 success 和 output 返回字段',
        };
      }

      return { valid: true };
    } catch (error: any) {
      return {
        valid: false,
        error: `语法错误: ${error.message}`,
      };
    }
  }

  /**
   * 构建提示词
   */
  private buildPrompt(request: SkillCodeRequest): string {
    const { name, description, category, parameters, examples } = request;

    let prompt = `请为以下技能生成完整的JavaScript实现代码：

技能名称: ${name}
技能描述: ${description}
分类: ${category}
`;

    if (parameters && Object.keys(parameters).length > 0) {
      prompt += `\n参数定义:\n${JSON.stringify(parameters, null, 2)}\n`;
    }

    if (examples && examples.length > 0) {
      prompt += `\n使用示例:\n${examples.join('\n')}\n`;
    }

    prompt += `
请生成一个async函数，函数签名如下：
\`\`\`javascript
async function skillHandler(args) {
  // args 包含调用时传入的参数
  // 返回格式: { success: boolean, output: string, data?: any }
}
\`\`\`

要求：
1. 代码必须是完整的、可执行的JavaScript
2. 使用async/await处理异步操作
3. 包含适当的错误处理（try/catch）
4. 返回格式必须是: { success: boolean, output: string }
5. 代码要简洁实用
6. 在代码后简要说明实现逻辑

请直接输出代码块，不需要额外的解释。`;

    return prompt;
  }

  /**
   * 提取代码依赖
   */
  private extractDependencies(code: string): string[] {
    const deps: string[] = [];
    
    // 检查是否使用了fs
    if (code.includes("require('fs") || code.includes('require("fs')) {
      deps.push('fs');
    }
    
    // 检查是否使用了path
    if (code.includes("require('path") || code.includes('require("path')) {
      deps.push('path');
    }
    
    // 检查是否使用了fetch（Node 18+内置）
    if (code.includes('fetch(')) {
      deps.push('fetch (built-in)');
    }

    return deps;
  }
}

// 单例导出
let generator: SkillCodeGenerator | null = null;

export function getSkillCodeGenerator(llmRouter: AgentAIRouter): SkillCodeGenerator {
  if (!generator) {
    generator = new SkillCodeGenerator(llmRouter);
  }
  return generator;
}
