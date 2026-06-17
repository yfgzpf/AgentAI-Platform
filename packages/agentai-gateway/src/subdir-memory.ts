/**
 * SubdirMemory — 子目录记忆系统
 * ----------------------------------------------------------------
 * 学自: Reasonix subdir.ts (findSubdirMemoryAncestors)
 * 
 * 机制: 从当前工作文件所在目录向上遍历，收集沿途的 .agentai.md
 *       按 innermost-first 顺序注入 system prompt
 * 
 * 示例:
 *   workspace = F:/project/src/components
 *   F:/project/.agentai.md           ← 项目级规则
 *   F:/project/src/.agentai.md       ← src 级规则
 *   注入顺序: [src/.agentai.md, .agentai.md]
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const MEMORY_FILES = ['.agentai.md', 'AGENTS.md', 'AGENT.md'];
const MAX_CHARS_PER_FILE = 3000;

/**
 * 从某个目录向上遍历，收集记忆文件
 * 返回绝对路径列表，innermost-first
 */
export function findDirMemory(absDir: string, rootDir: string): string[] {
  const root = resolve(rootDir);
  const target = resolve(absDir);
  const rel = relative(root, target);
  if (rel.startsWith('..') && rel !== target) return [];

  const found: string[] = [];
  let cur = target;

  while (true) {
    const r = relative(root, cur);
    if (r.startsWith('..')) break;
    for (const name of MEMORY_FILES) {
      const p = join(cur, name);
      if (existsSync(p)) {
        found.push(p);
        break;
      }
    }
    const parent = dirname(cur);
    if (parent === cur || parent === sep + cur) break;
    cur = parent;
  }
  return found;
}

/**
 * 从文件路径向上找子目录记忆
 */
export function findSubdirMemoryAncestors(absPath: string, rootDir: string): string[] {
  return findDirMemory(dirname(resolve(absPath)), rootDir);
}

/**
 * 读取记忆文件内容，超长截断
 */
export function readSubdirMemoryContent(path: string): string | null {
  try {
    const raw = readFileSync(path, 'utf8').trim();
    if (!raw) return null;
    if (raw.length <= MAX_CHARS_PER_FILE) return raw;
    return raw.slice(0, MAX_CHARS_PER_FILE) + `\n… (truncated ${raw.length - MAX_CHARS_PER_FILE} chars)`;
  } catch {
    return null;
  }
}

/**
 * 格式化子目录记忆为 system prompt 片段
 */
export function buildSubdirMemorySection(workspaceDir: string): string {
  const ancestors = findDirMemory(workspaceDir, workspaceDir);
  if (ancestors.length === 0) return '';

  const sections: string[] = [];
  for (const p of ancestors) {
    const content = readSubdirMemoryContent(p);
    if (content) {
      const displayPath = p.replace(workspaceDir, '.').replace(/\\/g, '/');
      sections.push(`[项目记忆: ${displayPath}]\n${content}`);
    }
  }
  return sections.join('\n\n');
}
