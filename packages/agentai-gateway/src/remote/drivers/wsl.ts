/**
 * WSL 驱动 - 使用 wsl.exe 命令
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { RemoteEnvironment, FileOperationResult, DirectoryEntry, ExecResult } from '../types.js';

const execAsync = promisify(exec);

export class WSLDriver {
  private env: RemoteEnvironment;
  private connected = false;
  private currentDir: string;

  constructor(env: RemoteEnvironment) {
    this.env = env;
    this.currentDir = env.workingDirectory;
  }

  async connect(): Promise<void> {
    const wsl = this.env.wsl!;
    // 测试 WSL 是否可用
    const distFlag = wsl.distribution ? `-d ${wsl.distribution}` : '';
    const { stdout } = await execAsync(`wsl ${distFlag} echo "connected"`, { timeout: 10000 });
    
    if (!stdout.includes('connected')) {
      throw new Error('WSL connection test failed');
    }
    
    this.connected = true;
    
    // 切换到工作目录
    await this.exec(`cd "${this.env.workingDirectory}" && pwd`);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async readFile(filePath: string): Promise<FileOperationResult> {
    try {
      const cmd = this.buildWSLCommand(`cat "${filePath}"`);
      const { stdout } = await execAsync(cmd, { 
        timeout: 30000, 
        maxBuffer: 10 * 1024 * 1024 
      });
      return { success: true, content: stdout, path: filePath };
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to read file', path: filePath };
    }
  }

  async writeFile(filePath: string, content: string): Promise<FileOperationResult> {
    try {
      // 使用 base64 编码避免转义问题
      const base64Content = Buffer.from(content).toString('base64');
      const cmd = this.buildWSLCommand(`echo "${base64Content}" | base64 -d > "${filePath}"`);
      await execAsync(cmd, { timeout: 30000 });
      return { success: true, path: filePath };
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to write file', path: filePath };
    }
  }

  async listDirectory(dirPath: string): Promise<{ success: boolean; entries?: DirectoryEntry[]; error?: string }> {
    try {
      const cmd = this.buildWSLCommand(`ls -la "${dirPath}"`);
      const { stdout } = await execAsync(cmd, { timeout: 10000 });
      
      const entries = this.parseLSOutput(stdout, dirPath);
      return { success: true, entries };
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to list directory' };
    }
  }

  async exec(command: string, cwd?: string): Promise<ExecResult> {
    const startTime = Date.now();
    try {
      const workDir = cwd || this.currentDir;
      const fullCommand = `cd "${workDir}" && ${command}`;
      const cmd = this.buildWSLCommand(fullCommand);
      
      const { stdout, stderr } = await execAsync(cmd, { 
        timeout: 60000,
        maxBuffer: 50 * 1024 * 1024 
      });
      
      // 更新当前目录
      if (command.includes('cd ')) {
        const { stdout: pwdOut } = await execAsync(this.buildWSLCommand('pwd'));
        this.currentDir = pwdOut.trim();
      }
      
      return {
        success: true,
        stdout,
        stderr,
        exitCode: 0,
        durationMs: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        success: false,
        stdout: error.stdout || '',
        stderr: error.stderr || error.message,
        exitCode: error.code || 1,
        durationMs: Date.now() - startTime,
      };
    }
  }

  getCurrentDirectory(): string {
    return this.currentDir;
  }

  private buildWSLCommand(command: string): string {
    const wsl = this.env.wsl!;
    const distFlag = wsl.distribution ? `-d ${wsl.distribution}` : '';
    const userFlag = wsl.user ? `-u ${wsl.user}` : '';
    return `wsl ${distFlag} ${userFlag} bash -c "${command.replace(/"/g, '\\"')}"`;
  }

  private parseLSOutput(output: string, basePath: string): DirectoryEntry[] {
    const lines = output.split('\n').slice(1);
    const entries: DirectoryEntry[] = [];
    
    for (const line of lines) {
      const match = line.match(/^([\-dl])([\-rwx]{9})\s+\d+\s+(\S+)\s+(\S+)\s+(\d+)\s+(\S+\s+\S+\s+\S+)\s+(.+)$/);
      if (match) {
        const [, type, , , , size, , name] = match;
        if (name !== '.' && name !== '..') {
          entries.push({
            name,
            path: path.posix.join(basePath, name),
            isDirectory: type === 'd',
            size: parseInt(size, 10),
            modifiedAt: Date.now(),
          });
        }
      }
    }
    
    return entries;
  }
}
