/**
 * explore.ts — 广度→深度探索器 (RSIAgent BRS/DRS 两阶段, 纯数据驱动)
 * =========================================================
 * 对应 4 篇公众号文章落地方案 P3 (RSIAgent Curriculum + 先广后深)。
 *
 * 核心设计 (与 RSIAgent 的差别):
 *   - RSIAgent 的 Curriculum Agent 是 LLM, 由它挑"信息量最大的探索任务"。
 *   - 我们把"挑弱点"从 LLM 手里拿过来, 交给**纯数据** (evolution/evolved-rules/
 *     测试失败计数), 弱模型也能用 — RSIAgent 原文承认"成功取决于环境复杂度和
 *     模型基础能力", 我们避免这个塌方点。
 *
 * 两阶段:
 *   BRS (Broad Recursive Self-exploration): 并行跑 5 个独立 probe, 发现项目
 *       整体能力与边界, 算出 Top N 弱点。
 *   DRS (Deep Recursive Self-exploration): 针对单个弱点焦点, 集中 5-10 次
 *       probe (读代码 + 找测试 + 找调用方), 反复迭代直到掌握。
 *
 * 信息隔离: 只读, 不写任何文件。结果由调用方 (子智能体) 决定是否写 record_failure。
 */

import * as fs from 'fs';
import * as path from 'path';

// ===== 类型定义 =====

export interface ProbeFinding {
  /** probe 名 (structure / tech-stack / recent-changes / failure-history / unexplored) */
  probe: string;
  /** 摘要 (1-2 句话) */
  summary: string;
  /** 证据 (file:line 或命令输出片段) */
  evidence?: string[];
  /** 是否发现"弱点" (供 DRS 聚焦) */
  isWeakSpot?: boolean;
  /** 弱点简述 */
  weakSpot?: string;
}

export interface BroadResult {
  /** Phase 1: 5 个并行 probe */
  probes: ProbeFinding[];
  /** 从 probe 里算出的 Top N 弱点 (按严重度排序) */
  topWeakSpots: string[];
  /** 建议的 DRS 焦点 (给下一轮) */
  recommendedFocus?: string;
}

export interface DeepFinding {
  focus: string;
  probes: ProbeFinding[];
  /** 给主 Agent 的下一步建议 */
  nextAction?: string;
}

// ===== 5 个 BRS probe (纯数据驱动, 不接 LLM) =====

/** 扫描 workspace 时跳过的目录 (与 autonomous-explorer.ts 的 SKIP_DIRS 保持一致) */
const SKIP_DIRS_FOR_SCAN = new Set([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'build', 'out',
  '.cache', '.workbuddy', '.agentai', '__pycache__', '.venv', 'venv',
]);

function probeStructure(workspace: string): ProbeFinding {
  const dirs: string[] = [];
  try {
    const entries = fs.readdirSync(workspace, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') {
        dirs.push(e.name);
      }
    }
  } catch { /* ignore */ }
  const summary = dirs.length > 0
    ? `顶层 ${dirs.length} 个目录: ${dirs.slice(0, 8).join(', ')}${dirs.length > 8 ? ', ...' : ''}`
    : '顶层无目录 (空 workspace 或读取失败)';
  return { probe: 'structure', summary };
}

function probeTechStack(workspace: string): ProbeFinding {
  const markers: Array<[string, string]> = [
    ['package.json', 'Node/JS/TS 项目'],
    ['pnpm-workspace.yaml', 'pnpm monorepo'],
    ['lerna.json', 'lerna monorepo'],
    ['vite.config.ts', 'Vite'],
    ['vite.config.js', 'Vite'],
    ['next.config.js', 'Next.js'],
    ['tauri.conf.json', 'Tauri'],
    ['pyproject.toml', 'Python'],
    ['go.mod', 'Go'],
    ['Cargo.toml', 'Rust'],
    ['tsconfig.json', 'TypeScript 项目'],
  ];
  const found: string[] = [];
  // 在 workspace 顶层 + src/ 子目录两层找 (monorepo 的 package.json 可能在 packages/xxx/)
  const dirsToCheck: string[] = [workspace];
  try {
    const entries = fs.readdirSync(workspace, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && !SKIP_DIRS_FOR_SCAN.has(e.name)) {
        dirsToCheck.push(path.join(workspace, e.name));
      }
    }
  } catch { /* ignore */ }
  for (const d of dirsToCheck.slice(0, 20)) {
    for (const [file, label] of markers) {
      if (fs.existsSync(path.join(d, file))) found.push(label);
    }
    if (found.length >= 5) break; // 够了就停, 避免遍历整个 monorepo
  }
  return {
    probe: 'tech-stack',
    summary: found.length > 0 ? `检测到: ${[...new Set(found)].join(', ')}` : '未识别到技术栈标记文件',
    isWeakSpot: found.length === 0,
    weakSpot: found.length === 0 ? 'workspace 没有 package.json 等标记, 可能需要先初始化' : undefined,
  };
}

