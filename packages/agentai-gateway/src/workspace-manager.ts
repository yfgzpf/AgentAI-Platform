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
import { currentRequestWorkspace } from './request-scope.js';
import { ensureWorkspaceProfile } from './workspace-profile.js';

/**
 * 归一化路径分隔符 (2026-10-16): 反斜杠 Windows 路径 (如 "F:\目录已检查\澳彩")
 * 统一转成正斜杠形式。Node 在中文路径下 path.resolve/path.join 会静默丢弃
 * 反斜杠导致路径损坏 ("F:目录已检查澳彩"), 先归一化再参与任何路径拼接。
 * posix 路径不受影响 (无 \ 可替换)。
 */
export function normalizeSeparators(p: string): string {
  return String(p || '').trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '');
}

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
  // 2026-10-16 打包/部署加固: 之前这两个目录不在 STANDARD_SUBDIRS 里,
  // 靠各模块自己 mkdir —— 一旦 init 时漏建(或容器里权限不足), 首次写入就失败。
  checkpoints: 'checkpoints', // 会话级 checkpoint/rewind 存储
  tasks:       'tasks',       // 长任务快照
} as const;

/**
 * 解析 AgentAI 数据根目录（唯一权威入口）
 * ---------------------------------------------------------------------------
 * 优先级: AGENTAI_HOME > <userHome>/.agentai
 *
 * ⚠️ 2026-10-16: 此前 session-checkpoint / task-snapshot / worktree 三处各自
 * 硬编码 `path.join(os.homedir(), '.agentai', ...)`，**绕过 AGENTAI_HOME**。后果:
 *   - 桌面版（Tauri 显式设 AGENTAI_HOME=<data_dir>）checkpoint 却写到
 *     %USERPROFILE%\.agentai\checkpoints，与 gateway 其余数据分离 →
 *     卸载/迁移/多版本共存行为不可预期
 *   - Docker 里 compose 挂的持久卷指向 /app/.agentai/memory，checkpoints 却
 *     落在没挂卷的 /app/.agentai/checkpoints → 容器重建全丢
 * 新代码一律用本函数，**不要再写 os.homedir()**。
 */
export function resolveAgentAiHome(explicit?: string): string {
  if (explicit) return explicit;
  const env = process.env.AGENTAI_HOME;
  if (env && env.trim()) return env.trim();
  return path.join(getUserHome(), '.agentai');
}

export type SubdirKey = keyof typeof STANDARD_SUBDIRS;

/**
 * 工作区/文件操作的允许根目录 (2026-10-17 批 2-B: 单一实现; 10-17 晚: 分发安全修正)
 * ---------------------------------------------------------------------------
 * 此前有**两份各自为政**的实现: routes/files.ts 的 getAllowedRoots 与
 * safety/path-guard.ts 的 getAllowedRoots — 根集合不一致 (前者含 projectDir +
 * monorepo 根, 后者含 AGENTAI_FS_ALLOWED_ROOTS), 且两处都写
 * `require('os').homedir()` — 在 ESM 运行时 (tsx / dist) require 未定义,
 * 那个 home 根**从来没生效过** (截图存桌面等场景被误拦, 且无人发现因为被 catch 吞)。
 * 现统一为本函数 (并集语义), 两处消费方各自委托, 不再有第二份实现。
 *
 * ═══ 2026-10-17 晚 P0: 移除"projectDir 上两级"盲目授权 (分发安全) ═══
 * 原实现 `path.resolve(projectDir, '..', '..')` 无条件入根 — 这是把开发机的
 * monorepo 布局当成普适事实: 本机 projectDir=F:/目录已检查/澳彩 → 上两级=F:/,
 * **整个 F 盘变成允许根**; 分发到用户机上, 项目目录上两级可能是 C:\Users\某人
 * 甚至盘根 — 同样是越权放大。现改为 detectMonorepoRoot(): 只授予**确实探测到
 * monorepo 标记** (pnpm-workspace.yaml / lerna.json / package.json#workspaces)
 * 的祖先目录, 且锚点是 process.cwd() (gateway 自身所在), 不是用户工作区。
 */
