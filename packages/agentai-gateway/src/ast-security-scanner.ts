/**
 * AST Security Scanner — AST级安全扫描器
 * ---------------------------------------
 * 基于抽象语法树的安全扫描，识别危险代码模式
 * 
 * 检测范围:
 * - 危险函数调用 (eval, Function, exec, etc.)
 * - 敏感API访问 (process.kill, fs.unlink, etc.)
 * - 网络请求 (fetch to external, XMLHttpRequest)
 * - 动态代码执行
 * - 敏感信息泄露
 */

// 简化的AST扫描器 (不依赖外部parser，使用正则+启发式)
// 实际部署时可替换为 @babel/parser 或 typescript 解析器

export interface SecurityViolation {
  type: 'dangerous_call' | 'sensitive_api' | 'dynamic_execution' | 'info_leak' | 'network_risk';
  severity: 'critical' | 'high' | 'medium' | 'low';
  line: number;
  column: number;
  message: string;
  code: string;
  suggestion?: string;
}

export interface ScanResult {
  passed: boolean;
  violations: SecurityViolation[];
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    total: number;
  };
}

// 危险模式定义
interface DangerPattern {
  type: SecurityViolation['type'];
  severity: SecurityViolation['severity'];
  pattern: RegExp;
  message: string;
  suggestion?: string;
}

