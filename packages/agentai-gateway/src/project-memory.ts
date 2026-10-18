/**
 * 项目记忆 — 跨会话记住项目特征和用户偏好
 * ==============================================
 * 对标 Claude Code 的 /memory 和 Cursor 的项目感知
 *
 * 存储位置: .agentai/project-memory.json
 * 内容:
 *   - 技术栈信息
 *   - 用户偏好和约定
 *   - 历史修复模式
 *   - 常用命令
 *   - 已发现的问题和规避方案
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export interface ProjectMemory {
  /** 技术栈 */
  techStack: {
    language: string;
    framework?: string;
    runtime: string;
    packageManager: string;
    buildTool?: string;
    testFramework?: string;
    databases?: string[];
    /** 检测时间 */
    detectedAt: number;
  };
  /** 用户偏好 */
  preferences: {
    /** 偏好的代码风格 */
    codeStyle?: string;
    /** 偏好的测试方式 */
    testCommand?: string;
    /** 偏好的提交规范 */
    commitConvention?: string;
    /** 自定义规则 */
    customRules: string[];
    /** AI 偏好设置 */
    ai_preferences?: {
      /** 是否跳过跨会话记忆注入 */
      skip_last_session_injection?: boolean;
    };
  };
  /** 历史修复模式 */
  fixPatterns: Array<{
    pattern: string;
    solution: string;
    count: number;
    lastUsed: number;
  }>;
  /** 已知问题和规避方案 */
  knownIssues: Array<{
    description: string;
    workaround: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    discovered: number;
  }>;
  /** 项目事实 */
  facts: Array<{
    key: string;
    value: string;
    source: string;
  }>;
  /** 元数据 */
  updatedAt: number;
  version: number;
}

const MEMORY_VERSION = 1;
const MEMORY_FILE = '.agentai/project-memory.json';

function getMemoryPath(workspace: string): string {
  return path.join(workspace, MEMORY_FILE);
}

/** Python 项目标记文件 (2026-10-17 补全: 原来只认 pyproject.toml) */
const PYTHON_MARKERS = ['pyproject.toml', 'requirements.txt', 'setup.py', 'setup.cfg', 'Pipfile', 'environment.yml', 'conda.yaml'];
/** 包管理器锁文件 → 包管理器 */
const PYTHON_PKG_MANAGERS: Array<[string, string]> = [
  ['poetry.lock', 'poetry'],
  ['Pipfile.lock', 'pipenv'],
  ['environment.yml', 'conda'],
  ['conda.yaml', 'conda'],
  ['requirements.txt', 'pip'],
];
/** Python 依赖名 → 框架/数据库 (从 requirements.txt / pyproject 的纯文本里 grep) */
const PYTHON_DEP_HINTS: Array<[RegExp, string]> = [
  [/django/i, 'Django'],
  [/fastapi/i, 'FastAPI'],
  [/flask/i, 'Flask'],
  [/tornado/i, 'Tornado'],
  [/scrapy/i, 'Scrapy'],
  [/pandas|numpy|scipy|sklearn|scikit-learn/i, '数据科学 (pandas/numpy)'],
  [/torch|tensorflow/i, 'ML (torch/tf)'],
  [/psycopg|^pg\b|asyncpg/i, 'PostgreSQL'],
  [/pymysql|mysqlclient/i, 'MySQL'],
  [/pymongo/i, 'MongoDB'],
  [/\bredis\b/i, 'Redis'],
];

/** 读一个文本依赖文件的内容 (不存在/读失败 → '') */
function readTextIfExists(file: string): string {
  try { return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : ''; } catch { return ''; }
}

/** 扫工作区根目录有没有 .py 文件 (兜底: 无任何标记文件的传统 py 项目) */
function hasPythonSource(workspace: string): boolean {
  try {
    return fs.readdirSync(workspace).some(e => e.toLowerCase().endsWith('.py'));
  } catch { return false; }
}

/**
 * 检测项目技术栈。
 *
 * ═══ 2026-10-17 重写: 互斥优先级判定 (Python > Go > Rust > Node) ═══
 * 原实现的三个坑 (实测 /f/澳彩AI 全中):
 *   ① 一串顺序 `if` 且**非互斥** — 带 Node 工具链的 py 项目 (package.json 只用来放
 *      black/eslint 配置) 会先被判成 TypeScript, 后面探到 pyproject 也只是"后写覆盖",
 *      顺序稍有变化结论就翻;
 *   ② Python 只认 `pyproject.toml` — `requirements.txt`/`setup.py`/`Pipfile`/`*.py`
 *      完全不探测 → 传统 py 项目 `language` 恒为 `'unknown'` (系统根本不知道那是 Python);
 *   ③ 探测结果没有任何地方复用, 技术栈被 4 处独立探测且互不同步 (见 workspace-profile)。
 *
 * 现在: 先按优先级定主语言 (只定一次, 不再互相覆盖), 再按主语言补细节。
 */
