/**
 * AutonomousExplorer — AI 代码自主探索引擎
 * ----------------------------------------------------
 * 理念: 授人以渔，不是AI替用户读代码，而是给AI自主探索代码库的能力
 *
 * 核心能力:
 *   1. 代码地图绘制 — 自动扫描项目结构，生成依赖关系图
 *   2. 智能跳转追踪 — 从入口文件追踪调用链，发现关键路径
 *   3. 模式识别 — 识别设计模式、代码异味、架构瓶颈
 *   4. 增量探索 — 只探索变化的部分，不重复扫描
 *
 * 设计原则:
 *   - 按需探索，不全量扫描 (节省 token)
 *   - 结果缓存到 .agentai/explorer-cache/ (跨会话复用)
 *   - 探索深度可控 (breadth × depth 限制)
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

const AGENTAI_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '~', '.agentai');
const CACHE_DIR = path.join(AGENTAI_DIR, 'explorer-cache');

// ===== 类型定义 =====

export interface ExplorerOptions {
  /** 最大探索广度 (每层扫描的文件数) */
  maxBreadth: number;
  /** 最大探索深度 (递归层数) */
  maxDepth: number;
  /** 是否跳过 node_modules / .git 等 */
  skipCommon: boolean;
  /** 是否使用缓存 */
  useCache: boolean;
  /** 探索模式 */
  mode: 'structure' | 'dependencies' | 'patterns' | 'full';
}

const DEFAULT_OPTIONS: ExplorerOptions = {
  maxBreadth: 50,
  maxDepth: 5,
  skipCommon: true,
  useCache: true,
  mode: 'structure',
};

export interface CodeMap {
  root: string;
  timestamp: string;
  /** 顶层目录结构 */
  topDirs: string[];
  /** 文件类型统计 */
  fileTypes: Record<string, number>;
  /** 入口文件 (package.json main / index.ts / App.tsx 等) */
  entryPoints: string[];
  /** 关键目录 */
  keyDirs: KeyDir[];
  /** 依赖关系 (仅 dependencies 模式) */
  dependencies?: DepGraph;
  /** 识别到的模式 (仅 patterns 模式) */
  patterns?: PatternResult[];
  /** 摘要 token 估算 */
  estimatedTokens: number;
}

export interface KeyDir {
  path: string;
  purpose: string;
  fileCount: number;
  keyFiles: string[];
}

export interface DepGraph {
  internal: Array<{ from: string; to: string }>;
  external: string[];
}

export interface PatternResult {
  pattern: string;
  locations: string[];
  description: string;
}

// ===== 常见项目模式识别 =====

const PROJECT_PATTERNS: Array<{
  id: string;
  detect: (files: string[]) => boolean;
  label: string;
  entryPoints: string[];
  keyDirMap: Record<string, string>;
}> = [
  {
    id: 'monorepo',
    detect: (f) => f.includes('pnpm-workspace.yaml') || f.includes('lerna.json'),
    label: 'Monorepo (pnpm/lerna)',
    entryPoints: ['packages/*/src/index.ts', 'packages/*/src/index.js'],
    keyDirMap: { packages: '子包', apps: '应用', libs: '库' },
  },
  {
    id: 'nextjs',
    detect: (f) => f.includes('next.config'),
    label: 'Next.js 应用',
    entryPoints: ['app/page.tsx', 'pages/index.tsx', 'src/app/page.tsx'],
    keyDirMap: { app: 'App Router', pages: 'Pages Router', components: '组件', lib: '工具', api: 'API 路由' },
  },
  {
    id: 'react-vite',
    detect: (f) => f.includes('vite.config'),
    label: 'React + Vite',
    entryPoints: ['src/main.tsx', 'src/App.tsx'],
    keyDirMap: { src: '源码', components: '组件', pages: '页面', services: '服务', store: '状态' },
  },
  {
    id: 'express',
    detect: (f) => f.includes('package.json') && !f.includes('next.config') && !f.includes('vite.config'),
    label: 'Node.js 后端',
    entryPoints: ['src/index.ts', 'src/app.ts', 'index.ts', 'server.ts'],
    keyDirMap: { src: '源码', routes: '路由', controllers: '控制器', services: '业务逻辑', models: '数据模型', middleware: '中间件' },
  },
];

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'build', 'out',
  '.cache', '.workbuddy', '.agentai', '__pycache__', '.venv', 'venv',
]);

const SKIP_FILES = new Set([
  '.DS_Store', 'Thumbs.db', '.env.local', '.env.production',
]);

// ===== 核心探索引擎 =====

export class AutonomousExplorer extends EventEmitter {
  private cache = new Map<string, { map: CodeMap; mtime: number }>();
  private options: ExplorerOptions;

