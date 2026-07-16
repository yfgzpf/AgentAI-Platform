/**
 * 简化版浏览器自动化 - 基于browser-use CLI
 * 
 * 核心功能：
 * 1. 执行browser-use命令序列
 * 2. 录制用户操作（通过命令日志）
 * 3. 回放录制的命令
 * 
 * 不依赖iframe注入，直接调用CLI
 */

import { execSync, exec, execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// 存储路径
const SCRIPTS_DIR = path.join(os.homedir(), '.agentai', 'browser-scripts');

// 确保目录存在
if (!fs.existsSync(SCRIPTS_DIR)) {
  fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
}

interface BrowserCommand {
  id: string;
  command: string;
  args: string[];
  timestamp: number;
  screenshot?: string;
}

interface BrowserScript {
  id: string;
  name: string;
  description: string;
  startUrl: string;
  commands: BrowserCommand[];
  createdAt: number;
  updatedAt: number;
}

/**
 * 执行browser-use命令
 */
const ALLOWED_BROWSER_COMMANDS = new Set([
  'navigate', 'click', 'type', 'screenshot', 'scroll', 'wait',
  'evaluate', 'extract', 'back', 'forward', 'close', 'hover', 'select', 'press',
]);
const SHELL_METACHARS = /[;&|`$(){}[\]<>!\n\r\\"']/;

export async function executeBrowserUse(
  command: string,
  args: string[] = [],
  timeout: number = 30000
): Promise<{ success: boolean; output: string; error?: string }> {
  if (!ALLOWED_BROWSER_COMMANDS.has(command)) {
    return { success: false, output: '', error: `不允许的命令: ${command}` };
  }
  for (const arg of args) {
    if (SHELL_METACHARS.test(arg)) {
      return { success: false, output: '', error: '参数包含非法字符' };
    }
  }
  try {
    const { stdout, stderr } = await execFileAsync('browser-use', [command, ...args], {
      timeout,
      shell: true,
      windowsHide: true,
    });
    return {
      success: true,
      output: stdout || stderr,
    };
  } catch (error: any) {
    return {
      success: false,
      output: error.stdout || '',
      error: error.stderr || error.message,
    };
  }
}

/**
 * 浏览器自动化控制器
 */
export class BrowserAutomation {
  private recording: boolean = false;
  private currentScript: BrowserScript | null = null;
  private commandLog: BrowserCommand[] = [];

  /**
   * 开始录制
   */
  startRecording(name: string, startUrl: string): BrowserScript {
    this.recording = true;
    this.commandLog = [];
    
    this.currentScript = {
      id: `script-${Date.now()}`,
      name: name || `脚本-${Date.now()}`,
      description: '',
      startUrl,
      commands: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    return this.currentScript;
  }

  /**
   * 记录命令
   */
  recordCommand(command: string, args: string[] = []): void {
    if (!this.recording) return;
    
    const cmd: BrowserCommand = {
      id: `cmd-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      command,
      args,
      timestamp: Date.now(),
    };
    
    this.commandLog.push(cmd);
  }

  /**
   * 停止录制并保存
   */
  stopRecording(): BrowserScript | null {
    if (!this.recording || !this.currentScript) {
      return null;
    }

    this.recording = false;
    this.currentScript.commands = [...this.commandLog];
    this.currentScript.updatedAt = Date.now();

    // 保存到文件
    const filePath = path.join(SCRIPTS_DIR, `${this.currentScript.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(this.currentScript, null, 2));

    return this.currentScript;
  }

  /**
   * 取消录制
   */
  cancelRecording(): void {
    this.recording = false;
    this.currentScript = null;
    this.commandLog = [];
  }

  /**
   * 获取录制状态
   */
  getRecordingStatus(): { recording: boolean; stepCount: number; script?: BrowserScript } {
    return {
      recording: this.recording,
      stepCount: this.commandLog.length,
      script: this.currentScript || undefined,
    };
  }

  /**
   * 执行脚本
   */
  async executeScript(scriptId: string, variables: Record<string, string> = {}): Promise<{
    success: boolean;
    results: Array<{ command: string; success: boolean; output: string }>;
    error?: string;
  }> {
    const filePath = path.join(SCRIPTS_DIR, `${scriptId}.json`);
    
    if (!fs.existsSync(filePath)) {
      return { success: false, results: [], error: 'Script not found' };
    }

    const script: BrowserScript = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const results: Array<{ command: string; success: boolean; output: string }> = [];

    // 先打开起始URL
    if (script.startUrl) {
      const openResult = await executeBrowserUse('open', [script.startUrl], 10000);
      results.push({
        command: `open ${script.startUrl}`,
        success: openResult.success,
        output: openResult.output,
      });
      
      if (!openResult.success) {
        return { success: false, results, error: 'Failed to open start URL' };
      }
    }

    // 执行每个命令
    for (const cmd of script.commands) {
      // 替换变量
      const args = cmd.args.map(arg => {
        let result = arg;
        for (const [key, value] of Object.entries(variables)) {
          result = result.replace(`{{${key}}}`, value);
        }
        return result;
      });

      const result = await executeBrowserUse(cmd.command, args, 30000);
      
      results.push({
        command: `${cmd.command} ${args.join(' ')}`,
        success: result.success,
        output: result.output,
      });

      // 如果命令失败，可以选择停止或继续
      if (!result.success) {
        console.warn(`Command failed: ${cmd.command}`, result.error);
      }

      // 命令间延迟
      await new Promise(r => setTimeout(r, 1000));
    }

    return {
      success: results.every(r => r.success),
      results,
    };
  }

  /**
   * 获取所有脚本
   */
  getAllScripts(): BrowserScript[] {
    const scripts: BrowserScript[] = [];
    
    if (!fs.existsSync(SCRIPTS_DIR)) return scripts;
    
    const files = fs.readdirSync(SCRIPTS_DIR);
    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const content = fs.readFileSync(path.join(SCRIPTS_DIR, file), 'utf-8');
          scripts.push(JSON.parse(content));
        } catch (e) {
          console.error(`Failed to load script ${file}:`, e);
        }
      }
    }
    
    return scripts.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 获取单个脚本
   */
  getScript(scriptId: string): BrowserScript | null {
    const filePath = path.join(SCRIPTS_DIR, `${scriptId}.json`);
    
    if (!fs.existsSync(filePath)) return null;
    
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (e) {
      return null;
    }
  }

  /**
   * 删除脚本
   */
  deleteScript(scriptId: string): boolean {
    const filePath = path.join(SCRIPTS_DIR, `${scriptId}.json`);
    
    if (!fs.existsSync(filePath)) return false;
    
    try {
      fs.unlinkSync(filePath);
      return true;
    } catch (e) {
      return false;
    }
  }
}

// 单例导出
export const browserAutomation = new BrowserAutomation();
