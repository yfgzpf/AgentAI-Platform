/**
 * auto_project_doc — AI 自动维护项目说明文件
 * 
 * 功能:
 *   1. 自动审查项目结构并生成说明文件
 *   2. 维护项目上下文和任务状态
 *   3. 实时更新项目状态
 * 
 * 三个核心文件:
 *   - PROJECT_README.md: 项目架构、技术栈、目录结构
 *   - PROJECT_CONTEXT.md: 当前任务、决策记录、注意事项
 *   - PROJECT_STATE.md: 实时状态（打开文件、Git、服务）
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export interface ProjectDocOptions {
  action: 'review' | 'update_context' | 'refresh_state' | 'read';
  workspace: string;
  contextData?: {
    currentTask?: string;
    decisions?: string[];
    relatedFiles?: string[];
    notes?: string[];
  };
}

export interface ProjectDocResult {
  success: boolean;
  files: {
    readme: { exists: boolean; lastModified: number };
    context: { exists: boolean; lastModified: number };
    state: { exists: boolean; lastModified: number };
  };
  content?: string;
  message: string;
}

const DOC_NAMES = {
  readme: 'PROJECT_README.md',
  context: 'PROJECT_CONTEXT.md',
  state: 'PROJECT_STATE.md',
} as const;

/**
 * 主入口: 自动维护项目说明文件
 */
export async function autoProjectDoc(options: ProjectDocOptions): Promise<ProjectDocResult> {
  const { action, workspace, contextData } = options;
  const agentaiDir = path.join(workspace, '.agentai');

  // 确保 .agentai 目录存在
  if (!fs.existsSync(agentaiDir)) {
    fs.mkdirSync(agentaiDir, { recursive: true });
  }

  const result: ProjectDocResult = {
    success: true,
    files: checkFiles(agentaiDir),
    message: '',
  };

  try {
    switch (action) {
      case 'review':
        await generateReadme(agentaiDir, workspace);
        await generateContext(agentaiDir, workspace, contextData);
        await refreshState(agentaiDir, workspace);
        result.message = '项目审查完成，已生成/更新所有说明文件';
        break;

      case 'update_context':
        await generateContext(agentaiDir, workspace, contextData);
        result.message = '项目上下文已更新';
        break;

      case 'refresh_state':
        await refreshState(agentaiDir, workspace);
        result.message = '项目状态已刷新';
        break;

      case 'read':
        result.content = readAllDocs(agentaiDir);
        result.message = '已读取所有说明文件';
        break;

      default:
        result.success = false;
        result.message = `未知操作: ${action}`;
    }

    // 更新文件状态
    result.files = checkFiles(agentaiDir);
    return result;

  } catch (e: any) {
    return {
      success: false,
      files: result.files,
      message: `操作失败: ${e.message}`,
    };
  }
}

/**
 * 检查文件存在状态和修改时间
 */
function checkFiles(agentaiDir: string): ProjectDocResult['files'] {
  const check = (name: string) => {
    const filePath = path.join(agentaiDir, name);
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      return { exists: true, lastModified: stats.mtimeMs };
    }
    return { exists: false, lastModified: 0 };
  };

  return {
    readme: check(DOC_NAMES.readme),
    context: check(DOC_NAMES.context),
    state: check(DOC_NAMES.state),
  };
}

/**
 * 生成 PROJECT_README.md — 项目架构说明
 */
async function generateReadme(agentaiDir: string, workspace: string): Promise<void> {
  const filePath = path.join(agentaiDir, DOC_NAMES.readme);

  // 检测技术栈
  const techStack = detectTechStack(workspace);

  // 分析目录结构
  const structure = analyzeStructure(workspace);

  // 查找关键文件
  const keyFiles = findKeyFiles(workspace);

  // 检测构建命令
  const buildCommands = detectBuildCommands(workspace);

  const content = `# 项目概述: ${path.basename(workspace)}

## 技术栈
${techStack.map(t => `- ${t}`).join('\n')}

## 目录结构
\`\`\`
${structure}
\`\`\`

## 关键文件
${keyFiles.map(f => `- ${f}`).join('\n')}

## 构建命令
${buildCommands.map(c => `- \`${c}\``).join('\n')}

