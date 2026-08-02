/**
 * 远程开发环境 - 类型定义
 */

export type RemoteEnvironmentType = 'ssh' | 'wsl' | 'docker' | 'codespace';

export interface SSHConfig {
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key' | 'agent';
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export interface WSLConfig {
  distribution: string;
  user?: string;
}

export interface DockerConfig {
  containerName?: string;
  image: string;
  workingDir: string;
  volumes: Array<{ host: string; container: string }>;
  env: Record<string, string>;
}

export interface RemoteEnvironment {
  id: string;
  name: string;
  type: RemoteEnvironmentType;
  ssh?: SSHConfig;
  wsl?: WSLConfig;
  docker?: DockerConfig;
  workingDirectory: string;
  defaultShell: string;
  envVars: Record<string, string>;
  lastUsed: number;
  useCount: number;
  isFavorite: boolean;
}

export interface ConnectionState {
  id: string;
  environmentId: string;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  connectedAt?: number;
  lastActivity: number;
  latency: number;
  transferSpeed: number;
  error?: string;
  retryCount: number;
  sessionId: string;
  currentDirectory: string;
}

export interface FileOperationResult {
  success: boolean;
  content?: string;
  error?: string;
  path: string;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: number;
}

export interface ExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export interface RemoteAuditLog {
  timestamp: number;
  environmentId: string;
  userId: string;
  action: 'connect' | 'disconnect' | 'file_read' | 'file_write' | 'exec';
  details: Record<string, any>;
  success: boolean;
  error?: string;
}