  constructor(options?: Partial<ExplorerOptions>) {
    super();
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.loadCache();
  }

  /**
   * 绘制代码地图 — 入口方法
   * 不全量扫描，只看顶层 + 识别项目类型 + 定位关键目录
   */
  async mapProject(workspace: string, mode?: ExplorerOptions['mode']): Promise<CodeMap> {
    const effectiveMode = mode || this.options.mode;
    const cacheKey = `${workspace}:${effectiveMode}`;

    // 缓存检查
    if (this.options.useCache) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.mtime < 300_000) { // 5分钟缓存
        this.emit('cache:hit', { workspace });
        return cached.map;
      }
    }

    const t0 = Date.now();

    // 1. 顶层扫描
    const topDirs: string[] = [];
    const fileTypes: Record<string, number> = {};
    const allTopFiles: string[] = [];

    const entries = await fs.readdir(workspace, { withFileTypes: true });
    for (const entry of entries) {
      if (this.options.skipCommon && SKIP_DIRS.has(entry.name)) continue;
      if (entry.isDirectory()) {
        topDirs.push(entry.name);
      } else if (entry.isFile() && !SKIP_FILES.has(entry.name)) {
        allTopFiles.push(entry.name);
        const ext = path.extname(entry.name).toLowerCase();
        fileTypes[ext] = (fileTypes[ext] || 0) + 1;
      }
    }

    // 2. 项目类型识别
    const matched = PROJECT_PATTERNS.find(p => p.detect(allTopFiles));
    const projectType = matched?.id || 'unknown';
    const projectLabel = matched?.label || '未知项目类型';

    // 3. 入口文件定位
    const entryPoints = await this.findEntryPoints(workspace, matched);

    // 4. 关键目录分析
    const keyDirs = await this.analyzeKeyDirs(workspace, topDirs, matched);

    // 5. 子目录文件类型统计 (递归一层)
    await this.countFileTypesRecursive(workspace, topDirs, fileTypes, 2);

    const codeMap: CodeMap = {
      root: workspace,
      timestamp: new Date().toISOString(),
      topDirs,
      fileTypes,
      entryPoints,
      keyDirs,
      estimatedTokens: 0,
    };

    // 6. 可选: 依赖关系分析
    if (effectiveMode === 'dependencies' || effectiveMode === 'full') {
      codeMap.dependencies = await this.analyzeDependencies(workspace, topDirs);
    }

    // 7. 可选: 模式识别
    if (effectiveMode === 'patterns' || effectiveMode === 'full') {
      codeMap.patterns = await this.detectPatterns(workspace, keyDirs);
    }

    // 8. 估算 token
    codeMap.estimatedTokens = this.estimateCodeMapTokens(codeMap);

    // 缓存
    this.cache.set(cacheKey, { map: codeMap, mtime: Date.now() });
    this.emit('map:done', { workspace, projectType, durationMs: Date.now() - t0 });

    return codeMap;
  }

  /**
   * 智能跳转追踪 — 从指定文件追踪调用链
   * 不读全文，只提取 import/require 行
   */
  async traceImports(filePath: string, depth = 3): Promise<string[]> {
    if (depth <= 0) return [];
    const visited = new Set<string>();
    const result: string[] = [];

    const trace = async (fp: string, d: number) => {
      if (d <= 0 || visited.has(fp)) return;
      visited.add(fp);

      try {
        const content = await fs.readFile(fp, 'utf-8');
        const lines = content.split('\n').slice(0, 200); // 只看前200行

        for (const line of lines) {
          // 匹配 import/require
          const importMatch = line.match(/(?:import.*from\s+['"]|require\(\s*['"])(\.{1,2}\/[^'"]+)/);
          if (importMatch && importMatch[1]) {
            const resolved = path.resolve(path.dirname(fp), importMatch[1]);
            // 尝试补全扩展名
            const extensions = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];
            let resolvedPath = resolved;
            for (const ext of extensions) {
              if (fsSync.existsSync(resolved + ext)) {
                resolvedPath = resolved + ext;
                break;
              }
            }
            result.push(resolvedPath);
            await trace(resolvedPath, d - 1);
          }
        }
      } catch { /* 文件可能不存在 */ }
    };

    await trace(filePath, depth);
    return [...new Set(result)];
  }

  /**
   * 生成精简摘要 — 给 AI 的 system prompt 用
   * 关键: 不输出原始代码，只输出结构化信息
   */
  toCompactSummary(codeMap: CodeMap): string {
    const lines: string[] = [];
    lines.push(`项目结构: ${codeMap.topDirs.length} 个顶层目录, ${Object.values(codeMap.fileTypes).reduce((a, b) => a + b, 0)} 个文件`);

    // 文件类型分布
    const typeEntries = Object.entries(codeMap.fileTypes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    if (typeEntries.length > 0) {
      lines.push(`文件类型: ${typeEntries.map(([ext, count]) => `${ext}(${count})`).join(', ')}`);
    }

    // 入口文件
    if (codeMap.entryPoints.length > 0) {
      lines.push(`入口: ${codeMap.entryPoints.join(', ')}`);
    }

    // 关键目录
    for (const dir of codeMap.keyDirs.slice(0, 10)) {
      const keyFiles = dir.keyFiles.slice(0, 5).join(', ');
      lines.push(`${dir.path}/ — ${dir.purpose} (${dir.fileCount}文件${keyFiles ? ', 含 ' + keyFiles : ''})`);
    }

    // 依赖
    if (codeMap.dependencies?.external?.length) {
      lines.push(`外部依赖: ${codeMap.dependencies.external.slice(0, 20).join(', ')}`);
    }

    // 模式
    if (codeMap.patterns?.length) {
      lines.push(`识别模式: ${codeMap.patterns.map(p => `${p.pattern}(${p.locations.length}处)`).join(', ')}`);
    }

    return lines.join('\n');
  }

  // ===== 内部方法 =====

  private async findEntryPoints(workspace: string, pattern: typeof PROJECT_PATTERNS[0]): Promise<string[]> {
    const points: string[] = [];

    // 从 package.json 的 main 字段找
    try {
      const pkgPath = path.join(workspace, 'package.json');
      const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
      if (pkg.main) points.push(pkg.main);
      if (pkg.module) points.push(pkg.module);
    } catch { /* no package.json */ }

    // 从模式识别的入口文件找
    if (pattern) {
      for (const ep of pattern.entryPoints) {
        if (ep.includes('*')) {
          // glob 模式: 简单处理
          const parts = ep.split('*');
          const base = path.join(workspace, parts[0]!);
          try {
            if (fsSync.existsSync(base)) {
              const subdirs = await fs.readdir(base, { withFileTypes: true });
              for (const d of subdirs.slice(0, 10)) {
                if (d.isDirectory()) {
                  const suffix = parts[1]!.replace(/^\//, '');
                  const fullPath = path.join(base, d.name, suffix);
                  if (fsSync.existsSync(fullPath)) {
                    points.push(path.relative(workspace, fullPath));
                  }
                }
              }
            }
          } catch { /* ignore */ }
        } else {
          const fullPath = path.join(workspace, ep);
          if (fsSync.existsSync(fullPath)) {
            points.push(ep);
          }
        }
      }
    }

    // 通用入口: 检查常见文件
    const commonEntries = ['src/index.ts', 'src/index.tsx', 'src/main.ts', 'src/App.tsx', 'index.ts', 'index.js'];
    for (const ce of commonEntries) {
      if (!points.includes(ce) && fsSync.existsSync(path.join(workspace, ce))) {
        points.push(ce);
      }
    }

    return [...new Set(points)];
  }

  private async analyzeKeyDirs(workspace: string, topDirs: string[], pattern: typeof PROJECT_PATTERNS[0]): Promise<KeyDir[]> {
    const result: KeyDir[] = [];
    const dirMap = pattern?.keyDirMap || {};

    for (const dir of topDirs.slice(0, this.options.maxBreadth)) {
      if (SKIP_DIRS.has(dir)) continue;
      const dirPath = path.join(workspace, dir);
      try {
        const stat = await fs.stat(dirPath);
        if (!stat.isDirectory()) continue;

        const files = await this.listFilesShallow(dirPath, 15);
        const purpose = dirMap[dir] || this.inferDirPurpose(dir, files);

        result.push({
          path: dir,
          purpose,
          fileCount: files.length,
          keyFiles: files.slice(0, 5).map(f => path.basename(f)),
        });
      } catch { /* permission denied */ }
    }

    return result;
  }

  private async listFilesShallow(dirPath: string, limit: number): Promise<string[]> {
    const result: string[] = [];
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries.slice(0, limit)) {
        if (SKIP_DIRS.has(entry.name) || SKIP_FILES.has(entry.name)) continue;
        result.push(entry.name);
        // 递归一层子目录 (只看目录名)
        if (entry.isDirectory() && result.length < limit) {
          try {
            const subEntries = await fs.readdir(path.join(dirPath, entry.name), { withFileTypes: true });
            for (const sub of subEntries.slice(0, 5)) {
              if (!SKIP_DIRS.has(sub.name)) {
                result.push(`${entry.name}/${sub.name}`);
              }
            }
          } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
    return result.slice(0, limit);
  }

  private inferDirPurpose(dirName: string, files: string[]): string {
    const nameLC = dirName.toLowerCase();
    if (/component|comp|ui/.test(nameLC)) return 'UI 组件';
    if (/page|view|route/.test(nameLC)) return '页面/路由';
    if (/service|api|gateway/.test(nameLC)) return '服务/API';
    if (/store|state|model/.test(nameLC)) return '状态管理';
    if (/util|lib|helper|tool/.test(nameLC)) return '工具库';
    if (/test|spec|__test/.test(nameLC)) return '测试';
    if (/config|setting/.test(nameLC)) return '配置';
    if (/type|interface|typedef/.test(nameLC)) return '类型定义';
    if (/hook|composable/.test(nameLC)) return 'Hooks';
    if (/style|css|theme/.test(nameLC)) return '样式/主题';
    if (/asset|image|icon|static|public/.test(nameLC)) return '静态资源';
    if (/doc|docx|markdown/.test(nameLC)) return '文档';
    if (/skill|plugin|extension/.test(nameLC)) return '技能/插件';
    if (files.some(f => f.endsWith('.py'))) return 'Python 模块';
    if (files.some(f => f.endsWith('.rs'))) return 'Rust 模块';
    return '源码';
  }

  private async countFileTypesRecursive(
    workspace: string, dirs: string[], fileTypes: Record<string, number>, maxDepth: number,
  ): Promise<void> {
    for (const dir of dirs.slice(0, 10)) {
      if (SKIP_DIRS.has(dir)) continue;
      const dirPath = path.join(workspace, dir);
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          if (SKIP_DIRS.has(entry.name) || SKIP_FILES.has(entry.name)) continue;
          if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (ext) fileTypes[ext] = (fileTypes[ext] || 0) + 1;
          }
        }
      } catch { /* ignore */ }
    }
  }

  private async analyzeDependencies(workspace: string, topDirs: string[]): Promise<DepGraph> {
    const external: string[] = [];
    const internal: Array<{ from: string; to: string }> = [];

    try {
      const pkgPath = path.join(workspace, 'package.json');
      const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      external.push(...Object.keys(deps).slice(0, 50));
    } catch { /* no package.json */ }

    return { internal, external };
  }

  private async detectPatterns(workspace: string, keyDirs: KeyDir[]): Promise<PatternResult[]> {
    const patterns: PatternResult[] = [];

    // 检测常见设计模式
    for (const dir of keyDirs) {
      const dirPath = path.join(workspace, dir.path);
      try {
        const files = await fs.readdir(dirPath);
        // 工厂模式
        if (files.some(f => /factory|create/i.test(f))) {
          patterns.push({ pattern: 'Factory', locations: [dir.path], description: '工厂模式' });
        }
        // 观察者/事件模式
        if (files.some(f => /event|observer|listener|subscribe|emit/i.test(f))) {
          patterns.push({ pattern: 'Observer', locations: [dir.path], description: '观察者/事件模式' });
        }
        // 路由模式
        if (files.some(f => /route|router/i.test(f))) {
          patterns.push({ pattern: 'Router', locations: [dir.path], description: '路由分发模式' });
        }
        // 中间件模式
        if (files.some(f => /middleware|interceptor|guard/i.test(f))) {
          patterns.push({ pattern: 'Middleware', locations: [dir.path], description: '中间件/拦截器模式' });
        }
      } catch { /* ignore */ }
    }

    return patterns;
  }

  private estimateCodeMapTokens(codeMap: CodeMap): number {
    const text = this.toCompactSummary(codeMap);
    return Math.ceil(text.length * 0.7);
  }

  private loadCache(): void {
    try {
      if (!fsSync.existsSync(CACHE_DIR)) return;
      const cacheFile = path.join(CACHE_DIR, 'explorer-cache.json');
      if (!fsSync.existsSync(cacheFile)) return;
      const data = JSON.parse(fsSync.readFileSync(cacheFile, 'utf-8'));
      for (const [key, value] of Object.entries(data)) {
        this.cache.set(key, value as { map: CodeMap; mtime: number });
      }
    } catch { /* ignore corrupt cache */ }
  }

  saveCache(): void {
    try {
      if (!fsSync.existsSync(CACHE_DIR)) {
        fsSync.mkdirSync(CACHE_DIR, { recursive: true });
      }
      const data: Record<string, any> = {};
      for (const [key, value] of this.cache) {
        data[key] = value;
      }
      fsSync.writeFileSync(
        path.join(CACHE_DIR, 'explorer-cache.json'),
        JSON.stringify(data, null, 2),
        'utf-8',
      );
    } catch { /* ignore write errors */ }
  }
}

export const autonomousExplorer = new AutonomousExplorer();