export function getWorkspaceAllowedRoots(): string[] {
  const roots: string[] = [];
  // cwd: 仅当不是文件系统根时才授予 (分发场景 cwd 可能是盘根, 如 C:\ —
  // 那等于整盘授权; 开发场景 cwd=gateway 包目录, 正常保留)
  const cwd = path.resolve(process.cwd());
  if (path.parse(cwd).root !== cwd) roots.push(cwd);
  const wm = WorkspaceManager.getInstance();
  if (wm.projectDir) roots.push(wm.projectDir);
  if (process.env.AGENTAI_WORKSPACE) roots.push(path.resolve(process.env.AGENTAI_WORKSPACE));
  if (process.env.AGENTAI_FS_ALLOWED_ROOTS) {
    for (const r of process.env.AGENTAI_FS_ALLOWED_ROOTS.split(',').map(s => s.trim())) {
      if (r) roots.push(path.resolve(r));
    }
  }
  // monorepo 根 (仅标记验证通过的才授予 — 见函数头 P0 说明)
  try {
    const monorepoRoot = detectMonorepoRoot(cwd);
    if (monorepoRoot) roots.push(monorepoRoot);
  } catch { /* ignore */ }
  // 用户主目录 (原两处都有这行意图, 但 require 在 ESM 下从未生效 — 本修复让其真正生效)
  try {
    const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
    if (home) roots.push(path.resolve(home));
  } catch { /* ignore */ }
  return [...new Set(roots.map(r => path.resolve(r)))];
}

/**
 * 探测 monorepo 根目录 (2026-10-17 P0 新增, 分发安全)
 * ---------------------------------------------------------------------------
 * 从 fromDir 向上逐级找 monorepo 标记:
 *   - pnpm-workspace.yaml / lerna.json 存在, 或
 *   - package.json 含 "workspaces" 字段
 * 最多向上 4 层, 命中即返回; 没有任何标记返回 null (调用方不授权)。
 *
 * 为什么需要它: 原 getWorkspaceAllowedRoots 用 `projectDir/../..` 盲目猜
 * monorepo 根 — 开发机上猜对 (且顺带把 F:/ 盘根也猜进来了), 分发机上猜错
 * (把用户目录的上级甚至盘根加进允许根)。"探测到标记才认" 让同一个函数在
 * 开发/分发两种场景都给出正确答案。
 */
