/**
 * WorkspaceManager — AI 工作目录动态配置与管理
 * ----------------------------------------------------------------
 * 核心概念:
 *   1. AI 工作目录 (aiWorkDir)    = ~/.agentai  (存储 AI 运行时数据)
 *      子目录: sessions/ memory/ skills/ worktrees/ cache/ config/
 *   2. 项目操作目录 (projectDir)  = 用户选择 (AI 进行文件操作的工作区)
 *
 * 路径解析策略 (多层级):
 *   1. 环境变量 AGENTAI_HOME — 部署时覆盖 (最高优先级)
 *   2. 平台默认 ~/.agentai    — Windows: %USERPROFILE%\.agentai
 *                                macOS/Linux: $HOME/.agentai
 *   3. 回退 ./.agentai         — 无 home 目录时的 fallback
 *
 * 生命周期:
 *   init() → 创建全部子目录 → ready
 *   运行时: resolveAiPath() / resolveProjectPath() 路径解析
 *   销毁时: (无特殊清理 — 数据持久化由上层控制)
 *
 * 跨平台兼容:
 *   - Windows: os.homedir() → C:\Users\xxx 或 USERPROFILE
 *   - macOS:   os.homedir() → /Users/xxx
 *   - Linux:   os.homedir() → /home/xxx
 *   - 路径分隔符: 始终用 path.join/path.resolve, 不硬编码 / 或 \
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ===== 类型定义 =====

export interface WorkspaceManagerOptions {
  /** 自定义 AI 工作目录根 (覆盖默认 ~/.agentai) */
  aiWorkDir?: string;
  /** 当前项目目录 (可选, 运行时设置) */
  projectDir?: string;
}

export interface WorkspaceManagerState {
  aiWorkDir: string;
  projectDir: string;
  initialized: boolean;
  /** 子目录路径 (懒加载缓存) */
  subdirs: Record<string, string>;
}

// ===== 标准化子目录结构 =====

export const STANDARD_SUBDIRS = {
  sessions:   'sessions',    // 会话 checkpoint
  memory:     'memory',      // 全局记忆 (跨项目)
  skills:     'skills',      // 用户安装的技能
  worktrees:  'worktrees',   // Git worktree 缓存
  cache:      'cache',       // LLM 缓存 / embeddings
  config:     'config',      // sandbox rules, user-model, QQ config
} as const;

export type SubdirKey = keyof typeof STANDARD_SUBDIRS;

// ===== 单例 =====

let _instance: WorkspaceManager | null = null;

// ===== 工具函数 =====

/** 获取用户主目录 (跨平台) */
export function getUserHome(): string {
  // 1. 环境变量 HOME (macOS/Linux/git-bash)
  // 2. 环境变量 USERPROFILE (Windows)
  // 3. os.homedir() (Node.js 内置, 最可靠)
  // 4. 回退到 process.cwd()
  const candidates = [
    process.env.HOME,
    process.env.USERPROFILE,
    os.homedir(),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  // 极端回退: 在 cwd 下创建 .agentai
  return process.cwd();
}

/** 确保目录存在 (递归创建) */
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ===== WorkspaceManager 类 =====

export class WorkspaceManager {
  public readonly aiWorkDir: string;
  public projectDir: string;
  private _initialized = false;
  private _subdirs = new Map<string, string>();

  constructor(opts: WorkspaceManagerOptions = {}) {
    // 路径解析优先级: 构造参数 > 环境变量 > 平台默认
    this.aiWorkDir = opts.aiWorkDir
      || process.env.AGENTAI_HOME
      || path.join(getUserHome(), '.agentai');

    this.projectDir = opts.projectDir || process.cwd();
  }

  /** 初始化: 创建全部标准子目录 */
  init(): this {
    if (this._initialized) return this;
    ensureDir(this.aiWorkDir);
    for (const [key, sub] of Object.entries(STANDARD_SUBDIRS)) {
      const fullPath = path.join(this.aiWorkDir, sub);
      ensureDir(fullPath);
      this._subdirs.set(key, fullPath);
    }
    this._initialized = true;
    return this;
  }

  /** 是否已初始化 */
  get initialized(): boolean { return this._initialized; }

  // ========================
  // 路径解析 API
  // ========================

  /** 获取 AI 工作目录下的标准子目录完整路径 */
  subdir(key: SubdirKey): string {
    return this._subdirs.get(key) || path.join(this.aiWorkDir, key);
  }

  /**
   * 解析相对于 AI 工作目录的路径
   * @param relativePath 相对路径 (相对于 aiWorkDir)
   * @returns 绝对路径
   */
  resolveAiPath(relativePath: string): string {
    return path.resolve(this.aiWorkDir, relativePath);
  }

  /**
   * 解析相对于项目操作目录的路径 (文件操作用)
   * @param relativePath 相对路径 (相对于 projectDir)
   * @returns 绝对路径
   */
  resolveProjectPath(relativePath: string): string {
    if (!relativePath) return this.projectDir;
    // 绝对路径: 验证是否在 projectDir 内
    if (path.isAbsolute(relativePath)) {
      const rel = path.relative(this.projectDir, relativePath);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(
          `Path "${relativePath}" is outside project directory "${this.projectDir}". Use a relative path.`
        );
      }
      return relativePath;
    }
    return path.resolve(this.projectDir, relativePath);
  }

  /**
   * 设置当前项目目录 (前端选择后调用)
   * 自动创建项目级 .agentai/ 子目录
   */
  setProjectDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      throw new Error(`Project directory does not exist: ${dir}`);
    }
    this.projectDir = path.resolve(dir);
    // 创建项目级记忆目录
    ensureDir(path.join(this.projectDir, '.agentai', 'memory'));
  }

  // ========================
  // 配置路径 (便捷方法)
  // ========================

  /** 沙箱规则文件路径 */
  get sandboxRulesPath(): string {
    return path.join(this.subdir('config'), 'sandbox-rules.json');
  }

  /** 用户模型文件路径 */
  get userModelPath(): string {
    return path.join(this.subdir('config'), 'user-model.json');
  }

  /** QQ 配置路径 */
  get qqConfigPath(): string {
    return path.join(this.subdir('config'), 'qq-config.json');
  }

  /** 全局记忆文件路径 */
  get globalMemoryPath(): string {
    return path.join(this.subdir('memory'), 'global-memory.json');
  }

  /** 项目记忆目录 */
  get projectMemoryDir(): string {
    return path.join(this.projectDir, '.agentai', 'memory');
  }

  /** LLM 缓存目录 */
  get cacheDir(): string {
    return this.subdir('cache');
  }

  /** 会话 checkpoint 目录 */
  get sessionsDir(): string {
    return this.subdir('sessions');
  }

  /** 技能根目录 */
  get skillsDir(): string {
    return this.subdir('skills');
  }

  // ========================
  // 工具方法
  // ========================

  /** 获取状态摘要 (供前端 /status 查询) */
  toJSON(): WorkspaceManagerState {
    const subdirs: Record<string, string> = {};
    for (const [k, v] of this._subdirs) {
      subdirs[k] = v;
    }
    return {
      aiWorkDir: this.aiWorkDir,
      projectDir: this.projectDir,
      initialized: this._initialized,
      subdirs,
    };
  }

  /** 获取单例 (全局复用, 避免多处 new) */
  static getInstance(): WorkspaceManager {
    if (!_instance) {
      _instance = new WorkspaceManager();
    }
    return _instance;
  }

  /** 设置单例 */
  static setInstance(instance: WorkspaceManager): void {
    _instance = instance;
  }
}
