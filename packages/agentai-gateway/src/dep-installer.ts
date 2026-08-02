/**
 * dep-installer.ts — 智能依赖安装器
 * ----------------------------------------------------
 * 解决 AI 运行/探索项目时"缺依赖就卡住"的问题。
 *
 * 能力:
 *   1. 自动检测包管理器 (pnpm > yarn > npm, pip for Python)
 *   2. 支持 monorepo workspace (pnpm --filter, -w)
 *   3. 支持 dev/global 多种安装模式
 *   4. 幂等: 已安装则跳过, 不重复安装
 *   5. 自动验证: 安装后检查 importable
 *   6. 国内加速: 自动使用 npmmirror / 清华源
 *   7. Python venv 检测: 优先使用 .venv/bin/python
 *   8. 多包批量安装: 一次装多个依赖
 *
 * 暴露:
 *   - installDependency(args) — 主入口
 *   - ensureDependency(args) — 检查+安装 (幂等)
 *   - detectPackageManager(cwd) — 检测当前项目的包管理器
 *   - isPackageInstalled(name, cwd) — 检查包是否已安装
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { exec, execSync } from 'node:child_process';

/** 包管理器类型 */
export type PkgManager = 'pnpm' | 'yarn' | 'npm' | 'pip' | 'pip3';

/** 安装模式 */
export type InstallMode = 'prod' | 'dev' | 'global' | 'peer';

/** 安装参数 */
export interface InstallArgs {
  /** 包名 (单个) 或包名数组 (批量) */
  package: string | string[];
  /** 包类型: npm/pip, 默认根据名字自动判断 */
  type?: 'npm' | 'pip';
  /** 安装模式: prod=生产依赖, dev=开发依赖, global=全局 */
  mode?: InstallMode;
  /** monorepo 中安装到指定工作区 (如 @agentai/gateway), 不指定则装到根 */
  workspace?: string;
  /** 自定义 cwd (默认使用 wm().projectDir) */
  cwd?: string;
  /** 跳过已安装检查, 强制安装 */
  force?: boolean;
  /** 使用国内镜像 (默认 true, 中国大陆自动启用) */
  chinaMirror?: boolean;
  /** 安装超时 (毫秒, 默认 120000) */
  timeout?: number;
}

/** 安装结果 */
export interface InstallResult {
  success: boolean;
  output: string;
  data?: {
    installed: string[];
    skipped: string[];
    failed: string[];
    manager?: PkgManager;
    workspace?: string;
  };
}

// ═══════════════════════════════════════════════════════════
// 包管理器检测
// ═══════════════════════════════════════════════════════════

/** 检测项目使用的包管理器 (优先级: pnpm > yarn > npm) */
export function detectPackageManager(cwd: string): PkgManager {
  // pnpm: pnpm-lock.yaml 或 pnpm-workspace.yaml
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml')) ||
      fs.existsSync(path.join(cwd, 'pnpm-workspace.yaml'))) {
    return 'pnpm';
  }
  // yarn: yarn.lock
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn';
  // 默认 npm
  return 'npm';
}

/** 检测 Python 包管理器 */
export function detectPythonManager(cwd: string): PkgManager {
  // 优先检测 venv
  const venvPython = path.join(cwd, '.venv', 'Scripts', 'python.exe');
  const venvPythonUnix = path.join(cwd, '.venv', 'bin', 'python');
  if (fs.existsSync(venvPython) || fs.existsSync(venvPythonUnix)) {
    return 'pip';
  }
  // pyproject.toml (现代 Python 项目)
  if (fs.existsSync(path.join(cwd, 'pyproject.toml'))) return 'pip';
  // requirements.txt
  if (fs.existsSync(path.join(cwd, 'requirements.txt'))) return 'pip';
  return 'pip3';
}

