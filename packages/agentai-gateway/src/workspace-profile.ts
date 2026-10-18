/**
 * workspace-profile.ts — 工作区画像单一读写模块 (2026-10-17, 批 2-B)
 * ============================================================================
 * 解决的问题: 每个工作区的「画像数据」此前没有单一模块 —
 *   · devPrefs (开发偏好): routes/profile.ts 直写 `.agentai/profile.json`,
 *     agentai-loop.ts 直读同一文件 — 读写两端各写一份 path.join, 无迁移无版本号
 *   · techStack (技术栈): 5 处独立探测互不同步 (project-memory 结构化 /
 *     workspace-agent home 索引 / auto-project-doc 带版本标签 / proactive
 *     文件名匹配 / project-rules-initializer 富扫描), 且探测结果无统一缓存
 *   · 新建工作区时 `.agentai/` 只建 memory 一个子目录, 画像从不初始化
 *
 * 本模块定契约:
 *   · 画像文件 = `<ws>/.agentai/workspace-profile.json` (带 version/时间戳)
 *   · 读写一律走本模块 (atomic write: tmp + rename), 禁止别处再 path.join 直读
 *   · techStack 探测复用 project-memory.detectTechStack (2026-10-17 刚重写成
 *     互斥优先级 + Python 全套), 结果按 TTL 缓存在画像里, 避免每轮重探
 *     (go version / rustc --version 是 execSync, 不缓存会拖慢每轮 ensureContext)
 *   · 旧 `.agentai/profile.json` 的 devPrefs 只读兼容 (迁移期), 新写一律新文件
 *
 * ⚠️ 路径必须走 ws-paths 的 agentAiPath/normWsPath: Windows 中文路径下
 *   path.join(ws, '.agentai', ...) 会吞反斜杠拼坏路径 (实测实录, 见 ws-paths.ts)。
 *
 * 边界声明 (有意不收敛的部分, 避免误改回归):
 *   · auto-project-doc.ts 的 detectTechStack 返回**带版本号**的标签
 *     (如 "React 18.2.0") 用于生成 README 文档 — 与结构化探测用途不同, 保留
 *   · project-rules-initializer.ts 的 scanProject 返回富结构 (topDirs/dirCount/
 *     has*) 喂 LLM 生成规范 — 形状不同, 保留
 *   · workspace-agent.ts 的工作区索引在 ~/.agentai/workspace-index/ (home 下,
 *     用于工作区发现) — 位置与用途不同, 保留
 *   · proactive-suggestion-engine.ts 的文件名匹配用于主动建议 — 保留
 *   这些探针的**结果**若与画像冲突, 以画像 (结构化互斥优先级) 为准。
 */

import * as fs from 'fs';
import { agentAiPath } from './ws-paths.js';
import { detectTechStack, type ProjectMemory } from './project-memory.js';

export const WORKSPACE_PROFILE_VERSION = 1;
const PROFILE_FILE = 'workspace-profile.json';
/** 旧画像文件 (2026-10-17 前的 devPrefs 落点, 只读兼容) */
const LEGACY_PROFILE_FILE = 'profile.json';
/** 技术栈探测缓存 TTL: 5 分钟。依赖文件不会秒变; 但不永久缓存, 免得项目装了新依赖后一直用旧值 */
const TECH_STACK_TTL_MS = 5 * 60 * 1000;

/** 开发偏好 (与 routes/profile.ts POST 的 devPrefs 同形状) */
export interface DevPrefs {
  languages?: string[];
  frontend?: string[];
  backend?: string[];
  packageManager?: string[];
  [k: string]: unknown;
}

export interface WorkspaceProfile {
  version: number;
  createdAt: number;
  updatedAt: number;
  /** 结构化技术栈 (project-memory.detectTechStack 产出, 带 detectedAt) */
  techStack: ProjectMemory['techStack'] | null;
  devPrefs: DevPrefs | null;
  /** 工作区行业标签 (供画像展示, 不影响注入 — 注入仍以 userModel/opts 为准) */
  industry: string;
}

