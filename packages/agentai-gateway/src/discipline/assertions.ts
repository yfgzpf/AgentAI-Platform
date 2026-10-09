/**
 * Discipline — 验收断言器 (Execution Assertor)
 * ----------------------------------------------------
 * 治未病：动手之前先把「怎么算完成」写成机器可执行的断言，
 * 而不是让模型自己说「我完成了」。
 *
 * 核心问题（2026-10-09 实测）：
 *   goal-runner.ts 的 acceptanceCriteria 只是一个 string，
 *   被拼进 prompt 文本里，零处机器校验。
 *   → 模型说「完成了」就算完成，这是所有失控的总根源。
 *
 * 本模块把验收标准从「建议」升级为「断言」。
 *
 * 设计要点：
 *   1. 纯函数式：verifyAsserts 不产生副作用，可单测
 *   2. 命令执行带白名单 + 超时 + 输出截断，避免断言本身成为攻击面
 *   3. 内置断言集 = 把资深工程师每轮必做的检查固化成代码
 *   4. 向后兼容：字符串形式的验收标准自动降级为 llmJudge，不破坏 goal-runner
 *
 * 中医对应：
 *   常慎微 — 每个阶段都有断言，不等到大错才发现
 *   善诊者察内外 — 机器校验不依赖「我觉得对不对」
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// ===== 类型定义 =====

/** 命令断言：跑一条命令，看退出码 */
export interface CommandAssert {
  kind: 'command';
  /** 要执行的命令 */
  cmd: string;
  /** 期望结果 */
  expect: 'exit0' | 'exitN' | 'contains' | 'notContains';
  /** expect='exitN' 时的期望退出码 */
  exitCode?: number;
  /** expect='contains' 时期望输出包含的字符串 */
  output?: string;
  /** 超时（毫秒），默认 120s */
  timeoutMs?: number;
  /** 失败时的说明 */
  description?: string;
}

/** 文件内容 grep 断言 */
export interface GrepAssert {
  kind: 'grep';
  /** 正则或字面量 */
  pattern: string;
  /** 搜索路径（文件或目录） */
  path: string;
  /** 期望结果 */
  expect: 'found' | 'absent';
  /** 至少命中次数（expect='found' 时生效），默认 1 */
  minCount?: number;
  /** 是否按正则解析，默认 true */
  regex?: boolean;
  description?: string;
}

/** 文件存在性断言 */
export interface FileAssert {
  kind: 'fileExists' | 'fileAbsent';
  path: string;
  description?: string;
}

/** 行数断言：用于「代码量不得增长」「不得为负」这类约束 */
export interface LineCountAssert {
  kind: 'lineCount';
  path: string;
  mode: 'lte' | 'gte' | 'eq';
  value: number;
  description?: string;
}

/** 目录 diff 断言：绿区不得被改动 */
export interface DirCleanAssert {
  kind: 'dirClean';
  /** 目录路径 */
  path: string;
  /** git ref，默认与 HEAD 比较 */
  since?: string;
  description?: string;
}

/** LLM 判定断言：语义类无法用命令表达的兜底 */
export interface LlmJudgeAssert {
  kind: 'llmJudge';
  /** 评判标准 */
  rubric: string;
  /** 待判定内容 */
  content?: string;
  /** 通过阈值 0-1，默认 0.7 */
  threshold?: number;
  description?: string;
}

export type AcceptanceAssert =
  | CommandAssert
  | GrepAssert
  | FileAssert
  | LineCountAssert
  | DirCleanAssert
  | LlmJudgeAssert;

// ===== 验证结果 =====

export interface AssertResult {
  /** 断言的描述（用于报告） */
  label: string;
  passed: boolean;
  /** 实际观测到的内容（截断） */
  observed: string;
  /** 失败原因 */
  reason?: string;
  /** 耗时 ms */
  durationMs: number;
  /** 是否可跳过（例如缺少环境依赖） */
  skipped?: boolean;
}

export interface GateResult {
  passed: boolean;
  results: AssertResult[];
  /** 失败项数 */
  failedCount: number;
  /** 跳过项数 */
  skippedCount: number;
  totalMs: number;
}

