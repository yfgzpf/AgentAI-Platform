/**
 * TokenCompressor — 工具输出语义压缩
 * ----------------------------------------------------
 * 学习 RTK (Rust Token Killer) 的 Token 压缩思想:
 *   1. 噪音过滤 — 去掉 ANSI 转义码、空行、无意义的 repeated prefixes
 *   2. 结构化分组 — 同类工具输出合并且去重
 *   3. 重复折叠 — 合并相似的连续行
 *   4. 智能截断 — 对超长输出的头尾保留、中间截断
 *
 * 插入点: agentai-loop.ts dispatchToolCalls 的 appendOnlyLog push 之前
 *
 * 预估效果: 节省 70-85% 工具输出的 token 消耗
 * 不对 LLM 的输出做压缩 (LLM 输出是自然语言, 压缩会丢失语义)
 *
 * 安全承诺:
 *   - 不丢失关键信息 (错误信息完整保留)
 *   - 不影响 LLM 理解 (保留结构化标记)
 *   - 不引入额外 LLM 调用 (纯本地算法)
 */

// ===== 配置 =====
export interface CompressorConfig {
  /** 是否启用 */
  enabled: boolean;
  /** 单条工具输出超过此字符数才压缩 (默认 1000) */
  minCharsToCompress: number;
  /** 截断模式: 保留头部 + 尾部各多少字符 (默认 500/200) */
  headKeep: number;
  tailKeep: number;
  /** 是否过滤 ANSI 终端颜色码 */
  stripAnsi: boolean;
  /** 是否压缩连续空行 */
  collapseBlankLines: boolean;
  /** 是否折叠重复行 */
  foldRepeats: boolean;
  /** 是否压缩 list_directory / directory_tree 输出 */
  compressLargeListings: boolean;
}

const DEFAULT_CONFIG: CompressorConfig = {
  enabled: true,
  minCharsToCompress: 1000,
  headKeep: 500,
  tailKeep: 200,
  stripAnsi: true,
  collapseBlankLines: true,
  foldRepeats: true,
  compressLargeListings: true,
};

// ===== 公共: 压缩单条工具输出 =====

export interface CompressResult {
  /** 压缩后的文本 */
  compressed: string;
  /** 压缩前字符数 */
  before: number;
  /** 压缩后字符数 */
  after: number;
  /** 节省百分比 */
  savedPercent: number;
  /** 是否执行了压缩 */
  wasCompressed: boolean;
}

/**
 * 压缩单条工具输出
 * @param output 原始工具输出
 * @param toolName 工具名称 (用于策略选择)
 * @param config 压缩配置 (可选)
 */
export function compressToolOutput(
  output: string | undefined | null,
  toolName: string,
  config: Partial<CompressorConfig> = {},
): CompressResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (!cfg.enabled) return noCompress(output);
  if (!output || output.length < cfg.minCharsToCompress) {
    return noCompress(output);
  }

  const before = output.length;
  let result = output;

  // 1. 噪音过滤: ANSI 转义码
  if (cfg.stripAnsi) {
    result = stripAnsiCodes(result);
  }

  // 2. 噪音过滤: 空行压缩
  if (cfg.collapseBlankLines) {
    result = collapseBlankLinesFn(result);
  }

  // 3. 策略: ContentRouter 自动检测内容类型 + 选择最优压缩器 (Headroom 算法)
  result = routeAndCompress(result, toolName, cfg);

  // 4. 重复折叠 (非代码输出)
  if (cfg.foldRepeats && !isCodeOutput(toolName)) {
    result = foldRepeatedLines(result);
  }

  const after = result.length;
  const savedPercent = before > 0 ? Math.round(((before - after) / before) * 100) : 0;

  return {
    compressed: result,
    before,
    after,
    savedPercent,
    wasCompressed: before !== after,
  };
}

/**
 * 批量压缩: 对 dispatchToolCalls 的全部结果做压缩
 * @param results 原始结果数组 { id, name, output }
 * @param config 压缩配置
 * @returns 压缩后的结果数组 (output 被替换为 compressed)
 */
export function compressAllToolResults<T extends { id: string; name: string; output: string }>(
  results: T[],
  config: Partial<CompressorConfig> = {},
): { results: T[]; stats: CompressStats } {
  const stats: CompressStats = { totalBefore: 0, totalAfter: 0, compressedCount: 0 };
  const compressed = results.map(r => {
    const cr = compressToolOutput(r.output, r.name, config);
    stats.totalBefore += cr.before;
    stats.totalAfter += cr.after;
    if (cr.wasCompressed) stats.compressedCount++;
    return { ...r, output: cr.compressed };
  });
  return { results: compressed, stats };
}

export interface CompressStats {
  totalBefore: number;
  totalAfter: number;
  compressedCount: number;
}

// ===== 内部实现 =====

/** 不压缩的占位结果 */
function noCompress(output: string | undefined | null): CompressResult {
  const len = output?.length || 0;
  return { compressed: output || '', before: len, after: len, savedPercent: 0, wasCompressed: false };
}

/** 去掉 ANSI 转义码 (终端颜色等) */
function stripAnsiCodes(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\]8;;.*?\x1b\\/g, '');
}

