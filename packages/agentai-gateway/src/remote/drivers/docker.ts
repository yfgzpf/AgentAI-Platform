/**
 * Docker 驱动 - 使用 docker 命令
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { RemoteEnvironment, FileOperationResult, DirectoryEntry, ExecResult } from '../types.js';

const execAsync = promisify(exec);

export class DockerDriver {
  private env: RemoteEnvironment;
  private connected = false;
  private currentDir: string;
  private containerId?: string;

  constructor(env: RemoteEnvironment) {
    this.env = env;
    this.currentDir = env.docker?.workingDir || '/app';
  }

  async connect(): Promise<void> {
    const docker = this.env.docker!;
    
    // 如果指定了容器名，检查容器是否存在
    if (docker.containerName) {
      try {
        const { stdout } = await execAsync(`docker ps -q -f name=${docker.containerName}`);
        if (stdout.trim()) {
          this.containerId = stdout.trim();
          this.connected = true;
          return;
        }
      } catch {
        // 容器不存在，创建新容器
      }
    }
    
    // 创建新容器
    const volumeFlags = docker.volumes.map(v => `-v "${v.host}:${v.container}"`).join(' ');
    const envFlags = Object.entries(docker.env).map(([k, v]) => `-e ${k}="${v}"`).join(' ');
    const nameFlag = docker.containerName ? `--name ${docker.containerName}` : '';
    
    const runCmd = `docker run -d ${nameFlag} ${volumeFlags} ${envFlags} -w "${docker.workingDir}" ${docker.image} sleep infinity`;
    const { stdout } = await execAsync(runCmd, { timeout: 30000 });
    
    this.containerId = stdout.trim();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.containerId && !this.env.docker?.containerName) {
      // 如果没有指定容器名，停止并删除临时容器
      try {
        await execAsync(`docker stop ${this.containerId}`, { timeout: 10000 });
        await execAsync(`docker rm ${this.containerId}`, { timeout: 10000 });
      } catch {}
    }
    this.connected = false;
    this.containerId = undefined;
  }

  async readFile(filePath: string): Promise<FileOperationResult> {
    try {
      const cmd = this.buildDockerCommand(`cat "${filePath}"`);
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
      // 使用 docker cp 或 base64 编码写入
      const base64Content = Buffer.from(content).toString('base64');
      const cmd = this.buildDockerCommand(`echo "${base64Content}" | base64 -d > "${filePath}"`);
      await execAsync(cmd, { timeout: 30000 });
      return { success: true, path: filePath };
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to write file', path: filePath };
    }
  }

  async listDirectory(dirPath: string): Promise<{ success: boolean; entries?: DirectoryEntry[]; error?: string }> {
    try {
      const cmd = this.buildDockerCommand(`ls -la "${dirPath}"`);
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
      const cmd = this.buildDockerCommand(fullCommand);
      
      const { stdout, stderr } = await execAsync(cmd, { 
        timeout: 60000,
        maxBuffer: 50 * 1024 * 1024 
      });
      
      // 更新当前目录
      if (command.includes('cd ')) {
        const { stdout: pwdOut } = await execAsync(this.buildDockerCommand('pwd'));
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

  private buildDockerCommand(command: string): string {
    if (!this.containerId) {
      throw new Error('Docker container not connected');
    }
    return `docker exec ${this.containerId} bash -c "${command.replace(/"/g, '\\"')}"`;
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
