import { TaskChain, ChainState } from './task-chain.js';
import * as fs from 'fs';
import * as path from 'path';

type AnyChain = TaskChain;
const store = new Map<string, AnyChain>();

// P0 修复: 持久化到文件 — gateway 重启后任务链不丢失
const CHAIN_FILE = path.join(process.cwd(), '.agentai', 'chains.json');

function loadFromFile(): void {
  try {
    if (!fs.existsSync(CHAIN_FILE)) return;
    const data = JSON.parse(fs.readFileSync(CHAIN_FILE, 'utf-8'));
    // 注意: 反序列化后的是纯数据, 不是 TaskChain 实例 — 但 getChain 返回后调用者用的是 .chainId/.stages 等属性
    // 纯数据访问不需要实例方法, 所以直接存纯数据即可
    for (const [k, v] of Object.entries(data)) {
      store.set(k, v as AnyChain);
    }
    console.log(`[chain-store] 已从文件恢复 ${store.size} 个任务链`);
  } catch { /* 文件不存在或损坏, 忽略 */ }
}

function saveToFile(): void {
  try {
    const dir = path.dirname(CHAIN_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data: Record<string, any> = {};
    for (const [k, v] of store.entries()) {
      // 序列化: 如果是 TaskChain 实例, 用 toJSON(); 否则直接存
      data[k] = (v as any).toJSON ? (v as any).toJSON() : v;
    }
    fs.writeFileSync(CHAIN_FILE, JSON.stringify(data));
  } catch { /* 持久化失败不影响内存操作 */ }
}

// 启动时加载
loadFromFile();

function key(userId: string, workspace: string): string {
  return `${userId}::${workspace}`;
}

export function putChain(userId: string, workspace: string, chain: AnyChain): void {
  store.set(key(userId, workspace) + '::' + chain.chainId, chain);
  saveToFile();
}

export function getChain(userId: string, workspace: string, chainId: string): AnyChain | undefined {
  return store.get(key(userId, workspace) + '::' + chainId);
}

export function getChainById(chainId: string): AnyChain | undefined {
  for (const c of store.values()) { if (c.chainId === chainId) return c; }
  return undefined;
}

export function listChains(userId: string, workspace: string): ChainState[] {
  const prefix = key(userId, workspace) + '::';
  const out: ChainState[] = [];
  for (const [k, c] of store.entries()) { if (k.startsWith(prefix)) out.push(c.toJSON()); }
  return out;
}

export function dropChain(chainId: string): boolean {
  for (const k of store.keys()) { if (k.endsWith('::' + chainId)) { const deleted = store.delete(k); saveToFile(); return deleted; } }
  return false;
}

export function clearAllChains(): void { store.clear(); saveToFile(); }

/** P0: 获取用户最近未完成的任务链 (用于恢复) */
export function getLatestUnfinishedChain(userId: string, workspace: string): AnyChain | undefined {
  const prefix = key(userId, workspace) + '::';
  let latest: AnyChain | undefined;
  let latestTime = 0;
  for (const [k, c] of store.entries()) {
    if (!k.startsWith(prefix)) continue;
    const state = c.toJSON();
    // 只恢复未完成的链 (currentStage 不是 done/failed)
    if (state.currentStage !== 'done' && state.currentStage !== 'failed') {
      if (state.createdAt > latestTime) {
        latestTime = state.createdAt;
        latest = c;
      }
    }
  }
  return latest;
}
