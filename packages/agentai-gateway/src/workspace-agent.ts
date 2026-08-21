/**
 * workspace-agent.ts — 工作区常驻 Agent
 * ============================================================
 * 后台持续索引代码结构，让 AI 在对话前就"知道"项目。
 *
 * 核心能力:
 *   1. 项目结构索引 — 文件树 + 模块依赖图 + 导出符号表
 *   2. 热点文件追踪 — 最近修改的文件优先级更高
 *   3. 技术栈检测 — 自动识别框架/语言/依赖
 *   4. 对话前注入 — 用户发消息时, AI 已经知道项目结构
 *
 * 存储位置: ~/.agentai/workspace-index/{hash}.json
 * 更新策略: 文件变更时增量更新 (watcher), 首次全量扫描
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

// ===== 类型定义 =====

export interface ProjectIndex {
  /** 工作区路径 */
  workspace: string;
  /** 索引创建时间 */
  indexedAt: number;
  /** 最后更新时间 */
  lastUpdatedAt: number;
  /** 技术栈 */
  techStack: TechStack;
  /** 文件列表 (带元信息) */
  files: FileInfo[];
  /** 模块依赖图 */
  dependencyGraph: Record<string, string[]>;
  /** 导出符号表 (file → exports) */
  exportMap: Record<string, string[]>;
  /** 入口文件 */
  entryPoints: string[];
  /** 最近修改的文件 (热点) */
  recentFiles: { path: string; ts: number }[];
  /** 项目摘要 (一段话描述) */
  summary: string;
}

export interface TechStack {
  language: string[];
  framework: string[];
  packageManager: string;
  buildTool: string;
  testFramework: string;
  hasTypeScript: boolean;
  hasReact: boolean;
  hasVue: boolean;
  hasTauri: boolean;
  monorepo: boolean;
}

export interface FileInfo {
  path: string;
  ext: string;
  lines: number;
  lastModified: number;
  exports: string[];
  complexity: number;
}

// ===== 索引存储 =====

const INDEX_DIR = path.join(os.homedir(), '.agentai', 'workspace-index');

function getIndexPath(workspace: string): string {
  const hash = crypto.createHash('md5').update(workspace).digest('hex').slice(0, 12);
  return path.join(INDEX_DIR, `${hash}.json`);
}

function loadIndex(workspace: string): ProjectIndex | null {
  try {
    const p = getIndexPath(workspace);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch { return null; }
}

function saveIndex(index: ProjectIndex): void {
  try {
    const dir = INDEX_DIR;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getIndexPath(index.workspace), JSON.stringify(index), 'utf-8');
  } catch (e: any) {
    console.warn('[workspace-agent] save index failed:', e?.message);
  }
}

// ===== 技术栈检测 =====

function detectTechStack(workspace: string): TechStack {
  const stack: TechStack = {
    language: [],
    framework: [],
    packageManager: 'npm',
    buildTool: '',
    testFramework: '',
    hasTypeScript: false,
    hasReact: false,
    hasVue: false,
    hasTauri: false,
    monorepo: false,
  };

  // package.json
  try {
    const pkgPath = path.join(workspace, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      
      if (deps.typescript) { stack.hasTypeScript = true; stack.language.push('TypeScript'); }
      if (deps.react) { stack.hasReact = true; stack.framework.push('React'); }
      if (deps.vue) { stack.hasVue = true; stack.framework.push('Vue'); }
      if (deps['@tauri-apps/cli'] || deps['@tauri-apps/api']) { stack.hasTauri = true; stack.framework.push('Tauri'); }
      if (deps.next) stack.framework.push('Next.js');
      if (deps.express) stack.framework.push('Express');
      if (deps.fastify) stack.framework.push('Fastify');
      if (deps.vite) stack.buildTool = 'Vite';
      if (deps.webpack) stack.buildTool = 'Webpack';
      if (deps.rollup) stack.buildTool = 'Rollup';
      if (deps.jest) stack.testFramework = 'Jest';
      if (deps.vitest) stack.testFramework = 'Vitest';
      if (deps.mocha) stack.testFramework = 'Mocha';
      
      // 包管理器
      if (fs.existsSync(path.join(workspace, 'pnpm-lock.yaml'))) stack.packageManager = 'pnpm';
      else if (fs.existsSync(path.join(workspace, 'yarn.lock'))) stack.packageManager = 'yarn';
      
      // monorepo
      if (pkg.workspaces) stack.monorepo = true;
    }
  } catch {}

  // Python
  try {
    if (fs.existsSync(path.join(workspace, 'requirements.txt')) || 
        fs.existsSync(path.join(workspace, 'pyproject.toml'))) {
      stack.language.push('Python');
    }
  } catch {}

  // Go
  try {
    if (fs.existsSync(path.join(workspace, 'go.mod'))) stack.language.push('Go');
  } catch {}

  // Rust
  try {
    if (fs.existsSync(path.join(workspace, 'Cargo.toml'))) { stack.language.push('Rust'); stack.framework.push('Rust'); }
  } catch {}

  return stack;
}