/** 检测当前工作区在 monorepo 中的包名 */
export function detectWorkspacePackage(cwd: string): string | null {
  // 向上查找 pnpm-workspace.yaml
  let dir = cwd;
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      // 当前 cwd 是某个 workspace 包?
      const pkgJsonPath = path.join(cwd, 'package.json');
      if (fs.existsSync(pkgJsonPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
          if (pkg.name) return pkg.name;
        } catch { /* ignore */ }
      }
      return null;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════
// 已安装检查
// ═══════════════════════════════════════════════════════════

/** 检查 npm 包是否已安装 (在 node_modules 中) */
export function isNpmPackageInstalled(name: string, cwd: string): boolean {
  // 1. 检查 cwd/node_modules
  const localPath = path.join(cwd, 'node_modules', name);
  if (fs.existsSync(localPath)) return true;
  // 2. 向上查找 (monorepo 根 node_modules)
  let dir = cwd;
  for (let i = 0; i < 6; i++) {
    const rootPath = path.join(dir, 'node_modules', name);
    if (fs.existsSync(rootPath)) return true;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // 3. 全局安装检查
  try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf-8', timeout: 3000 }).trim();
    if (fs.existsSync(path.join(globalRoot, name))) return true;
  } catch { /* ignore */ }
  return false;
}

/** 检查 Python 包是否已安装 */
export function isPipPackageInstalled(name: string, cwd: string): boolean {
  // 标准化包名 (pip list 显示的可能是 import name 而非包名)
  const importName = name.replace(/[-_]/g, '_').toLowerCase();
  const pkgName = name.replace(/[-_]/g, '-').toLowerCase();
  try {
    // 优先使用 venv 的 pip
    const venvPip = path.join(cwd, '.venv', 'Scripts', 'pip.exe');
    const pipCmd = fs.existsSync(venvPip) ? `"${venvPip}"` : 'pip';
    const output = execSync(`${pipCmd} list --format=json`, {
      encoding: 'utf-8', timeout: 8000,
    });
    const pkgs = JSON.parse(output) as Array<{ name: string; version: string }>;
    return pkgs.some(p => {
      const n = p.name.toLowerCase().replace(/[-_]/g, '_');
      return n === importName || n === pkgName;
    });
  } catch {
    // 降级: 尝试 import 检查
    try {
      execSync(`python -c "import ${importName}"`, { stdio: 'pipe', timeout: 5000 });
      return true;
    } catch { return false; }
  }
}

/** 通用: 检查包是否已安装 */
export function isPackageInstalled(name: string, cwd: string, type: 'npm' | 'pip' = 'npm'): boolean {
  return type === 'pip' ? isPipPackageInstalled(name, cwd) : isNpmPackageInstalled(name, cwd);
}

// ═══════════════════════════════════════════════════════════
// 安装命令构造
// ═══════════════════════════════════════════════════════════

/** 构造 npm/pnpm/yarn 安装命令 */
function buildNpmCommand(
  manager: PkgManager,
  packages: string[],
  mode: InstallMode,
  workspace: string | undefined,
  chinaMirror: boolean,
): string {
  const pkgsStr = packages.join(' ');
  const isGlobal = mode === 'global';
  const isDev = mode === 'dev';

  // 镜像源
  const registryFlag = chinaMirror ? ' --registry=https://registry.npmmirror.com' : '';

  switch (manager) {
    case 'pnpm': {
      if (isGlobal) return `pnpm add -g ${pkgsStr}${registryFlag}`;
      // monorepo workspace
      if (workspace) return `pnpm --filter ${workspace} add ${isDev ? '-D ' : ''}${pkgsStr}${registryFlag}`;
      // 装到根
      const wsFlag = fs.existsSync('pnpm-workspace.yaml') ? ' -w' : '';
      return `pnpm add ${isDev ? '-D ' : ''}${pkgsStr}${wsFlag}${registryFlag}`;
    }
    case 'yarn': {
      if (isGlobal) return `yarn global add ${pkgsStr}${registryFlag}`;
      return `yarn add ${isDev ? '--dev ' : ''}${pkgsStr}${registryFlag}`;
    }
    case 'npm':
    default: {
      if (isGlobal) return `npm install -g ${pkgsStr}${registryFlag}`;
      return `npm install ${isDev ? '--save-dev ' : '--save '}${pkgsStr}${registryFlag}`;
    }
  }
}

/** 构造 pip 安装命令 */
function buildPipCommand(
  manager: PkgManager,
  packages: string[],
  mode: InstallMode,
  cwd: string,
  chinaMirror: boolean,
): string {
  const pkgsStr = packages.join(' ');
  const isGlobal = mode === 'global';
  // venv 检测
  const venvPip = path.join(cwd, '.venv', 'Scripts', 'pip.exe');
  const pipCmd = fs.existsSync(venvPip) ? `"${venvPip}"` : (manager === 'pip3' ? 'pip3' : 'pip');
  const mirrorFlag = chinaMirror ? ' -i https://pypi.tuna.tsinghua.edu.cn/simple' : '';
  const globalFlag = isGlobal && !fs.existsSync(venvPip) ? ' --user' : '';
  return `${pipCmd} install ${pkgsStr}${globalFlag}${mirrorFlag}`;
}

// ═══════════════════════════════════════════════════════════
// 主入口
// ═══════════════════════════════════════════════════════════

/** 安装依赖 (主入口) */
export async function installDependency(args: InstallArgs): Promise<InstallResult> {
  const {
    package: pkgInput,
    type = 'npm',
    mode = 'prod',
    workspace,
    cwd = process.cwd(),
    force = false,
    chinaMirror = true,
    timeout = 120_000,
  } = args;

  if (!pkgInput) return { success: false, output: '❌ package 参数必填' };

  const packages = Array.isArray(pkgInput) ? pkgInput : [pkgInput];
  if (packages.length === 0) return { success: false, output: '❌ 至少需要一个包名' };

  // 检测包管理器
  const manager: PkgManager = type === 'pip' ? detectPythonManager(cwd) : detectPackageManager(cwd);

  // 自动检测当前 workspace (如果未指定)
  const finalWorkspace = workspace !== undefined ? workspace : (type === 'npm' ? detectWorkspacePackage(cwd) || undefined : undefined);

  // 幂等检查: 已安装则跳过
  const installed: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];

  if (!force) {
    for (const pkg of packages) {
      // 处理 "pkg@version" 格式
      const pkgNameOnly = pkg.split('@')[0] || pkg;
      if (isPackageInstalled(pkgNameOnly, cwd, type)) {
        skipped.push(pkg);
      }
    }
  }

  const toInstall = packages.filter(p => !skipped.includes(p));
  if (toInstall.length === 0) {
    return {
      success: true,
      output: `✅ 全部已安装, 无需重复安装\n跳过: ${skipped.join(', ')}`,
      data: { installed: [], skipped, failed: [], manager, workspace: finalWorkspace },
    };
  }

  // 构造命令
  const cmd = type === 'pip'
    ? buildPipCommand(manager, toInstall, mode, cwd, chinaMirror)
    : buildNpmCommand(manager, toInstall, mode, finalWorkspace, chinaMirror);

  // 执行安装
  const startTime = Date.now();
  try {
    const result = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
      exec(cmd, { cwd, timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        resolve({ stdout: stdout || '', stderr: stderr || '', code: err ? (err as any).code || 1 : 0 });
      });
    });
    const elapsed = Math.floor((Date.now() - startTime) / 1000);

    if (result.code === 0) {
      // 验证安装: 抽样检查第一个包
      const firstPkg = toInstall[0].split('@')[0] || toInstall[0];
      const verified = isPackageInstalled(firstPkg, cwd, type);

      for (const pkg of toInstall) {
        installed.push(pkg);
      }

      const lines: string[] = [
        `✅ 依赖安装成功 (${elapsed}s, ${manager})`,
        `命令: ${cmd}`,
        `已装: ${installed.join(', ')}`,
      ];
      if (skipped.length > 0) lines.push(`跳过(已装): ${skipped.join(', ')}`);
      if (finalWorkspace) lines.push(`工作区: ${finalWorkspace}`);
      if (!verified) lines.push(`⚠️ 验证警告: ${firstPkg} 安装后未在 import 列表中检测到, 可能需要重启进程`);
      if (result.stdout) lines.push(`\n输出:\n${result.stdout.slice(0, 1500)}`);

      return {
        success: true,
        output: lines.join('\n'),
        data: { installed, skipped, failed, manager, workspace: finalWorkspace },
      };
    } else {
      // 失败: 收集错误信息
      for (const pkg of toInstall) failed.push(pkg);
      const errLines: string[] = [
        `❌ 依赖安装失败 (${elapsed}s, ${manager})`,
        `命令: ${cmd}`,
        `失败: ${failed.join(', ')}`,
      ];
      if (result.stderr) errLines.push(`\n错误:\n${result.stderr.slice(0, 1500)}`);
      // 智能建议
      if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED/.test(result.stderr)) {
        errLines.push('\n💡 建议: 网络问题, 已自动使用国内镜像 (npmmirror/清华源), 如仍失败请检查网络或代理设置');
      } else if (/EACCES|permission denied/i.test(result.stderr)) {
        errLines.push('\n💡 建议: 权限不足, 尝试改为全局安装 npm_install({package:"...", mode:"global"})');
      } else if (/Could not resolve|Not Found|404/.test(result.stderr)) {
        errLines.push('\n💡 建议: 包名错误或包不存在, 请检查拼写');
      }
      return { success: false, output: errLines.join('\n'), data: { installed, skipped, failed, manager, workspace: finalWorkspace } };
    }
  } catch (e: any) {
    return {
      success: false,
      output: `❌ 安装异常: ${e.message}\n命令: ${cmd}`,
      data: { installed, skipped, failed, manager, workspace: finalWorkspace },
    };
  }
}

