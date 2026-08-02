/**
 * Git 服务 — 前端与后端 Git API 的桥梁
 * 提供 Git 状态查询、diff 查看、提交、推送等操作
 *
 * 修复: 支持动态工作区切换，自动传递当前工作区路径
 * 修复: getStatus 支持 AbortSignal 超时控制
 */

const API_BASE = '/v1/git';

// 获取当前工作区路径
function getWorkspacePath(): string {
  // 1. 从 localStorage 获取当前工作区
  const workspace = localStorage.getItem('agentai.workspace') ||
                   localStorage.getItem('currentWorkspace')||
                   (window as any).__AGENTAI_WORKSPACE__;
  return workspace || '';
}

// 构建带工作区信息的请求配置
function getWorkspaceConfig(): RequestInit {
  const workspace = getWorkspacePath();
  return workspace ? {
    headers: { 'X-Workspace-Path': workspace }
  } : {};
}

export interface GitFile {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'staged';
  staged: boolean;
  additions?: number;
  deletions?: number;
}

export interface GitStatus {
  success: boolean;
  branch: string;
  ahead: number;
  behind: number;
  files: GitFile[];
  summary: {
    modified: number;
    added: number;
    deleted: number;
    untracked: number;
    staged: number;
    totalAdditions: number;
    totalDeletions: number;
  };
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  date: string;
  message: string;
  author: string;
}

export interface GitBranch {
  name: string;
  current: boolean;
  remote: boolean;
}

export interface GitStash {
  hash: string;
  date: string;
  message: string;
}

class GitService {
  private _listeners: Set<(status: GitStatus) => void> = new Set();
  private _intervalId: number | null = null;
  private _lastStatus: GitStatus | null = null;

  /**
   * 获取 Git 状态（自动传递当前工作区）
   * @param opts 可选配置，支持 signal 用于超时取消
   */
  async getStatus(opts?: { signal?: AbortSignal }): Promise<GitStatus | null> {
    try {
      const res = await fetch(`${API_BASE}/status`, {
        ...getWorkspaceConfig(),
        ...(opts?.signal ? { signal: opts.signal } : {}),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || !data.summary) return null;
      this._lastStatus = data;
      return data;
    } catch {
      return null;
    }
  }

  /**
   * 获取文件 diff
   */
  async getDiff(file?: string, staged = false): Promise<{ success: boolean; diff: string; file: string; staged: boolean }> {
    const params = new URLSearchParams();
    if (file) params.append('file', file);
    if (staged) params.append('staged', 'true');
    const res = await fetch(`${API_BASE}/diff?${params}`, getWorkspaceConfig());
    return res.json();
  }

  /**
   * 获取提交历史
   */
  async getLog(count = 10, file?: string): Promise<{ success: boolean; commits: GitCommit[] }> {
    const params = new URLSearchParams();
    params.append('count', count.toString());
    if (file) params.append('file', file);
    const res = await fetch(`${API_BASE}/log?${params}`, getWorkspaceConfig());
    return res.json();
  }

  /**
   * 获取分支列表
   */
  async getBranches(): Promise<{ success: boolean; branches: GitBranch[] }> {
    const res = await fetch(`${API_BASE}/branches`, getWorkspaceConfig());
    return res.json();
  }

  /**
   * Stage 文件
   */
  async add(files: string[]): Promise<{ success: boolean; message: string; files: string[] }> {
    const res = await fetch(`${API_BASE}/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getWorkspaceConfig().headers },
      body: JSON.stringify({ files }),
    });
    return res.json();
  }

  /**
   * 提交变更
   */
  async commit(message: string, files?: string[]): Promise<{ success: boolean; message: string; commitHash?: string; output?: string }> {
    const res = await fetch(`${API_BASE}/commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getWorkspaceConfig().headers },
      body: JSON.stringify({ message, files }),
    });
    return res.json();
  }

  /**
   * 推送到远程
   */
  async push(remote = 'origin', branch?: string): Promise<{ success: boolean; message: string; output?: string }> {
    const res = await fetch(`${API_BASE}/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getWorkspaceConfig().headers },
      body: JSON.stringify({ remote, branch }),
    });
    return res.json();
  }

  /**
   * 从远程拉取
   */
  async pull(remote = 'origin', branch?: string): Promise<{ success: boolean; message: string; output?: string }> {
    const res = await fetch(`${API_BASE}/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getWorkspaceConfig().headers },
      body: JSON.stringify({ remote, branch }),
    });
    return res.json();
  }

  /**
   * 切换分支
   */
  async checkout(branch: string, create = false): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getWorkspaceConfig().headers },
      body: JSON.stringify({ branch, create }),
    });
    return res.json();
  }

  /**
   * 获取 stash 列表
   */
  async getStash(): Promise<{ success: boolean; stashes: GitStash[] }> {
    const res = await fetch(`${API_BASE}/stash`, getWorkspaceConfig());
    return res.json();
  }

  /**
   * 创建 stash
   */
  async stash(message?: string): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/stash`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getWorkspaceConfig().headers },
      body: JSON.stringify({ message }),
    });
    return res.json();
  }

  /**
   * 弹出 stash
   */
  async stashPop(index = 0): Promise<{ success: boolean; message: string; output?: string }> {
    const res = await fetch(`${API_BASE}/stash/pop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getWorkspaceConfig().headers },
      body: JSON.stringify({ index }),
    });
    return res.json();
  }

  /**
   * 重置变更
   */
  async reset(mode: 'soft' | 'mixed' | 'hard' = 'mixed', commit = 'HEAD'): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getWorkspaceConfig().headers },
      body: JSON.stringify({ mode, commit }),
    });
    return res.json();
  }

  /**
   * 开始轮询 Git 状态
   */
  startPolling(interval = 5000): void {
    this.stopPolling();
    this._intervalId = window.setInterval(async () => {
      const status = await this.getStatus();
      if (status) {
        this._listeners.forEach(fn => fn(status));
      }
    }, interval);
  }

  /**
   * 停止轮询
   */
  stopPolling(): void {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }

  /**
   * 监听状态变化
   */
  onStatusChange(callback: (status: GitStatus) => void): () => void {
    this._listeners.add(callback);
    return () => this._listeners.delete(callback);
  }

  /**
   * 获取最后一次状态
   */
  getLastStatus(): GitStatus | null {
    return this._lastStatus;
  }

  /**
   * 触发手动刷新
   */
  refresh(): void {
    window.dispatchEvent(new CustomEvent('git:refresh'));
  }
}

export const gitService = new GitService();
