/**
 * 信任命令白名单管理
 * 从 agentai-loop.ts 提取
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TrustedPattern } from './types.js';

const TRUSTED_COMMANDS_FILE = path.join(os.homedir(), '.agentai', 'trusted-commands.json');

let trustedPatternsCache: TrustedPattern[] | null = null;

/**
 * 加载信任模式列表
 */
export function loadTrustedPatterns(): TrustedPattern[] {
  if (trustedPatternsCache) return trustedPatternsCache;
  try {
    if (fs.existsSync(TRUSTED_COMMANDS_FILE)) {
      trustedPatternsCache = JSON.parse(fs.readFileSync(TRUSTED_COMMANDS_FILE, 'utf-8'));
      return trustedPatternsCache || [];
    }
  } catch { /* ignore */ }
  return [];
}

/**
 * 保存信任模式列表
 */
export function saveTrustedPatterns(patterns: TrustedPattern[]): void {
  try {
    const dir = path.dirname(TRUSTED_COMMANDS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(TRUSTED_COMMANDS_FILE, JSON.stringify(patterns, null, 2), 'utf-8');
    trustedPatternsCache = patterns;
  } catch { /* ignore */ }
}

/**
 * 检查命令是否在白名单中
 * @param toolName 工具名称
 * @param filePath 文件路径
 * @returns 是否信任
 */
export function isTrustedCommand(toolName: string, filePath: string): boolean {
  const patterns = loadTrustedPatterns();
  return patterns.some(p => {
    if (p.toolName !== toolName && p.toolName !== '*') return false;
    if (p.pathPattern === '*') return true;
    // ReDoS 防护: 拒绝过长或连续通配符的模式
    if (p.pathPattern.length > 200) return false;
    if (/\*{4,}/.test(p.pathPattern)) return false; // 4+ 连续 * 可能导致指数回溯
    // 简单 glob 匹配: ** 匹配任意路径段, * 匹配非/字符
    try {
      const regex = new RegExp('^' + p.pathPattern.replace(/\./g, '\\.').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$');
      return regex.test(filePath);
    } catch {
      return false; // 无效正则 → 不匹配
    }
  });
}

/**
 * 添加信任模式
 * @param toolName 工具名称
 * @param pathPattern 路径模式 (glob-like)
 */
export function addTrustedPattern(toolName: string, pathPattern: string): void {
  const patterns = loadTrustedPatterns();
  // 去重: 相同 tool+path 只保留一个
  const filtered = patterns.filter(p => !(p.toolName === toolName && p.pathPattern === pathPattern));
  filtered.push({
    toolName,
    pathPattern,
    trustedAt: Date.now(),
  });
  saveTrustedPatterns(filtered);
}

/**
 * 移除信任模式
 * @param toolName 工具名称
 * @param pathPattern 路径模式
 */
export function removeTrustedPattern(toolName: string, pathPattern: string): void {
  const patterns = loadTrustedPatterns();
  const filtered = patterns.filter(p => !(p.toolName === toolName && p.pathPattern === pathPattern));
  saveTrustedPatterns(filtered);
}

/**
 * 获取所有信任模式
 */
export function getTrustedPatterns(): TrustedPattern[] {
  return loadTrustedPatterns();
}
