/**
 * SSH 驱动 - 使用系统 ssh 命令
 */

import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { RemoteEnvironment, FileOperationResult, DirectoryEntry, ExecResult } from '../types.js';

const execAsync = promisify(exec);

export class SSHDriver {
  private env: RemoteEnvironment;
  private connected = false;
  private currentDir: string;
  private sshOptions: string[] = [];

  constructor(env: RemoteEnvironment) {
    this.env = env;
    this.currentDir = env.workingDirectory;
    this.buildSSHOptions();
  }

  private buildSSHOptions(): void {
    const ssh = this.env.ssh!;
    this.sshOptions = [
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=/dev/null',
      '-o', 'LogLevel=ERROR',
      '-p', String(ssh.port || 22),
    ];

    if (ssh.authType === 'key' && ssh.privateKey) {
      // 创建临时密钥文件
      const keyPath = path.join(os.tmpdir(), `agentai-ssh-key-${Date.now()}`);
      fs.writeFileSync(keyPath, ssh.privateKey, { mode: 0o600 });
      this.sshOptions.push('-i', keyPath);
    }
  }

  async connect(): Promise<void> {
    const ssh = this.env.ssh!;
    // 测试连接
    const testCmd = this.buildSSHCommand('echo "connected"');
    const { stdout } = await execAsync(testCmd, { timeout: 10000 });
    
    if (!stdout.includes('connected')) {
      throw new Error('SSH connection test failed');
    }
    
    this.connected = true;
    
    // 切换到工作目录
    await this.exec(`cd "${this.env.workingDirectory}" && pwd`);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    // 清理临时密钥文件
    const ssh = this.env.ssh!;
    if (ssh.authType === 'key' && ssh.privateKey) {
      const keyPath = path.join(os.tmpdir(), `agentai-ssh-key-${Date.now()}`);
      try { fs.unlinkSync(keyPath); } catch {}
    }
  }

  async readFile(filePath: string): Promise<FileOperationResult> {
    try {
      const cmd = this.buildSSHCommand(`cat "${filePath}"`);
      const { stdout } = await execAsync(cmd, { timeout: 30000, maxBuffer: 10 * 1024 * 1024 });
      return { success: true, content: stdout, path: filePath };
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to read file', path: filePath };
    }
  }

  async writeFile(filePath: string, content: string): Promise<FileOperationResult> {
    try {
      // 使用 base64 编码避免转义问题
      const base64Content = Buffer.from(content).toString('base64');
      const cmd = this.buildSSHCommand(`echo "${base64Content}" | base64 -d > "${filePath}"`);
      await execAsync(cmd, { timeout: 30000 });
      return { success: true, path: filePath };
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to write file', path: filePath };
    }
  }

  async listDirectory(dirPath: string): Promise<{ success: boolean; entries?: DirectoryEntry[]; error?: string }> {
    try {
      const cmd = this.buildSSHCommand(`ls -la "${dirPath}"`);
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
      const cmd = this.buildSSHCommand(fullCommand);
      
      const { stdout, stderr } = await execAsync(cmd, { 
        timeout: 60000,
        maxBuffer: 50 * 1024 * 1024 
      });
      
      // 更新当前目录
      if (command.includes('cd ')) {
        const { stdout: pwdOut } = await execAsync(this.buildSSHCommand('pwd'));
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

  private buildSSHCommand(remoteCommand: string): string {
    const ssh = this.env.ssh!;
    const userHost = `${ssh.username}@${ssh.host}`;
    const options = this.sshOptions.join(' ');
    
    if (ssh.authType === 'password' && ssh.password) {
      // 使用 sshpass 处理密码（如果系统安装了）
      return `sshpass -p "${ssh.password}" ssh ${options} ${userHost} "${remoteCommand.replace(/"/g, '\\"')}"`;
    }
    
    return `ssh ${options} ${userHost} "${remoteCommand.replace(/"/g, '\\"')}"`;
  }

  private parseLSOutput(output: string, basePath: string): DirectoryEntry[] {
    const lines = output.split('\n').slice(1); // 跳过总计行
    const entries: DirectoryEntry[] = [];
    
    for (const line of lines) {
      const match = line.match(/^([\-dl])([\-rwx]{9})\s+\d+\s+(\S+)\s+(\S+)\s+(\d+)\s+(\S+\s+\S+\s+\S+)\s+(.+)$/);
      if (match) {
        const [, type, , , , size, , name] = match;
        if (name !== '.' && name !== '..') {
          entries.push({
            name,
            path: path.join(basePath, name),
            isDirectory: type === 'd',
            size: parseInt(size, 10),
            modifiedAt: Date.now(), // 简化处理
          });
        }
      }
    }
    
    return entries;
  }
}