const DANGER_PATTERNS: DangerPattern[] = [
  // 动态代码执行 - 关键
  {
    type: 'dynamic_execution',
    severity: 'critical',
    pattern: /eval\s*\(/,
    message: '检测到 eval() 调用，可能导致任意代码执行',
    suggestion: '使用 JSON.parse 或安全的表达式求值替代'
  },
  {
    type: 'dynamic_execution',
    severity: 'critical',
    pattern: /new\s+Function\s*\(/,
    message: '检测到 Function 构造函数调用',
    suggestion: '避免动态创建函数，使用预定义的函数映射'
  },
  {
    type: 'dynamic_execution',
    severity: 'critical',
    pattern: /setTimeout\s*\(\s*["']/,  // setTimeout("code", 100)
    message: 'setTimeout 使用字符串参数',
    suggestion: '使用函数作为参数: setTimeout(() => {}, 100)'
  },
  {
    type: 'dynamic_execution',
    severity: 'critical',
    pattern: /setInterval\s*\(\s*["']/,
    message: 'setInterval 使用字符串参数',
    suggestion: '使用函数作为参数'
  },
  
  // 进程控制 - 关键
  {
    type: 'dangerous_call',
    severity: 'critical',
    pattern: /process\.kill\s*\(/,
    message: '检测到进程终止调用',
    suggestion: '使用 taskkill 或更安全的进程管理方式'
  },
  {
    type: 'dangerous_call',
    severity: 'critical',
    pattern: /process\.exit\s*\(/,
    message: '检测到进程退出调用',
    suggestion: '正常流程中避免强制退出进程'
  },
  
  // 子进程 - 高
  {
    type: 'dangerous_call',
    severity: 'high',
    pattern: /child_process/,
    message: '使用 child_process 模块',
    suggestion: '确保命令参数已正确转义，避免命令注入'
  },
  {
    type: 'dangerous_call',
    severity: 'high',
    pattern: /exec\s*\(|execSync\s*\(/,
    message: '检测到 shell 命令执行',
    suggestion: '使用 execFile 或 spawn 替代，避免 shell 注入'
  },
  {
    type: 'dangerous_call',
    severity: 'high',
    pattern: /spawn\s*\(\s*['"]\s*sh\s*['"]/,
    message: 'spawn 使用 shell 执行',
    suggestion: '直接执行目标程序，不通过 shell'
  },
  
  // 文件系统 - 高
  {
    type: 'sensitive_api',
    severity: 'high',
    pattern: /fs\.unlinkSync\s*\(|fs\.rmdirSync\s*\(/,
    message: '检测到文件/目录删除操作',
    suggestion: '确认路径安全，避免删除重要文件'
  },
  {
    type: 'sensitive_api',
    severity: 'high',
    pattern: /fs\.writeFileSync\s*\(\s*['"]\s*\//,
    message: '写入绝对路径文件',
    suggestion: '使用相对路径或验证路径在白名单内'
  },
  {
    type: 'sensitive_api',
    severity: 'medium',
    pattern: /fs\.chmod|fs\.chown/,
    message: '修改文件权限',
    suggestion: '谨慎修改权限设置'
  },
  
  // 网络 - 中
  {
    type: 'network_risk',
    severity: 'medium',
    pattern: /fetch\s*\(\s*['"]http/,
    message: 'HTTP 网络请求 (非加密)',
    suggestion: '使用 HTTPS 协议'
  },
  {
    type: 'network_risk',
    severity: 'medium',
    pattern: /XMLHttpRequest/,
    message: '使用 XMLHttpRequest',
    suggestion: '考虑使用现代 fetch API'
  },
  
  // 信息泄露 - 中
  {
    type: 'info_leak',
    severity: 'medium',
    pattern: /console\.(log|warn|error)\s*\(.*\b(password|secret|key|token)\b/i,
    message: '可能泄露敏感信息到日志',
    suggestion: '避免在日志中输出敏感信息'
  },
  {
    type: 'info_leak',
    severity: 'high',
    pattern: /\.env\.[A-Z_]+\s*\+/,  // process.env.KEY + something
    message: '环境变量可能被拼接泄露',
    suggestion: '检查敏感信息的使用方式'
  },
  
  // 其他危险模式
  {
    type: 'dangerous_call',
    severity: 'high',
    pattern: /require\s*\(\s*['"]vm['"]\s*\)/,
    message: '使用 vm 模块执行代码',
    suggestion: 'vm 模块存在沙箱逃逸风险，谨慎使用'
  },
  {
    type: 'dangerous_call',
    severity: 'medium',
    pattern: /__proto__|prototype\.pollution/i,
    message: '可能存在原型污染风险',
    suggestion: '使用 Object.create(null) 或验证属性名'
  },
];

/**
 * AST安全扫描器类
 */
export class ASTSecurityScanner {
  private patterns: DangerPattern[];

  constructor(customPatterns?: DangerPattern[]) {
    this.patterns = [...DANGER_PATTERNS, ...(customPatterns || [])];
  }

  /**
   * 扫描代码
   */
  scan(code: string, filename?: string): ScanResult {
    const violations: SecurityViolation[] = [];
    const lines = code.split('\n');
    
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      const lineNum = lineIndex + 1;
      
      for (const pattern of this.patterns) {
        // 重置正则lastIndex
        pattern.pattern.lastIndex = 0;
        
        let match: RegExpExecArray | null;
        while ((match = pattern.pattern.exec(line)) !== null) {
          // 检查是否在注释中
          const beforeMatch = line.substring(0, match.index);
          const commentIndex = Math.max(
            beforeMatch.lastIndexOf('//'),
            beforeMatch.lastIndexOf('/*')
          );
          const stringIndex = Math.max(
            beforeMatch.lastIndexOf('"'),
            beforeMatch.lastIndexOf("'"),
            beforeMatch.lastIndexOf('`')
          );
          
          // 如果在注释中，跳过
          if (commentIndex > stringIndex) continue;
          
          violations.push({
            type: pattern.type,
            severity: pattern.severity,
            line: lineNum,
            column: match.index + 1,
            message: pattern.message,
            code: match[0],
            suggestion: pattern.suggestion
          });
        }
      }
    }
    
    // 去重 (相同位置相同类型)
    const uniqueViolations = this.deduplicate(violations);
    
    // 计算摘要
    const summary = {
      critical: uniqueViolations.filter(v => v.severity === 'critical').length,
      high: uniqueViolations.filter(v => v.severity === 'high').length,
      medium: uniqueViolations.filter(v => v.severity === 'medium').length,
      low: uniqueViolations.filter(v => v.severity === 'low').length,
      total: uniqueViolations.length
    };
    
    return {
      passed: summary.critical === 0 && summary.high === 0,
      violations: uniqueViolations,
      summary
    };
  }

  /**
   * 快速扫描 (只检查关键和高危)
   */
  quickScan(code: string): ScanResult {
    const fullResult = this.scan(code);
    const criticalHigh = fullResult.violations.filter(
      v => v.severity === 'critical' || v.severity === 'high'
    );
    
    return {
      passed: criticalHigh.length === 0,
      violations: criticalHigh,
      summary: {
        critical: criticalHigh.filter(v => v.severity === 'critical').length,
        high: criticalHigh.filter(v => v.severity === 'high').length,
        medium: 0,
        low: 0,
        total: criticalHigh.length
      }
    };
  }

  /**
   * 添加自定义模式
   */
  addPattern(pattern: DangerPattern): void {
    this.patterns.push(pattern);
  }

  /**
   * 去重
   */
  private deduplicate(violations: SecurityViolation[]): SecurityViolation[] {
    const seen = new Set<string>();
    return violations.filter(v => {
      const key = `${v.line}:${v.column}:${v.type}:${v.code}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}

// 默认扫描器实例
let defaultScanner: ASTSecurityScanner | null = null;

export function getDefaultScanner(): ASTSecurityScanner {
  if (!defaultScanner) {
    defaultScanner = new ASTSecurityScanner();
  }
  return defaultScanner;
}

// 便捷函数
export function scanCode(code: string, filename?: string): ScanResult {
  return getDefaultScanner().scan(code, filename);
}

export function quickScanCode(code: string): ScanResult {
  return getDefaultScanner().quickScan(code);
}

// 导出类型
export { DANGER_PATTERNS };
export default ASTSecurityScanner;
