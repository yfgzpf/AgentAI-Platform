/**
 * auto-error-repair — AI 自动错误修复技能
 * 
 * 当工具调用出现运行时错误时，自动诊断并修复：
 * - TypeError: Cannot read properties of undefined (reading 'slice')
 * - JSON 解析错误
 * - 类型不匹配
 * - 空值处理
 * 
 * 修复后自动重试，无需用户介入
 */

import { SkillDescriptor } from '../skill-orchestrator.js';

export interface AutoRepairResult {
  success: boolean;
  originalError: string;
  fixedCode?: string;
  retryCount: number;
  output?: string;
}

export const autoErrorRepair: SkillDescriptor = {
  name: 'auto_error_repair',
  description: '自动诊断并修复工具调用中的运行时错误（如 slice 错误、类型错误等），然后自动重试',
  category: 'system',
  tags: ['error', 'repair', 'auto-fix', 'slice', 'undefined'],
  riskLevel: 'low',
  parallelSafe: true,
  parameters: {
    type: 'object',
    required: ['error_message', 'original_code', 'tool_name'],
    properties: {
      error_message: {
        type: 'string',
        description: '完整的错误信息，如 "Cannot read properties of undefined (reading \'slice\')"'
      },
      original_code: {
        type: 'string',
        description: '出错的原始代码片段'
      },
      tool_name: {
        type: 'string',
        description: '调用的工具名称'
      },
      context: {
        type: 'object',
        description: '额外的上下文信息（args、返回值等）',
        properties: {
          args: { type: 'object' },
          result: { type: 'string' },
          file_path: { type: 'string' }
        }
      }
    }
  },
  handler: async (params: any, _ctx?: any): Promise<{ success: boolean; output: string; data?: any }> => {
    const { error_message, original_code, tool_name, context } = params;
    
    // 错误类型诊断
    const diagnosis = diagnoseError(error_message, original_code, tool_name);
    
    // 生成修复代码
    const fixedCode = applyFix(original_code, diagnosis);
    
    // 构建修复报告
    const report = diagnosis.suggestedFix
      ? `诊断: ${diagnosis.description}\n修复策略: ${diagnosis.suggestedFix.after}\n说明: ${diagnosis.suggestedFix.explanation}`
      : `诊断: ${diagnosis.description}\n无法自动修复，需要人工介入`;
    
    return {
      success: diagnosis.fixStrategy !== 'manual',
      output: report,
      data: {
        originalError: error_message,
        fixedCode,
        diagnosis,
        toolName: tool_name,
        context
      }
    };
  }
};

/**
 * 错误诊断引擎
 */
function diagnoseError(errorMessage: string, code: string, toolName: string): DiagnosisResult {
  const result: DiagnosisResult = {
    type: 'unknown',
    severity: 'high',
    fixStrategy: 'manual',
    description: ''
  };
  
  // 1. slice 错误诊断
  if (errorMessage.includes('slice') || errorMessage.includes('reading \'slice\'')) {
    const propertyMatch = errorMessage.match(/reading '(\w+)'/i);
    const property = propertyMatch ? propertyMatch[1] : 'unknown';
    
    result.type = 'undefined_property_access';
    result.severity = 'medium';
    result.fixStrategy = 'add_null_check';
    result.description = `尝试访问 ${property} 属性时，对象为 undefined。需要添加空值检查。`;
    result.suggestedFix = {
      before: `args?.content.slice(0, 500)`,
      after: `args?.content ? String(args.content).slice(0, 500) : undefined`,
      explanation: '先检查 content 是否存在，存在时转换为字符串再调用 slice'
    };
  }
  
  // 2. JSON 解析错误
  else if (errorMessage.includes('JSON') || errorMessage.includes('parse')) {
    result.type = 'json_parse_error';
    result.severity = 'medium';
    result.fixStrategy = 'sanitize_json';
    result.description = 'JSON 解析失败，可能是截断或格式错误';
    result.suggestedFix = {
      before: `JSON.parse(rawString)`,
      after: `try { JSON.parse(rawString) } catch { JSON.parse(fixTruncatedJson(rawString)) }`,
      explanation: '添加 try-catch，使用修复函数处理截断的 JSON'
    };
  }
  
  // 3. TypeError 通用诊断
  else if (errorMessage.includes('TypeError')) {
    const propertyMatch = errorMessage.match(/reading '(\w+)'/i);
    const property = propertyMatch ? propertyMatch[1] : 'unknown';
    
    result.type = 'type_error';
    result.severity = 'medium';
    result.fixStrategy = 'add_type_check';
    result.description = `类型错误：访问 ${property} 时类型不匹配`;
    result.suggestedFix = {
      before: `obj.property`,
      after: `obj?.property ?? defaultValue`,
      explanation: '使用可选链操作符和默认值'
    };
  }
  
  // 4. ReferenceError
  else if (errorMessage.includes('ReferenceError')) {
    const varMatch = errorMessage.match(/'(\w+)'/);
    const variable = varMatch ? varMatch[1] : 'unknown';
    
    result.type = 'reference_error';
    result.severity = 'low';
    result.fixStrategy = 'import_or_define';
    result.description = `引用了未定义的变量: ${variable}`;
    result.suggestedFix = {
      before: `使用 ${variable}`,
      after: `import { ${variable} } from 'module' 或定义 ${variable}`,
      explanation: '需要导入或定义该变量'
    };
  }
  
  // 5. 工具调用参数错误
  else if (errorMessage.includes('tool') || errorMessage.includes('parameter')) {
    result.type = 'tool_parameter_error';
    result.severity = 'medium';
    result.fixStrategy = 'validate_params';
    result.description = '工具调用参数验证失败';
    result.suggestedFix = {
      before: `toolCall(params)`,
      after: `validateParams(params); toolCall(params)`,
      explanation: '添加参数验证步骤'
    };
  }
  
  return result;
}