function probeRecentChanges(workspace: string): ProbeFinding {
  // 找 .agentai/ 下最近 7 天修改过的文件 (进化记忆 / 备份 / 规则)
  const agentaiDir = path.join(workspace, '.agentai');
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const recent: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 3) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full, depth + 1); continue; }
      if (!e.isFile()) continue;
      try {
        const m = fs.statSync(full).mtimeMs;
        if (now - m < sevenDays) recent.push(full.replace(workspace, '').replace(/\\/g, '/'));
      } catch { /* ignore */ }
    }
  };
  if (fs.existsSync(agentaiDir)) walk(agentaiDir, 0);
  return {
    probe: 'recent-changes',
    summary: recent.length > 0
      ? `最近 7 天改动 ${recent.length} 个文件: ${recent.slice(0, 5).join(', ')}${recent.length > 5 ? ', ...' : ''}`
      : '最近 7 天无 .agentai/ 改动 (可能是全新 workspace)',
  };
}

function probeFailureHistory(workspace: string): ProbeFinding {
  // 读 evolution.jsonl 里最近的 failure 条目, 找反复失败的 toolName
  let failures: Array<{ toolName?: string; content?: string }> = [];
  try {
    const home = process.env.AGENTAI_EVOLUTION_DIR || path.join(process.env.HOME || process.env.USERPROFILE || '~', '.agentai', 'evolution');
    const evoFile = process.env.AGENTAI_EVOLUTION_FILE || path.join(home, 'evolution.jsonl');
    if (fs.existsSync(evoFile)) {
      const lines = fs.readFileSync(evoFile, 'utf-8').trim().split('\n').filter(Boolean).slice(-50);
      for (const l of lines) {
        try {
          const e = JSON.parse(l);
          if (e.type === 'failure') failures.push({ toolName: e.metadata?.toolName, content: e.content });
        } catch { /* skip */ }
      }
    }
  } catch { /* ignore */ }

  if (failures.length === 0) {
    return { probe: 'failure-history', summary: '无失败记录 (新 workspace 或 evolution 未启用)' };
  }
  // 按 toolName 聚合, 找反复失败的
  const byTool = new Map<string, number>();
  for (const f of failures) {
    const t = f.toolName || 'unknown';
    byTool.set(t, (byTool.get(t) || 0) + 1);
  }
  const repeated = [...byTool.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]);
  if (repeated.length === 0) {
    return { probe: 'failure-history', summary: `最近 50 条失败 ${failures.length} 条, 无重复 toolName` };
  }
  return {
    probe: 'failure-history',
    summary: `反复失败的工具: ${repeated.map(([t, c]) => `${t}×${c}`).join(', ')}`,
    isWeakSpot: true,
    weakSpot: `反复失败的工具: ${repeated.map(([t, c]) => `${t}(${c} 次)`).join(', ')} — 下次别再用相同参数`,
    evidence: repeated.slice(0, 3).map(([t, c]) => `tool=${t} 出现 ${c} 次`),
  };
}

function probeUnexplored(workspace: string): ProbeFinding {
  // 找 workspace 里有代码但没被任何测试覆盖的目录 (粗略: 找 src/** 但 test/** 缺对应)
  const srcDir = path.join(workspace, 'src');
  const testDir = path.join(workspace, 'test');
  const testDir2 = path.join(workspace, 'tests');
  if (!fs.existsSync(srcDir)) {
    return { probe: 'unexplored', summary: 'workspace 无 src/ 目录, 未覆盖维度不可推断' };
  }
  const hasTest = fs.existsSync(testDir) || fs.existsSync(testDir2);
  return {
    probe: 'unexplored',
    summary: hasTest
      ? `有 src/ + 测试目录, 可用 explore_project_deep 聚焦某模块`
      : '有 src/ 但无测试目录 — 可能漏测',
    isWeakSpot: !hasTest,
    weakSpot: !hasTest ? '项目缺测试目录, 建议补最小测试' : undefined,
  };
}

// ===== BRS 入口: 并行跑 5 个 probe, 算 Top N 弱点 =====