function profileFilePath(ws: string): string {
  return agentAiPath(ws, PROFILE_FILE);
}

/** 原子写: 先写 tmp 再 rename, 避免进程中断留下半截 JSON */
function atomicWrite(filePath: string, data: string): void {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, data, 'utf-8');
  fs.renameSync(tmp, filePath);
}

/** 读画像; 不存在/损坏返回 null (损坏不抛, 调用方按"无画像"处理) */
export function readWorkspaceProfile(ws: string): WorkspaceProfile | null {
  try {
    const p = profileFilePath(ws);
    if (!fs.existsSync(p)) return null;
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as WorkspaceProfile;
  } catch { return null; }
}

/**
 * 读 devPrefs: 新画像优先, 回退旧 `.agentai/profile.json` (迁移兼容)。
 * 收敛点: agentai-loop.ts 此前直读 profile.json, 现统一走本函数。
 */
export function readDevPrefs(ws: string): DevPrefs | null {
  const prof = readWorkspaceProfile(ws);
  if (prof?.devPrefs && typeof prof.devPrefs === 'object') return prof.devPrefs;
  try {
    const legacy = agentAiPath(ws, LEGACY_PROFILE_FILE);
    if (fs.existsSync(legacy)) {
      const parsed = JSON.parse(fs.readFileSync(legacy, 'utf-8'));
      if (parsed?.devPrefs && typeof parsed.devPrefs === 'object') return parsed.devPrefs as DevPrefs;
    }
  } catch { /* ignore */ }
  return null;
}

/** 读-改-写画像 (只传要改的字段; 未传字段保留原值) */
export function writeWorkspaceProfile(
  ws: string,
  patch: Partial<Pick<WorkspaceProfile, 'techStack' | 'devPrefs' | 'industry'>>,
): WorkspaceProfile {
  const existing = readWorkspaceProfile(ws);
  const now = Date.now();
  const next: WorkspaceProfile = {
    version: WORKSPACE_PROFILE_VERSION,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    techStack: patch.techStack !== undefined ? patch.techStack : (existing?.techStack ?? null),
    devPrefs: patch.devPrefs !== undefined ? patch.devPrefs : (existing?.devPrefs ?? null),
    industry: patch.industry !== undefined ? patch.industry : (existing?.industry || ''),
  };
  const dir = agentAiPath(ws);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  atomicWrite(profileFilePath(ws), JSON.stringify(next, null, 2));
  return next;
}

/** 确保画像存在 (不存在则创建, 含首次技术栈探测 + 旧 devPrefs 迁移) */
export function ensureWorkspaceProfile(ws: string): WorkspaceProfile {
  const existing = readWorkspaceProfile(ws);
  if (existing) return existing;
  return writeWorkspaceProfile(ws, {
    techStack: detectTechStack(ws),
    devPrefs: readDevPrefs(ws),
  });
}

/**
 * 取结构化技术栈 (TTL 缓存)。
 * 缓存未过期 → 直接返回; 缺失/过期 → 重新探测并落盘。
 * ⚠️ force=true 用于用户显式刷新 (如 forget project_memory 的"技术栈"重探)。
 */
export function getTechStack(ws: string, opts: { maxAgeMs?: number; force?: boolean } = {}): ProjectMemory['techStack'] {
  const maxAge = opts.maxAgeMs ?? TECH_STACK_TTL_MS;
  const prof = readWorkspaceProfile(ws);
  if (!opts.force && prof?.techStack && (Date.now() - (prof.techStack.detectedAt || 0)) < maxAge) {
    return prof.techStack;
  }
  const detected = detectTechStack(ws);
  writeWorkspaceProfile(ws, { techStack: detected });
  return detected;
}

/** 画像是否存在 (供 GUI/工具判断"这是不是一个已初始化的工作区") */
export function hasWorkspaceProfile(ws: string): boolean {
  return readWorkspaceProfile(ws) !== null;
}