---
*自动生成于 ${new Date().toLocaleString()}*
`;

  fs.writeFileSync(filePath, content, 'utf-8');
}

/**
 * 生成 PROJECT_CONTEXT.md — 当前任务上下文
 */
async function generateContext(
  agentaiDir: string,
  workspace: string,
  contextData?: ProjectDocOptions['contextData']
): Promise<void> {
  const filePath = path.join(agentaiDir, DOC_NAMES.context);

  // 读取现有内容（如果有）
  let existingTasks: string[] = [];
  let existingDecisions: string[] = [];

  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf-8');
    const taskMatch = existing.match(/## 进行中的任务\n([\s\S]*?)(?=##|$)/);
    if (taskMatch) {
      existingTasks = taskMatch[1].trim().split('\n').filter(l => l.trim());
    }
    const decisionMatch = existing.match(/## 最近决策\n([\s\S]*?)(?=##|$)/);
    if (decisionMatch) {
      existingDecisions = decisionMatch[1].trim().split('\n').filter(l => l.trim());
    }
  }

  // 合并新数据
  const tasks = contextData?.currentTask
    ? [...existingTasks, `- [ ] ${contextData.currentTask}`]
    : existingTasks;

  const decisions = contextData?.decisions
    ? [...existingDecisions, ...contextData.decisions.map(d => `- ${new Date().toLocaleDateString()}: ${d}`)]
    : existingDecisions;

  const relatedFiles = contextData?.relatedFiles || [];
  const notes = contextData?.notes || [];

  const content = `# 当前任务上下文

## 进行中的任务
${tasks.length > 0 ? tasks.join('\n') : '- 暂无进行中的任务'}

## 最近决策
${decisions.slice(-10).join('\n') || '- 暂无决策记录'}

## 相关文件
${relatedFiles.length > 0 ? relatedFiles.map(f => `- ${f}`).join('\n') : '- 暂无相关文件'}

## 注意事项
${notes.length > 0 ? notes.map(n => `- ${n}`).join('\n') : '- 暂无注意事项'}

---
*更新于 ${new Date().toLocaleString()}*
`;

  fs.writeFileSync(filePath, content, 'utf-8');
}

/**
 * 刷新 PROJECT_STATE.md — 实时项目状态
 */
async function refreshState(agentaiDir: string, workspace: string): Promise<void> {
  const filePath = path.join(agentaiDir, DOC_NAMES.state);

  // 获取 Git 状态
  const gitStatus = getGitStatus(workspace);

  // 获取最近修改的文件
  const recentChanges = getRecentChanges(workspace);

  // 检测运行中的服务（简化版）
  const runningServices = detectRunningServices(workspace);

  const content = `# 实时项目状态

## Git 状态
- 分支: ${gitStatus.branch}
- 未提交文件: ${gitStatus.uncommitted} 个
- 最近提交: ${gitStatus.lastCommit}

## 最近修改
${recentChanges.map(c => `- ${c}`).join('\n') || '- 暂无修改记录'}

## 运行服务
${runningServices.map(s => `- ${s}`).join('\n') || '- 暂无运行中的服务'}

