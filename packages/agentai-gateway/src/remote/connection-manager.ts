/**
 * 远程连接管理器
 * 管理 SSH/WSL/Docker 连接池
 */

import { EventEmitter } from 'events';
import { RemoteEnvironment, ConnectionState, FileOperationResult, DirectoryEntry, ExecResult } from './types.js';
import { SSHDriver } from './drivers/ssh.js';
import { WSLDriver } from './drivers/wsl.js';
import { DockerDriver } from './drivers/docker.js';
import { updateLastUsed } from './store.js';

interface Driver {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  readFile(path: string): Promise<FileOperationResult>;
  writeFile(path: string, content: string): Promise<FileOperationResult>;
  listDirectory(path: string): Promise<{ success: boolean; entries?: DirectoryEntry[]; error?: string }>;
  exec(command: string, cwd?: string): Promise<ExecResult>;
  getCurrentDirectory(): string;
}

export class RemoteConnectionManager extends EventEmitter {
  private connections = new Map<string, { state: ConnectionState; driver: Driver }>();
  private static instance: RemoteConnectionManager;

  static getInstance(): RemoteConnectionManager {
    if (!RemoteConnectionManager.instance) {
      RemoteConnectionManager.instance = new RemoteConnectionManager();
    }
    return RemoteConnectionManager.instance;
  }

  async connect(env: RemoteEnvironment): Promise<ConnectionState> {
    const existing = this.connections.get(env.id);
    if (existing && existing.state.status === 'connected') {
      return existing.state;
    }

    const state: ConnectionState = {
      id: `conn-${Date.now()}`,
      environmentId: env.id,
      status: 'connecting',
      lastActivity: Date.now(),
      latency: 0,
      transferSpeed: 0,
      retryCount: 0,
      sessionId: `session-${Date.now()}`,
      currentDirectory: env.workingDirectory,
    };

    try {
      const driver = this.createDriver(env);
      const startTime = Date.now();
      
      await driver.connect();
      
      state.status = 'connected';
      state.connectedAt = Date.now();
      state.latency = Date.now() - startTime;
      state.currentDirectory = driver.getCurrentDirectory();

      this.connections.set(env.id, { state, driver });
      updateLastUsed(env.id);
      
      this.emit('connected', { environmentId: env.id, state });
      
      return state;
    } catch (error: any) {
      state.status = 'error';
      state.error = error.message || 'Connection failed';
      this.emit('error', { environmentId: env.id, error: state.error });
      throw error;
    }
  }

  async disconnect(envId: string): Promise<void> {
    const conn = this.connections.get(envId);
    if (conn) {
      await conn.driver.disconnect();
      conn.state.status = 'disconnected';
      this.connections.delete(envId);
      this.emit('disconnected', { environmentId: envId });
    }
  }

  getConnection(envId: string): ConnectionState | undefined {
    return this.connections.get(envId)?.state;
  }

  isConnected(envId: string): boolean {
    return this.connections.get(envId)?.state.status === 'connected';
  }

  async readFile(envId: string, filePath: string): Promise<FileOperationResult> {
    const conn = this.getConnectedDriver(envId);
    conn.state.lastActivity = Date.now();
    return conn.driver.readFile(filePath);
  }

  async writeFile(envId: string, filePath: string, content: string): Promise<FileOperationResult> {
    const conn = this.getConnectedDriver(envId);
    conn.state.lastActivity = Date.now();
    return conn.driver.writeFile(filePath, content);
  }

  async listDirectory(envId: string, dirPath: string): Promise<{ success: boolean; entries?: DirectoryEntry[]; error?: string }> {
    const conn = this.getConnectedDriver(envId);
    conn.state.lastActivity = Date.now();
    return conn.driver.listDirectory(dirPath);
  }

  async exec(envId: string, command: string, cwd?: string): Promise<ExecResult> {
    const conn = this.getConnectedDriver(envId);
    conn.state.lastActivity = Date.now();
    return conn.driver.exec(command, cwd);
  }

  getAllConnections(): ConnectionState[] {
    return Array.from(this.connections.values()).map(c => c.state);
  }

  private getConnectedDriver(envId: string): { state: ConnectionState; driver: Driver } {
    const conn = this.connections.get(envId);
    if (!conn || conn.state.status !== 'connected') {
      throw new Error(`Environment ${envId} is not connected`);
    }
    return conn;
  }

  private createDriver(env: RemoteEnvironment): Driver {
    switch (env.type) {
      case 'ssh':
        if (!env.ssh) throw new Error('SSH config required');
        return new SSHDriver(env);
      case 'wsl':
        if (!env.wsl) throw new Error('WSL config required');
        return new WSLDriver(env);
      case 'docker':
        if (!env.docker) throw new Error('Docker config required');
        return new DockerDriver(env);
      default:
        throw new Error(`Unsupported environment type: ${env.type}`);
    }
  }
}

// 导出单例
export const remoteManager = RemoteConnectionManager.getInstance();
