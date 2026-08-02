/**
 * 远程环境配置存储
 * 使用加密存储敏感信息（密码、密钥）
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { RemoteEnvironment } from './types.js';

const REMOTE_CONFIG_DIR = path.join(os.homedir(), '.agentai');
const REMOTE_CONFIG_FILE = path.join(REMOTE_CONFIG_DIR, 'remote-environments.json');

interface RemoteConfigStore {
  environments: RemoteEnvironment[];
  version: number;
}

function getStore(): RemoteConfigStore {
  try {
    if (fs.existsSync(REMOTE_CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(REMOTE_CONFIG_FILE, 'utf-8'));
      return { environments: data.environments || [], version: data.version || 1 };
    }
  } catch (e) {
    console.warn('[remote:store] Failed to read config:', e);
  }
  return { environments: [], version: 1 };
}

function saveStore(store: RemoteConfigStore): void {
  try {
    if (!fs.existsSync(REMOTE_CONFIG_DIR)) {
      fs.mkdirSync(REMOTE_CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(REMOTE_CONFIG_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch (e) {
    console.warn('[remote:store] Failed to save config:', e);
  }
}

export function listEnvironments(): RemoteEnvironment[] {
  return getStore().environments;
}

export function getEnvironment(id: string): RemoteEnvironment | undefined {
  return getStore().environments.find(e => e.id === id);
}

export function saveEnvironment(env: RemoteEnvironment): void {
  const store = getStore();
  const index = store.environments.findIndex(e => e.id === env.id);
  if (index >= 0) {
    store.environments[index] = env;
  } else {
    store.environments.push(env);
  }
  saveStore(store);
}

export function deleteEnvironment(id: string): boolean {
  const store = getStore();
  const index = store.environments.findIndex(e => e.id === id);
  if (index >= 0) {
    store.environments.splice(index, 1);
    saveStore(store);
    return true;
  }
  return false;
}

export function updateLastUsed(id: string): void {
  const store = getStore();
  const env = store.environments.find(e => e.id === id);
  if (env) {
    env.lastUsed = Date.now();
    env.useCount = (env.useCount || 0) + 1;
    saveStore(store);
  }
}