export function detectMonorepoRoot(fromDir: string): string | null {
  let cur = path.resolve(fromDir);
  for (let depth = 0; depth < 4; depth++) {
    for (const marker of ['pnpm-workspace.yaml', 'lerna.json']) {
      try {
        if (fs.existsSync(path.join(cur, marker))) return cur;
      } catch { /* ignore */ }
    }
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(cur, 'package.json'), 'utf-8'));
      if (pkg && pkg.workspaces) return cur;
    } catch { /* 无 package.json 或解析失败 — 继续向上 */ }
    const parent = path.dirname(cur);
    if (parent === cur) break; // 已到文件系统根
    cur = parent;
  }
  return null;
}

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
    this.aiWorkDir = resolveAgentAiHome(opts.aiWorkDir);

    // ⚠️ 2026-10-16: 归一化分隔符。构造参数可能是反斜杠 Windows 中文路径
    // (如 "F:\目录已检查\澳彩"), 不归一化后续 .agentai/ 读写全失效。
    this.projectDir = opts.projectDir ? normalizeSeparators(opts.projectDir) : process.cwd();
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

  // ========================
  // 持久化: 工作区路径跨进程保存
  // ========================

  /** 持久化工作区配置到文件 (重启后恢复) */
  private _saveWorkspaceConfig(): void {
    const configDir = path.join(this.aiWorkDir, 'config');
    try {
      if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'workspace.json'),
        JSON.stringify({ projectDir: this.projectDir }, null, 2),
        'utf-8',
      );
    } catch (e) {
      console.error('[workspace-manager] persist workspace config failed:', e);
    }
  }

  /** 从持久化文件恢复工作区路径 */
  private _loadWorkspaceConfig(): string | null {
    const configPath = path.join(this.aiWorkDir, 'config', 'workspace.json');
    try {
      if (fs.existsSync(configPath)) {
        const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        return data.projectDir || null;
      }
    } catch { /* ignore */ }
    return null;
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
    // 2026-10-06 P0跨请求串扰修复: 绝对路径的越界校验与相对路径的基准
    //   **必须用请求级工作区**，不是全局单例。
    //   之前两者都用 this.projectDir，而该值会被routes/chat.ts 的请求体改写
    //   → A 请求传进来的绝对路径可能因 projB 的 projectDir 而被误判为"越界"
    //   → 反之 B 请求传 projA 的路径会被"合法"放行 → 直接读写他人项目。
    //不在请求上下文中（后台任务/单测）→ 回退 projectDir，行为不变。
    const base = currentRequestWorkspace() || this.projectDir;

    if (!relativePath) return base;
    // 绝对路径: 验证是否在 projectDir 内
    if (path.isAbsolute(relativePath)) {
      const rel = path.relative(base, relativePath);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(
          `Path "${relativePath}" is outside project directory "${base}". Use a relative path.`
        );
      }
      return relativePath;
    }
    return path.resolve(base, relativePath);
  }

  /**
   * 设置当前项目目录 (前端选择后调用)
   * 自动创建项目级 .agentai/ 子目录, 并持久化到磁盘
   */
  setProjectDir(dir: string): void {
    // ⚠️ 2026-10-16 修复: path.resolve 对反斜杠 Windows 中文路径 (如 "F:\目录已检查\澳彩")
    // 会静默丢弃反斜杠 → 拼成 "F:目录已检查澳彩" (路径损坏), 导致 .agentai/ 下所有读写失效。
    // 先归一化分隔符 (反斜杠→正斜杠), 保证盘符+中文路径完整。
    const normalized = normalizeSeparators(dir);
    if (!fs.existsSync(normalized)) {
      throw new Error(`Project directory does not exist: ${dir}`);
    }
    this.projectDir = normalized;
    // 创建项目级记忆目录
    ensureDir(normalized + '/.agentai/memory');
    // 持久化 (重启后恢复)
    this._saveWorkspaceConfig();
  }

  /**
   * 创建工作区目录 (批 2-B, 2026-10-17)
   * ---------------------------------------------------------------------------
   * 在允许根 (getWorkspaceAllowedRoots) 内建目录 + `.agentai/` 骨架 + 初始化画像
   * (ensureWorkspaceProfile: 结构化技术栈探测 + 旧 devPrefs 迁移)。
   *
   * ⚠️ **只创建, 不切换**当前工作区 — 切换是用户显式动作 (POST /v1/workspace /
   *    GUI 清单点击 / create_workspace 工具也遵守这条), 避免"某处顺手建个目录
   *    就把当前会话的工作区偷走" (澳彩项目里挖洞时建个洞库工作区, 结果上下文全变)。
   * ⚠️ name 只接受单段目录名: 拒绝路径分隔符 / 盘符 / `..` — 防越权写到允许根外。
   * ⚠️ 目录已存在 → 不报错, 补建骨架并返回 existed:true (幂等, GUI/工具可安全重试)。
   */
  createProjectDir(name: string, parentDir?: string): { path: string; created: boolean; existed: boolean } {
    const clean = String(name || '').trim();
    if (!clean) throw new Error('工作区名称不能为空');
    if (clean.length > 64) throw new Error('工作区名称过长 (≤64 字符)');
    // 防越权: name 只能是单段目录名 (反斜杠在 Windows 也是分隔符, 一并禁)
    if (/[\\/:*?"<>|]/.test(clean)) {
      throw new Error(`非法工作区名称: "${clean}" — 不能包含路径分隔符或 Windows 保留字符 (\\ / : * ? " < > |)`);
    }
    if (clean === '.' || clean === '..' || clean.startsWith('..')) {
      throw new Error(`非法工作区名称: "${clean}"`);
    }

    const roots = getWorkspaceAllowedRoots();
    const parent = normalizeSeparators(parentDir || this.projectDir);
    if (!parent) throw new Error('未指定父目录 (parent)');
    const parentNorm = normalizeSeparators(path.resolve(parent));
    // 父目录必须落在某个允许根内 (防"在 C:\\ 下建工作区"这类越权)
    const inRoots = roots.some(r => {
      const rn = normalizeSeparators(r);
      return parentNorm === rn || parentNorm.startsWith(rn + '/');
    });
    if (!inRoots) {
      throw new Error(`父目录不在允许范围内: ${parent} (允许根: ${roots.map(r => normalizeSeparators(r)).join(' | ')})`);
    }
    if (!fs.existsSync(parentNorm) || !fs.statSync(parentNorm).isDirectory()) {
      throw new Error(`父目录不存在或不是目录: ${parent}`);
    }

    const target = parentNorm + '/' + clean;
    const existed = fs.existsSync(target);
    if (existed && !fs.statSync(target).isDirectory()) {
      throw new Error(`目标已存在且不是目录: ${target}`);
    }
    if (!existed) fs.mkdirSync(target, { recursive: true });
    // .agentai/ 骨架 (与 setProjectDir 对齐: 至少建 memory 子目录)
    ensureDir(target + '/.agentai/memory');
    // 初始化工作区画像 (已存在则不动; 首次会跑一次技术栈探测)
    ensureWorkspaceProfile(target);
    return { path: target, created: !existed, existed };
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
      // 尝试从持久化文件恢复上次的工作区路径
      try {
        const saved = _instance._loadWorkspaceConfig();
        // 归一化分隔符 (历史持久化值可能是反斜杠 Windows 形式, 中文路径会损坏)
        const normalized = saved ? normalizeSeparators(saved) : null;
        if (normalized && fs.existsSync(normalized)) {
          _instance.projectDir = normalized;
          console.log(`[workspace-manager] 已从配置文件恢复工作区: ${normalized}`);
        }
      } catch { /* ignore */ }
    }
    return _instance;
  }

  /** 设置单例 */
  static setInstance(instance: WorkspaceManager): void {
    _instance = instance;
  }
}
