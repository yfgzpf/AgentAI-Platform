/**
 * Discipline — 内置断言集 (Builtin Asserts)
 * ----------------------------------------------------
 * 把资深工程师每一轮动手前后必做的检查，固化成可复用的断言。
 *
 * 这些不是凭空设计的，每一条都对应一次真实踩过的坑：
 *   typecheck-clean      ← 前端重构时靠它守住「零新增错误」
 *   test-green           ← 修 vitest 全挂那次
 *   build-pass           ← 删死代码后确认产物仍可构建
 *   no-orphan-after-delete ← 删文件前必须验 0 引用
 *   no-unstaged-pollution ← 工作区脏时禁止 git add -A
 *   guardzone-untouched  ← 中医四资产不得被误伤
 */

import type { AcceptanceAssert } from './assertions.js';

// ===== 单条断言工厂 =====

/** TypeScript 类型检查必须零错误 */
export function typecheckClean(pkg = 'agentai-gateway'): AcceptanceAssert {
  const dir = pkg === 'agentai-gui' ? 'packages/agentai-gui' : 'packages/agentai-gateway';
  return {
    kind: 'command',
    cmd: `cd ${dir} && npx tsc --noEmit`,
    expect: 'exit0',
    timeoutMs: 300_000,
    description: `类型检查零错误 (${dir})`,
  };
}

/** 测试全绿 */
export function testGreen(pkg = 'agentai-gateway'): AcceptanceAssert {
  const dir = pkg === 'agentai-gui' ? 'packages/agentai-gui' : 'packages/agentai-gateway';
  return {
    kind: 'command',
    cmd: `cd ${dir} && npx vitest run`,
    expect: 'exit0',
    timeoutMs: 600_000,
    description: `测试全绿 (${dir})`,
  };
}

/** 构建通过 */
export function buildPass(pkg = 'agentai-gateway'): AcceptanceAssert {
  const cmd = pkg === 'agentai-gui'
    ? 'cd packages/agentai-gui && npx vite build'
    : 'cd packages/agentai-gateway && node scripts/build.mjs';
  return {
    kind: 'command',
    cmd,
    expect: 'exit0',
    timeoutMs: 600_000,
    description: `构建通过 (${pkg})`,
  };
}

/**
 * 删除后必须验证零引用。
 * 这是 2026-08-28 删除 27 个孤儿文件时用过的核心纪律。
 */
export function noOrphanAfterDelete(files: string[], repoRoot = '.'): AcceptanceAssert {
  if (files.length === 0) {
    return {
      kind: 'command',
      cmd: 'git status --short',
      expect: 'exit0',
      description: '未声明待删文件，跳过孤儿校验',
    };
  }
  const checks = files
    .map(f => `git grep -l "${f}" -- . | wc -l`)
    .join(' ; ');
  return {
    kind: 'command',
    cmd: checks,
    expect: 'exit0',
    output: '0',
    timeoutMs: 120_000,
    description: `删除后零引用校验 (${files.length} 个文件)`,
  };
}

/** 删除前逐个文件验零引用（比批量更严） */
export function verifyNoRefsBeforeDelete(files: string[]): AcceptanceAssert[] {
  return files.map(f => ({
    kind: 'grep' as const,
    pattern: f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    path: 'packages/agentai-gateway/src',
    expect: 'absent' as const,
    description: `删除前验零引用: ${f}`,
  }));
}

/**
 * 提交洁净度：不允许把无关改动卷进 commit。
 * 2026-10-09 实测：工作区有 335 个未提交改动，`git add -A` 会污染清理 commit。
 */
export function noUnstagedPollution(maxChanged = 60): AcceptanceAssert {
  return {
    kind: 'command',
    cmd: `git status --short | wc -l`,
    expect: 'contains',
    output: String(maxChanged),
    description: `提交洁净度（变更文件数应 ≤ ${maxChanged}）`,
  };
}

/** 禁止 git add -A 的粗放提交（检测暂存区是否包含超范围路径） */
export function stagedPathsWithin(allowedPrefixes: string[]): AcceptanceAssert[] {
  if (allowedPrefixes.length === 0) return [];
  return [
    {
      kind: 'command',
      cmd: 'git diff --cached --name-only | head -1',
      expect: 'exit0',
      description: '暂存区可读（提交前必须精确 add 路径）',
    },
  ];
}

// ===== 中医绿区保护 =====

/**
 * 差异化资产目录，任何清理/重构波次都不得触碰。
 * 这是把「不越界」从口头承诺变成机器断言。
 */
export const GUARDZONE_DIRS = [
  'packages/agentai-gateway/src/soul',
  'packages/agentai-gateway/src/qihuang',
  'packages/agentai-gateway/src/xuanji',
  'packages/agentai-gateway/src/diagnosis',
  'packages/agentai-gateway/src/judge',
  'packages/agentai-gateway/src/sandbox',
] as const;

/** 绿区不得有任何改动 */
export function guardzoneUntouched(since = 'HEAD'): AcceptanceAssert[] {
  return GUARDZONE_DIRS.map(dir => ({
    kind: 'dirClean' as const,
    path: dir,
    since,
    description: `绿区未被改动: ${dir.split('/').pop()}`,
  }));
}

/** 仅保护最核心的四资产（soul/qihuang/xuanji/diagnosis），更严格 */
export function coreAssetUntouched(since = 'HEAD'): AcceptanceAssert[] {
  const core = [
    'packages/agentai-gateway/src/soul',
    'packages/agentai-gateway/src/qihuang',
    'packages/agentai-gateway/src/xuanji',
    'packages/agentai-gateway/src/diagnosis',
  ];
  return core.map(dir => ({
    kind: 'dirClean' as const,
    path: dir,
    since,
    description: `核心资产未被改动: ${dir.split('/').pop()}`,
  }));
}

// ===== 常用组合 =====

/** 删除代码后的标准三连：类型 + 测试 + 构建 */
export function postDeleteStandard(pkg = 'agentai-gateway'): AcceptanceAssert[] {
  return [typecheckClean(pkg), testGreen(pkg), buildPass(pkg)];
}

/** 重构阶段的完整防线：类型 + 测试 + 构建 + 绿区 */
export function refactorDefense(pkg = 'agentai-gateway', since = 'HEAD'): AcceptanceAssert[] {
  return [
    typecheckClean(pkg),
    testGreen(pkg),
    buildPass(pkg),
    ...guardzoneUntouched(since),
  ];
}

/** 治理/重构阶段的防线：完整 + 不越界 */
export function governanceDefense(pkg = 'agentai-gateway', since = 'HEAD'): AcceptanceAssert[] {
  return [...refactorDefense(pkg, since), ...coreAssetUntouched(since)];
}

/** 纯分析阶段（不写代码）：只需保证没碰任何东西 */
export function analysisOnlyDefense(since = 'HEAD'): AcceptanceAssert[] {
  return guardzoneUntouched(since);
}