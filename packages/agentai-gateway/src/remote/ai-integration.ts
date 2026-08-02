/**
 * 远程环境 AI 集成模块
 * 让 AI 自动感知和操作远程环境
 */

import { RemoteEnvironment, ConnectionState, ExecResult } from './types.js';
import { remoteManager } from './connection-manager.js';
import { getEnvironment, listEnvironments } from './store.js';

/**
 * 当前活跃的远程环境会话
 */
interface ActiveRemoteSession {
  environmentId: string;
  environment: RemoteEnvironment;
  state: ConnectionState;
  activatedAt: number;
}

let activeSession: ActiveRemoteSession | null = null;

/**
 * 激活远程环境会话
 * 连接成功后调用，让 AI 感知到远程环境
 */
export async function activateRemoteSession(envId: string): Promise<ActiveRemoteSession> {
  const env = getEnvironment(envId);
  if (!env) {
    throw new Error(`Environment ${envId} not found`);
  }

  const state = remoteManager.getConnection(envId);
  if (!state || state.status !== 'connected') {
    throw new Error(`Environment ${envId} is not connected`);
  }

  activeSession = {
    environmentId: envId,
    environment: env,
    state,
    activatedAt: Date.now(),
  };

  return activeSession;
}

/**
 * 停用远程环境会话
 */
export function deactivateRemoteSession(): void {
  activeSession = null;
}

/**
 * 获取当前活跃的远程会话
 */
export function getActiveRemoteSession(): ActiveRemoteSession | null {
  return activeSession;
}

/**
 * 检查是否有活跃的远程会话
 */
export function isRemoteSessionActive(): boolean {
  return activeSession !== null && activeSession.state.status === 'connected';
}

/**
 * 构建远程环境上下文（注入到 System Prompt）
 */
export function buildRemoteContext(): string | null {
  if (!activeSession) return null;

  const { environment, state } = activeSession;
  const typeName = {
    ssh: 'SSH 服务器',
    wsl: 'WSL 子系统',
    docker: 'Docker 容器',
    codespace: 'Codespace',
  }[environment.type];

  let envDetails = '';
  if (environment.type === 'ssh' && environment.ssh) {
    envDetails = `
- 主机: ${environment.ssh.host}:${environment.ssh.port}
- 用户: ${environment.ssh.username}`;
  } else if (environment.type === 'wsl' && environment.wsl) {
    envDetails = `
- 发行版: ${environment.wsl.distribution}
- 用户: ${environment.wsl.user || '默认用户'}`;
  } else if (environment.type === 'docker' && environment.docker) {
    envDetails = `
- 镜像: ${environment.docker.image}
- 工作目录: ${environment.docker.workingDir}`;
  }

  return `
## 🌐 当前远程开发环境

你正在操作一个远程开发环境，所有文件操作和命令执行都在远程进行：

### 环境信息
- **名称**: ${environment.name}
- **类型**: ${typeName}
- **工作目录**: ${state.currentDirectory}
- **连接状态**: ✅ 已连接
- **延迟**: ${state.latency}ms
${envDetails}

### 操作规则
1. **文件路径**: 使用远程绝对路径或相对于 ${state.currentDirectory} 的相对路径
2. **命令执行**: 所有 shell 命令在远程环境执行
3. **环境变量**: 使用远程环境的环境变量
4. **网络访问**: 从远程环境发起网络请求

### 本地 vs 远程判断
- 用户说"查看服务器日志"、"部署到测试环境" → 使用远程环境
- 用户说"修改本地配置"、"查看本地文件" → 询问是否切换到本地
- 用户提到远程工作目录下的文件路径 → 使用远程环境
`;
}

/**
 * 远程文件操作封装
 */
