/**
 * Project Rules Initializer — AI 自动创建项目规范
 * ----------------------------------------------------
 * 当 AI 第一次进入一个 workspace 时，自动检测项目结构、
 * 生成项目规范文件 (.trae/rules/project_rules.md)，
 * 确保后续所有会话都能加载相同的规范。
 *
 * 设计意图:
 *   1. 新项目 → AI 自动扫描 → 生成规则 → 持久化到文件
 *   2. 已有规则 → 跳过 → 直接加载到 system prompt
 *   3. 整个过程对用户透明，不阻塞首次交互
 *
 * 触发点: buildImmutablePrefix() 中调用 ensureProjectRules()
 * 幂等性: 文件已存在时不重复生成
 */
import fs from 'fs';
import path from 'path';
import type { AgentAIRouter } from './llm-router.js';

/** 规则文件相对于 workspace 的路径 */
const RULES_REL_PATH = path.join('.trae', 'rules', 'project_rules.md');

/** 检测到的项目特征，用于 LLM 生成规则 */
interface ProjectProfile {
  name: string;
  techStack: string[];
  topDirs: string[];
  hasPackageJson: boolean;
  hasTsconfig: boolean;
  hasPython: boolean;
  hasDocker: boolean;
  dirCount: number;
}

/**
 * 确保 workspace 存在项目规则文件
 * - 已存在 → 读取并返回内容
 * - 不存在 → 分析项目 → LLM 生成 → 写入 → 返回内容
 * - 不可达 → 静默返回 null（不阻塞主流程）
 */
export async function ensureProjectRules(
  workspace: string,
  router: AgentAIRouter,
): Promise<string | null> {
  try {
    const rulesFile = path.join(workspace, RULES_REL_PATH);
    if (fs.existsSync(rulesFile)) {
      return fs.readFileSync(rulesFile, 'utf-8');
    }
    // 项目根新建，生成规范
    const profile = scanProject(workspace);
    const content = await generateRules(profile, workspace, router);
    if (!content) return null;

    // 确保目录存在并写入
    const dir = path.dirname(rulesFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(rulesFile, content, 'utf-8');
    console.info(`[project-rules] created: ${rulesFile}`);
    return content;
  } catch (e: unknown) {
    console.warn(`[project-rules] init skipped: ${(e as Error)?.message}`);
    return null;
  }
}

/**
 * 扫描 workspace 项目结构，提取特征
 */
function scanProject(workspace: string): ProjectProfile {
  const profile: ProjectProfile = {
    name: path.basename(workspace),
    techStack: [],
    topDirs: [],
    hasPackageJson: false,
    hasTsconfig: false,
    hasPython: false,
    hasDocker: false,
    dirCount: 0,
  };

  try {
    if (!fs.existsSync(workspace)) return profile;
    const entries = fs.readdirSync(workspace).slice(0, 50);
    const dirs: string[] = [];
    for (const e of entries) {
      const full = path.join(workspace, e);
      try {
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          dirs.push(e);
        } else if (e === 'package.json') {
          profile.hasPackageJson = true;
          const pkg = JSON.parse(fs.readFileSync(full, 'utf-8'));
          profile.name = pkg.name || profile.name;
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };
          if (deps.react) profile.techStack.push('React');
          if (deps.vue) profile.techStack.push('Vue');
          if (deps.express) profile.techStack.push('Express');
          if (deps.next) profile.techStack.push('Next.js');
          if (deps.vite) profile.techStack.push('Vite');
          if (deps.typescript || pkg.devDependencies?.typescript) profile.techStack.push('TypeScript');
          if (deps.electron || pkg.devDependencies?.electron) profile.techStack.push('Electron');
          if (deps.tauri || pkg.devDependencies?.['@tauri-apps/cli']) profile.techStack.push('Tauri');
          if (deps['antd'] || pkg.dependencies?.['antd']) profile.techStack.push('Ant Design');
          if (deps.prisma) profile.techStack.push('Prisma');
        } else if (e === 'tsconfig.json') {
          profile.hasTsconfig = true;
          if (!profile.techStack.includes('TypeScript')) profile.techStack.push('TypeScript');
        } else if (e === 'pyproject.toml' || e === 'requirements.txt' || e === 'setup.py') {
          profile.hasPython = true;
          if (!profile.techStack.includes('Python')) profile.techStack.push('Python');
        } else if (e === 'Dockerfile' || e === 'docker-compose.yml') {
          profile.hasDocker = true;
        }
      } catch { /* stat/parse 失败跳过单个文件 */ }
    }
    profile.topDirs = dirs.slice(0, 20);
    profile.dirCount = dirs.length;
  } catch { /* workspace 不可读时跳过 */ }

  return profile;
}

/**
 * 用 LLM 根据项目特征生成规范文件内容
 */
async function generateRules(
  profile: ProjectProfile,
  workspace: string,
  router: AgentAIRouter,
): Promise<string | null> {
  const techInfo = profile.techStack.length > 0
    ? profile.techStack.join(', ')
    : profile.hasPython ? 'Python' : '通用';

  const dirInfo = profile.topDirs.length > 0
    ? profile.topDirs.slice(0, 15).map(d => `  - ${d}/`).join('\n')
    : '  (空或无法读取)';

  const prompt = `你是一个项目规范生成专家。请分析以下项目特征，生成一份适用于 AI 辅助开发的 ${techInfo} 项目规范文件。

## 项目特征
- 项目名: ${profile.name}
- 技术栈: ${techInfo}
- 顶层目录 (${profile.dirCount} 个):
${dirInfo}

## 输出要求
生成一份 Markdown 文件，包含以下章节（如果适用）:

1. **项目概述** — 简短描述项目是什么
2. **技术栈** — 列出检测到的技术栈
3. **目录结构** — 基于顶层目录给出建议的结构说明
4. **编码规范** — 通用规范（命名、导入顺序、代码风格），基于技术栈给出针对性的规范
5. **架构约束** — 如果检测到 monorepo (如 packages/)，列出层间依赖规则
6. **脚本命令** — 常见的 dev/build/test/lint 命令
7. **禁止事项** — 通用的禁止操作（如硬编码路径、process.kill 等）
8. **工作流程** — AI 辅助开发的通用建议（先读后改、最小改动）

格式要求:
- 使用 Markdown
- 用 "> 此文件由 AI 自动生成" 开头
- 不包含无法从项目特征中确定的假设
- 保持通用和简洁，单文件不超过 100 行
`;

  try {
    const res = await router.chat({
      model: 'agentai',
      messages: [
        { role: 'system', content: '你是一个项目规范生成专家。只输出规范文件内容，不要解释。' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      maxTokens: 2000,
    });

    return res?.content || null;
  } catch { /* LLM 调用失败时跳过 */
    return null;
  }
}