/** 压缩连续空行: 连续3空行→1空行 */
function collapseBlankLinesFn(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n');
}

/** 是否是目录列表类工具 */
function isDirectoryListing(name: string): boolean {
  return /^(list_directory|directory_tree|list_files|ls|dir)$/i.test(name);
}

/** 是否是代码/运行类工具 (输出不应压缩) */
function isCodeOutput(name: string): boolean {
  return /^(run_code|read_file|exec|bash|shell|python)$/i.test(name);
}

/** 是否是错误输出 (应完整保留) */
function isErrorOutput(text: string): boolean {
  // 检测错误关键词，但不在开头就判为错误 — 很多正常输出也包含 "error" 字符串
  const firstLine = text.split('\n')[0] || '';
  return /^(Error|\[ERROR\]|SyntaxError|TypeError|ReferenceError|ModuleNotFoundError|ImportError|ENOENT|EACCES|EPERM)/i.test(firstLine);
}

/** 压缩目录列表: 保留前N后M条 */
function compressDirectoryListing(listing: string): string {
  const lines = listing.split('\n');
  if (lines.length <= 30) return listing;

  const headCount = 15;
  const tailCount = 10;
  const total = lines.length;
  const skipped = total - headCount - tailCount;

  return [
    ...lines.slice(0, headCount),
    `... [共 ${total} 条, 省略中间 ${skipped} 条] ...`,
    ...lines.slice(-tailCount),
  ].join('\n');
}

/** 压缩代码/日志输出: 保留头尾 (始终保留尾部, 因为代码运行结果通常在最后) */
function compressCodeOutput(text: string, cfg: CompressorConfig): string {
  if (text.length <= cfg.headKeep + cfg.tailKeep) return text;

  const head = text.slice(0, cfg.headKeep);
  const tail = text.slice(-cfg.tailKeep);
  const skipped = text.length - cfg.headKeep - cfg.tailKeep;

  return `${head}\n\n... [省略 ${skipped} 字符] ...\n\n${tail}`;
}

/** 智能截断: 通用版 */
function smartTruncate(text: string, cfg: CompressorConfig): string {
  if (text.length <= cfg.headKeep + cfg.tailKeep) return text;

  const head = text.slice(0, cfg.headKeep);
  const tail = text.slice(-cfg.tailKeep);
  const skipped = text.length - cfg.headKeep - cfg.tailKeep;
  return `${head}\n\n... [省略 ${skipped} 字符] ...\n\n${tail}`;
}

/** 折叠重复行: 连续3行相同→1行+重复标记 */
function foldRepeatedLines(text: string): string {
  const lines = text.split('\n');
  if (lines.length < 5) return text;

  const result: string[] = [];
  let repeatCount = 0;
  let lastLine = '';

  for (const line of lines) {
    if (line === lastLine && line.trim().length > 0) {
      repeatCount++;
      if (repeatCount === 3) {
        // 第三行替换为折叠标记
        result.pop(); // 移除第二行
        result.pop(); // 移除第一行
        result.push(line);
        result.push(`[以上行重复 ${repeatCount + 1} 次]`);
        continue;
      }
      if (repeatCount > 2) {
        continue; // 继续跳过
      }
    } else {
      repeatCount = 0;
      lastLine = line;
    }
    result.push(line);
  }

  return result.join('\n');
}

// ===== Headroom 核心压缩算法 (内置实现, 无外部依赖) =====

/**
 * SmartCrusher — JSON 智能压缩
 * 去除冗余 key, 压缩重复结构, 保留语义
 * 压缩率: 50-80% (JSON 工具输出)
 */
function crushJson(text: string): string {
  try {
    const obj = JSON.parse(text);
    return crushJsonValue(obj, 0);
  } catch {
    return text; // 不是有效 JSON, 返回原文
  }
}

function crushJsonValue(val: any, depth: number): string {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'string') {
    // 长字符串截断
    if (val.length > 200) return JSON.stringify(val.slice(0, 150) + '...[truncated]');
    return JSON.stringify(val);
  }
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);

  if (Array.isArray(val)) {
    if (val.length === 0) return '[]';
    // 同构数组: 只保留前2个 + 总数
    if (val.length > 3 && typeof val[0] === 'object' && val[0] !== null) {
      const sample = val.slice(0, 2).map(v => crushJsonValue(v, depth + 1));
      return `[${sample.join(',')},...${val.length - 2} more]`;
    }
    // 简单数组: 全部保留但递归压缩
    if (val.length > 10) {
      const head = val.slice(0, 5).map(v => crushJsonValue(v, depth + 1));
      const tail = val.slice(-2).map(v => crushJsonValue(v, depth + 1));
      return `[${head.join(',')},...${val.length - 7} more...,${tail.join(',')}]`;
    }
    return `[${val.map((v: any) => crushJsonValue(v, depth + 1)).join(',')}]`;
  }

  if (typeof val === 'object') {
    const keys = Object.keys(val);
    if (keys.length === 0) return '{}';
    // 去除无信息 key (null/空串/空数组)
    const meaningful = keys.filter(k => {
      const v = val[k];
      return v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);
    });
    // 深层嵌套: 只保留 key 列表
    if (depth > 3) {
      return `{${meaningful.map(k => `${k}:...`).join(',')}}`;
    }
    const parts = meaningful.map(k => `${k}:${crushJsonValue(val[k], depth + 1)}`);
    return `{${parts.join(',')}}`;
  }

  return String(val);
}