export function detectTechStack(workspace: string): ProjectMemory['techStack'] {
  let language = 'unknown';
  let framework: string | undefined;
  let runtime = 'unknown';
  let packageManager = 'npm';
  let buildTool: string | undefined;
  let testFramework: string | undefined;
  let databases: string[] = [];

  const pyProject = readTextIfExists(path.join(workspace, 'pyproject.toml'));
  const pyReqs = readTextIfExists(path.join(workspace, 'requirements.txt'));
  const pyDepText = `${pyProject}\n${pyReqs}`;

  try {
    // ── 优先级 1: Python (标记文件 或 根目录有 .py 源码) ──
    if (PYTHON_MARKERS.some(m => fs.existsSync(path.join(workspace, m))) || hasPythonSource(workspace)) {
      language = 'Python';
      runtime = `Python ${process.env.PYTHON_VERSION || '3.x'}`;
      // 框架 / 数据库: 从依赖文本里 grep (不 import, 不执行)
      const frameworks: string[] = [];
      for (const [re, name] of PYTHON_DEP_HINTS) if (re.test(pyDepText)) frameworks.push(name);
      framework = frameworks[0];
      if (frameworks.length > 1) framework = frameworks.join(' + ');
      // 包管理器: 锁文件优先, 回退 pip
      const pm = PYTHON_PKG_MANAGERS.find(([f]) => fs.existsSync(path.join(workspace, f)));
      packageManager = pm ? pm[1] : 'pip';
      if (/\bpytest\b/i.test(pyDepText)) testFramework = 'pytest';
      else if (/\bunittest\b/i.test(pyDepText)) testFramework = 'unittest';
      for (const [, db] of PYTHON_DEP_HINTS) {
        if (['PostgreSQL', 'MySQL', 'MongoDB', 'Redis'].includes(db) && !databases.includes(db)) databases.push(db);
      }
    }
    // ── 优先级 2: Go ──
    else if (fs.existsSync(path.join(workspace, 'go.mod'))) {
      language = 'Go';
      try { runtime = execSync('go version', { encoding: 'utf-8', timeout: 3000 }).trim().split(' ')[2] || 'go'; } catch { /* go 未安装, 保持 unknown */ }
    }
    // ── 优先级 3: Rust ──
    else if (fs.existsSync(path.join(workspace, 'Cargo.toml'))) {
      language = 'Rust';
      try { runtime = execSync('rustc --version', { encoding: 'utf-8', timeout: 3000 }).trim() || 'rust'; } catch { /* rustc 未安装 */ }
    }
    // ── 优先级 4: Node ──
    else if (fs.existsSync(path.join(workspace, 'package.json'))) {
      const pkg = JSON.parse(readTextIfExists(path.join(workspace, 'package.json')) || '{}');
      language = fs.existsSync(path.join(workspace, 'tsconfig.json')) ? 'TypeScript' : 'JavaScript';
      runtime = `Node ${process.version}`;
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

      // 检测框架
      if (deps['next']) framework = 'Next.js';
      else if (deps['react'] && deps['vite']) framework = 'React + Vite';
      else if (deps['react']) framework = 'React';
      else if (deps['vue']) framework = 'Vue';
      else if (deps['@angular/core']) framework = 'Angular';
      else if (deps['express']) framework = 'Express.js';

      // 检测包管理器
      if (fs.existsSync(path.join(workspace, 'pnpm-lock.yaml'))) packageManager = 'pnpm';
      else if (fs.existsSync(path.join(workspace, 'yarn.lock'))) packageManager = 'yarn';

      // 检测测试框架
      if (deps['vitest']) testFramework = 'vitest';
      else if (deps['jest']) testFramework = 'jest';
      else if (deps['mocha']) testFramework = 'mocha';
      else if (deps['ava']) testFramework = 'ava';

      // 检测数据库
      if (deps['prisma'] || deps['@prisma/client']) databases.push('Prisma');
      if (deps['pg'] || deps['mysql2'] || deps['better-sqlite3']) databases.push(deps['pg'] ? 'PostgreSQL' : deps['mysql2'] ? 'MySQL' : 'SQLite');
      if (deps['mongoose'] || deps['mongodb']) databases.push('MongoDB');
      if (deps['drizzle-orm']) databases.push('Drizzle');

      // 构建工具
      if (deps['vite']) buildTool = 'Vite';
      else if (deps['webpack']) buildTool = 'Webpack';
      else if (deps['tsup'] || deps['unbuild']) buildTool = 'tsup';
    }
  } catch { /* 探测失败 → 保持已判定的主语言, 细节留 unknown */ }

  return {
    language,
    framework,
    runtime,
    packageManager,
    buildTool,
    testFramework,
    databases: databases.length > 0 ? databases : undefined,
    detectedAt: Date.now(),
  };
}