export interface RunContext {
  /** 工作目录，默认为 process.cwd() */
  cwd?: string;
  /** 传给 llmJudge 的判定函数（由调用方注入，避免本模块依赖 LLM） */
  llmJudge?: (rubric: string, content: string, threshold: number) => Promise<{ pass: boolean; score: number; reason?: string }>;
  /** 传入 llmJudge 的内容 */
  judgeContent?: string;
  /** 单条断言默认超时 */
  defaultTimeoutMs?: number;
}

export interface StageGate {
  /** 阶段标识 */
  stageKey: string;
  /** 断言列表 */
  asserts: AcceptanceAssert[];
  /** 失败时的处理策略，默认 'halt' */
  onFail?: 'halt' | 'retry' | 'rollbackAndHalt';
  /** 最大重试次数，默认 2 */
  maxRetries?: number;
}

// ===== 常量 =====

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 2000;

/**
 * 命令白名单：断言层只允许跑这些命令前缀。
 * 断言是「验证」不是「执行」，不能让 LLM 用它当任意命令执行器。
 */
const CMD_ALLOWLIST = [
  'npx tsc',
  'npx vitest',
  'npx vite build',
  'npm test',
  'npm run',
  'pnpm',
  'node scripts/',
  'git status',
  'git diff',
  'git log',
  'git grep',
  'git ls-files',
  'git rev-parse',
  'git --version',
  'git branch',
  'git show',
  'ls ',
  'test -',
  'wc ',
];

function isCmdAllowed(cmd: string): boolean {
  const normalized = cmd.trim();
  return CMD_ALLOWLIST.some(prefix => normalized.startsWith(prefix));
}