/**
 * CodeCompressor — 代码智能压缩
 * 去注释, 压缩空行, 折叠 import 块, 保留结构
 * 压缩率: 30-60% (代码文件)
 */
function compressCode(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let inBlockComment = false;
  let importBlock: string[] = [];
  let blankCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // 块注释
    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlockComment = true;
      continue;
    }

    // 单行注释 (保留 eslint/ts 指令)
    if (/^\/\//.test(trimmed) && !/eslint|@ts-|prettier|istanbul/.test(trimmed)) {
      continue;
    }
    // Python 注释
    if (/^#(?!!)/.test(trimmed) && !/type:|noqa|pragma/.test(trimmed)) {
      continue;
    }

    // 空行: 最多保留1行
    if (!trimmed) {
      blankCount++;
      if (blankCount <= 1) result.push('');
      continue;
    }
    blankCount = 0;

    // import 块折叠
    if (/^(import |from |require\(|const .* = require)/.test(trimmed)) {
      importBlock.push(trimmed);
      continue;
    }
    if (importBlock.length > 0) {
      if (importBlock.length <= 3) {
        result.push(...importBlock);
      } else {
        result.push(importBlock[0]);
        result.push(`// ... ${importBlock.length - 1} more imports`);
      }
      importBlock = [];
    }

    result.push(line);
  }

  // 残余 import
  if (importBlock.length > 0) {
    if (importBlock.length <= 3) {
      result.push(...importBlock);
    } else {
      result.push(importBlock[0]);
      result.push(`// ... ${importBlock.length - 1} more imports`);
    }
  }

  return result.join('\n');
}

/**
 * ContentRouter — 自动检测内容类型, 选择最优压缩器
 * 替代原有的简单 isCodeOutput / isDirectoryListing 判断
 */
function routeAndCompress(text: string, toolName: string, cfg: CompressorConfig): string {
  // 检测内容类型
  const contentType = detectContentType(text);

  switch (contentType) {
    case 'json':
      return crushJson(text);
    case 'code':
      return compressCode(text);
    case 'directory':
      return compressDirectoryListing(text);
    case 'error':
      return text; // 错误信息完整保留
    case 'log':
      return compressLogOutput(text, cfg);
    default:
      return smartTruncate(text, cfg);
  }
}

type ContentType = 'json' | 'code' | 'directory' | 'log' | 'error' | 'text';

function detectContentType(text: string): ContentType {
  const trimmed = text.trim();

  // 错误优先
  if (isErrorOutput(text)) return 'error';

  // JSON
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try { JSON.parse(trimmed); return 'json'; } catch { /* not valid json */ }
  }

  // 代码特征
  const codeSignals = [
    /^(import |from |const |let |var |function |class |def |pub fn |async fn)/m,
    /^(export |module\.exports|package |using |#include)/m,
    /[{}\[\]();]$/.test(trimmed.split('\n').slice(0, 10).join('')),
  ];
  const codeScore = codeSignals.filter(Boolean).length;
  if (codeScore >= 2) return 'code';

  // 目录列表
  if (/^[├└│─┬ ]+/.test(trimmed) || /^\d+ files?/.test(trimmed) || /^(total |drwx|[-rwx]{10})/.test(trimmed)) {
    return 'directory';
  }

  // 日志
  if (/^\[\d{4}-\d{2}-\d{2}|^\d{4}\/\d{2}\/\d{2}|^\[INFO\]|^\[WARN\]|^\[ERROR\]|^\[DEBUG\]/m.test(trimmed)) {
    return 'log';
  }

  return 'text';
}

/** 日志输出压缩: 去重 + 保留首尾 + 统计 */
function compressLogOutput(text: string, cfg: CompressorConfig): string {
  const lines = text.split('\n');
  if (lines.length <= 20) return text;

  // 去重相邻日志
  const deduped: string[] = [];
  let lastKey = '';
  let repeatCount = 0;
  for (const line of lines) {
    // 提取日志级别 + 消息 (去掉时间戳)
    const key = line.replace(/^\[?\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}:\d{2}[.\d]*\]?\s*/g, '').trim();
    if (key === lastKey && key.length > 0) {
      repeatCount++;
      continue;
    }
    if (repeatCount > 0) {
      deduped.push(`  [×${repeatCount + 1}]`);
      repeatCount = 0;
    }
    deduped.push(line);
    lastKey = key;
  }
  if (repeatCount > 0) deduped.push(`  [×${repeatCount + 1}]`);

  // 还是太长? 头尾保留
  if (deduped.length > 30) {
    return [
      ...deduped.slice(0, 15),
      `... [省略 ${deduped.length - 20} 行日志] ...`,
      ...deduped.slice(-5),
    ].join('\n');
  }

  return deduped.join('\n');
}
