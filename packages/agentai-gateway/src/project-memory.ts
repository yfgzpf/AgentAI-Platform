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

/** 检测项目技术栈 */
export function detectTechStack(workspace: string): ProjectMemory['techStack'] {
  const pkgPath = path.join(workspace, 'package.json');
  const tsConfigPath = path.join(workspace, 'tsconfig.json');
  const goModPath = path.join(workspace, 'go.mod');
  const cargoPath = path.join(workspace, 'Cargo.toml');
  const pyProjectPath = path.join(workspace, 'pyproject.toml');

  let language = 'unknown';
  let framework: string | undefined;
  let runtime = 'unknown';
  let packageManager = 'npm';
  let buildTool: string | undefined;
  let testFramework: string | undefined;
  let databases: string[] = [];

  try {
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      language = hasFile(workspace, 'tsconfig.json') ? 'TypeScript' : 'JavaScript';
      runtime = `Node ${process.version}`;

      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

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

    if (fs.existsSync(goModPath)) {
      language = 'Go';
      runtime = execSync('go version', { encoding: 'utf-8', timeout: 3000 }).trim().split(' ')[2] || 'go';
    }
    if (fs.existsSync(cargoPath)) {
      language = 'Rust';
      runtime = execSync('rustc --version', { encoding: 'utf-8', timeout: 3000 }).trim() || 'rust';
    }
    if (fs.existsSync(pyProjectPath)) {
      language = 'Python';
      runtime = `Python ${process.env.PYTHON_VERSION || '3.x'}`;
    }

  } catch {}

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

function hasFile(dir: string, filename: string): boolean {
  return fs.existsSync(path.join(dir, filename));
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
