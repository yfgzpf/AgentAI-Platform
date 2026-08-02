/**
 * 远程环境工具封装
 * 为 AI 提供远程文件和命令操作能力
 */

import { z } from 'zod';
import {
  remoteReadFile,
  remoteWriteFile,
  remoteListDirectory,
  remoteExec,
  isRemoteSessionActive,
  getActiveRemoteSession,
} from './ai-integration.js';

/**
 * 远程读取文件工具
 */
export const RemoteReadFileTool = {
  name: 'read_file_remote',
  description: '读取远程服务器上的文件内容。当连接到远程环境时，使用此工具读取远程文件。',
  parameters: z.object({
    file_path: z.string().describe('远程文件路径（绝对路径或相对于远程工作目录）'),
    offset: z.number().optional().describe('起始行号（可选）'),
    limit: z.number().optional().describe('读取行数（可选）'),
  }),
  handler: async (args: { file_path: string; offset?: number; limit?: number }) => {
    if (!isRemoteSessionActive()) {
      return {
        success: false,
        output: '❌ 未连接到远程环境。请先连接远程环境（SSH/WSL/Docker）。',
      };
    }

    const result = await remoteReadFile(args.file_path);

    if (!result.success) {
      return {
        success: false,
        output: `❌ 读取远程文件失败: ${result.error}`,
      };
    }

    let content = result.content || '';

    // 处理 offset 和 limit
    if (args.offset !== undefined || args.limit !== undefined) {
      const lines = content.split('\n');
      const start = args.offset || 0;
      const end = args.limit ? start + args.limit : lines.length;
      content = lines.slice(start, end).join('\n');
    }

    const session = getActiveRemoteSession();
    return {
      success: true,
      output: `🌐 [${session?.environment.name}] 读取成功:\n\n${content}`,
    };
  },
};

/**
 * 远程写入文件工具
 */
export const RemoteWriteFileTool = {
  name: 'write_file_remote',
  description: '写入文件到远程服务器。当连接到远程环境时，使用此工具修改远程文件。',
  parameters: z.object({
    file_path: z.string().describe('远程文件路径（绝对路径或相对于远程工作目录）'),
    content: z.string().describe('要写入的文件内容'),
  }),
  handler: async (args: { file_path: string; content: string }) => {
    if (!isRemoteSessionActive()) {
      return {
        success: false,
        output: '❌ 未连接到远程环境。请先连接远程环境（SSH/WSL/Docker）。',
      };
    }

    const result = await remoteWriteFile(args.file_path, args.content);

    const session = getActiveRemoteSession();
    if (result.success) {
      return {
        success: true,
        output: `🌐 [${session?.environment.name}] 文件写入成功: ${args.file_path}`,
      };
    } else {
      return {
        success: false,
        output: `❌ [${session?.environment.name}] 写入失败: ${result.error}`,
      };
    }
  },
};

/**
 * 远程列出目录工具
 */
export const RemoteListDirectoryTool = {
  name: 'list_directory_remote',
  description: '列出远程服务器上的目录内容。当连接到远程环境时，使用此工具浏览远程文件系统。',
  parameters: z.object({
    path: z.string().describe('远程目录路径（绝对路径或相对于远程工作目录）'),
  }),
  handler: async (args: { path: string }) => {
    if (!isRemoteSessionActive()) {
      return {
        success: false,
        output: '❌ 未连接到远程环境。请先连接远程环境（SSH/WSL/Docker）。',
      };
    }

    const result = await remoteListDirectory(args.path);

    const session = getActiveRemoteSession();
    if (!result.success) {
      return {
        success: false,
        output: `❌ [${session?.environment.name}] 列出目录失败: ${result.error}`,
      };
    }

    const entries = result.entries || [];
    const formatted = entries
      .map(e => {
        const type = e.isDirectory ? '📁' : '📄';
        const size = e.isDirectory ? '' : ` (${formatBytes(e.size)})`;
        return `${type} ${e.name}${size}`;
      })
      .join('\n');

    return {
      success: true,
      output: `🌐 [${session?.environment.name}] ${args.path}:\n\n${formatted || '(空目录)'}`,
    };
  },
};

/**
 * 远程执行命令工具
 */