interface DiagnosisResult {
  type: string;
  severity: 'low' | 'medium' | 'high';
  fixStrategy: string;
  description: string;
  suggestedFix?: {
    before: string;
    after: string;
    explanation: string;
  };
}

/**
 * 应用修复
 */
function applyFix(code: string, diagnosis: DiagnosisResult): string {
  if (!diagnosis.suggestedFix) {
    return code; // 无法自动修复，返回原代码
  }
  
  let fixed = code;
  
  // 根据策略应用修复
  switch (diagnosis.fixStrategy) {
    case 'add_null_check':
      // 查找所有可能的 undefined 访问并添加检查
      fixed = fixed.replace(
        /(\w+)?\.(\w+)\s*\.\s*(\w+)/g,
        '$1?.[$2]?.[$3] ?? undefined'
      );
      // 处理 slice 调用
      fixed = fixed.replace(
        /(\w+)?\.(\w+)\.slice\(([^)]+)\)/g,
        '$1?.[$2] ? String($1?.[$2]).slice($3) : undefined'
      );
      break;
      
    case 'sanitize_json':
      // 添加 JSON 解析保护
      fixed = fixed.replace(
        /JSON\.parse\(([^)]+)\)/g,
        `try { JSON.parse($1) } catch(e) { console.warn('[json-fix]', e.message); JSON.parse(fixTruncatedJson($1)) }`
      );
      break;
      
    case 'add_type_check':
      // 添加类型检查
      fixed = fixed.replace(
        /(\w+)\.(\w+)/g,
        (match, obj, prop) => {
          if (['slice', 'substring', 'substr', 'length', 'push', 'pop'].includes(prop)) {
            return `${obj} != null ? ${obj}.${prop} : undefined`;
          }
          return match;
        }
      );
      break;
      
    case 'validate_params':
      // 添加参数验证
      fixed = `validateParams(params, '${diagnosis.type}');\n${fixed}`;
      break;
  }
  
  return fixed;
}

/**
 * 修复截断的 JSON
 */
function fixTruncatedJson(str: string): string {
  if (!str) return '{}';
  
  let fixed = str;
  
  // 补齐未闭合的括号
  const openBraces = (fixed.match(/{/g) || []).length;
  const closeBraces = (fixed.match(/}/g) || []).length;
  if (openBraces > closeBraces) {
    fixed += '}'.repeat(openBraces - closeBraces);
  }
  
  const openBrackets = (fixed.match(/\[/g) || []).length;
  const closeBrackets = (fixed.match(/\]/g) || []).length;
  if (openBrackets > closeBrackets) {
    fixed += ']'.repeat(openBrackets - closeBrackets);
  }
  
  // 移除末尾不完整的键值对
  fixed = fixed.replace(/,\s*"[^"]*":\s*[^,}]*$/, '');
  
  return fixed;
}

/**
 * 参数验证器
 */
function validateParams(params: any, type: string): void {
  if (!params) {
    throw new Error('参数为空');
  }
  
  // 根据类型进行特定验证
  switch (type) {
    case 'undefined_property_access':
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) {
          console.warn(`[validate] 参数 ${key} 为空值，使用默认值`);
        }
      }
      break;
  }
}