/** 读取项目记忆 */
export function readProjectMemory(workspace: string): ProjectMemory | null {
  try {
    const memPath = getMemoryPath(workspace);
    if (!fs.existsSync(memPath)) return null;
    return JSON.parse(fs.readFileSync(memPath, 'utf-8'));
  } catch {
    return null;
  }
}

/** 初始化项目记忆 */
export function initProjectMemory(workspace: string): ProjectMemory {
  const mem: ProjectMemory = {
    techStack: detectTechStack(workspace),
    preferences: {
      customRules: [],
    },
    fixPatterns: [],
    knownIssues: [],
    facts: [],
    updatedAt: Date.now(),
    version: MEMORY_VERSION,
  };
  saveProjectMemory(workspace, mem);
  return mem;
}

/** 保存项目记忆 */
export function saveProjectMemory(workspace: string, mem: ProjectMemory): void {
  const memPath = getMemoryPath(workspace);
  const dir = path.dirname(memPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  mem.updatedAt = Date.now();
  fs.writeFileSync(memPath, JSON.stringify(mem, null, 2), 'utf-8');
}

/** 添加修复模式 */
export function addFixPattern(workspace: string, pattern: string, solution: string): void {
  const mem = readProjectMemory(workspace) || initProjectMemory(workspace);
  const existing = mem.fixPatterns.find(p => p.pattern === pattern);
  if (existing) {
    existing.count++;
    existing.solution = solution;
    existing.lastUsed = Date.now();
  } else {
    mem.fixPatterns.push({ pattern, solution, count: 1, lastUsed: Date.now() });
  }
  // 只保留最近 20 条
  if (mem.fixPatterns.length > 20) mem.fixPatterns = mem.fixPatterns.slice(-20);
  saveProjectMemory(workspace, mem);
}

/** 添加已知问题 */
export function addKnownIssue(workspace: string, description: string, workaround: string, severity: ProjectMemory['knownIssues'][0]['severity']): void {
  const mem = readProjectMemory(workspace) || initProjectMemory(workspace);
  if (!mem.knownIssues.find(i => i.description === description)) {
    mem.knownIssues.push({ description, workaround, severity, discovered: Date.now() });
  }
  saveProjectMemory(workspace, mem);
}

/** 添加偏好 */
export function addPreference(workspace: string, key: string, value: string): void {
  const mem = readProjectMemory(workspace) || initProjectMemory(workspace);
  switch (key) {
    case 'codeStyle': mem.preferences.codeStyle = value; break;
    case 'testCommand': mem.preferences.testCommand = value; break;
    case 'commitConvention': mem.preferences.commitConvention = value; break;
    default: mem.preferences.customRules.push(`${key}: ${value}`);
  }
  saveProjectMemory(workspace, mem);
}

/** 生成项目记忆上下文 (注入 AI 提示) */
export function buildMemoryContext(workspace: string): string {
  const mem = readProjectMemory(workspace);
  if (!mem) return '';

  const lines: string[] = ['<project-memory>'];

  // 技术栈
  lines.push(`  技术栈: ${mem.techStack.language}${mem.techStack.framework ? ' + ' + mem.techStack.framework : ''}`);
  lines.push(`  运行时: ${mem.techStack.runtime}`);
  lines.push(`  包管理: ${mem.techStack.packageManager}`);
  if (mem.techStack.testFramework) lines.push(`  测试: ${mem.techStack.testFramework}`);
  if (mem.techStack.databases?.length) lines.push(`  数据库: ${mem.techStack.databases.join(', ')}`);

  // 偏好
  if (mem.preferences.codeStyle) lines.push(`  代码风格: ${mem.preferences.codeStyle}`);
  if (mem.preferences.testCommand) lines.push(`  测试命令: ${mem.preferences.testCommand}`);
  if (mem.preferences.customRules.length > 0) {
    lines.push(`  自定义规则: ${mem.preferences.customRules.join('; ')}`);
  }

  // 修复模式 (最近 3 条)
  if (mem.fixPatterns.length > 0) {
    lines.push('  最近修复模式:');
    for (const p of mem.fixPatterns.slice(-3)) {
      lines.push(`    - ${p.pattern} → ${p.solution.slice(0, 80)} (${p.count}次)`);
    }
  }

  // 已知问题
  if (mem.knownIssues.length > 0) {
    const critical = mem.knownIssues.filter(i => i.severity === 'critical');
    if (critical.length > 0) {
      lines.push(`  ⚠️ ${critical.length} 个已知严重问题 (修复前请查看 project-memory.json)`);
    }
  }

  lines.push('</project-memory>');
  return lines.join('\n');
}
