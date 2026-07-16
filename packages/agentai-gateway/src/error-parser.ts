/**
 * 错误解析引擎 — 结构化错误信息 + 修复建议
 * ----------------------------------------------------
 * 设计理念：
 * - 工具执行失败时，返回结构化错误信息
 * - 包含错误类型、上下文、修复建议、置信度
 * - 支持自主修复闭环直接应用修复建议
 * 
 * 安全守护：
 * - 不暴露敏感信息（路径、密钥等）
 * - 修复建议经过安全检查
 */

export type ErrorType = 'TypeError' | 'ReferenceError' | 'SyntaxError' | 'NetworkError' | 'FileSystemError' | 'PermissionError' | 'TimeoutError' | 'UnknownError';

export interface StructuredError {
    type: ErrorType;
    message: string;
    context: {
        variableName?: string;
        expectedType?: string;
        actualValue?: any;
        callStack?: string;
        executionStep?: string;
        toolName?: string;
        args?: Record<string, any>;
    };
    suggestedFix?: string;
    confidence: number; // 0-1，修复建议的可信度
    riskLevel: 'low' | 'medium' | 'high'; // 修复建议的风险等级
}

/**
 * 解析工具执行错误，返回结构化错误信息
 */
export function parseToolError(
    error: Error | string,
    step: string,
    toolName: string,
    args: Record<string, any>
): StructuredError {
    const errorMsg = typeof error === 'string' ? error : error.message;
    const errorStack = typeof error === 'string' ? '' : error.stack || '';

    // 1. 解析 undefined 属性访问错误（最常见的slice错误）
    const propMatch = errorMsg.match(/Cannot read properties of (?:undefined|null) \(reading ['"](\w+)['"]\)/);
    if (propMatch) {
        const prop = propMatch[1];
        return {
            type: 'TypeError',
            message: errorMsg,
            context: {
                variableName: prop,
                expectedType: 'string',
                actualValue: undefined,
                callStack: errorStack,
                executionStep: step,
                toolName,
                args: sanitizeArgs(args)
            },
            suggestedFix: `添加空值检查: obj?.${prop} 或 String(obj || '').${prop}()`,
            confidence: 0.9,
            riskLevel: 'low'
        };
    }

    // 2. 解析网络错误
    if (errorMsg.match(/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|network|Network Error/i)) {
        return {
            type: 'NetworkError',
            message: errorMsg,
            context: {
                executionStep: step,
                toolName,
                args: sanitizeArgs(args)
            },
            suggestedFix: '检查网络连接，或使用本地缓存/离线模式',
            confidence: 0.7,
            riskLevel: 'low'
        };
    }

    // 3. 解析文件系统错误
    if (errorMsg.match(/ENOENT|EACCES|EPERM|file not found|cannot find module/i)) {
        const pathMatch = errorMsg.match(/(?:ENOENT|file not found).*['"]([^'"]+)['"]/);
        const path = pathMatch ? pathMatch[1] : '';
        return {
            type: 'FileSystemError',
            message: errorMsg,
            context: {
                variableName: path,
                executionStep: step,
                toolName,
                args: sanitizeArgs(args)
            },
            suggestedFix: path ? `检查路径是否存在: ${path}` : '检查文件路径是否正确',
            confidence: 0.8,
            riskLevel: 'low'
        };
    }

    // 4. 解析权限错误
    if (errorMsg.match(/permission denied|EACCES|EPERM|not authorized/i)) {
        return {
            type: 'PermissionError',
            message: errorMsg,
            context: {
                executionStep: step,
                toolName,
                args: sanitizeArgs(args)
            },
            suggestedFix: '检查文件权限，或使用管理员权限运行',
            confidence: 0.6,
            riskLevel: 'medium'
        };
    }

    // 5. 解析超时错误
    if (errorMsg.match(/timeout|ETIMEDOUT|timed out/i)) {
        return {
            type: 'TimeoutError',
            message: errorMsg,
            context: {
                executionStep: step,
                toolName,
                args: sanitizeArgs(args)
            },
            suggestedFix: '增加超时时间，或优化执行效率',
            confidence: 0.7,
            riskLevel: 'low'
        };
    }

    // 6. 解析语法错误
    if (errorMsg.match(/SyntaxError|Unexpected token|parse error/i)) {
        return {
            type: 'SyntaxError',
            message: errorMsg,
            context: {
                executionStep: step,
                toolName,
                args: sanitizeArgs(args)
            },
            suggestedFix: '检查代码语法，修复语法错误',
            confidence: 0.5,
            riskLevel: 'medium'
        };
    }

    // 7. 解析引用错误
    if (errorMsg.match(/ReferenceError|is not defined|Cannot find module/i)) {
        const varMatch = errorMsg.match(/(?:ReferenceError|is not defined).*['"](\w+)['"]/);
        const varName = varMatch ? varMatch[1] : '';
        return {
            type: 'ReferenceError',
            message: errorMsg,
            context: {
                variableName: varName,
                executionStep: step,
                toolName,
                args: sanitizeArgs(args)
            },
            suggestedFix: varName ? `检查变量 ${varName} 是否定义` : '检查变量是否定义',
            confidence: 0.6,
            riskLevel: 'medium'
        };
    }

    // 8. 默认：未知错误
    return {
        type: 'UnknownError',
        message: errorMsg,
        context: {
            executionStep: step,
            toolName,
            args: sanitizeArgs(args)
        },
        suggestedFix: '检查代码逻辑，添加错误处理',
        confidence: 0.3,
        riskLevel: 'medium'
    };
}

/**
 * 清理参数中的敏感信息（路径、密钥等）
 */
function sanitizeArgs(args: Record<string, any>): Record<string, any> {
    const sanitized: Record<string, any> = {};
    
    for (const [key, value] of Object.entries(args)) {
        // 跳过敏感字段
        if (key.match(/password|secret|key|token|credential/i)) {
            sanitized[key] = '[REDACTED]';
            continue;
        }
        
        // 清理路径中的敏感信息
        if (typeof value === 'string' && value.match(/\/etc|\/usr|\/bin|C:\\Windows|C:\\Program Files/i)) {
            sanitized[key] = '[SANITIZED_PATH]';
            continue;
        }
        
        // 其他字段保留
        sanitized[key] = value;
    }
    
    return sanitized;
}

/**
 * 检查修复建议是否安全
 */
export function isFixSafe(suggestedFix: string): boolean {
    // 检查是否包含危险操作
    const dangerousPatterns = [
        /rm\s+-rf/i,
        /del\s+\/s/i,
        /format/i,
        /shutdown/i,
        /registry\s+delete/i,
        /eval\(/i,
        /Function\(/i,
        /child_process/i,
        /os\.system/i
    ];
    
    return !dangerousPatterns.some(p => suggestedFix.match(p));
}

/**
 * 格式化结构化错误为可读文本
 */
export function formatStructuredError(error: StructuredError): string {
    const parts: string[] = [];
    
    parts.push(`❌ 错误类型: ${error.type}`);
    parts.push(`错误信息: ${error.message}`);
    
    if (error.context.variableName) {
        parts.push(`变量: ${error.context.variableName}`);
    }
    
    if (error.context.expectedType) {
        parts.push(`期望类型: ${error.context.expectedType}`);
    }
    
    if (error.context.executionStep) {
        parts.push(`执行步骤: ${error.context.executionStep}`);
    }
    
    if (error.suggestedFix) {
        parts.push(`💡 修复建议: ${error.suggestedFix}`);
        parts.push(`置信度: ${Math.round(error.confidence * 100)}%`);
        parts.push(`风险等级: ${error.riskLevel}`);
    }
    
    return parts.join('\n');
}