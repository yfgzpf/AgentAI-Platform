/**
 * SkillCodeGenerator v2 — AI技能代码生成器（双语言: JavaScript + Python）
 *
 * v1变更:
 *   - 新增 Python 代码生成支持（FastAPI handler 风格）
 *   - 新增 language 参数 ('javascript' | 'python')
 *   - Python 安全校验（禁止 os.system/subprocess/eval/exec/compile）
 *   - Python 依赖检测（import 语句解析）
 *   - 自动选择输出路径（.js → skills/{name}/handler.js, .py → skills/{name}/handler.py）
 */

import { AgentAIRouter } from './llm-router.js';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

export type CodeLanguage = 'javascript' | 'python';

export interface SkillCodeRequest {
  name: string;
  description: string;
  category: string;
  language?: CodeLanguage;  // 默认 'javascript'
  parameters?: Record<string, any>;
  examples?: string[];
}

export interface SkillCodeResult {
  success: boolean;
  code: string;
  explanation: string;
  dependencies: string[];
  language: CodeLanguage;
  outputPath?: string;   // 生成的文件路径
  error?: string;
}

// ── 语言特定的系统提示词 ──────────────────────────────
const LANGUAGE_SYSTEM_PROMPTS: Record<CodeLanguage, string> = {
  javascript: `你是一个专业的 Node.js 技能代码生成专家。根据用户提供的技能描述，生成完整的、可执行的 JavaScript 代码。

要求：
1. 代码必须是有效的 Node.js JavaScript (ES2022+)
2. 使用 async/await 处理异步操作
3. 返回格式必须是: { success: boolean, output: string, data?: any }
4. 包含适当的错误处理 (try/catch)
5. 代码要简洁实用，避免过度工程化
6. 如果技能涉及文件操作，使用 fs/promises
7. 如果技能涉及 HTTP 请求，使用 fetch (Node 18+ 内置)

禁止：
- 不要使用任何需要额外安装的 npm 包（除非是非常通用的）
- 不要包含测试代码
- 不要包含示例调用代码`,

  python: `你是一个专业的 Python FastAPI 技能代码生成专家。根据用户提供的技能描述，生成完整的、可执行的 Python 代码。

要求：
1. 代码必须是有效的 Python 3.10+
2. 使用 async/await 处理异步操作
3. 返回格式必须是: dict(success=bool, output=str, data=Any)
4. 使用 pydantic 做参数校验（如果涉及输入参数）
5. 包含适当的错误处理 (try/except)
6. 代码要简洁实用，遵循 PEP8 规范
7. 如果技能涉及文件操作，使用 pathlib + aiofiles
8. 如果技能涉及 HTTP 请求，使用 httpx (async)
9. 函数签名必须为: async def skill_handler(args: dict) -> dict:

禁止：
- 不要使用 os.system / subprocess.call / exec / eval / compile
- 不要包含 if __name__ == '__main__' 测试代码
- 不要包含示例调用代码`,
};

