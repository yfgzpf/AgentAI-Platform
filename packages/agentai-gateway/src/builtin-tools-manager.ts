// @ts-nocheck
/**
 * 内置工具管理器 - Built-in Tools Manager
 *
 * 目的：将所有AI要用到的工具和命令内置到项目中，避免依赖外部环境配置
 * 解决问题：沙箱规则阻止文件操作、工具找不到、环境配置不一致等问题
 *
 * 内置工具列表：
 * - pnpm: 包管理器（项目依赖）
 * - npm: 包管理器（备用）
 * - tsc: TypeScript编译器
 * - node: Node.js运行时
 * - vite: 前端开发服务器
 * - concurrently: 并行运行工具
 * - esbuild: 快速编译器（备用）
 */

import { spawn, spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgRoot = path.resolve(__dirname, '..');

/**
 * 内置工具配置
 */
interface BuiltInTool {
  name: string;
  command: string;
  args?: string[];
  description: string;
  category: 'package-manager' | 'compiler' | 'runtime' | 'dev-server' | 'utility';
  required: boolean;
  fallback?: string; // 备用工具
  installCommand?: string; // 安装命令（如果工具不存在）
}

/**
 * 内置工具列表
 */
const BUILT_IN_TOOLS: BuiltInTool[] = [
  // ===== 包管理器 =====
  {
    name: 'pnpm',
    command: 'pnpm',
    description: '快速的磁盘节省包管理器（项目主要使用）',
    category: 'package-manager',
    required: true,
    fallback: 'npm',
    installCommand: 'npm install -g pnpm',
  },
  {
    name: 'npm',
    command: 'npm',
    description: 'Node.js包管理器（备用）',
    category: 'package-manager',
    required: false,
    fallback: 'pnpm',
  },

  // ===== 编译器 =====
  {
    name: 'tsc',
    command: 'npx',
    args: ['tsc'],
    description: 'TypeScript编译器',
    category: 'compiler',
    required: true,
    fallback: 'esbuild',
  },
  {
    name: 'esbuild',
    command: 'npx',
    args: ['esbuild'],
    description: '极速JavaScript打包器（备用）',
    category: 'compiler',
    required: false,
    fallback: 'tsc',
  },

  // ===== 运行时 =====
  {
    name: 'node',
    command: 'node',
    description: 'Node.js运行时',
    category: 'runtime',
    required: true,
  },
  {
    name: 'tsx',
    command: 'npx',
    args: ['tsx'],
    description: 'TypeScript执行器（直接运行.ts文件）',
    category: 'runtime',
    required: false,
    fallback: 'node',
  },

  // ===== 开发服务器 =====
  {
    name: 'vite',
    command: 'npx',
    args: ['vite'],
    description: '下一代前端开发服务器',
    category: 'dev-server',
    required: true,
    fallback: 'webpack-dev-server',
  },
  {
    name: 'webpack-dev-server',
    command: 'npx',
    args: ['webpack-dev-server'],
    description: 'Webpack开发服务器（备用）',
    category: 'dev-server',
    required: false,
    fallback: 'vite',
  },

  // ===== 工具 =====
  {
    name: 'concurrently',
    command: 'npx',
    args: ['concurrently'],
    description: '并行运行多个命令',
    category: 'utility',
    required: true,
  },
  {
    name: 'nodemon',
    command: 'npx',
    args: ['nodemon'],
    description: '监视文件变化并自动重启',
    category: 'utility',
    required: false,
  },
];

/**
 * 内置工具管理器类
 */
export class BuiltInToolsManager {
  private tools: Map<string, BuiltInTool>;
  private availableTools: Map<string, boolean>;
  private toolPaths: Map<string, string>;

  constructor() {
    this.tools = new Map();
    this.availableTools = new Map();
    this.toolPaths = new Map();

    // 初始化工具列表
    for (const tool of BUILT_IN_TOOLS) {
      this.tools.set(tool.name, tool);
    }

    console.log('[BuiltInToolsManager] 内置工具管理器已初始化');
    console.log(`[BuiltInToolsManager] 内置工具数量: ${this.tools.size}`);
  }

  /**
   * 检查工具是否可用
   */
  checkToolAvailability(toolName: string): boolean {
    const tool = this.tools.get(toolName);
    if (!tool) {
      console.warn(`[BuiltInToolsManager] 工具不存在: ${toolName}`);
      return false;
    }

    try {
      // 尝试运行工具的版本检查命令
      const result = spawnSync(tool.command, ['--version'], {
        encoding: 'utf8',
        shell: true,
        timeout: 5000,
      });

      const isAvailable = result.status === 0;
      this.availableTools.set(toolName, isAvailable);

      if (isAvailable) {
        console.log(`[BuiltInToolsManager] ✓ 工具可用: ${toolName}`);
      } else {
        console.warn(`[BuiltInToolsManager] ✗ 工具不可用: ${toolName}`);
      }

      return isAvailable;
    } catch (error) {
      console.error(`[BuiltInToolsManager] 检查工具可用性失败: ${toolName}`, error);
      this.availableTools.set(toolName, false);
      return false;
    }
  }

  /**
   * 检查所有工具的可用性
   */
  checkAllTools(): Map<string, boolean> {
    console.log('[BuiltInToolsManager] 检查所有工具的可用性...');

    for (const [name, tool] of this.tools) {
      this.checkToolAvailability(name);
    }

    // 输出可用性报告
    const available = Array.from(this.availableTools.entries())
      .filter(([_, isAvailable]) => isAvailable)
      .map(([name]) => name);

    const unavailable = Array.from(this.availableTools.entries())
      .filter(([_, isAvailable]) => !isAvailable)
      .map(([name]) => name);

    console.log(`[BuiltInToolsManager] ✓ 可用工具 (${available.length}): ${available.join(', ')}`);
    console.log(`[BuiltInToolsManager] ✗ 不可用工具 (${unavailable.length}): ${unavailable.join(', ')}`);

    return this.availableTools;
  }

  /**
   * 获取工具（如果不可用，使用备用工具）
   * @param visited 内部使用: 防止 fallback 循环回溯
   */
  getTool(toolName: string, visited?: Set<string>): BuiltInTool | null {
    // 防止 fallback 循环 (pnpm→npm→pnpm...)
    const visitedSet = visited || new Set<string>();
    if (visitedSet.has(toolName)) {
      console.warn(`[BuiltInToolsManager] 检测到 fallback 循环: ${toolName} 已访问过，停止递归`);
      return null;
    }
    visitedSet.add(toolName);

    const tool = this.tools.get(toolName);
    if (!tool) {
      return null;
    }

    // 检查工具是否可用 (undefined = 未检查, 视为可用避免误触发 fallback)
    const isAvailable = this.availableTools.get(toolName);
    if (isAvailable === true || isAvailable === undefined) {
      return tool;
    }

    // 如果工具不可用，尝试使用备用工具
    if (tool.fallback) {
      console.log(`[BuiltInToolsManager] 工具 ${toolName} 不可用，使用备用工具 ${tool.fallback}`);
      return this.getTool(tool.fallback, visitedSet);
    }

    return null;
  }

  /**
   * 运行工具
   */
  runTool(
    toolName: string,
    args: string[],
    options?: {
      cwd?: string;
      blocking?: boolean;
      timeout?: number;
    }
  ): {
    success: boolean;
    output?: string;
    error?: string;
  } {
    const tool = this.getTool(toolName);
    if (!tool) {
      return {
        success: false,
        error: `工具 ${toolName} 不可用且无备用工具`,
      };
    }

    console.log(`[BuiltInToolsManager] 运行工具: ${tool.name} ${args.join(' ')}`);

    try {
      const result = spawnSync(
        tool.command,
        [...(tool.args || []), ...args],
        {
          cwd: options?.cwd || pkgRoot,
          encoding: 'utf8',
          shell: true,
          timeout: options?.timeout || 60000,
        }
      );

      const success = result.status === 0;

      if (success) {
        console.log(`[BuiltInToolsManager] ✓ 工具运行成功: ${tool.name}`);
      } else {
        console.error(`[BuiltInToolsManager] ✗ 工具运行失败: ${tool.name}`);
        console.error(`[BuiltInToolsManager] 错误输出: ${result.stderr}`);
      }

      return {
        success,
        output: result.stdout,
        error: result.stderr,
      };
    } catch (error) {
      console.error(`[BuiltInToolsManager] 运行工具异常: ${tool.name}`, error);
      return {
        success: false,
        error: String(error),
      };
    }
  }

  /**
   * 安装缺失的工具
   */
  installMissingTools(): {
    installed: string[];
    failed: string[];
  } {
    console.log('[BuiltInToolsManager] 安装缺失的工具...');

    const installed: string[] = [];
    const failed: string[] = [];

    for (const [name, tool] of this.tools) {
      if (!tool.required) {
        continue; // 只安装必需的工具
      }

      const isAvailable = this.availableTools.get(name);
      if (isAvailable) {
        continue; // 工具已可用，跳过
      }

      if (!tool.installCommand) {
        console.warn(`[BuiltInToolsManager] 工具 ${name} 无安装命令，跳过`);
        continue;
      }

      console.log(`[BuiltInToolsManager] 安装工具: ${name} (${tool.installCommand})`);

      const result = this.runTool('npm', ['install', '-g', tool.name], {
        timeout: 120000,
      });

      if (result.success) {
        installed.push(name);
        this.availableTools.set(name, true);
        console.log(`[BuiltInToolsManager] ✓ 工具安装成功: ${name}`);
      } else {
        failed.push(name);
        console.error(`[BuiltInToolsManager] ✗ 工具安装失败: ${name}`);
      }
    }

    console.log(`[BuiltInToolsManager] 安装完成: 成功 ${installed.length}, 失败 ${failed.length}`);

    return { installed, failed };
  }

  /**
   * 生成工具报告
   */
  generateReport(): string {
    const lines: string[] = [
      '# 内置工具管理器报告',
      '',
      '## 工具可用性',
      '',
    ];

    for (const [name, tool] of this.tools) {
      const isAvailable = this.availableTools.get(name) || false;
      const status = isAvailable ? '✓' : '✗';
      const required = tool.required ? '必需' : '可选';
      const fallback = tool.fallback ? `备用: ${tool.fallback}` : '';

      lines.push(`- ${status} **${name}** (${required}) - ${tool.description} ${fallback}`);
    }

    lines.push('');
    lines.push('## 建议');
    lines.push('');

    const unavailableRequired = Array.from(this.tools.entries())
      .filter(([name, tool]) => tool.required && !this.availableTools.get(name))
      .map(([name]) => name);

    if (unavailableRequired.length > 0) {
      lines.push(`⚠️ 缺失必需工具: ${unavailableRequired.join(', ')}`);
      lines.push('');
      lines.push('**建议操作:**');
      lines.push('1. 运行 `BuiltInToolsManager.installMissingTools()` 安装缺失工具');
      lines.push('2. 或手动安装: `npm install -g <tool-name>`');
    } else {
      lines.push('✅ 所有必需工具都已可用');
    }

    return lines.join('\n');
  }

  /**
   * 获取工具命令（用于沙箱白名单）
   */
  getToolCommands(): string[] {
    return Array.from(this.tools.values()).map(tool => tool.command);
  }

  /**
   * 获取工具路径白名单（用于沙箱配置）
   */
  getToolPathWhitelist(): string[] {
    const os = require('os') as typeof import('os');
    const path = require('path') as typeof import('path');
    const home = os.homedir();
    const cwd = process.cwd();
    const whitelist: string[] = [
      // Node.js 相关路径 (动态获取)
      path.join(home, 'AppData', 'Roaming', 'npm') + '\\',
      path.join(home, 'AppData', 'Local', 'pnpm-cache') + '\\',
      path.join(home, 'AppData', 'Local', 'pnpm-state') + '\\',

      // 项目路径 (基于 process.cwd())
      cwd + '\\',
      path.join(cwd, 'node_modules') + '\\',
      path.join(cwd, 'packages') + '\\',
      path.join(cwd, 'packages', 'agentai-gateway', 'dist') + '\\',
      path.join(cwd, 'packages', 'agentai-gui', 'dist') + '\\',

      // 临时文件路径
      path.join(home, 'AppData', 'Local', 'Temp') + '\\',
    ];

    return whitelist;
  }
}

/**
 * 导出单例实例
 */
export const builtInToolsManager = new BuiltInToolsManager();