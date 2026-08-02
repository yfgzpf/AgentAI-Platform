/**
 * Git 授权管理 — SSH Key / HTTPS Token / 凭证助手配置
 * 支持多种认证方式，统一管理 Git 凭证
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface GitAuthConfig {
  type: 'ssh' | 'https_token' | 'https_credential_helper';
  name: string;
  isDefault: boolean;
  // SSH
  sshKeyPath?: string;
  sshPublicKey?: string;
  // HTTPS Token
  username?: string;
  token?: string;
  host?: string; // github.com, gitlab.com, etc.
  // 凭证助手
  credentialHelper?: string;
}

const CONFIG_DIR = path.join(os.homedir(), '.agentai', 'git-auth');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// 确保配置目录存在
function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

// 读取配置
function readConfig(): GitAuthConfig[] {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch { /* ignore */ }
  return [];
}

// 保存配置
function saveConfig(configs: GitAuthConfig[]): void {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(configs, null, 2));
}

/**
 * 生成新的 SSH Key
 */
export function generateSSHKey(name: string, email: string, passphrase = ''): { privateKey: string; publicKey: string; path: string } {
  ensureConfigDir();
  const keyPath = path.join(CONFIG_DIR, `id_${name.replace(/[^a-z0-9]/gi, '_')}`);
  
  // 使用 ssh-keygen 生成密钥
  const cmd = `ssh-keygen -t ed25519 -C "${email}" -f "${keyPath}" -N "${passphrase}"`;
  execSync(cmd, { stdio: 'pipe' });
  
  const privateKey = fs.readFileSync(keyPath, 'utf-8');
  const publicKey = fs.readFileSync(`${keyPath}.pub`, 'utf-8');
  
  // 添加到 ssh-agent
  try {
    execSync(`ssh-add "${keyPath}"`, { stdio: 'ignore' });
  } catch { /* ignore */ }
  
  return { privateKey, publicKey, path: keyPath };
}

/**
 * 添加 SSH Key 配置
 */
export function addSSHKey(name: string, email: string, isDefault = false): GitAuthConfig {
  const { publicKey, path: keyPath } = generateSSHKey(name, email);
  
  const configs = readConfig();
  
  // 如果设为默认，取消其他默认
  if (isDefault) {
    configs.forEach(c => c.isDefault = false);
  }
  
  const config: GitAuthConfig = {
    type: 'ssh',
    name,
    isDefault: isDefault || configs.length === 0,
    sshKeyPath: keyPath,
    sshPublicKey: publicKey,
  };
  
  configs.push(config);
  saveConfig(configs);
  
  return config;
}

/**
 * 添加 HTTPS Token 配置
 */
export function addHttpsToken(name: string, host: string, username: string, token: string, isDefault = false): GitAuthConfig {
  const configs = readConfig();
  
  if (isDefault) {
    configs.forEach(c => c.isDefault = false);
  }
  
  const config: GitAuthConfig = {
    type: 'https_token',
    name,
    host,
    username,
    token,
    isDefault: isDefault || configs.length === 0,
  };
  
  configs.push(config);
  saveConfig(configs);
  
  // 配置 git credential helper
  try {
    execSync(`git config --global credential.${host}.helper store`);
    // 写入凭证到 ~/.git-credentials
    const credsPath = path.join(os.homedir(), '.git-credentials');
    const credLine = `https://${username}:${token}@${host}\n`;
    if (!fs.existsSync(credsPath) || !fs.readFileSync(credsPath, 'utf-8').includes(credLine.trim())) {
      fs.appendFileSync(credsPath, credLine);
    }
  } catch { /* ignore */ }
  
  return config;
}

/**
 * 获取所有配置
 */
export function listAuthConfigs(): GitAuthConfig[] {
  return readConfig();
}

/**
 * 获取默认配置
 */
export function getDefaultAuth(): GitAuthConfig | null {
  const configs = readConfig();
  return configs.find(c => c.isDefault) || configs[0] || null;
}

/**
 * 删除配置
 */
export function removeAuth(name: string): boolean {
  const configs = readConfig();
  const idx = configs.findIndex(c => c.name === name);
  if (idx >= 0) {
    const config = configs[idx];
    // 删除 SSH key 文件
    if (config.sshKeyPath) {
      try {
        fs.unlinkSync(config.sshKeyPath);
        fs.unlinkSync(`${config.sshKeyPath}.pub`);
      } catch { /* ignore */ }
    }
    configs.splice(idx, 1);
    saveConfig(configs);
    return true;
  }
  return false;
}

/**
 * 设置默认配置
 */
export function setDefaultAuth(name: string): boolean {
  const configs = readConfig();
  let found = false;
  configs.forEach(c => {
    if (c.name === name) {
      c.isDefault = true;
      found = true;
    } else {
      c.isDefault = false;
    }
  });
  if (found) {
    saveConfig(configs);
  }
  return found;
}

/**
 * 测试 Git 认证是否有效
 */
export function testGitAuth(host = 'github.com'): { success: boolean; message: string } {
  try {
    // 测试 SSH 连接
    const result = execSync(`ssh -T git@${host} 2>&1`, { encoding: 'utf-8', timeout: 10000 });
    return { success: true, message: result };
  } catch (e: any) {
    const msg = e.message || '';
    if (msg.includes('successfully authenticated')) {
      return { success: true, message: 'SSH 认证成功' };
    }
    return { success: false, message: `认证失败: ${msg}` };
  }
}

/**
 * 获取 SSH 公钥内容（用于复制到 GitHub/GitLab）
 */
export function getSSHPublicKey(name?: string): string | null {
  const configs = readConfig();
  const config = name 
    ? configs.find(c => c.name === name && c.type === 'ssh')
    : configs.find(c => c.isDefault && c.type === 'ssh');
  
  if (config?.sshPublicKey) {
    return config.sshPublicKey;
  }
  
  // 尝试读取默认 SSH key
  const defaultKeyPath = path.join(os.homedir(), '.ssh', 'id_ed25519.pub');
  if (fs.existsSync(defaultKeyPath)) {
    return fs.readFileSync(defaultKeyPath, 'utf-8');
  }
  
  const rsaKeyPath = path.join(os.homedir(), '.ssh', 'id_rsa.pub');
  if (fs.existsSync(rsaKeyPath)) {
    return fs.readFileSync(rsaKeyPath, 'utf-8');
  }
  
  return null;
}

/**
 * 配置 Git 用户信息（全局）
 */
export function configureGitUser(name: string, email: string): void {
  execSync(`git config --global user.name "${name}"`);
  execSync(`git config --global user.email "${email}"`);
}

/**
 * 获取 Git 用户信息
 */
export function getGitUser(): { name: string; email: string } {
  try {
    const name = execSync('git config --global user.name', { encoding: 'utf-8' }).trim();
    const email = execSync('git config --global user.email', { encoding: 'utf-8' }).trim();
    return { name: name || '', email: email || '' };
  } catch {
    return { name: '', email: '' };
  }
}