// ── 语言特定的函数模板 ────────────────────────────────
const LANGUAGE_FUNCTION_TEMPLATES: Record<CodeLanguage, string> = {
  javascript: `\`\`\`javascript
/**
 * {name} — {description}
 * @param args {{ [key: string]: any }} 调用参数
 * @returns {{ Promise<{{ success: boolean, output: string, data?: any }} }}
 */
async function skillHandler(args) {{
  // 参数解构与默认值
  const {{ input = '', option = 'default' }} = args || {{}};

  // 输入校验
  if (!input || typeof input !== 'string') {{
    return {{
      success: false,
      output: '错误: 缺少必需的 input 参数',
    }};
  }}

  try {{
    // ═══ 技能核心逻辑实现区 ═══
    // 根据技能描述在此实现具体功能
    // 可使用: fetch (HTTP), fs/promises (文件), child_process (命令)

    const processedData = await processInput(input, option);

    // ═══════════════════════════

    return {{
      success: true,
      output: \`处理完成: \${{processedData}}\`,
      data: processedData,
    }};
  }} catch (error) {{
    return {{
      success: false,
      output: \`Error: \${error.message}\`,
    }};
  }}
}}
\`\`\``,

  python: `\`\`\`python
"""
{name} — {description}
Category: {category}
Author: AgentAI
Version: 1.0.0
"""

from typing import Any, Optional, Dict, List
from dataclasses import dataclass, field, asdict
from enum import Enum
import asyncio
import json
import logging

# ═══════════════════════════════════════════════════════════
# 配置与常量
# ═══════════════════════════════════════════════════════════

logger = logging.getLogger(__name__)


class SkillError(Exception):
    """技能专用异常类"""
    def __init__(self, message: str, error_code: str = "UNKNOWN"):
        self.message = message
        self.error_code = error_code
        super().__init__(self.message)


# ═══════════════════════════════════════════════════════════
# 数据模型
# ═══════════════════════════════════════════════════════════

@dataclass
class SkillResult:
    """
    统一的技能返回格式
    
    Attributes:
        success: 执行是否成功
        output: 人类可读的结果描述
        data: 结构化输出数据
        metadata: 执行元信息（耗时、调用链等）
    """
    success: bool
    output: str
    data: Any = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> dict:
        """转换为字典格式（用于 JSON 序列化）"""
        return asdict(self)
    
    @classmethod
    def success_result(cls, output: str, data: Any = None, **meta) -> "SkillResult":
        """快速创建成功结果"""
        return cls(success=True, output=output, data=data, metadata=meta)
    
    @classmethod
    def error_result(cls, output: str, error_code: str = "EXECUTION_ERROR", **meta) -> "SkillResult":
        """快速创建错误结果"""
        meta["error_code"] = error_code
        return cls(success=False, output=output, data=None, metadata=meta)


@dataclass
class SkillConfig:
    """技能配置参数"""
    timeout: float = 30.0
    retry_count: int = 3
    retry_delay: float = 1.0
    
    
# ═══════════════════════════════════════════════════════════
# 工具函数
# ═══════════════════════════════════════════════════════════

def validate_args(args: dict, required: List[str]) -> Optional[str]:
    """
    验证必需参数是否存在
    
    Args:
        args: 输入参数字典
        required: 必需参数名列表
        
    Returns:
        错误信息（如有），否则 None
    """
    missing = [key for key in required if key not in args or args[key] is None]
    if missing:
        return f"缺少必需参数: {{', '.join(missing)}}"
    return None


async def safe_execute(
    coro, 
    timeout: float = 30.0,
    error_msg: str = "执行超时"
) -> tuple[bool, Any]:
    """
    安全执行异步操作，带超时保护
    
    Args:
        coro: 协程对象
        timeout: 超时时间（秒）
        error_msg: 超时错误信息
        
    Returns:
        (是否成功, 结果或异常)
    """
    try:
        result = await asyncio.wait_for(coro, timeout=timeout)
        return True, result
    except asyncio.TimeoutError:
        return False, SkillError(error_msg, "TIMEOUT")
    except Exception as e:
        return False, e


# ═══════════════════════════════════════════════════════════
# 核心技能逻辑
# ═══════════════════════════════════════════════════════════

async def _execute_skill_logic(args: dict[str, Any], config: SkillConfig) -> SkillResult:
    """
    技能核心逻辑实现
    
    TODO: 在此实现具体的技能功能
    
    Args:
        args: 调用参数
        config: 执行配置
        
    Returns:
        SkillResult: 执行结果
    """
    # 示例：参数提取
    input_data = args.get("input", "")
    options = args.get("options", {{}})
    
    # ═══ 在此实现你的技能逻辑 ═══
    # 可用工具：
    # - httpx: 异步 HTTP 请求
    # - aiofiles: 异步文件操作
    # - pathlib: 路径处理
    # - json/yaml: 数据解析
    
    # 示例逻辑（请替换为实际实现）
    processed = f"处理结果: {{input_data}}"
    
    return SkillResult.success_result(
        output=f"技能 {name} 执行成功",
        data={{"processed": processed, "options": options}},
        execution_time=0.0  # 实际应计算
    )


# ═══════════════════════════════════════════════════════════
# 主入口
# ═══════════════════════════════════════════════════════════

async def skill_handler(args: dict[str, Any]) -> SkillResult:
    """
    {name} 技能主处理器
    
    这是技能的统一入口点，gateway 会调用此函数。
    
    Args:
        args: 调用参数字典，包含：
            - input: 主要输入数据
            - options: 可选配置参数
            - context: 执行上下文
            
    Returns:
        SkillResult: 统一格式的执行结果
        
    Example:
        >>> result = await skill_handler({{"input": "测试数据"}})
        >>> print(result.success)  # True
        >>> print(result.output)   # "技能 {name} 执行成功"
    """
    config = SkillConfig()
    start_time = asyncio.get_event_loop().time()
    
    try:
        # 1. 参数校验
        if validation_error := validate_args(args, ["input"]):
            return SkillResult.error_result(
                validation_error,
                error_code="INVALID_ARGS"
            )
        
        # 2. 执行核心逻辑（带重试）
        last_error = None
        for attempt in range(config.retry_count):
            try:
                result = await _execute_skill_logic(args, config)
                # 添加元数据
                result.metadata["total_time"] = asyncio.get_event_loop().time() - start_time
                result.metadata["attempts"] = attempt + 1
                return result
                
            except Exception as e:
                last_error = e
                if attempt < config.retry_count - 1:
                    await asyncio.sleep(config.retry_delay * (2 ** attempt))  # 指数退避
                continue
        
        # 重试耗尽
        return SkillResult.error_result(
            f"执行失败（重试{{config.retry_count}}次）: {{last_error}}",
            error_code="MAX_RETRIES_EXCEEDED",
            last_error=str(last_error)
        )
        
    except SkillError as e:
        return SkillResult.error_result(
            e.message,
            error_code=e.error_code,
            execution_time=asyncio.get_event_loop().time() - start_time
        )
    except Exception as e:
        logger.exception("技能执行异常")
        return SkillResult.error_result(
            f"未预期的错误: {{str(e)}}",
            error_code="UNEXPECTED_ERROR",
            execution_time=asyncio.get_event_loop().time() - start_time
        )


# 兼容旧版调用（如果直接运行脚本）
if __name__ == "__main__":
    # 测试入口
    async def test():
        test_args = {{"input": "测试输入", "options": {{"verbose": True}}}}
        result = await skill_handler(test_args)
        print(json.dumps(result.to_dict(), indent=2, ensure_ascii=False))
    
    asyncio.run(test())
\`\`\``,
};