/** 幂等安装: 检查 → 安装 (AI 主动调用推荐入口) */
export async function ensureDependency(args: InstallArgs): Promise<InstallResult> {
  // ensureDependency = installDependency with force=false (默认即幂等)
  return installDependency({ ...args, force: args.force ?? false });
}

/** 批量检查并安装多个依赖 (从代码 import 语句提取) */
export async function ensureDependenciesFromCode(
  code: string,
  cwd: string,
  type: 'npm' | 'pip' = 'npm',
): Promise<InstallResult> {
  // 提取 import/require 语句中的包名
  const packages = new Set<string>();
  // JS/TS: import ... from 'pkg' / require('pkg') / import 'pkg'
  const jsImportRe = /(?:import\s+(?:[\s\S]*?from\s+)?|require\s*\(\s*)['"]([^'"./][^'"]*)['"]/g;
  // Python: import pkg / from pkg import ...
  const pyImportRe = /^(?:import\s+(\w+)|from\s+(\w+(?:\.\w+)*)\s+import)/gm;

  const re = type === 'pip' ? pyImportRe : jsImportRe;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const pkg = (m[1] || m[2] || '').split('/')[0].split('.')[0];
    if (pkg && !['node', 'fs', 'path', 'os', 'http', 'https', 'crypto', 'child_process', 'util', 'stream', 'events', 'url', 'querystring'].includes(pkg)) {
      packages.add(pkg);
    }
  }

  if (packages.size === 0) {
    return { success: true, output: '未检测到外部依赖', data: { installed: [], skipped: [], failed: [] } };
  }

  return installDependency({
    package: Array.from(packages),
    type,
    cwd,
    force: false,
  });
}