// ===== 文件扫描 =====

const SCAN_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.py', '.go', '.rs', '.css', '.scss', '.html', '.vue', '.svelte'];
const IGNORE_DIRS = ['node_modules', 'dist', 'build', '.git', '.agentai', 'target', '__pycache__', '.next', '.nuxt'];

function scanFiles(workspace: string, maxFiles = 500): FileInfo[] {
  const files: FileInfo[] = [];
  const now = Date.now();
  
  function scan(dir: string, depth: number) {
    if (files.length >= maxFiles || depth > 4) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (IGNORE_DIRS.includes(entry.name) || entry.name.startsWith('.')) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scan(fullPath, depth + 1);
        } else if (SCAN_EXTS.some(ext => entry.name.endsWith(ext))) {
          try {
            const stat = fs.statSync(fullPath);
            const content = fs.readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n').length;
            
            // 提取导出
            const exports: string[] = [];
            const exportRe = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|const|interface|type)\s+(\w+)/gm;
            let m;
            while ((m = exportRe.exec(content)) !== null && exports.length < 20) {
              exports.push(m[1]);
            }
            
            // 复杂度
            let complexity = 0;
            if (/\bif\s*\(/g.test(content)) complexity += (content.match(/\bif\s*\(/g) || []).length;
            if (/\bfor\s*\(/g.test(content)) complexity += (content.match(/\bfor\s*\(/g) || []).length;
            if (/\bwhile\s*\(/g.test(content)) complexity += (content.match(/\bwhile\s*\(/g) || []).length;
            
            const relPath = path.relative(workspace, fullPath);
            files.push({
              path: relPath,
              ext: path.extname(fullPath).slice(1),
              lines,
              lastModified: stat.mtimeMs,
              exports,
              complexity,
            });
          } catch {}
        }
      }
    } catch {}
  }
  
  scan(workspace, 0);
  return files;
}

// ===== 依赖图构建 =====

function buildDependencyGraph(files: FileInfo[], workspace: string): Record<string, string[]> {
  const graph: Record<string, string[]> = {};
  
  for (const file of files) {
    const fullPath = path.join(workspace, file.path);
    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const deps: string[] = [];
      
      // import ... from '...'
      const importRe = /(?:import|require)\s*\(?\s*['"]([^'"]+)['"]/g;
      let m;
      while ((m = importRe.exec(content)) !== null) {
        const dep = m[1];
        if (dep.startsWith('.') || dep.startsWith('/')) {
          // 相对路径 — 解析到实际文件
          const resolved = path.resolve(path.dirname(file.path), dep);
          const relResolved = path.relative(workspace, resolved);
          if (files.some(f => f.path === relResolved || f.path === relResolved + '.ts' || f.path === relResolved + '.js')) {
            deps.push(relResolved);
          }
        }
      }
      
      graph[file.path] = deps;
    } catch {
      graph[file.path] = [];
    }
  }
  
  return graph;
}

// ===== 导出符号表 =====

function buildExportMap(files: FileInfo[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const file of files) {
    if (file.exports.length > 0) {
      map[file.path] = file.exports;
    }
  }
  return map;
}

// ===== 入口文件检测 =====

function detectEntryPoints(files: FileInfo[], techStack: TechStack): string[] {
  const entryNames = ['index', 'main', 'app', 'server', 'start', 'entry'];
  const entryExts = techStack.hasTypeScript ? ['ts', 'tsx'] : ['js', 'jsx'];
  
  return files
    .filter(f => {
      const basename = path.basename(f.path).replace(/\.\w+$/, '');
      return entryNames.includes(basename) && entryExts.includes(f.ext);
    })
    .map(f => f.path);
}

// ===== 项目摘要 =====

function buildSummary(files: FileInfo[], techStack: TechStack, entryPoints: string[]): string {
  const parts: string[] = [];
  
  if (techStack.language.length > 0) {
    parts.push(`语言: ${techStack.language.join(', ')}`);
  }
  if (techStack.framework.length > 0) {
    parts.push(`框架: ${techStack.framework.join(', ')}`);
  }
  parts.push(`文件数: ${files.length}`);
  parts.push(`包管理: ${techStack.packageManager}`);
  if (techStack.buildTool) parts.push(`构建: ${techStack.buildTool}`);
  if (techStack.monorepo) parts.push('monorepo: 是');
  if (entryPoints.length > 0) parts.push(`入口: ${entryPoints.slice(0, 3).join(', ')}`);
  
  // 找出复杂度最高的文件
  const hotFiles = [...files].sort((a, b) => b.complexity - a.complexity).slice(0, 3);
  if (hotFiles.length > 0) {
    parts.push(`复杂文件: ${hotFiles.map(f => `${f.path}(${f.complexity})`).join(', ')}`);
  }
  
  return parts.join(' | ');
}

// ===== 主索引函数 =====

export function indexWorkspace(workspace: string): ProjectIndex {
  console.log(`[workspace-agent] 开始索引: ${workspace}`);
  const startTime = Date.now();
  
  const techStack = detectTechStack(workspace);
  const files = scanFiles(workspace);
  const dependencyGraph = buildDependencyGraph(files, workspace);
  const exportMap = buildExportMap(files);
  const entryPoints = detectEntryPoints(files, techStack);
  const summary = buildSummary(files, techStack, entryPoints);
  
  // 最近修改的文件 (7天内)
  const now = Date.now();
  const recentFiles = files
    .filter(f => now - f.lastModified < 7 * 24 * 60 * 60 * 1000)
    .sort((a, b) => b.lastModified - a.lastModified)
    .slice(0, 10)
    .map(f => ({ path: f.path, ts: f.lastModified }));
  
  const index: ProjectIndex = {
    workspace,
    indexedAt: startTime,
    lastUpdatedAt: startTime,
    techStack,
    files,
    dependencyGraph,
    exportMap,
    entryPoints,
    recentFiles,
    summary,
  };
  
  saveIndex(index);
  console.log(`[workspace-agent] 索引完成: ${files.length} 文件, ${Date.now() - startTime}ms`);
  return index;
}

// ===== 增量更新 =====

export function updateIndex(workspace: string): ProjectIndex {
  const existing = loadIndex(workspace);
  if (!existing) {
    return indexWorkspace(workspace);
  }
  
  // 检查是否有文件变更 (比较最近修改时间)
  const now = Date.now();
  const indexAge = now - existing.lastUpdatedAt;
  
  // 索引超过 5 分钟才更新 (避免频繁索引)
  if (indexAge < 5 * 60 * 1000) {
    return existing;
  }
  
  // 重新扫描 (增量更新 = 全量重扫, 但比首次快因为文件系统缓存)
  return indexWorkspace(workspace);
}

// ===== 对话前注入 =====

export function buildWorkspaceContext(workspace: string): string {
  let index = loadIndex(workspace);
  if (!index) {
    index = indexWorkspace(workspace);
  } else {
    index = updateIndex(workspace);
  }
  
  const parts: string[] = [];
  
  // 1. 项目摘要
  parts.push(`[工作区智能体] ${index.summary}`);
  
  // 2. 技术栈详情
  const ts = index.techStack;
  if (ts.framework.length > 0) {
    parts.push(`框架: ${ts.framework.join(', ')}${ts.hasTauri ? ' (桌面应用)' : ''}${ts.monorepo ? ' (monorepo)' : ''}`);
  }
  
  // 3. 入口文件
  if (index.entryPoints.length > 0) {
    parts.push(`入口: ${index.entryPoints.slice(0, 5).join(', ')}`);
  }
  
  // 4. 最近修改的文件 (热点)
  if (index.recentFiles.length > 0) {
    const recentList = index.recentFiles.slice(0, 5).map(f => {
      const age = Math.floor((Date.now() - f.ts) / 60000);
      const ageLabel = age < 60 ? `${age}分钟前` : age < 1440 ? `${Math.floor(age / 60)}小时前` : `${Math.floor(age / 1440)}天前`;
      return `${f.path} (${ageLabel})`;
    });
    parts.push(`最近修改: ${recentList.join(', ')}`);
  }
  
  // 5. 复杂度最高的文件 (需要关注的)
  const hotFiles = [...index.files].sort((a, b) => b.complexity - a.complexity).slice(0, 3);
  if (hotFiles.length > 0 && hotFiles[0].complexity > 10) {
    parts.push(`高复杂度文件: ${hotFiles.map(f => `${f.path}(复杂度${f.complexity})`).join(', ')}`);
  }
  
  // 6. 关键导出 (入口文件的导出)
  if (index.entryPoints.length > 0) {
    const entryExports = index.entryPoints.slice(0, 3).flatMap(ep => {
      const exports = index.exportMap[ep] || [];
      return exports.slice(0, 5).map(e => `${ep}→${e}`);
    });
    if (entryExports.length > 0) {
      parts.push(`关键导出: ${entryExports.slice(0, 8).join(', ')}`);
    }
  }
  
  return parts.join('\n');
}

// ===== 查询函数 =====

/**
 * 查找导出了某个符号的文件
 */
export function findExporter(workspace: string, symbol: string): string[] {
  const index = loadIndex(workspace);
  if (!index) return [];
  
  const results: string[] = [];
  for (const [file, exports] of Object.entries(index.exportMap)) {
    if (exports.includes(symbol)) {
      results.push(file);
    }
  }
  return results;
}

/**
 * 查找某文件的所有依赖
 */
export function findDependencies(workspace: string, filePath: string): string[] {
  const index = loadIndex(workspace);
  if (!index) return [];
  return index.dependencyGraph[filePath] || [];
}

/**
 * 查找谁依赖了某文件 (反向依赖)
 */
export function findDependents(workspace: string, filePath: string): string[] {
  const index = loadIndex(workspace);
  if (!index) return [];
  
  const results: string[] = [];
  for (const [file, deps] of Object.entries(index.dependencyGraph)) {
    if (deps.includes(filePath)) {
      results.push(file);
    }
  }
  return results;
}