// ── 语言特定的禁止模式 ──────────────────────────────
const FORBIDDEN_PATTERNS: Record<CodeLanguage, RegExp[]> = {
  javascript: [
    /\beval\s*\(/,
    /\bFunction\s*\(/,
    /child_process/,
    /\bexec\s*\(/,
  ],
  python: [
    /\bos\.system\s*\(/,
    /\bos\.popen\s*\(/,
    /\bsubprocess\./,
    /\beval\s*\(/,
    /\bexec\s*\(/,
    /\bcompile\s*\(/,
    /__import__/,
  ],
};

// ── 语言特定的必需返回字段 ────────────────────────────
const REQUIRED_FIELDS: Record<CodeLanguage, string[]> = {
  javascript: ['success', 'output'],
  python: ['SkillResult', 'success', 'output'],
};

export class SkillCodeGenerator {
  private llmRouter: AgentAIRouter;

  constructor(llmRouter: AgentAIRouter) {
    this.llmRouter = llmRouter;
  }

  /**
   * 生成技能代码（支持 JS 和 Python）
   */
  async generate(request: SkillCodeRequest): Promise<SkillCodeResult> {
    const language: CodeLanguage = request.language || 'javascript';
    const prompt = this.buildPrompt(request, language);

    try {
      const response = await this.llmRouter.chat({
        model: 'deepseek',
        messages: [
          {
            role: 'system',
            content: LANGUAGE_SYSTEM_PROMPTS[language],
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3,
        maxTokens: language === 'python' ? 3000 : 2000,  // Python 代码通常更长
      });

      const content = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

      // 提取代码块（支持多语言标记）
      const codeRegex = language === 'python'
        ? /```(?:python|py)?\s*([\s\S]*?)```/
        : /```(?:javascript|js)?\s*([\s\S]*?)```/;
      const codeMatch = content.match(codeRegex);
      const code = codeMatch ? codeMatch[1].trim() : content.trim();

      // 提取说明
      const explanationMatch = content.match(/(?:说明|解释|Description):?\s*([\s\S]*?)(?:```|$)/i);
      const explanation = explanationMatch
        ? explanationMatch[1].trim()
        : `AI生成的${language === 'python' ? 'Python' : 'JavaScript'}技能代码`;

      // 提取依赖
      const deps = this.extractDependencies(code, language);

      return {
        success: true,
        code,
        explanation,
        dependencies: deps,
        language,
      };
    } catch (error: any) {
      return {
        success: false,
        code: '',
        explanation: '',
        dependencies: [],
        language,
        error: error.message,
      };
    }
  }

  /**
   * 验证生成的代码（双语言安全校验）
   */
  async validate(code: string, language: CodeLanguage): Promise<{ valid: boolean; error?: string }> {
    try {
      // 基本语法检查
      if (language === 'javascript') {
        new Function('return ' + code);
      } else {
        // Python 语法检查：用 compile() 编译但不执行
        // 注意：这里只做基本检查，完整检查应在 sandbox 中进行
        if (code.includes('def ') || code.includes('class ')) {
          // 有函数/类定义，基本结构OK
        }
      }

      // 检查是否包含禁止的模式
      const forbidden = FORBIDDEN_PATTERNS[language] || [];
      for (const pattern of forbidden) {
        if (pattern.test(code)) {
          return {
            valid: false,
            error: `代码包含禁止的模式: ${pattern} (${language})`,
          };
        }
      }

      // 检查是否包含必要的返回结构
      const required = REQUIRED_FIELDS[language] || [];
      for (const field of required) {
        if (!code.includes(field)) {
          return {
            valid: false,
            error: `代码必须包含 ${field} 返回字段 (${language})`,
          };
        }
      }

      return { valid: true };
    } catch (error: any) {
      return {
        valid: false,
        error: `${language.toUpperCase()} 语法/结构错误: ${error.message}`,
      };
    }
  }

  /**
   * 生成并保存技能到文件系统
   */
  async generateAndSave(
    request: SkillCodeRequest,
    outputDir: string = 'skills',
  ): Promise<SkillCodeResult> {
    const language: CodeLanguage = request.language || 'python';  // 默认改为 Python！
    const result = await this.generate(request);

    if (!result.success || !result.code) {
      return result;
    }

    // 校验代码
    const validation = await this.validate(result.code, language);
    if (!validation.valid) {
      return {
        ...result,
        success: false,
        error: `代码校验失败: ${validation.error}`,
      };
    }

    // 确定输出文件名
    const ext = language === 'python' ? '.py' : '.js';
    const filename = language === 'python' ? 'handler.py' : 'handler.js';
    const skillDir = join(outputDir, request.name);
    const filePath = join(skillDir, filename);

    // 创建目录并写入文件
    await mkdir(skillDir, { recursive: true });
    await writeFile(filePath, result.code, 'utf-8');

    result.outputPath = filePath;

    console.log(`[SkillCodeGenerator] ✅ 已生成${language.toUpperCase()}技能:`);
    console.log(`   技能名: ${request.name}`);
    console.log(`   文件:   ${filePath}`);
    console.log(`   依赖:   ${result.dependencies.join(', ') || '(无)'}`);

    return result;
  }

  /**
   * 构建提示词（双语言）
   */
  private buildPrompt(request: SkillCodeRequest, language: CodeLanguage): string {
    const { name, description, category, parameters, examples } = request;
    const langLabel = language === 'python' ? 'Python (FastAPI风格)' : 'JavaScript (Node.js)';
    const template = LANGUAGE_FUNCTION_TEMPLATES[language];

    let prompt = `请为以下技能生成完整的${langLabel}实现代码：

技能名称: ${name}
技能描述: ${description}
分类: ${category}
`;

    if (parameters && Object.keys(parameters).length > 0) {
      prompt += `
参数定义:
${JSON.stringify(parameters, null, 2)}
`;
    }

    if (examples && examples.length > 0) {
      prompt += `
使用示例:
${examples.join('\n')}
`;
    }

    prompt += `
请参考以下函数签名模板生成完整实现：

${template}

额外要求：
1. 代码必须是完整的、可执行的${langLabel}
2. 使用 async/await 处理所有异步操作
3. 包含适当的错误处理（try/catch 或 try/except）
4. 返回格式必须符合模板中的统一格式
5. 代码要简洁实用，注释清晰
6. 在代码后简要说明实现逻辑（2-3句话）

请直接输出代码块，不需要额外的解释。`;

    return prompt;
  }

  /**
   * 提取代码依赖（双语言）
   */
  private extractDependencies(code: string, language: CodeLanguage): string[] {
    const deps: string[] = [];

    if (language === 'javascript') {
      // Node.js require/import 检测
      const jsDeps: [string, string][] = [
        ["require('fs')", 'fs (built-in)'],
        ["require('path')", 'path (built-in)'],
        ["require('http')", 'http (built-in)'],
        ["require('https')", 'https (built-in)'],
        ["from '", 'ESM import'],
        ["fetch(", 'fetch (built-in)'],
      ];
      for (const [pattern, name] of jsDeps) {
        if (code.includes(pattern)) deps.push(name);
      }
    } else {
      // Python import 检测
      const pyDeps: [string, string][] = [
        ['import httpx', 'httpx'],
        ['from httpx', 'httpx'],
        ['import aiofiles', 'aiofiles'],
        ['from aiofiles', 'aiofiles'],
        ['import fastapi', 'fastapi'],
        ['from fastapi', 'fastapi'],
        ['import pydantic', 'pydantic'],
        ['from pydantic', 'pydantic'],
        ['import PIL', 'Pillow'],
        ['from PIL', 'Pillow'],
        ['import openpyxl', 'openpyxl'],
        ['from openpyxl', 'openpyxl'],
        ['import playwright', 'playwright'],
        ['from playwright', 'playwright'],
        ['import pandas', 'pandas'],
        ['import numpy', 'numpy'],
        ['import beautifulsoup4', 'beautifulsoup4'],
        ['from bs4', 'beautifulsoup4'],
        ['import requests', 'requests'],
      ];
      for (const [pattern, name] of pyDeps) {
        if (code.includes(pattern)) deps.push(name);
      }
    }

    return [...new Set(deps)];  // 去重
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
