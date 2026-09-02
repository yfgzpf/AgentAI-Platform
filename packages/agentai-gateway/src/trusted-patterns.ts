/**
 * 信任模式管理 — 从 agentai-loop.ts 提取
 * 
 * 职责: 管理工具操作的文件路径信任列表
 * 原位置: agentai-loop.ts 行 ~30-108, 304-308
 * 提取理由: 纯函数模块，无 this 依赖，置信度 95%+
 */

import * as fs from 'fs';
import * as path from 'path';

/** 信任模式条目 */
export interface TrustedPattern {
  toolName: string;
  pathPattern: string;
  trustedAt: number;
  compiledRegex?: RegExp;
}

const TRUSTED_PATTERNS_FILE = path.join(process.cwd(), '.agentai', 'trusted-patterns.json');

/** 加载信任模式 */
export function loadTrustedPatterns(): TrustedPattern[] {
  try {
    if (!fs.existsSync(TRUSTED_PATTERNS_FILE)) return [];
    const raw = JSON.parse(fs.readFileSync(TRUSTED_PATTERNS_FILE, 'utf-8'));
    // 还原 RegExp (JSON 序列化会丢失)
    return raw.map((p: any) => ({
      ...p,
      compiledRegex: p.pathPattern !== '*' ? new RegExp(`^${p.pathPattern.replace(/\*/g, '.*').replace(/\//g, '\\/').replace(/\\\\/g, '\\\\')}?$`, 'i') : undefined,
    }));
  } catch { return []; }
}

/** 持久化信任模式 */
export function saveTrustedPatterns(patterns: TrustedPattern[]): void {
  const dir = path.dirname(TRUSTED_PATTERNS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // 序列化时去掉 compiledRegex (不可 JSON 化)
  const serializable = patterns.map(({ compiledRegex, ...rest }) => rest);
  fs.writeFileSync(TRUSTED_PATTERNS_FILE, JSON.stringify(serializable, null, 2));
}

/** 检查路径是否匹配任一信任模式 */
export function isPathTrusted(toolName: string, filePath: string): boolean {
  const patterns = loadTrustedPatterns();
  return patterns.some(p => {
    if (p.toolName !== '*' && p.toolName !== toolName) return false;
    if (p.pathPattern === '*') return true;
    if (/\\{4,}/.test(p.pathPattern)) return false;
    const re = p.compiledRegex;
    return re ? re.test(filePath) : false;
  });
}

/** 添加信任模式 (由路由端点调用) */
export function addTrustedPattern(toolName: string, pathPattern: string): void {
  const patterns = loadTrustedPatterns();
  if (!patterns.some(p => p.toolName === toolName && p.pathPattern === pathPattern)) {
    const compiledRegex = pathPattern !== '*'
      ? new RegExp(`^${pathPattern.replace(/\*/g, '.*').replace(/\//g, '\\/').replace(/\\\\/g, '\\\\')}?$`, 'i')
      : undefined;
    patterns.push({ toolName, pathPattern, trustedAt: Date.now(), compiledRegex });
    saveTrustedPatterns(patterns);
  }
}

/** 获取所有信任模式 */
export function getTrustedPatterns(): TrustedPattern[] {
  return loadTrustedPatterns();
}

/** 移除信任模式 */
export function removeTrustedPattern(toolName: string, pathPattern: string): void {
  const patterns = loadTrustedPatterns().filter(p => !(p.toolName === toolName && p.pathPattern === pathPattern));
  saveTrustedPatterns(patterns);
}
