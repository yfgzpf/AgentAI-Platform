/**
 * intelligent-core.ts — 智能核心引擎
 * ============================================================
 * 这是我作为 AI 将自己的核心能力注入系统的实现。
 * 
 * 我做任务时"丝滑"的原因不是模型本身, 而是:
 *   1. 先理解再行动 (不是拿到任务就开干)
 *   2. 任务分解 (复杂任务拆成有依赖关系的子任务)
 *   3. 代码理解 (快速定位关键代码, 不盲目读文件)
 *   4. 智能搜索 (语义匹配, 不是关键词匹配)
 *   5. 错误自修复 (分析错误原因, 不只是重试)
 *   6. 上下文压缩 (保留关键信息, 不截断)
 * 
 * 这些能力系统原本都有雏形, 但不够完整。下面是完整实现。
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================
// 1. 任务规划引擎 — 复杂任务自动分解 + 依赖分析
// ============================================================

export interface SubTask {
  id: string;
  title: string;
  description: string;
  /** 依赖的子任务 ID */
  dependencies: string[];
  /** 预估难度: easy/medium/hard */
  difficulty: 'easy' | 'medium' | 'hard';
  /** 预估步骤数 */
  estimatedSteps: number;
  /** 需要的工具 */
  requiredTools: string[];
  /** 是否可并行 */
  parallelizable: boolean;
}

export interface TaskPlan {
  goal: string;
  subtasks: SubTask[];
  /** 拓扑排序后的执行顺序 */
  executionOrder: string[];
  /** 可并行的分组 */
  parallelGroups: string[][];
  /** 关键路径 (最长依赖链) */
  criticalPath: string[];
  /** 风险点 */
  risks: string[];
}

/**
 * 分析任务复杂度 — 决定是否需要规划
 */
export function analyzeComplexity(message: string): {
  isComplex: boolean;
  score: number;
  reasons: string[];
  suggestion: 'plan_first' | 'direct_execute' | 'ask_clarify';
} {
  const reasons: string[] = [];
  let score = 0;

  // 多步骤信号
  if (message.match(/然后|接着|之后|再|第一步|第二步/g)) { score += 2; reasons.push('多步骤信号'); }
  if (message.match(/创建|实现|开发|构建|部署/g)) { score += 1; reasons.push('需要创建'); }
  if (message.match(/修复|调试|解决|排查/g)) { score += 1; reasons.push('需要修复'); }
  if (message.match(/重构|优化|改进|升级/g)) { score += 2; reasons.push('需要重构'); }
  
  // 多文件信号
  if (message.match(/前后端|客户端|服务端|数据库|界面/g)) { score += 2; reasons.push('跨模块'); }
  if ((message.match(/和|与|以及/g) || []).length >= 2) { score += 1; reasons.push('多对象'); }
  
  // 模糊信号 — 需要澄清
  if (message.match(/大概|可能|或者|好像|差不多/g)) { score += 1; reasons.push('需求模糊'); }
  if (message.length < 10) { score += 1; reasons.push('描述太短'); }
  
  // 依赖信号
  if (message.match(/依赖|基于|引用|调用/g)) { score += 1; reasons.push('有依赖关系'); }
  
  const isComplex = score >= 4;
  let suggestion: 'plan_first' | 'direct_execute' | 'ask_clarify' = 'direct_execute';
  if (isComplex) suggestion = 'plan_first';
  if (reasons.includes('需求模糊') && score <= 3) suggestion = 'ask_clarify';

  return { isComplex, score, reasons, suggestion };
}

/**
 * 拓扑排序 — 计算执行顺序
 */
function topologicalSort(subtasks: SubTask[]): string[] {
  const sorted: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(id: string) {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      // 循环依赖, 跳过
      return;
    }
    visiting.add(id);
    const task = subtasks.find(s => s.id === id);
    if (task) {
      for (const dep of task.dependencies) {
        visit(dep);
      }
    }
    visiting.delete(id);
    visited.add(id);
    sorted.push(id);
  }

  for (const s of subtasks) visit(s.id);
  return sorted;
}

/**
 * 计算可并行的分组 — 没有相互依赖的任务可以并行
 */
function findParallelGroups(subtasks: SubTask[]): string[][] {
  const groups: string[][] = [];
  const completed = new Set<string>();

  while (completed.size < subtasks.length) {
    // 找出所有依赖已满足的任务
    const ready = subtasks
      .filter(s => !completed.has(s.id))
      .filter(s => s.dependencies.every(d => completed.has(d)))
      .map(s => s.id);
    
    if (ready.length === 0) break; // 死锁
    groups.push(ready);
    ready.forEach(id => completed.add(id));
  }
  return groups;
}

/**
 * 计算关键路径 — 最长依赖链
 */
function findCriticalPath(subtasks: SubTask[], order: string[]): string[] {
  const memo = new Map<string, { len: number; path: string[] }>();
  
  function longest(id: string): { len: number; path: string[] } {
    if (memo.has(id)) return memo.get(id)!;
    const task = subtasks.find(s => s.id === id);
    if (!task || task.dependencies.length === 0) {
      const result = { len: 1, path: [id] };
      memo.set(id, result);
      return result;
    }
    let best = { len: 0, path: [] as string[] };
    for (const dep of task.dependencies) {
      const candidate = longest(dep);
      if (candidate.len > best.len) best = candidate;
    }
    const result = { len: best.len + 1, path: [...best.path, id] };
    memo.set(id, result);
    return result;
  }

  let best = { len: 0, path: [] as string[] };
  for (const s of subtasks) {
    const candidate = longest(s.id);
    if (candidate.len > best.len) best = candidate;
  }
  return best.path;
}

/**
 * 构建任务计划 — 拓扑排序 + 并行分组 + 关键路径
 * 供 plan_task 工具调用
 */
export function buildTaskPlan(goal: string, subtasks: SubTask[]): TaskPlan {
  const executionOrder = topologicalSort(subtasks);
  const parallelGroups = findParallelGroups(subtasks);
  const criticalPath = findCriticalPath(subtasks, executionOrder);
  
  // 风险点: 循环依赖、无依赖的独立任务过多、关键路径过长
  const risks: string[] = [];
  if (executionOrder.length < subtasks.length) {
    risks.push('存在循环依赖, 部分任务无法排序');
  }
  if (parallelGroups.length === subtasks.length) {
    risks.push('所有任务相互独立, 可能需要明确执行顺序');
  }
  if (criticalPath.length > 5) {
    risks.push(`关键路径过长 (${criticalPath.length} 步), 考虑简化依赖`);
  }
  
  return { goal, subtasks, executionOrder, parallelGroups, criticalPath, risks };
}

// ============================================================
// 2. 代码理解引擎 — 快速定位关键代码
// ============================================================

/**
 * 分析文件结构 — 不用 AST, 但比正则更智能
 * 提取: 导出符号、import 依赖、函数签名、复杂度热点
 */
