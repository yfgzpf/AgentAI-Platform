import { TaskChain, ChainState } from './task-chain.js';

type AnyChain = TaskChain;
const store = new Map<string, AnyChain>();

function key(userId: string, workspace: string): string {
  return `${userId}::${workspace}`;
}

export function putChain(userId: string, workspace: string, chain: AnyChain): void {
  store.set(key(userId, workspace) + '::' + chain.chainId, chain);
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
  for (const k of store.keys()) { if (k.endsWith('::' + chainId)) return store.delete(k); }
  return false;
}

export function clearAllChains(): void { store.clear(); }