function truncate(s: string, max = MAX_OUTPUT_CHARS): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n...[truncated ${s.length - max} chars]`;
}

// ===== 单条断言执行 =====

/**
 * 执行单条断言（纯函数，无副作用）
 */
export async function verifyAssert(
  assert: AcceptanceAssert,
  ctx: RunContext = {},
): Promise<AssertResult> {
  const started = Date.now();
  const cwd = ctx.cwd || process.cwd();
  const timeout = ctx.defaultTimeoutMs || DEFAULT_TIMEOUT_MS;

  try {
    switch (assert.kind) {
      // ---- 命令断言 ----
      case 'command': {
        const label = assert.description || `命令: ${truncate(assert.cmd, 60)}`;

        if (!isCmdAllowed(assert.cmd)) {
          return {
            label,
            passed: false,
            observed: '',
            reason: `命令不在白名单内，拒绝执行（安全策略）。白名单前缀: ${CMD_ALLOWLIST.slice(0, 5).join(', ')} ...`,
            durationMs: Date.now() - started,
          };
        }

        let output = '';
        let exitCode = 0;
        try {
          output = execSync(assert.cmd, {
            cwd,
            encoding: 'utf8',
            timeout: assert.timeoutMs || timeout,
            stdio: ['ignore', 'pipe', 'pipe'],
            maxBuffer: 8 * 1024 * 1024,
          });
        } catch (e: any) {
          // execSync 抛错时 err.stdout/stderr 仍带输出
          output = `${e.stdout || ''}${e.stderr || ''}`;
          exitCode = typeof e.status === 'number' ? e.status : 1;
        }

        let passed = false;
        let reason: string | undefined;

        switch (assert.expect) {
          case 'exit0':
            passed = exitCode === 0;
            if (!passed) reason = `期望退出码 0，实际 ${exitCode}`;
            break;
          case 'exitN':
            passed = exitCode === (assert.exitCode ?? 0);
            if (!passed) reason = `期望退出码 ${assert.exitCode}，实际 ${exitCode}`;
            break;
          case 'contains':
            passed = output.includes(assert.output || '');
            if (!passed) reason = `输出未包含 "${assert.output}"`;
            break;
          case 'notContains':
            passed = !output.includes(assert.output || '');
            if (!passed) reason = `输出意外包含了 "${assert.output}"`;
            break;
        }

        return {
          label,
          passed,
          observed: truncate(output, 500),
          reason,
          durationMs: Date.now() - started,
        };
      }

      // ---- grep 断言 ----
      case 'grep': {
        const label = assert.description || `grep ${assert.expect}: ${truncate(assert.pattern, 40)} @ ${assert.path}`;

        if (!fs.existsSync(assert.path)) {
          // 路径不存在时，found 断言判失败，absent 断言判通过（路径本身就不存在）
          const passed = assert.expect === 'absent';
          return {
            label,
            passed,
            observed: '(路径不存在)',
            reason: passed ? undefined : `路径不存在，无法找到匹配: ${assert.path}`,
            durationMs: Date.now() - started,
          };
        }

        const content = fs.statSync(assert.path).isDirectory()
          ? readDirRecursive(assert.path)
          : fs.readFileSync(assert.path, 'utf8');

        let count = 0;
        if (assert.regex === false) {
          count = content.split(assert.pattern).length - 1;
        } else {
          try {
            const re = new RegExp(assert.pattern, 'g');
            count = (content.match(re) || []).length;
          } catch {
            // 正则非法时降级为字面量
            count = content.split(assert.pattern).length - 1;
          }
        }

        const minCount = assert.minCount ?? 1;
        const passed = assert.expect === 'found' ? count >= minCount : count === 0;

        return {
          label,
          passed,
          observed: `命中 ${count} 次（期望 ${assert.expect === 'found' ? '>= ' + minCount : '== 0'}）`,
          reason: passed ? undefined : `命中 ${count} 次，不满足 ${assert.expect}${minCount > 1 ? ` >= ${minCount}` : ''}`,
          durationMs: Date.now() - started,
        };
      }

      // ---- 文件存在 / 不存在 ----
      case 'fileExists':
      case 'fileAbsent': {
        const label = assert.description || `${assert.kind}: ${assert.path}`;
        const exists = fs.existsSync(assert.path);
        const passed = assert.kind === 'fileExists' ? exists : !exists;
        return {
          label,
          passed,
          observed: exists ? '存在' : '不存在',
          reason: passed ? undefined : `期望${assert.kind === 'fileExists' ? '存在' : '不存在'}，实际${exists ? '存在' : '不存在'}`,
          durationMs: Date.now() - started,
        };
      }

      // ---- 行数断言 ----
      case 'lineCount': {
        const label = assert.description || `行数 ${assert.mode} ${assert.value}: ${assert.path}`;
        if (!fs.existsSync(assert.path)) {
          return {
            label,
            passed: false,
            observed: '(文件不存在)',
            reason: `文件不存在，无法统计行数: ${assert.path}`,
            durationMs: Date.now() - started,
          };
        }
        const lines = fs.readFileSync(assert.path, 'utf8').split('\n').length;
        const passed =
          assert.mode === 'lte' ? lines <= assert.value :
          assert.mode === 'gte' ? lines >= assert.value :
          lines === assert.value;
        return {
          label,
          passed,
          observed: `${lines} 行`,
          reason: passed ? undefined : `实际 ${lines} 行，期望 ${assert.mode} ${assert.value}`,
          durationMs: Date.now() - started,
        };
      }

      // ---- 目录洁净（绿区不得被改动）----
      case 'dirClean': {
        const label = assert.description || `绿区未被改动: ${assert.path}`;
        if (!fs.existsSync(assert.path)) {
          return { label, passed: true, observed: '(目录不存在，跳过)', durationMs: Date.now() - started, skipped: true };
        }
        try {
          const since = assert.since || 'HEAD';
          const out = execSync(`git diff --stat ${since} -- ${assert.path}`, {
            cwd,
            encoding: 'utf8',
            timeout: 15_000,
            stdio: ['ignore', 'pipe', 'pipe'],
          }).trim();
          const passed = out === '';
          return {
            label,
            passed,
            observed: passed ? '无改动' : truncate(out, 500),
            reason: passed ? undefined : `检测到改动:\n${truncate(out, 500)}`,
            durationMs: Date.now() - started,
          };
        } catch (e: any) {
          return {
            label,
            passed: false,
            observed: '',
            reason: `git diff 执行失败: ${e.message}`,
            durationMs: Date.now() - started,
          };
        }
      }

      // ---- LLM 判定 ----
      case 'llmJudge': {
        const label = assert.description || `LLM 判定: ${truncate(assert.rubric, 50)}`;
        if (!ctx.llmJudge) {
          // 未注入判定器时不阻塞流程，标记为跳过
          return {
            label,
            passed: true,
            observed: '(未注入 llmJudge，跳过)',
            durationMs: Date.now() - started,
            skipped: true,
          };
        }
        const content = assert.content || ctx.judgeContent || '';
        const verdict = await ctx.llmJudge(assert.rubric, content, assert.threshold ?? 0.7);
        return {
          label,
          passed: verdict.pass,
          observed: `score=${verdict.score}`,
          reason: verdict.reason,
          durationMs: Date.now() - started,
        };
      }

      default: {
        return {
          label: '未知断言类型',
          passed: false,
          observed: '',
          reason: `不支持的断言类型: ${(assert as any).kind}`,
          durationMs: Date.now() - started,
        };
      }
    }
  } catch (e: any) {
    return {
      label: `断言执行异常: ${(assert as any).kind}`,
      passed: false,
      observed: '',
      reason: e?.message || String(e),
      durationMs: Date.now() - started,
    };
  }
}

function readDirRecursive(dir: string, depth = 0): string {
  if (depth > 3) return '';
  let out = '';
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return '';
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out += readDirRecursive(full, depth + 1);
    } else {
      try {
        out += fs.readFileSync(full, 'utf8');
      } catch {}
    }
  }
  return out;
}

// ===== 批量验证 =====

/**
 * 执行阶段的所有断言
 */
export async function verifyStage(
  gate: StageGate,
  ctx: RunContext = {},
): Promise<GateResult> {
  const started = Date.now();
  const results: AssertResult[] = [];

  for (const assert of gate.asserts) {
    results.push(await verifyAssert(assert, ctx));
  }

  const failedCount = results.filter(r => !r.passed).length;
  const skippedCount = results.filter(r => r.skipped).length;

  return {
    passed: failedCount === 0,
    results,
    failedCount,
    skippedCount,
    totalMs: Date.now() - started,
  };
}

/**
 * 生成人类可读的验收报告
 */
export function formatGateResult(result: GateResult): string {
  if (result.results.length === 0) return '(本阶段无机器断言)';

  const lines = result.results.map(r => {
    const icon = r.skipped ? 'SKIP' : r.passed ? 'PASS' : 'FAIL';
    const reason = r.reason ? `\n      ↳ ${r.reason}` : '';
    const observed = r.observed ? `\n      观测: ${truncate(r.observed, 200)}` : '';
    return `  [${icon}] ${r.label}${observed}${reason}`;
  });

  return [
    `机器验收: ${result.passed ? '通过' : '未通过'}（${result.results.length - result.failedCount}/${result.results.length} 通过, ${result.skippedCount} 跳过, ${result.totalMs}ms）`,
    ...lines,
  ].join('\n');
}

// ===== 向后兼容：字符串 → 断言 =====

/**
 * 把 goal-runner 的字符串验收标准降级为 llmJudge 断言。
 * 保证现有 368 行 goal-runner 无需修改即可接入纪律层。
 */
export function fromLegacyCriteria(criteria: string): AcceptanceAssert {
  return {
    kind: 'llmJudge',
    rubric: criteria,
    threshold: 0.7,
    description: `LLM 判定(兼容模式): ${truncate(criteria, 50)}`,
  };
}

/**
 * 自动识别：若传入数组直接用，若是字符串则降级
 */
export function normalizeAcceptance(
  criteria: string | AcceptanceAssert[],
): AcceptanceAssert[] {
  return Array.isArray(criteria) ? criteria : [fromLegacyCriteria(criteria)];
}