---
*刷新于 ${new Date().toLocaleString()}*
`;

  fs.writeFileSync(filePath, content, 'utf-8');
}

/**
 * 读取所有说明文件内容
 */
function readAllDocs(agentaiDir: string): string {
  const parts: string[] = [];

  for (const [key, name] of Object.entries(DOC_NAMES)) {
    const filePath = path.join(agentaiDir, name);
    if (fs.existsSync(filePath)) {
      parts.push(`\n=== ${name} ===\n`);
      parts.push(fs.readFileSync(filePath, 'utf-8'));
    }
  }

  return parts.join('\n');
}

// ============ 辅助函数 ============

function detectTechStack(workspace: string): string[] {
  const stack: string[] = [];

  if (fs.existsSync(path.join(workspace, 'package.json'))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(workspace, 'package.json'), 'utf-8'));
      if (pkg.dependencies?.react) stack.push(`React ${pkg.dependencies.react}`);
      if (pkg.dependencies?.vue) stack.push(`Vue ${pkg.dependencies.vue}`);
      if (pkg.dependencies?.next) stack.push(`Next.js ${pkg.dependencies.next}`);
      if (pkg.devDependencies?.typescript) stack.push('TypeScript');
      if (pkg.dependencies?.express) stack.push('Express.js');
    } catch {}
  }

  if (fs.existsSync(path.join(workspace, 'Cargo.toml'))) stack.push('Rust');
  if (fs.existsSync(path.join(workspace, 'go.mod'))) stack.push('Go');
  if (fs.existsSync(path.join(workspace, 'requirements.txt'))) stack.push('Python');
  if (fs.existsSync(path.join(workspace, 'Dockerfile'))) stack.push('Docker');

  if (stack.length === 0) stack.push('未知技术栈');
  return stack;
}

function analyzeStructure(workspace: string, depth = 0): string {
  if (depth > 2) return '';

  const entries = fs.readdirSync(workspace, { withFileTypes: true });
  const lines: string[] = [];

  for (const entry of entries.slice(0, 15)) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

    const prefix = '  '.repeat(depth);
    if (entry.isDirectory()) {
      lines.push(`${prefix}${entry.name}/`);
      if (depth < 1) {
        const sub = analyzeStructure(path.join(workspace, entry.name), depth + 1);
        if (sub) lines.push(sub);
      }
    } else {
      lines.push(`${prefix}${entry.name}`);
    }
  }

  return lines.join('\n');
}

function findKeyFiles(workspace: string): string[] {
  const keys: string[] = [];
  const candidates = [
    'src/index.ts', 'src/index.js', 'src/main.ts', 'src/main.js',
    'src/app.ts', 'src/app.js', 'src/server.ts', 'src/server.js',
    'index.ts', 'index.js', 'main.ts', 'main.js',
    'README.md', 'package.json', 'tsconfig.json',
  ];

  for (const cand of candidates) {
    if (fs.existsSync(path.join(workspace, cand))) {
      keys.push(cand);
    }
  }

  return keys.slice(0, 8);
}

function detectBuildCommands(workspace: string): string[] {
  const cmds: string[] = [];

  if (fs.existsSync(path.join(workspace, 'package.json'))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(workspace, 'package.json'), 'utf-8'));
      if (pkg.scripts?.build) cmds.push('npm run build / pnpm build');
      if (pkg.scripts?.dev) cmds.push('npm run dev / pnpm dev');
      if (pkg.scripts?.start) cmds.push('npm start');
    } catch {}
  }

  if (fs.existsSync(path.join(workspace, 'Cargo.toml'))) {
    cmds.push('cargo build', 'cargo run');
  }

  if (fs.existsSync(path.join(workspace, 'go.mod'))) {
    cmds.push('go build', 'go run .');
  }

  if (fs.existsSync(path.join(workspace, 'Makefile'))) {
    cmds.push('make');
  }

  return cmds.length > 0 ? cmds : ['未检测到标准构建命令'];
}

function getGitStatus(workspace: string): { branch: string; uncommitted: number; lastCommit: string } {
  try {
    const branch = execSync('git branch --show-current', { cwd: workspace, encoding: 'utf-8' }).trim();
    const status = execSync('git status --porcelain', { cwd: workspace, encoding: 'utf-8' });
    const uncommitted = status.split('\n').filter(l => l.trim()).length;
    const lastCommit = execSync('git log -1 --format=%s', { cwd: workspace, encoding: 'utf-8' }).trim();

    return { branch, uncommitted, lastCommit };
  } catch {
    return { branch: 'unknown', uncommitted: 0, lastCommit: 'unknown' };
  }
}

function getRecentChanges(workspace: string): string[] {
  try {
    const output = execSync('git diff --name-only HEAD~5..HEAD', { cwd: workspace, encoding: 'utf-8' });
    return output.split('\n').filter(l => l.trim()).slice(0, 10);
  } catch {
    return [];
  }
}

function detectRunningServices(workspace: string): string[] {
  const services: string[] = [];

  // 检查常见端口
  const ports = [3000, 5173, 8080, 18789];
  for (const port of ports) {
    try {
      execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf-8' });
      services.push(`端口 ${port} 正在使用`);
    } catch {
      // 端口未使用
    }
  }

  return services;
}