export function analyzeFileStructure(filepath: string): {
  exports: string[];
  imports: Array<{ from: string; names: string[] }>;
  functions: Array<{ name: string; params: string; line: number; isAsync: boolean; isExported: boolean }>;
  classes: Array<{ name: string; line: number; methods: string[] }>;
  complexity: number;
  lines: number;
} {
  let content: string;
  try { content = fs.readFileSync(filepath, 'utf-8'); } catch { return { exports: [], imports: [], functions: [], classes: [], complexity: 0, lines: 0 }; }
  
  const lines = content.split('\n');
  const exports: string[] = [];
  const imports: Array<{ from: string; names: string[] }> = [];
  const functions: Array<{ name: string; params: string; line: number; isAsync: boolean; isExported: boolean }> = [];
  const classes: Array<{ name: string; line: number; methods: string[] }> = [];

  let complexity = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // import 解析
    const importMatch = line.match(/^import\s+(?:(\*\s+as\s+(\w+))|(\{[^}]+\})|(\w+))\s+from\s+['"]([^'"]+)['"]/);
    if (importMatch) {
      const from = importMatch[5];
      const names: string[] = [];
      if (importMatch[2]) names.push(importMatch[2]);
      if (importMatch[3]) names.push(...importMatch[3].replace(/[{}]/g, '').split(',').map(s => s.trim()));
      if (importMatch[4]) names.push(importMatch[4]);
      imports.push({ from, names });
    }
    
    // 函数解析
    const fnMatch = line.match(/^(export\s+)?(default\s+)?(async\s+)?function\s+(\w+)\s*\(([^)]*)\)/);
    if (fnMatch) {
      const isExported = !!fnMatch[1];
      const isAsync = !!fnMatch[3];
      const name = fnMatch[4];
      const params = fnMatch[5].trim();
      functions.push({ name, params, line: i + 1, isAsync, isExported });
      if (isExported) exports.push(name);
    }
    
    // 箭头函数 / const 函数
    const arrowMatch = line.match(/^(export\s+)?const\s+(\w+)\s*=\s*(async\s*)?\([^)]*\)\s*=>/);
    if (arrowMatch) {
      const isExported = !!arrowMatch[1];
      const isAsync = !!arrowMatch[3];
      functions.push({ name: arrowMatch[2], params: '', line: i + 1, isAsync, isExported });
      if (isExported) exports.push(arrowMatch[2]);
    }
    
    // 类解析
    const classMatch = line.match(/^(export\s+)?(default\s+)?(abstract\s+)?class\s+(\w+)/);
    if (classMatch) {
      const isExported = !!classMatch[1];
      const name = classMatch[4];
      // 收集方法
      const methods: string[] = [];
      for (let j = i + 1; j < lines.length && (lines[j].match(/^\s/) || lines[j].trim() === ''); j++) {
        const methodMatch = lines[j].match(/^\s+(async\s+)?(\w+)\s*\(/);
        if (methodMatch && methodMatch[2] !== 'if' && methodMatch[2] !== 'for' && methodMatch[2] !== 'while' && methodMatch[2] !== 'switch') {
          methods.push(methodMatch[2]);
        }
      }
      classes.push({ name, line: i + 1, methods });
      if (isExported) exports.push(name);
    }
    
    // 复杂度计数
    if (line.match(/\bif\s*\(/)) complexity++;
    if (line.match(/\bfor\s*\(/)) complexity++;
    if (line.match(/\bwhile\s*\(/)) complexity++;
    if (line.match(/\bswitch\s*\(/)) complexity++;
    if (line.match(/\bcatch\s*\(/)) complexity++;
    if (line.match(/\?\?/)) complexity++;
  }
  
  return { exports, imports, functions, classes, complexity, lines: lines.length };
}

/**
 * 智能代码搜索 — 语义匹配, 不是纯关键词
 * 理解 "路由" = router/route/endpoint/api
 * 理解 "用户认证" = auth/login/token/jwt/session
 */
const SEMANTIC_MAP: Record<string, string[]> = {
  '路由': ['router', 'route', 'endpoint', 'api', 'path'],
  '认证': ['auth', 'login', 'token', 'jwt', 'session', 'password'],
  '数据库': ['database', 'db', 'sql', 'query', 'model', 'schema', 'table'],
  '前端': ['frontend', 'ui', 'component', 'render', 'view', 'page', 'react', 'vue'],
  '后端': ['backend', 'server', 'api', 'controller', 'service', 'handler'],
  '配置': ['config', 'setting', 'env', 'option', 'preference'],
  '测试': ['test', 'spec', 'mock', 'stub', 'fixture'],
  '工具': ['tool', 'util', 'helper', 'common', 'shared'],
  '类型': ['type', 'interface', 'enum', 'schema', 'model'],
  '错误': ['error', 'exception', 'catch', 'throw', 'fail'],
  '日志': ['log', 'logger', 'console', 'debug', 'trace'],
  '状态': ['state', 'store', 'context', 'reducer', 'action'],
  '样式': ['style', 'css', 'theme', 'color', 'layout'],
  '文档': ['doc', 'readme', 'md', 'documentation'],
  '构建': ['build', 'compile', 'bundle', 'webpack', 'vite', 'rollup'],
  '部署': ['deploy', 'ci', 'cd', 'docker', 'release', 'publish'],
  // ═══ 新增语义映射 ═══
  '安全': ['security', 'vulnerability', 'inject', 'xss', 'csrf', 'sanitize', 'validate'],
  '性能': ['performance', 'optimize', 'cache', 'lazy', 'memo', 'speed', 'fast'],
  '异步': ['async', 'await', 'promise', 'then', 'callback', 'resolve', 'reject'],
  '钩子': ['hook', 'useeffect', 'usestate', 'usememo', 'lifecycle', 'mount', 'unmount'],
  '中间件': ['middleware', 'interceptor', 'filter', 'guard', 'pipe'],
  '模型': ['model', 'llm', 'gpt', 'claude', 'gemini', 'embedding', 'vector', 'ai'],
  '消息': ['message', 'event', 'emit', 'listen', 'subscribe', 'publish', 'queue'],
  '会话': ['session', 'conversation', 'chat', 'dialog', 'message'],
  '记忆': ['memory', 'remember', 'recall', 'forget', 'persist', 'storage'],
  '进化': ['evolve', 'learn', 'adapt', 'self-modify', 'optimize', 'improve'],
  '网关': ['gateway', 'proxy', 'forward', 'route', 'upstream'],
  '流式': ['stream', 'sse', 'chunk', 'delta', 'partial', 'incremental'],
};

export function semanticSearch(query: string, files: string[]): string[] {
if (!query || typeof query !== 'string') return [];
const normalized = query.toLowerCase();
  // 扩展查询: 语义同义词
  const searchTerms = new Set<string>([normalized]);
  for (const [cn, en] of Object.entries(SEMANTIC_MAP)) {
    if (normalized.includes(cn)) {
      en.forEach(e => searchTerms.add(e));
    }
    // 反向: 英文 -> 中文
    if (en.some(e => normalized.includes(e))) {
      searchTerms.add(cn);
    }
  }

  const scored = files.map(file => {
    const filename = path.basename(file).toLowerCase();
    let score = 0;
    for (const term of searchTerms) {
      if (filename.includes(term)) score += 3;
      // 文件内容快速扫描 (只读前 100 行)
      try {
        const content = fs.readFileSync(file, 'utf-8').split('\n').slice(0, 100).join('\n').toLowerCase();
        if (content.includes(term)) score += 1;
      } catch {}
    }
    return { file, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(s => s.file);
}

// ============================================================
// 3. 错误自修复引擎 — 分析错误原因, 不只是重试
// ============================================================

export interface ErrorAnalysis {
  type: 'syntax' | 'runtime' | 'logic' | 'dependency' | 'permission' | 'network' | 'timeout' | 'unknown';
  rootCause: string;
  suggestedFix: string;
  relatedFiles: string[];
  confidence: number;
}

/**
 * 分析错误 — 从错误消息推断根因
 */
export function analyzeError(errorMsg: string, context?: { file?: string; tool?: string }): ErrorAnalysis {
  const msg = errorMsg.toLowerCase();
  
  // 语法错误
  if (msg.match(/syntaxerror|unexpected token|expected.*but.*found|identifier expected/i)) {
    return {
      type: 'syntax',
      rootCause: '代码语法错误: 缺少括号/分号/引号, 或使用了错误的关键字',
      suggestedFix: '检查错误行附近的括号匹配、引号闭合、逗号/分号',
      relatedFiles: context?.file ? [context.file] : [],
      confidence: 0.9,
    };
  }
  
  // 模块缺失
  if (msg.match(/cannot find module|module not found|no such file or directory/i)) {
    const modMatch = errorMsg.match(/['"]([^'"]+)['"]/);
    const mod = modMatch ? modMatch[1] : '未知模块';
    return {
      type: 'dependency',
      rootCause: `缺少依赖: ${mod}`,
      suggestedFix: `运行 npm install ${mod} 或 pnpm add ${mod} 安装缺失的依赖`,
      relatedFiles: [],
      confidence: 0.95,
    };
  }

  // PowerShell 命令不支持 (新增 — Windows 最常见错误)
  if (msg.match(/is not recognized as|term '.*' is not recognized|&&|not a valid command/i)) {
    const cmdMatch = msg.match(/term\s+'([^']+)'/);
    const cmd = cmdMatch?.[1] || '';
    return {
      type: 'syntax',
      rootCause: `PowerShell 不支持该命令或语法: ${cmd}`,
      suggestedFix: cmd
        ? `用 node -e "..." 替代 ${cmd}, 或用 npx ${cmd}, 或检查 PATH`
        : 'PowerShell 不支持 && 连接命令, 用分号 ; 或分行执行',
      relatedFiles: [],
      confidence: 0.92,
    };
  }

  // 端口被占用 (新增 — 更精确的修复建议)
  if (msg.match(/eaddrinuse|port.*in.*use|already in use/i)) {
    const portMatch = msg.match(/port\s+(\d+)/i);
    const port = portMatch?.[1] || '';
    return {
      type: 'runtime',
      rootCause: `端口 ${port} 被占用`,
      suggestedFix: port
        ? `Windows: netstat -ano | findstr :${port} → taskkill /PID <pid> /F; 或换端口`
        : '杀掉占用端口的进程, 或换一个端口',
      relatedFiles: [],
      confidence: 0.95,
    };
  }

  // 模块导入路径错误 (新增)
  if (msg.match(/cannot find module|err_module_not_found|import.*not.*found/i)) {
    const modMatch = msg.match(/cannot find module\s+['"]([^'"]+)['"]/i);
    const mod = modMatch?.[1] || '';
    return {
      type: 'syntax',
      rootCause: `模块路径错误: ${mod}`,
      suggestedFix: mod.endsWith('.js')
        ? `检查 ${mod} 是否存在, 可能需要去掉 .js 后缀 (ESM) 或改为 .ts`
        : `检查 ${mod} 是否安装 (npm install ${mod}), 或路径是否正确`,
      relatedFiles: context?.file ? [context.file] : [],
      confidence: 0.88,
    };
  }

  // 编译错误 (新增 — TS 类型错误增强)
  if (msg.match(/ts\d+|type.*not assignable|argument.*not assignable|does not exist on type/i)) {
    const tsMatch = msg.match(/(ts\d+)/i);
    const tsCode = tsMatch?.[1] || '';
    return {
      type: 'syntax',
      rootCause: `TypeScript 编译错误 ${tsCode}`,
      suggestedFix: tsCode === 'ts2304'
        ? '变量/函数未定义 → 检查是否 import 了, 或拼写错误'
        : tsCode === 'ts2307'
        ? '模块未找到 → 检查路径或 npm install'
        : tsCode === 'ts2322'
        ? '类型不匹配 → 检查变量类型声明'
        : '检查 TypeScript 类型声明, 确保类型匹配',
      relatedFiles: context?.file ? [context.file] : [],
      confidence: 0.87,
    };
  }

  // 类型错误
  if (msg.match(/typeerror|is not a function|is not defined|is undefined|is null|cannot read prop/i)) {
    return {
      type: 'runtime',
      rootCause: '类型错误: 调用了 undefined/null 上的方法, 或函数名拼写错误',
      suggestedFix: '检查变量是否正确初始化, 函数名是否拼写正确, 是否异步调用但忘了 await',
      relatedFiles: context?.file ? [context.file] : [],
      confidence: 0.8,
    };
  }
  
  // 权限错误
  if (msg.match(/eacces|permission denied|access denied|forbidden/i)) {
    return {
      type: 'permission',
      rootCause: '权限不足: 文件/目录没有读写权限',
      suggestedFix: '检查文件权限, 或以管理员身份运行',
      relatedFiles: [],
      confidence: 0.9,
    };
  }
  
  // 网络错误
  if (msg.match(/econnrefused|econnreset|timeout|etimedout|fetch failed|network error/i)) {
    return {
      type: 'network',
      rootCause: '网络错误: 连接被拒绝或超时',
      suggestedFix: '检查服务是否启动、端口是否正确、防火墙是否阻止',
      relatedFiles: [],
      confidence: 0.85,
    };
  }
  
  // 端口占用
  if (msg.match(/eaddrinuse|port.*in.*use|already in use/i)) {
    return {
      type: 'runtime',
      rootCause: '端口被占用: 另一个进程已经在使用该端口',
      suggestedFix: '杀掉占用端口的进程, 或换一个端口',
      relatedFiles: [],
      confidence: 0.95,
    };
  }
  
  // TS 类型错误
  if (msg.match(/ts\d+|type.*not assignable|argument.*not assignable/i)) {
    return {
      type: 'syntax',
      rootCause: 'TypeScript 类型错误: 类型不匹配',
      suggestedFix: '检查变量类型声明, 确保赋值/传参类型正确',
      relatedFiles: context?.file ? [context.file] : [],
      confidence: 0.85,
    };
  }
  
  // 文件不存在
  if (msg.match(/enoent|no such file/i)) {
    const fileMatch = errorMsg.match(/['"]([^'"]+)['"]/);
    return {
      type: 'runtime',
      rootCause: `文件不存在: ${fileMatch ? fileMatch[1] : '未知路径'}`,
      suggestedFix: '检查路径是否正确, 或先创建该文件',
      relatedFiles: [],
      confidence: 0.9,
    };
  }

  return {
    type: 'unknown',
    rootCause: errorMsg.slice(0, 200),
    suggestedFix: '检查错误信息, 分析可能的原因',
    relatedFiles: [],
    confidence: 0.3,
  };
}

// ============================================================
// 4. 上下文压缩引擎 — 智能摘要, 不是截断
// ============================================================

/**
 * 压缩对话历史 — 保留关键信息, 丢弃冗余
 */
export function compressContext(messages: Array<{ role: string; content: any }>): {
  compressed: Array<{ role: string; content: string }>;
  summary: string;
  removedCount: number;
} {
  if (messages.length <= 6) {
    return { compressed: messages, summary: '', removedCount: 0 };
  }

  // 保留最近 4 条 + 前面压缩
  const recent = messages.slice(-4);
  const old = messages.slice(0, -4);
  
  // B2 优化: 提取最近修改的文件内容摘要 (不只保留文件名)
  const lastModifiedFiles = new Map<string, string>(); // file → content snippet

  // 从旧消息中提取关键信息
  const keyInfo: string[] = [];
  const seenTools = new Set<string>();
  const seenFiles = new Set<string>();
  const seenErrors: string[] = [];
  const seenDecisions: string[] = [];
  
  for (const msg of old) {
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
    // 提取工具调用
    const toolMatches = content.matchAll(/(?:调用|执行|running)\s+(\w+)\s*[\(\(]/g);
    for (const m of toolMatches) seenTools.add(m[1]);
    
      // 提取文件路径 (改进: 匹配更多路径格式)
      const fileMatches = content.matchAll(/(?:文件|路径|file|path|modified|created|edited)[:：]?\s*([^\s\n,}"\)]+\.\w{1,5})/gi);
      for (const m of fileMatches) {
        const p = m[1].replace(/['"`]/g, '');
        if (p.length > 3 && p.length < 200) seenFiles.add(p);
      }

      // B2 优化: 从 write_file/multi_edit 的工具结果中提取代码内容摘要
      if (msg.role === 'tool' && seenFiles.size > 0) {
        // 找到这个工具调用对应的文件
        for (const file of seenFiles) {
          if (!lastModifiedFiles.has(file) && content.length > 50) {
            // 保留最后 20 行代码内容 (关键结构不丢)
            const lines = content.split('\n').filter(l => l.trim());
            const snippet = lines.slice(-20).join('\n').slice(0, 500);
            if (snippet.length > 50) {
              lastModifiedFiles.set(file, snippet);
            }
          }
        }
      }
    
    // 提取错误信息 (新增: 保留错误教训)
    if (content.match(/\[ERROR\]|Error:|失败|failed|cannot|unable/i)) {
      const errLines = content.split('\n').filter(l => l.match(/\[ERROR\]|Error:|失败|failed/i)).slice(0, 2);
      seenErrors.push(...errLines.map(l => l.slice(0, 120)));
    }

    // 提取关键决策 (改进: 更精确)
    if (msg.role === 'assistant') {
      const lines = content.split('\n').filter(l => 
        l.match(/决定|选择|方案|策略|使用了|已创建|已修改|已删除|已安装/i)
      );
      seenDecisions.push(...lines.slice(0, 2).map(l => l.slice(0, 150)));
    }

    // 提取用户需求 (新增: 保留原始需求)
    if (msg.role === 'user' && content.length > 10 && content.length < 500) {
      keyInfo.push(`用户: ${content.slice(0, 100)}`);
    }
  }
  
  const summaryParts: string[] = [];
  // 用户需求 (最重要 — 不能丢)
  if (keyInfo.length > 0) summaryParts.push(`## 用户需求\n${keyInfo.slice(-3).join('\n')}`);
  // 已用工具
  if (seenTools.size > 0) summaryParts.push(`## 已用工具\n${[...seenTools].join(', ')}`);
  // 涉及文件 (扩展到 10 个)
  if (seenFiles.size > 0) summaryParts.push(`## 涉及文件\n${[...seenFiles].slice(0, 10).join(', ')}`);
  // 错误教训 (新增 — 避免重复犯错)
  if (seenErrors.length > 0) summaryParts.push(`## 错误记录\n${seenErrors.slice(-3).join('\n')}`);
  // 关键决策 (改进: 更多保留)
  if (seenDecisions.length > 0) summaryParts.push(`## 关键决策\n${seenDecisions.slice(-4).join('\n')}`);
  // B2 优化: 代码内容摘要 (保留最后修改的文件内容片段, 不只文件名)
  if (lastModifiedFiles.size > 0) {
    const codeSnippets: string[] = [];
    for (const [file, snippet] of lastModifiedFiles) {
      codeSnippets.push(`### ${file}\n\`\`\`\n${snippet.slice(0, 300)}\n\`\`\``);
    }
    if (codeSnippets.length > 0) {
      summaryParts.push(`## 代码摘要 (最近修改)\n${codeSnippets.slice(-3).join('\n\n')}`);
    }
  }
  
  const summary = summaryParts.length > 0 
    ? `[上下文摘要 - 已压缩 ${old.length} 条历史消息]\n${summaryParts.join('\n\n')}`
    : `[上下文摘要 - 已压缩 ${old.length} 条历史消息]`;
  
  return {
    compressed: [
      { role: 'system', content: summary },
      ...recent,
    ],
    summary,
    removedCount: old.length,
  };
}

// ============================================================
// 5. 导出: 构建智能上下文注入
// ============================================================

/**
 * 构建智能上下文 — 注入到 system prompt
 */
export function buildIntelligentContext(workspace: string, userMessage: string): string {
  const parts: string[] = [];
  
  // 1. 复杂度分析
  const complexity = analyzeComplexity(userMessage);
  if (complexity.isComplex) {
    parts.push(`[智能分析] 任务复杂度: ${complexity.score}/10 (${complexity.reasons.join(', ')})`);
    if (complexity.suggestion === 'plan_first') {
      parts.push('[智能建议] 建议先分解任务再执行');
    } else if (complexity.suggestion === 'ask_clarify') {
      parts.push('[智能建议] 需求模糊, 建议先向用户澄清关键细节');
    }
  }
  
  return parts.join('\n');
}

/**
 * 智能错误恢复建议 — 工具失败时注入
 */
export function buildErrorRecoverySuggestion(errorMsg: string, tool?: string, file?: string): string {
  const analysis = analyzeError(errorMsg, { file, tool });
  return `[错误分析] 类型: ${analysis.type}
根因: ${analysis.rootCause}
建议修复: ${analysis.suggestedFix}
置信度: ${(analysis.confidence * 100).toFixed(0)}%`;
}

// ============================================================
// 6. 反思引擎 — 每步检查结果，决定是否调整策略
// ============================================================

export interface ReflectionResult {
  /** 是否需要调整策略 */
  needsAdjustment: boolean;
  /** 调整类型 */
  adjustmentType: 'retry' | 'change_approach' | 'ask_user' | 'continue';
  /** 反思内容 */
  reflection: string;
  /** 建议的下一步 */
  suggestion: string;
  /** 置信度 */
  confidence: number;
}

/**
 * 反思 — 检查工具调用结果是否符合预期
 * 这是我做任务时"每步检查"的能力
 */
export function reflectOnResult(
  toolName: string,
  args: any,
  result: { success: boolean; output: string },
  iteration: number,
  previousFailures: number,
): ReflectionResult {
  // 情况 1: 工具成功
  if (result.success) {
    // 检查结果是否"真的"成功 — 有时 success=true 但输出有问题
    const output = typeof result.output === 'string' ? result.output : '';
    
    // 隐性失败检测
    if (output.match(/error|fail|undefined|null|NaN|invalid|cannot|unable/i) && output.length < 200) {
      return {
        needsAdjustment: true,
        adjustmentType: 'change_approach',
        reflection: `工具 ${toolName} 返回 success=true 但输出疑似错误: "${output.slice(0, 100)}"`,
        suggestion: '检查输出内容, 可能需要换一种方式执行',
        confidence: 0.6,
      };
    }
    
    // 成功且输出正常
    return {
      needsAdjustment: false,
      adjustmentType: 'continue',
      reflection: `工具 ${toolName} 执行成功`,
      suggestion: '继续执行下一步',
      confidence: 0.9,
    };
  }
  
  // 情况 2: 工具失败
  const errorAnalysis = analyzeError(result.output || '', { tool: toolName, file: args?.path || args?.file_path });
  
  // 第 1 次失败: 分析错误, 建议修复后重试
  if (previousFailures === 0) {
    return {
      needsAdjustment: true,
      adjustmentType: errorAnalysis.type === 'dependency' ? 'retry' : 'change_approach',
      reflection: `工具 ${toolName} 第 1 次失败 (${errorAnalysis.type}): ${errorAnalysis.rootCause}`,
      suggestion: errorAnalysis.suggestedFix,
      confidence: errorAnalysis.confidence,
    };
  }
  
  // 第 2 次失败: 换方法
  if (previousFailures === 1) {
    return {
      needsAdjustment: true,
      adjustmentType: 'change_approach',
      reflection: `工具 ${toolName} 第 2 次失败, 同一方法不奏效`,
      suggestion: '换一种方法: 检查参数是否正确、路径是否存在、权限是否足够, 或用不同工具达到同样目的',
      confidence: 0.7,
    };
  }
  
  // 第 3 次失败: 问用户
  if (previousFailures >= 2) {
    return {
      needsAdjustment: true,
      adjustmentType: 'ask_user',
      reflection: `工具 ${toolName} 已失败 ${previousFailures + 1} 次, 自动修复无效`,
      suggestion: '向用户说明情况, 请求提供更多信息或手动确认',
      confidence: 0.8,
    };
  }
  
  return {
    needsAdjustment: false,
    adjustmentType: 'continue',
    reflection: '',
    suggestion: '',
    confidence: 0,
  };
}

/**
 * 构建反思注入 — 供 agentai-loop 使用
 */
export function buildReflectionInjection(reflection: ReflectionResult, toolName: string): string {
  if (!reflection.needsAdjustment) return '';
  
  const actionMap: Record<string, string> = {
    'retry': '🔧 建议修复后重试',
    'change_approach': '🔄 建议换一种方法',
    'ask_user': '❓ 建议向用户求助',
    'continue': '✅ 继续执行',
  };
  
  return `[反思] ${reflection.reflection}
${actionMap[reflection.adjustmentType] || ''}: ${reflection.suggestion}
置信度: ${(reflection.confidence * 100).toFixed(0)}%`;
}

// ============================================================
// 7. 多模型自动路由 — 按任务类型选最优模型
// ============================================================

export interface ModelRoutingResult {
  /** 推荐的模型 ID */
  modelId: string;
  /** 推荐理由 */
  reason: string;
  /** 任务类型 */
  taskType: 'code' | 'writing' | 'reasoning' | 'image' | 'video' | 'chat' | 'search';
  /** 置信度 */
  confidence: number;
}

/**
 * 自动路由 — 根据消息内容推荐最优模型
 * 不是用户选模型, 而是系统自动选
 */
export function autoRouteModel(message: string, availableModels: string[]): ModelRoutingResult {
  const msg = message.toLowerCase();
  
  // 生图任务
  if (msg.match(/生成.*图|画.*图|画一个|生成.*logo|生成.*icon|生图|图片生成|draw|generate.*image/i)) {
    const imageModel = availableModels.find(m => m.includes('nano-banana') || m.includes('gpt-image'));
    if (imageModel) {
      return { modelId: imageModel, reason: '检测到生图需求', taskType: 'image', confidence: 0.95 };
    }
  }
  
  // 视频生成
  if (msg.match(/生成.*视频|视频生成|animate|生成.*动画/i)) {
    const videoModel = availableModels.find(m => m.includes('seedance'));
    if (videoModel) {
      return { modelId: videoModel, reason: '检测到视频生成需求', taskType: 'video', confidence: 0.9 };
    }
  }
  
  // 代码任务 — 需要强代码能力的模型
  if (msg.match(/代码|code|函数|function|bug|修复|fix|重构|refactor|编译|compile|调试|debug|实现|implement/i)) {
    // 优先选代码强的模型
    const codeModel = availableModels.find(m => m.includes('deepseek')) 
      || availableModels.find(m => m.includes('kimi-k2.7-code'))
      || availableModels.find(m => m.includes('kimi'));
    if (codeModel) {
      return { modelId: codeModel, reason: '检测到代码任务, 使用代码能力强的模型', taskType: 'code', confidence: 0.85 };
    }
  }
  
  // 推理任务 — 需要强推理能力
  if (msg.match(/分析|推理|为什么|原因|逻辑|证明|推导|方案|策略|比较|优劣/i)) {
    const reasonModel = availableModels.find(m => m.includes('deepseek-v4-pro'))
      || availableModels.find(m => m.includes('glm-5'))
      || availableModels.find(m => m.includes('minimax-m3'));
    if (reasonModel) {
      return { modelId: reasonModel, reason: '检测到推理任务, 使用推理能力强的模型', taskType: 'reasoning', confidence: 0.8 };
    }
  }
  
  // 写作任务 — 需要中文好的模型
  if (msg.match(/写|文案|文章|报告|总结|摘要|邮件|回复|创作|润色|改写/i)) {
    const writeModel = availableModels.find(m => m.includes('glm')) 
      || availableModels.find(m => m.includes('kimi'));
    if (writeModel) {
      return { modelId: writeModel, reason: '检测到写作任务, 使用中文能力强的模型', taskType: 'writing', confidence: 0.75 };
    }
  }
  
  // 搜索/简单问答 — 用免费快速模型
  if (msg.match(/什么是|怎么样|如何|哪里|多少|什么时候|是谁|能不能|可以吗/i) && msg.length < 50) {
    const chatModel = availableModels.find(m => m.includes('agnes') || m.includes('flash'));
    if (chatModel) {
      return { modelId: chatModel, reason: '检测到简单问答, 使用免费快速模型', taskType: 'chat', confidence: 0.7 };
    }
  }
  
  // 默认: 用当前模型
  return { modelId: '', reason: '使用当前模型', taskType: 'chat', confidence: 0.3 };
}

// ============================================================
// 8. 代码风格分析 — 写代码前先理解现有风格
// ============================================================

export interface CodeStyle {
  /** 缩进方式 */
  indent: 'tab' | '2space' | '4space';
  /** 引号风格 */
  quote: 'single' | 'double' | 'backtick';
  /** 分号 */
  semicolon: boolean;
  /** 命名风格: camelCase / snake_case / PascalCase */
  naming: 'camel' | 'snake' | 'pascal';
  /** 是否用 export default */
  preferDefaultExport: boolean;
  /** 是否用 async/await */
  preferAsync: boolean;
  /** 注释语言 */
  commentLang: 'zh' | 'en' | 'mixed' | 'none';
}

/**
 * 分析文件的代码风格 — 写代码前先理解, 保持一致性
 */
export function analyzeCodeStyle(filepath: string): CodeStyle {
  let content: string;
  try { content = fs.readFileSync(filepath, 'utf-8'); } catch {
    return { indent: '2space', quote: 'single', semicolon: true, naming: 'camel', preferDefaultExport: false, preferAsync: true, commentLang: 'none' };
  }
  
  const lines = content.split('\n');
  
  // 缩进
  let indent: CodeStyle['indent'] = '2space';
  for (const line of lines) {
    if (line.startsWith('\t')) { indent = 'tab'; break; }
    if (line.startsWith('    ')) { indent = '4space'; break; }
    if (line.startsWith('  ')) { indent = '2space'; break; }
  }
  
  // 引号
  const singleCount = (content.match(/'/g) || []).length;
  const doubleCount = (content.match(/"/g) || []).length;
  const backtickCount = (content.match(/`/g) || []).length;
  const quote: CodeStyle['quote'] = backtickCount > singleCount ? 'backtick' : singleCount > doubleCount ? 'single' : 'double';
  
  // 分号
  const semicolon = /;\s*$/m.test(content);
  
  // 命名
  const camelCase = /(?:^|[\s;,])([a-z][a-zA-Z]+)\s*[=:(]/g;
  const snakeCase = /(?:^|[\s;,])([a-z]+_[a-z_]+)\s*[=:(]/g;
  const camelCount = (content.match(camelCase) || []).length;
  const snakeCount = (content.match(snakeCase) || []).length;
  const naming: CodeStyle['naming'] = snakeCount > camelCount ? 'snake' : 'camel';
  
  // export default
  const preferDefaultExport = /export\s+default\s/.test(content);
  
  // async
  const preferAsync = /async\s+|await\s+/.test(content);
  
  // 注释语言
  const comments = content.match(/\/\/.*$/gm) || [];
  const zhComments = comments.filter(c => /[\u4e00-\u9fa5]/.test(c)).length;
  const enComments = comments.filter(c => /[a-zA-Z]{3,}/.test(c) && !/[\u4e00-\u9fa5]/.test(c)).length;
  const commentLang: CodeStyle['commentLang'] = zhComments > enComments ? 'zh' : enComments > 0 ? 'en' : 'none';
  
  return { indent, quote, semicolon, naming, preferDefaultExport, preferAsync, commentLang };
}

/**
 * 生成风格指导 — 注入到 AI 的上下文
 */
export function buildStyleGuide(filepath: string): string {
  const style = analyzeCodeStyle(filepath);
  const parts: string[] = [`[代码风格] ${path.basename(filepath)}`];
  parts.push(`缩进: ${style.indent === 'tab' ? 'Tab' : style.indent === '4space' ? '4空格' : '2空格'}`);
  parts.push(`引号: ${style.quote === 'backtick' ? '反引号' : style.quote === 'single' ? '单引号' : '双引号'}`);
  parts.push(`分号: ${style.semicolon ? '有' : '无'}`);
  parts.push(`命名: ${style.naming === 'camel' ? 'camelCase' : style.naming === 'snake' ? 'snake_case' : 'PascalCase'}`);
  parts.push(`导出: ${style.preferDefaultExport ? 'export default' : 'named exports'}`);
  parts.push(`异步: ${style.preferAsync ? 'async/await' : '同步'}`);
  parts.push(`注释: ${style.commentLang === 'zh' ? '中文' : style.commentLang === 'en' ? '英文' : '无'}`);
  return parts.join(' | ');
}

// ============================================================
// 9. 变更影响分析 — 改完检查影响范围
// ============================================================

/**
 * 分析一个文件被修改后会影响哪些其他文件
 * 通过 import 依赖图反向查找
 */
export function analyzeImpact(changedFile: string, workspace: string): {
  impactedFiles: string[];
  impactChain: string[];
  riskLevel: 'low' | 'medium' | 'high';
} {
  const impactedFiles: string[] = [];
  const impactChain: string[] = [changedFile];
  
  // 递归扫描 workspace 中的文件, 找出谁 import 了 changedFile
  const exts = ['.ts', '.tsx', '.js', '.jsx', '.mjs'];
  const changedBasename = path.basename(changedFile).replace(/\.(ts|tsx|js|jsx)$/, '');
  
  function scanDir(dir: string, depth: number) {
    if (depth > 3 || impactedFiles.length > 20) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath, depth + 1);
        } else if (exts.some(ext => entry.name.endsWith(ext))) {
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            // 检查是否 import 了变更的文件
            if (content.includes(`from './${changedBasename}'`) || 
                content.includes(`from "../${changedBasename}'`) ||
                content.includes(`from "./${changedBasename}'`) ||
                content.match(new RegExp(`from\\s+['"][^'"]*${changedBasename}['"]`))) {
              if (!impactedFiles.includes(fullPath)) {
                impactedFiles.push(fullPath);
                impactChain.push(`  ← ${path.relative(workspace, fullPath)}`);
              }
            }
          } catch {}
        }
      }
    } catch {}
  }
  
  scanDir(workspace, 0);
  
  const riskLevel = impactedFiles.length === 0 ? 'low' : impactedFiles.length <= 3 ? 'medium' : 'high';
  
  return { impactedFiles, impactChain, riskLevel };
}

/**
 * 构建影响分析注入
 */
export function buildImpactAnalysis(changedFile: string, workspace: string): string {
  const impact = analyzeImpact(changedFile, workspace);
  if (impact.impactedFiles.length === 0) return '';
  
  const riskEmoji = impact.riskLevel === 'high' ? '🔴' : impact.riskLevel === 'medium' ? '🟡' : '🟢';
  return `[变更影响分析] ${riskEmoji} 风险: ${impact.riskLevel}
修改了 ${path.basename(changedFile)}, 以下 ${impact.impactedFiles.length} 个文件依赖它:
${impact.impactChain.slice(1).join('\n')}
建议: 检查这些文件是否需要同步修改`;
}

// ============================================================
// 10. 最终结果自检 — 回复用户前检查结果
// ============================================================

/**
 * 自检 — AI 回复前检查结果是否完整
 */
export function selfCheck(
  userMessage: string,
  aiReply: string,
  toolsCalled: string[],
  filesChanged: string[],
): { passed: boolean; issues: string[]; suggestions: string[] } {
  const issues: string[] = [];
  const suggestions: string[] = [];
  
  // 检查 1: 用户要求创建文件但没创建
  const createMatch = userMessage.match(/创建|生成|新建|write|create/i);
  if (createMatch && filesChanged.length === 0) {
    issues.push('用户要求创建/生成, 但没有文件变更');
    suggestions.push('检查是否遗漏了 write_file 调用');
  }
  
  // 检查 2: 用户要求修复 bug 但没改代码
  const fixMatch = userMessage.match(/修复|fix|bug|解决|debug/i);
  if (fixMatch && filesChanged.length === 0) {
    issues.push('用户要求修复, 但没有修改任何文件');
    suggestions.push('可能需要定位问题文件并修改');
  }
  
  // 检查 3: AI 回复太短 (可能没说完)
  if (aiReply.length < 20 && toolsCalled.length === 0) {
    issues.push('回复过短且无工具调用');
    suggestions.push('可能需要更详细的回复或执行操作');
  }
  
  // 检查 4: AI 说要做什么但没做
  const promises = aiReply.match(/我将|我会|接下来|然后|首先.*创建|首先.*修改|马上/g) || [];
  if (promises.length > 2 && toolsCalled.length === 0) {
    issues.push(`回复中承诺了 ${promises.length} 个操作但没有执行任何工具`);
    suggestions.push('减少空谈, 直接执行');
  }
  
  // 检查 5: 回复中包含错误关键词
  if (aiReply.match(/undefined|NaN|\[object Object\]|Cannot read prop/i)) {
    issues.push('回复中疑似包含错误信息');
    suggestions.push('检查输出是否正确');
  }
  
  return {
    passed: issues.length === 0,
    issues,
    suggestions,
  };
}

// ============================================================
// 11. 实时学习 — 从当前对话的教训中学习
// ============================================================

interface Learnings {
  /** 本次对话中犯过的错误 */
  mistakes: { tool: string; error: string; fixApplied: string; ts: number }[];
  /** 用户纠正过的行为 */
  userCorrections: { pattern: string; correction: string; ts: number }[];
  /** 成功的模式 (可以复用) */
  successPatterns: { pattern: string; approach: string; ts: number }[];
}

// P1 修复: 按工作区隔离学习数据, 避免跨工作区经验污染
const sessionLearningsByWorkspace = new Map<string, Learnings>();

function getLearnings(workspace: string): Learnings {
  if (!sessionLearningsByWorkspace.has(workspace)) {
    sessionLearningsByWorkspace.set(workspace, { mistakes: [], userCorrections: [], successPatterns: [] });
  }
  return sessionLearningsByWorkspace.get(workspace)!;
}

// 兼容旧代码: 默认工作区
const sessionLearnings: Learnings = { mistakes: [], userCorrections: [], successPatterns: [] };

/**
 * 记录一次错误教训
 */
export function recordMistake(tool: string, error: string, fixApplied: string, workspace?: string) {
  const learnings = workspace ? getLearnings(workspace) : sessionLearnings;
  learnings.mistakes.push({ tool, error, fixApplied, ts: Date.now() });
}

/**
 * 记录一次成功模式
 */
export function recordSuccess(pattern: string, approach: string, workspace?: string) {
  const learnings = workspace ? getLearnings(workspace) : sessionLearnings;
  learnings.successPatterns.push({ pattern, approach, ts: Date.now() });
}

/**
 * 构建学习注入 — 让 AI 记住本次对话的教训
 */
export function buildLearningInjection(workspace?: string): string {
  const learnings = workspace ? getLearnings(workspace) : sessionLearnings;
  if (learnings.mistakes.length === 0 && learnings.successPatterns.length === 0) return '';
  
  const parts: string[] = ['[实时学习] 本次对话的经验:'];
  
  if (sessionLearnings.mistakes.length > 0) {
    parts.push('避免重复错误:');
    for (const m of sessionLearnings.mistakes.slice(-3)) {
      parts.push(`  ❌ ${m.tool}: ${m.error.slice(0, 80)} → 已修复: ${m.fixApplied.slice(0, 60)}`);
    }
  }
  
  if (sessionLearnings.successPatterns.length > 0) {
    parts.push('成功模式 (可复用):');
    for (const s of sessionLearnings.successPatterns.slice(-3)) {
      parts.push(`  ✅ ${s.pattern.slice(0, 50)} → ${s.approach.slice(0, 50)}`);
    }
  }
  
  return parts.join('\n');
}

// ============================================================
// 12. 最小可行优先 — 复杂任务先做 MVP
// ============================================================

/**
 * 判断是否应该先做 MVP
 */
export function shouldStartWithMVP(message: string): { shouldMVP: boolean; mvpScope: string; reason: string } {
  const msg = message.toLowerCase();
  
  // 大型项目信号
  const bigSignals = ['完整', '全部', '整个', '所有', '系统', '平台', '端到端', '从头到尾'];
  const isBig = bigSignals.some(s => msg.includes(s));
  
  // 多功能信号
  const features = (msg.match(/和|与|以及|同时|还需要|还要/g) || []).length;
  const isMultiFeature = features >= 2;
  
  if (isBig || isMultiFeature) {
    // 提取核心功能
    const coreMatch = msg.match(/(?:实现|开发|创建|做一个?|构建)\s*([^\s,，。]{2,20})/);
    const core = coreMatch ? coreMatch[1] : '核心功能';
    return {
      shouldMVP: true,
      mvpScope: `先实现最小可行版本: ${core}, 验证可用后再迭代添加其他功能`,
      reason: `检测到 ${isBig ? '大型任务' : '多功能任务'} (${features} 个功能点), 建议先做 MVP 降低风险`,
    };
  }
  
  return { shouldMVP: false, mvpScope: '', reason: '' };
}

// ============================================================
// 15. 多智能体智能调度 — 自动判断是否需要团队协作
// ============================================================

export interface TeamDispatchResult {
  /** 是否需要多智能体 */
  needsTeam: boolean;
  /** 推荐的团队 ID */
  teamId: string;
  /** 团队名称 */
  teamName: string;
  /** 工作流模式 */
  workflow: 'parallel' | 'sequential' | 'review';
  /** 推荐理由 */
  reason: string;
  /** 置信度 */
  confidence: number;
}

/**
 * 智能调度 — 根据任务内容自动判断是否需要多智能体协作
 */
export function dispatchTeam(message: string): TeamDispatchResult {
  const msg = message.toLowerCase();
  
  // 代码审查场景
  if (msg.match(/审查|review|code review|代码审查|检查代码|代码质量/i)) {
    return {
      needsTeam: true,
      teamId: 'code-review',
      teamName: '代码审查团队',
      workflow: 'parallel',
      reason: '检测到代码审查需求, 建议用 架构师+安全专家+性能专家 并行审查',
      confidence: 0.9,
    };
  }
  
  // 功能开发场景
  if (msg.match(/开发.*功能|实现.*功能|做一个.*系统|开发.*模块|新建.*项目/i) && msg.length > 30) {
    return {
      needsTeam: true,
      teamId: 'feature-dev',
      teamName: '功能开发团队',
      workflow: 'sequential',
      reason: '检测到功能开发需求, 建议用 架构师→前端→后端→测试 串行协作',
      confidence: 0.8,
    };
  }
  
  // Bug 修复场景
  if (msg.match(/修复.*bug|debug|排查.*问题|定位.*错误|线上.*故障/i) && msg.length > 20) {
    return {
      needsTeam: true,
      teamId: 'bug-fix',
      teamName: 'Bug修复团队',
      workflow: 'sequential',
      reason: '检测到 Bug 修复需求, 建议用 排查→修复→验证 串行协作',
      confidence: 0.85,
    };
  }
  
  // 文档生成场景
  if (msg.match(/写.*文档|生成.*文档|api文档|技术文档|使用说明/i)) {
    return {
      needsTeam: true,
      teamId: 'doc-team',
      teamName: '文档团队',
      workflow: 'parallel',
      reason: '检测到文档生成需求, 建议用 代码分析+文档生成 并行',
      confidence: 0.75,
    };
  }
  
  return { needsTeam: false, teamId: '', teamName: '', workflow: 'parallel', reason: '', confidence: 0 };
}

// ============================================================
// 16. 行业知识图谱 — 不同行业的专精知识
// ============================================================

export interface IndustryKnowledge {
  /** 行业 ID */
  industry: string;
  /** 行业名称 */
  name: string;
  /** 常见任务模式 */
  taskPatterns: { pattern: string; approach: string; tools: string[] }[];
  /** 行业术语映射 */
  terminology: Record<string, string>;
  /** 常用模板 */
  templates: { name: string; description: string; trigger: string }[];
}

const INDUSTRY_KB: Record<string, IndustryKnowledge> = {
  decoration: {
    industry: 'decoration',
    name: '装修行业',
    taskPatterns: [
      { pattern: '报价', approach: '按面积×单价+材料+人工+管理费计算', tools: ['run_code', 'write_file', 'generate_image'] },
      { pattern: '材料清单', approach: '按区域统计材料用量+品牌+规格+数量', tools: ['write_file', 'generate_image'] },
      { pattern: '施工图', approach: '平面图+立面图+节点大样', tools: ['generate_image', 'generate_diagram'] },
      { pattern: '预算', approach: '基础装修+主材+家具+家电+软装', tools: ['run_code', 'write_file'] },
    ],
    terminology: {
      '平米': '平方米面积', '半包': '人工+辅材', '全包': '人工+辅材+主材',
      '清包': '仅人工', '主材': '瓷砖/地板/门/洁具等', '辅材': '水泥/沙子/胶水等',
      '硬装': '不可移动的装修', '软装': '可移动的装饰', '隐蔽工程': '水电/防水',
    },
    templates: [
      { name: '报价单模板', description: 'Excel 格式, 含面积/单价/合价/备注', trigger: '报价|预算|报价单' },
      { name: '施工进度表', description: '甘特图格式, 含工序/工期/责任人', trigger: '施工|进度|工期' },
      { name: '材料清单', description: '按区域分类, 含品牌/规格/数量/单价', trigger: '材料|清单|采购' },
    ],
  },
  ecommerce: {
    industry: 'ecommerce',
    name: '电商行业',
    taskPatterns: [
      { pattern: '商品描述', approach: '卖点提炼+场景化描述+SEO关键词', tools: ['write_file'] },
      { pattern: '客服话术', approach: '常见问题+异议处理+促单话术', tools: ['write_file'] },
      { pattern: '数据分析', approach: '流量×转化×客单价×复购率', tools: ['run_code', 'write_file'] },
      { pattern: '活动策划', approach: '目标+主题+机制+预算+预期ROI', tools: ['write_file', 'generate_image'] },
    ],
    terminology: {
      'GMV': '成交总额', 'ROI': '投资回报率', 'SKU': '商品最小存货单位',
      '转化率': '访客→买家比例', '客单价': '每笔订单平均金额', '复购率': '再次购买比例',
      '私域': '自有流量池', '种草': '内容营销引导购买', '带货': '直播/视频销售',
    },
    templates: [
      { name: '商品详情页', description: '主图+卖点+参数+评价+FAQ', trigger: '商品描述|详情页|产品页' },
      { name: '客服话术本', description: '售前+售中+售后话术', trigger: '客服|话术|回复' },
      { name: '活动方案', description: '目标+机制+预算+ROI', trigger: '活动|促销|营销' },
    ],
  },
  education: {
    industry: 'education',
    name: '教育行业',
    taskPatterns: [
      { pattern: '课件生成', approach: '知识点+案例+练习+总结', tools: ['write_file', 'generate_image', 'generate_diagram'] },
      { pattern: '出卷', approach: '知识点分布+难度梯度+题型搭配', tools: ['write_file'] },
      { pattern: '学习路径', approach: '前置知识+核心知识+进阶+实战', tools: ['write_file', 'generate_diagram'] },
      { pattern: '教学报告', approach: '学习数据+薄弱点+建议', tools: ['run_code', 'write_file'] },
    ],
    terminology: {
      'K12': '中小学教育', 'STEAM': '科学/技术/工程/艺术/数学',
      '翻转课堂': '课前学习+课上讨论', '形成性评价': '过程性评估', '布鲁姆': '认知层次分类',
    },
    templates: [
      { name: '课件模板', description: 'PPT格式, 含知识点+案例+练习', trigger: '课件|PPT|教案' },
      { name: '试卷模板', description: '含题目+答案+评分标准', trigger: '试卷|出题|考试' },
      { name: '学习路径图', description: '流程图格式, 含前置+核心+进阶', trigger: '学习路径|课程规划' },
    ],
  },
};

/**
 * 检测用户所属行业
 */
export function detectIndustry(message: string, workspace: string): string | null {
  const msg = message.toLowerCase();
  
  // 装修行业信号
  if (msg.match(/装修|装饰|报价|施工|材料|平米|硬装|软装|隐蔽工程|报价单/i) ||
      workspace.match(/装修|装饰|decoration/i)) {
    return 'decoration';
  }
  
  // 电商行业信号
  if (msg.match(/商品|店铺|客服|GMV|ROI|SKU|转化率|客单价|带货|种草|私域/i) ||
      workspace.match(/电商|ecommerce|shop|store/i)) {
    return 'ecommerce';
  }
  
  // 教育行业信号
  if (msg.match(/课件|教案|试卷|学生|教学|课程|K12|STEAM|学习路径/i) ||
      workspace.match(/教育|education|course|learn/i)) {
    return 'education';
  }
  
  return null;
}

/**
 * 构建行业知识注入
 */
export function buildIndustryContext(message: string, workspace: string): string {
  const industryId = detectIndustry(message, workspace);
  if (!industryId) return '';
  
  const kb = INDUSTRY_KB[industryId];
  if (!kb) return '';
  
  const parts: string[] = [`[行业知识] ${kb.name}`];
  
  // 匹配的任务模式
  const msg = message.toLowerCase();
  const matchedPatterns = kb.taskPatterns.filter(p => msg.includes(p.pattern));
  if (matchedPatterns.length > 0) {
    parts.push('任务模式:');
    for (const p of matchedPatterns.slice(0, 3)) {
      parts.push(`  ${p.pattern}: ${p.approach}`);
    }
  }
  
  // 匹配的模板
  const matchedTemplates = kb.templates.filter(t => {
    const triggers = t.trigger.split('|');
    return triggers.some(t => msg.includes(t));
  });
  if (matchedTemplates.length > 0) {
    parts.push('可用模板:');
    for (const t of matchedTemplates.slice(0, 3)) {
      parts.push(`  ${t.name}: ${t.description}`);
    }
  }
  
  return parts.length > 1 ? parts.join('\n') : '';
}

// ============================================================
// 17. AI 自我改进 — 从用户反馈中学习
// ============================================================

interface FeedbackRecord {
  /** 用户消息 */
  userMessage: string;
  /** AI 回复摘要 */
  aiReplySummary: string;
  /** 反馈类型: up/down */
  feedback: 'up' | 'down';
  /** 时间戳 */
  ts: number;
  /** 改进建议 (从负面反馈中提取) */
  improvement?: string;
}

// P1 修复: feedbackHistory 按工作区隔离
const feedbackHistoryByWorkspace = new Map<string, FeedbackRecord[]>();

function getFeedbackHistory(workspace: string): FeedbackRecord[] {
  if (!feedbackHistoryByWorkspace.has(workspace)) {
    feedbackHistoryByWorkspace.set(workspace, []);
  }
  return feedbackHistoryByWorkspace.get(workspace)!;
}

// 兼容旧代码
const feedbackHistory: FeedbackRecord[] = [];

/**
 * 记录用户反馈
 */
export function recordFeedback(userMessage: string, aiReply: string, feedback: 'up' | 'down', workspace?: string) {
  const history = workspace ? getFeedbackHistory(workspace) : feedbackHistory;
  const record: FeedbackRecord = {
    userMessage: userMessage.slice(0, 200),
    aiReplySummary: aiReply.slice(0, 200),
    feedback,
    ts: Date.now(),
  };
  
  if (feedback === 'down') {
    // 从负面反馈中提取改进建议
    if (aiReply.length > 500) {
      record.improvement = '回复过长, 应更简洁';
    } else if (aiReply.length < 20) {
      record.improvement = '回复过短, 需要更详细';
    } else if (!aiReply.match(/```|代码|code|function/i) && userMessage.match(/代码|code|实现|开发/i)) {
      record.improvement = '用户要代码但回复中没有代码块';
    } else if (aiReply.match(/抱歉|对不起|无法|不能|sorry|cannot/i)) {
      record.improvement = '回复中含拒绝语句, 应尝试替代方案';
    } else {
      record.improvement = '用户不满意, 需分析具体原因';
    }
  }
  
  feedbackHistory.push(record);
}

/**
 * 构建自我改进注入 — 从历史反馈中提取教训
 */
export function buildSelfImprovementContext(workspace?: string): string {
  const history = workspace ? getFeedbackHistory(workspace) : feedbackHistory;
  if (history.length < 2) return '';
  
  const negative = history.filter(f => f.feedback === 'down');
  if (negative.length === 0) return '';
  
  const improvements = negative
    .filter(f => f.improvement)
    .slice(-3)
    .map(f => f.improvement);
  
  if (improvements.length === 0) return '';
  
  const uniqueImprovements = [...new Set(improvements)];
  return `[自我改进] 基于 ${negative.length} 条负面反馈:
${uniqueImprovements.map(i => `  ⚠️ ${i}`).join('\n')}
请在本次回复中避免这些问题。`;
}

// ============================================================
// 23. Lint 驱动修复 — 写完代码立即检查编译错误
// ============================================================

/**
 * 生成 lint 检查指令 — 写完代码后注入
 */
export function buildLintCheckDirective(filePath: string): string {
  return `[SYSTEM] 刚修改了 ${path.basename(filePath)}。请立即检查是否有编译/lint 错误。如果有, 立即修复, 不要留到最后。`;
}

// ============================================================
// 24. 保守方案选择器 — 不确定时选不破坏现有功能的方案
// ============================================================

export interface ConservativeChoice {
  /** 选择的方案 */
  choice: 'safe' | 'aggressive' | 'ask';
  /** 理由 */
  reason: string;
  /** 风险评估 */
  risk: string;
}

/**
 * 保守方案选择 — 面对多种方案时, 优先选不破坏现有功能的
 */
export function chooseConservative(options: { name: string; breaksExisting: boolean; complexity: number }[]): ConservativeChoice {
  if (options.length === 0) {
    return { choice: 'ask', reason: '没有可用方案', risk: '无法评估' };
  }
  
  // 优先选不破坏现有功能 + 复杂度低的
  const safe = options.filter(o => !o.breaksExisting);
  if (safe.length > 0) {
    const simplest = safe.sort((a, b) => a.complexity - b.complexity)[0];
    return {
      choice: 'safe',
      reason: `选择 "${simplest.name}" — 不破坏现有功能, 复杂度最低 (${simplest.complexity})`,
      risk: '低 — 不影响已有功能',
    };
  }
  
  // 所有方案都会破坏现有功能 → 问用户
  return {
    choice: 'ask',
    reason: `所有 ${options.length} 个方案都可能影响现有功能, 需用户确认`,
    risk: '高 — 所有方案都有破坏性',
  };
}

// ============================================================
// 25. 最小改动原则 — 改代码时只改必要的行
// ============================================================

/**
 * 检查改动是否最小化 — 对比改动前后的行数差异
 */
export function checkMinimalChange(oldContent: string, newContent: string): {
  isMinimal: boolean;
  changedLines: number;
  totalLines: number;
  ratio: number;
  suggestion: string;
} {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const maxLen = Math.max(oldLines.length, newLines.length);
  
  let changed = 0;
  for (let i = 0; i < maxLen; i++) {
    if (oldLines[i] !== newLines[i]) changed++;
  }
  
  const ratio = maxLen > 0 ? changed / maxLen : 0;
  const isMinimal = ratio < 0.3; // 改动不超过 30% 算最小
  
  let suggestion = '';
  if (!isMinimal) {
    suggestion = `改动 ${changed}/${maxLen} 行 (${(ratio * 100).toFixed(0)}%), 超过 30%。考虑: 是否可以只改必要的部分? 用 string_replace 替代 write_file?`;
  }
  
  return { isMinimal, changedLines: changed, totalLines: maxLen, ratio, suggestion };
}

// ============================================================
// 26. 并行读取建议 — 多文件操作时建议并行
// ============================================================

/**
 * 检测是否可以并行读取多个文件
 */
export function suggestParallelReads(message: string, files: string[]): {
  shouldParallel: boolean;
  files: string[];
  reason: string;
} {
  // 如果消息涉及多个文件且有"对比/检查/修改"意图
  const multiFileIntent = message.match(/对比|比较|检查.*所有|修改.*这些|批量|全部/i);
  if (multiFileIntent && files.length >= 2 && files.length <= 10) {
    return {
      shouldParallel: true,
      files,
      reason: `检测到多文件操作 (${files.length} 个文件), 建议并行读取以提升速度`,
    };
  }
  return { shouldParallel: false, files: [], reason: '' };
}

// ============================================================
// 27. Grep 优先策略 — 大文件先 grep 关键词再读
// ============================================================

/**
 * 判断是否应该先 grep 而不是直接读全文
 */
export function shouldGrepFirst(filePath: string, fileSize: number): {
  shouldGrep: boolean;
  keywords: string[];
  reason: string;
} {
  // 超过 200 行的文件建议先 grep
  if (fileSize > 200) {
    return {
      shouldGrep: true,
      keywords: [], // 由 AI 根据任务决定搜什么
      reason: `文件较大 (${fileSize} 行), 建议先 grep 关键词定位, 再用 read_file offset 读取相关部分, 避免读取全文浪费上下文`,
    };
  }
  return { shouldGrep: false, keywords: [], reason: '' };
}

// ============================================================
// 28. 编译错误归因 — 分析是哪个改动导致了编译错误
// ============================================================

/**
 * 从编译错误信息中归因到具体改动
 */
export function attributeError(errorMsg: string, recentChanges: { file: string; linesChanged: number[] }[]): {
  attributedFile: string | null;
  confidence: number;
  suggestion: string;
} {
  // 从错误信息中提取文件名
  const fileMatch = errorMsg.match(/([^\s]+\.(?:ts|tsx|js|jsx))\(\d+,\d+\)/);
  if (fileMatch) {
    const errorFile = fileMatch[1].replace(/\\/g, '/');
    const basename = path.basename(errorFile);
    
    // 在最近改动的文件中查找
    const match = recentChanges.find(c => c.file.includes(basename) || basename.includes(path.basename(c.file)));
    if (match) {
      return {
        attributedFile: match.file,
        confidence: 0.9,
        suggestion: `编译错误来自 ${basename}, 这是刚刚修改过的文件。请检查改动是否引入了类型错误或语法错误。`,
      };
    }
  }
  
  // 从错误类型推断
  if (errorMsg.match(/Cannot find module|Module not found/i)) {
    return {
      attributedFile: null,
      confidence: 0.7,
      suggestion: '模块缺失错误, 可能是最近的改动引入了新的 import 但没有安装对应依赖。',
    };
  }
  if (errorMsg.match(/Type .* is not assignable/i)) {
    return {
      attributedFile: null,
      confidence: 0.6,
      suggestion: '类型不匹配错误, 可能是改动后类型签名不一致。检查函数参数/返回值类型。',
    };
  }
  
  return { attributedFile: null, confidence: 0.3, suggestion: '无法确定错误来源, 建议检查最近的文件改动。' };
}

// ============================================================
// 29. 回复简洁性检查 — 回复不应啰嗦
// ============================================================

/**
 * 检查回复是否简洁 — 太长的回复应该精简
 */
export function checkReplyConciseness(reply: string): {
  isConcise: boolean;
  issues: string[];
  suggestion: string;
} {
  const issues: string[] = [];
  
  // 超过 2000 字符
  if (reply.length > 2000) {
    issues.push(`回复 ${reply.length} 字符, 超过 2000, 应精简`);
  }
  
  // 重复内容检测
  const sentences = reply.split(/[。.\n]/).filter(s => s.trim().length > 10);
  const seen = new Set<string>();
  for (const s of sentences) {
    const key = s.trim().slice(0, 30);
    if (seen.has(key)) {
      issues.push(`重复内容: "${key}..."`);
      break;
    }
    seen.add(key);
  }
  
  // 过多"我将/我会"
  const promises = (reply.match(/我将|我会|接下来我|然后我/g) || []).length;
  if (promises > 3) {
    issues.push(`"我将/我会" 出现 ${promises} 次, 减少空谈直接做`);
  }
  
  // 过多表情符号
  const emojis = (reply.match(/😀|😎|🤔|💪|👍|🎉|🚀/g) || []).length;
  if (emojis > 5) {
    issues.push(`表情符号 ${emojis} 个, 减少表情保持专业`);
  }
  
  return {
    isConcise: issues.length === 0,
    issues,
    suggestion: issues.length > 0 ? `回复不够简洁: ${issues.join('; ')}` : '',
  };
}

// ============================================================
// 30. 改动复查 — 改完后重新读一遍确认逻辑
// ============================================================

/**
 * 生成改动复查指令
 */
export function buildReviewDirective(filesChanged: string[]): string {
  if (filesChanged.length === 0) return '';
  const fileList = filesChanged.slice(0, 5).map(f => path.basename(f)).join(', ');
  return `[SYSTEM] 刚修改了 ${filesChanged.length} 个文件 (${fileList})。请重新读一遍改动部分, 确认: 1) 逻辑正确 2) 没有遗漏 3) 没有引入新问题。如果发现问题立即修复。`;
}

// ============================================================
// 31. 不确定优先问 — 不确定时问用户而不是猜
// ============================================================

/**
 * 检测 AI 是否应该问用户而不是猜
 */
export function shouldAskUser(message: string, context: { hasMultipleInterpretations: boolean; lacksCriticalInfo: boolean }): {
  shouldAsk: boolean;
  question: string;
  reason: string;
} {
  if (context.lacksCriticalInfo) {
    return {
      shouldAsk: true,
      question: '请提供更多细节',
      reason: '缺少关键信息, 猜测可能导致方向错误',
    };
  }
  if (context.hasMultipleInterpretations) {
    return {
      shouldAsk: true,
      question: '请确认您想要的是哪种方案',
      reason: '有多种可能的解释, 确认比猜测更高效',
    };
  }
  return { shouldAsk: false, question: '', reason: '' };
}

// ============================================================
// 32. 目录优先策略 — 搜索前先看目录结构
// ============================================================

/**
 * 建议先看目录再搜索
 */
export function suggestDirectoryFirst(message: string, hasWorkspaceIndex: boolean): string {
  const needsDirScan = message.match(/搜索|查找|找|在哪|哪里|search|find/i);
  if (needsDirScan && !hasWorkspaceIndex) {
    return `[SYSTEM] 搜索前建议先调用 list_directory 查看项目目录结构, 了解代码组织方式后再精准搜索, 避免盲目搜索。`;
  }
  return '';
}