export async function broadExplore(workspace: string): Promise<BroadResult> {
  const probes = await Promise.all([
    Promise.resolve(probeStructure(workspace)),
    Promise.resolve(probeTechStack(workspace)),
    Promise.resolve(probeRecentChanges(workspace)),
    Promise.resolve(probeFailureHistory(workspace)),
    Promise.resolve(probeUnexplored(workspace)),
  ]);
  const topWeakSpots = probes
    .filter(p => p.isWeakSpot && p.weakSpot)
    .map(p => p.weakSpot!)
    .slice(0, 3);
  return {
    probes,
    topWeakSpots,
    recommendedFocus: topWeakSpots[0], // 最严重的一个作为 DRS 焦点
  };
}

// ===== DRS 入口: 针对单个焦点, 集中 5-10 次 probe =====

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out', '.cache', '.venv', 'venv']);

/** 在 dir 下递归找匹配 file 正则的文件 (限深度, 避免拉全 monorepo) */
function findFilesMatching(dir: string, fileRe: RegExp, contentRe: RegExp, limit: number, maxDepth = 4): string[] {
  const results: string[] = [];
  const walk = (currentDir: string, depth: number) => {
    if (depth > maxDepth || results.length >= limit) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(currentDir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (results.length >= limit) return;
      const full = path.join(currentDir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(full, depth + 1);
      } else if (e.isFile() && fileRe.test(e.name)) {
        try {
          const text = fs.readFileSync(full, 'utf-8');
          if (contentRe.test(text)) results.push(full);
        } catch { /* ignore */ }
      }
    }
  };
  walk(dir, 0);
  return results;
}

export async function deepExplore(workspace: string, focus: string): Promise<DeepFinding> {
  const probes: ProbeFinding[] = [];
  const focusRe = new RegExp(focus.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

  // probe 1: 找 focus 相关源码文件
  const sourceFiles = findFilesMatching(
    workspace,
    /\.(ts|tsx|js|jsx|mjs)$/,
    focusRe,
    20,
  );
  probes.push({
    probe: 'dr-1-source',
    summary: `找到 ${sourceFiles.length} 个含 "${focus}" 的源码文件`,
    evidence: sourceFiles.slice(0, 5).map(f => f.replace(workspace, '').replace(/\\/g, '/')),
    // 关键词找不到 ≠ 项目弱点 (可能只是关键词错), 不标 weakSpot
  });

  // probe 2: 找相关测试
  const testFiles = findFilesMatching(
    workspace,
    /\.(test|spec)\.(ts|tsx|js|jsx)$/,
    focusRe,
    10,
  );
  probes.push({
    probe: 'dr-2-tests',
    summary: `找到 ${testFiles.length} 个含 "${focus}" 的测试文件`,
    evidence: testFiles.slice(0, 3).map(f => f.replace(workspace, '').replace(/\\/g, '/')),
    isWeakSpot: testFiles.length === 0 && sourceFiles.length > 0,
    weakSpot: testFiles.length === 0 && sourceFiles.length > 0
      ? `"${focus}" 有源码但无测试覆盖 — 建议补最小测试`
      : undefined,
  });

  // probe 3: 找调用方 (import / require 里含 focus)
  const callerFiles = findFilesMatching(
    workspace,
    /\.(ts|tsx|js|jsx|mjs)$/,
    new RegExp(`(import|require)\\(.*${focusRe.source}`, 'i'),
    10,
  );
  probes.push({
    probe: 'dr-3-callers',
    summary: `找到 ${callerFiles.length} 个 import/require "${focus}" 的文件`,
    evidence: callerFiles.slice(0, 3).map(f => f.replace(workspace, '').replace(/\\/g, '/')),
  });

  // probe 4: 找相关 evolution 失败记录
  try {
    const { readEvolution } = await import('./evolution.js');
    const entries = readEvolution(50).filter(e =>
      (e.content || '').toLowerCase().includes(focus.toLowerCase()),
    );
    probes.push({
      probe: 'dr-4-history',
      summary: `evolution 里有 ${entries.length} 条与 "${focus}" 相关的失败记录`,
      evidence: entries.slice(0, 3).map(e => (e.content || '').slice(0, 80)),
      isWeakSpot: entries.length >= 2,
      weakSpot: entries.length >= 2 ? `"${focus}" 反复失败 ${entries.length} 次 — 需重点攻坚` : undefined,
    });
  } catch {
    probes.push({ probe: 'dr-4-history', summary: 'evolution 记录读取失败' });
  }

  // probe 5: 汇总
  const weaks = probes.filter(p => p.isWeakSpot && p.weakSpot).map(p => p.weakSpot!);
  return {
    focus,
    probes,
    nextAction: weaks.length > 0
      ? `优先处理: ${weaks.join('; ')}`
      : `"${focus}" 探索完成, 未发现明显弱点 — 可进入下一焦点`,
  };
}