export const RemoteExecTool = {
  name: 'run_shell_command_remote',
  description: '在远程环境执行 shell 命令。当连接到远程环境时，使用此工具在远程执行命令。',
  parameters: z.object({
    command: z.string().describe('要执行的命令'),
    cwd: z.string().optional().describe('工作目录（可选，默认远程工作目录）'),
    timeout: z.number().optional().describe('超时时间（秒，默认60）'),
  }),
  handler: async (args: { command: string; cwd?: string; timeout?: number }) => {
    if (!isRemoteSessionActive()) {
      return {
        success: false,
        output: '❌ 未连接到远程环境。请先连接远程环境（SSH/WSL/Docker）。',
      };
    }

    const result = await remoteExec(args.command, args.cwd);

    const session = getActiveRemoteSession();
    const output = [];
    output.push(`🌐 [${session?.environment.name}] $ ${args.command}`);

    if (result.stdout) {
      output.push(`\n📤 STDOUT:\n${result.stdout}`);
    }

    if (result.stderr) {
      output.push(`\n📥 STDERR:\n${result.stderr}`);
    }

    output.push(`\n⏱️ 耗时: ${result.durationMs}ms | 退出码: ${result.exitCode}`);

    return {
      success: result.success && result.exitCode === 0,
      output: output.join(''),
    };
  },
};

/**
 * 远程搜索文件内容工具
 */
export const RemoteSearchContentTool = {
  name: 'search_content_remote',
  description: '在远程服务器上搜索文件内容。使用 grep 命令在远程搜索。',
  parameters: z.object({
    pattern: z.string().describe('搜索模式（正则表达式）'),
    path: z.string().describe('搜索路径'),
    file_pattern: z.string().optional().describe('文件匹配模式（如 *.ts）'),
  }),
  handler: async (args: { pattern: string; path: string; file_pattern?: string }) => {
    if (!isRemoteSessionActive()) {
      return {
        success: false,
        output: '❌ 未连接到远程环境。请先连接远程环境（SSH/WSL/Docker）。',
      };
    }

    // 构建 grep 命令
    let command = `grep -r -n`;
    if (args.file_pattern) {
      command += ` --include="${args.file_pattern}"`;
    }
    command += ` "${args.pattern}" "${args.path}" 2>/dev/null || echo "未找到匹配"`;

    const result = await remoteExec(command);

    const session = getActiveRemoteSession();
    if (result.stdout && !result.stdout.includes('未找到匹配')) {
      return {
        success: true,
        output: `🌐 [${session?.environment.name}] 搜索结果:\n\n${result.stdout}`,
      };
    } else {
      return {
        success: false,
        output: `🌐 [${session?.environment.name}] 未找到匹配 "${args.pattern}"`,
      };
    }
  },
};

/**
 * 获取远程环境信息工具
 */
export const RemoteEnvironmentInfoTool = {
  name: 'get_remote_environment_info',
  description: '获取当前远程环境的详细信息，包括系统信息、磁盘空间等。',
  parameters: z.object({}),
  handler: async () => {
    if (!isRemoteSessionActive()) {
      return {
        success: false,
        output: '❌ 未连接到远程环境',
      };
    }

    const session = getActiveRemoteSession();
    const commands = [
      'echo "=== 系统信息 ===" && uname -a',
      'echo "=== 当前目录 ===" && pwd',
      'echo "=== 磁盘空间 ===" && df -h',
      'echo "=== 内存使用 ===" && free -h 2>/dev/null || vm_stat 2>/dev/null || echo "无法获取内存信息"',
      'echo "=== 运行进程 ===" && ps aux | head -10',
    ];

    const results = [];
    for (const cmd of commands) {
      const result = await remoteExec(cmd);
      results.push(result.stdout || result.stderr);
    }

    return {
      success: true,
      output: `🌐 [${session?.environment.name}] 环境信息:\n\n${results.join('\n\n')}`,
    };
  },
};

/**
 * 所有远程工具列表
 */
export const RemoteTools = [
  RemoteReadFileTool,
  RemoteWriteFileTool,
  RemoteListDirectoryTool,
  RemoteExecTool,
  RemoteSearchContentTool,
  RemoteEnvironmentInfoTool,
];

/**
 * 注册远程工具到工具注册表
 */
export function registerRemoteTools(toolRegistry: any): void {
  for (const tool of RemoteTools) {
    toolRegistry.register(tool.name, tool.handler, {
      description: tool.description,
      parameters: tool.parameters,
    });
  }
}

// 辅助函数
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