export async function remoteReadFile(filePath: string): Promise<{ success: boolean; content?: string; error?: string }> {
  if (!activeSession) {
    return { success: false, error: '未连接到远程环境' };
  }

  try {
    const result = await remoteManager.readFile(activeSession.environmentId, filePath);
    return {
      success: result.success,
      content: result.content,
      error: result.error,
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function remoteWriteFile(filePath: string, content: string): Promise<{ success: boolean; error?: string }> {
  if (!activeSession) {
    return { success: false, error: '未连接到远程环境' };
  }

  try {
    const result = await remoteManager.writeFile(activeSession.environmentId, filePath, content);
    return {
      success: result.success,
      error: result.error,
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function remoteListDirectory(dirPath: string): Promise<{ success: boolean; entries?: any[]; error?: string }> {
  if (!activeSession) {
    return { success: false, error: '未连接到远程环境' };
  }

  try {
    const result = await remoteManager.listDirectory(activeSession.environmentId, dirPath);
    return {
      success: result.success,
      entries: result.entries,
      error: result.error,
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function remoteExec(command: string, cwd?: string): Promise<ExecResult> {
  if (!activeSession) {
    return {
      success: false,
      stdout: '',
      stderr: '未连接到远程环境',
      exitCode: 1,
      durationMs: 0,
    };
  }

  try {
    return await remoteManager.exec(activeSession.environmentId, command, cwd);
  } catch (error: any) {
    return {
      success: false,
      stdout: '',
      stderr: error.message,
      exitCode: 1,
      durationMs: 0,
    };
  }
}

/**
 * 检测用户意图是否需要远程操作
 */
export function detectRemoteIntent(userMessage: string): {
  shouldUseRemote: boolean;
  confidence: number;
  reason: string;
  suggestedEnv?: string;
} {
  const msg = userMessage.toLowerCase();

  // 明确的远程关键词
  const remoteKeywords = [
    { kw: '服务器', confidence: 0.9 },
    { kw: '远程', confidence: 0.9 },
    { kw: 'ssh', confidence: 0.95 },
    { kw: 'wsl', confidence: 0.95 },
    { kw: 'docker', confidence: 0.95 },
    { kw: '容器', confidence: 0.85 },
    { kw: '部署', confidence: 0.8 },
    { kw: '上线', confidence: 0.8 },
    { kw: '发布', confidence: 0.8 },
    { kw: '生产环境', confidence: 0.9 },
    { kw: '测试环境', confidence: 0.85 },
    { kw: '服务器日志', confidence: 0.9 },
    { kw: '远程调试', confidence: 0.9 },
    { kw: '云端', confidence: 0.85 },
    { kw: '阿里云', confidence: 0.9 },
    { kw: '腾讯云', confidence: 0.9 },
    { kw: 'aws', confidence: 0.9 },
    { kw: 'ec2', confidence: 0.9 },
    { kw: 'vps', confidence: 0.9 },
  ];

  for (const { kw, confidence } of remoteKeywords) {
    if (msg.includes(kw)) {
      // 检查是否有匹配的远程环境
      const envs = listEnvironments();
      const matchingEnv = envs.find(e =>
        msg.includes(e.name.toLowerCase()) ||
        (e.type === 'ssh' && e.ssh && msg.includes(e.ssh.host))
      );

      return {
        shouldUseRemote: true,
        confidence,
        reason: `检测到远程关键词: ${kw}`,
        suggestedEnv: matchingEnv?.id,
      };
    }
  }

  // 文件路径判断（远程路径特征）
  const remotePaths = ['/home', '/opt', '/var', '/app', '/workspace', '/root', '/etc'];
  for (const rp of remotePaths) {
    if (msg.includes(rp)) {
      return {
        shouldUseRemote: true,
        confidence: 0.85,
        reason: `检测到远程路径: ${rp}`,
      };
    }
  }

  // 当前处于远程模式
  if (activeSession) {
    // 用户提到本地
    if (msg.includes('本地') || msg.includes('local')) {
      return {
        shouldUseRemote: false,
        confidence: 0.7,
        reason: '用户提到本地，建议切换',
      };
    }

    return {
      shouldUseRemote: true,
      confidence: 0.6,
      reason: '当前处于远程模式',
    };
  }

  return {
    shouldUseRemote: false,
    confidence: 0.5,
    reason: '当前处于本地模式',
  };
}

/**
 * 建议环境切换
 */
export function suggestEnvironmentSwitch(userMessage: string): string | null {
  const msg = userMessage.toLowerCase();

  // 用户在远程模式下提到本地
  if (activeSession && (msg.includes('本地') || msg.includes('local'))) {
    return '检测到您提到"本地"，是否需要切换到本地工作区？';
  }

  // 用户在本地模式下提到远程
  if (!activeSession) {
    const intent = detectRemoteIntent(userMessage);
    if (intent.shouldUseRemote && intent.confidence > 0.8) {
      const envs = listEnvironments();
      if (envs.length > 0) {
        const envNames = envs.map(e => e.name).join('、');
        return `检测到您可能需要远程操作。可用环境: ${envNames}。是否连接？`;
      }
    }
  }

  return null;
}

/**
 * 获取远程环境状态摘要（用于 AI 了解环境）
 */
export async function getRemoteEnvironmentSummary(): Promise<string> {
  if (!activeSession) {
    return '未连接到远程环境';
  }

  const { environment, state } = activeSession;

  // 获取远程系统信息
  const sysInfo = await remoteExec('uname -a && echo "---" && pwd && echo "---" && df -h .');

  return `
远程环境: ${environment.name} (${environment.type})
工作目录: ${state.currentDirectory}
连接延迟: ${state.latency}ms
系统信息: ${sysInfo.stdout || '无法获取'}
`;
}

/**
 * 自动检测文件位置（本地还是远程）
 */
export async function detectFileLocation(filePath: string): Promise<'local' | 'remote' | 'unknown'> {
  // 如果有活跃的远程会话，优先检查远程
  if (activeSession) {
    try {
      const result = await remoteExec(`test -e "${filePath}" && echo "exists" || echo "not found"`);
      if (result.stdout.includes('exists')) {
        return 'remote';
      }
    } catch {
      // 忽略错误，继续检查本地
    }
  }

  // 检查本地
  try {
    const fs = await import('fs');
    if (fs.existsSync(filePath)) {
      return 'local';
    }
  } catch {
    // 忽略错误
  }

  return 'unknown';
}
