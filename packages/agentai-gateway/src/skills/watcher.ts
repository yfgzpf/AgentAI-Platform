/**
 * Skill Watcher - 技能目录热加载
 * ----------------------------------------------------
 * 用 chokidar 监听 skills/ 目录, 自动增量更新内存 skillRegistry
 * 无需重启 Gateway 即可让新技能生效
 *
 * 触发场景:
 *   - 用户在 ~/.agentai/skills/ 添加新技能目录
 *   - 开发者修改 packages/agentai-skills/ 中的 SKILL.md
 *   - IDE 删除/重命名技能
 */

import chokidar from 'chokidar';
import * as path from 'path';
import * as fs from 'fs';
import { scanProjectSkills, scanUserSkills, scanBuiltInSkills, SkillMeta, registerSkill, unregisterSkill, getSkill } from './loader.js';

/** 简单日志: 后续可替换为 pino */
const log = {
  info: (msg: string) => console.log(`[INFO] ${msg}`),
  warn: (msg: string) => console.warn(`[WARN] ${msg}`),
  error: (msg: string) => console.error(`[ERROR] ${msg}`),
};

let watcherInstance: chokidar.FSWatcher | null = null;
const debounceTimers = new Map<string, NodeJS.Timeout>();

/**
 * 防抖, 避免一次操作触发多次重新加载
 */
function debouncedReload(filePath: string, callback: () => void, delay: number = 300) {
  if (debounceTimers.has(filePath)) {
    clearTimeout(debounceTimers.get(filePath)!);
  }
  debounceTimers.set(filePath, setTimeout(() => {
    debounceTimers.delete(filePath);
    callback();
  }, delay));
}

/**
 * 启动技能目录热加载
 * @param paths 要监听的目录列表 (项目/用户/内置)
 */
export function startSkillWatcher(paths: string[]): chokidar.FSWatcher | null {
  if (watcherInstance) {
    log.warn('[skill-watcher] 已存在 watcher, 跳过启动');
    return watcherInstance;
  }

  // 过滤掉不存在的目录
  const existingPaths = paths.filter(p => {
    try {
      return fs.existsSync(p) && fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  });

  if (existingPaths.length === 0) {
    log.warn('[skill-watcher] 所有监听路径都不存在, 跳过启动');
    return null;
  }

  log.info(`[skill-watcher] 启动热加载, 监听 ${existingPaths.length} 个目录: ${existingPaths.join(', ')}`);

  watcherInstance = chokidar.watch(existingPaths, {
    ignored: [
      /(^|[\/\\])\../, // 隐藏文件
      /node_modules/,
      /\.(pyc|log|tmp)$/,
    ],
    persistent: true,
    ignoreInitial: true, // 启动时已扫描, 不再触发
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 100,
    },
  });

  watcherInstance
    .on('add', (filePath) => {
      if (!filePath.endsWith('SKILL.md')) return;
      debouncedReload(filePath, () => handleAddOrChange(filePath));
    })
    .on('change', (filePath) => {
      if (!filePath.endsWith('SKILL.md')) return;
      debouncedReload(filePath, () => handleAddOrChange(filePath));
    })
    .on('unlink', (filePath) => {
      if (!filePath.endsWith('SKILL.md')) return;
      debouncedReload(filePath, () => handleUnlink(filePath));
    })
    .on('addDir', (dirPath) => {
      // 新增的目录可能包含新技能
      const skillFile = path.join(dirPath, 'SKILL.md');
      if (fs.existsSync(skillFile)) {
        debouncedReload(skillFile, () => handleAddOrChange(skillFile));
      }
    })
    .on('unlinkDir', (dirPath) => {
      // 删除目录时尝试移除其中的所有技能
      const skillName = path.basename(dirPath);
      if (getSkill(skillName)) {
        log.info(`[skill-watcher] 技能目录被删除: ${skillName}`);
        unregisterSkill(skillName);
      }
    })
    .on('error', (error) => {
      log.error(`[skill-watcher] 错误: ${error}`);
    })
    .on('ready', () => {
      log.info('[skill-watcher] 准备就绪, 等待文件变化');
    });

  return watcherInstance;
}

function handleAddOrChange(filePath: string) {
  const dir = path.dirname(filePath);
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const meta = parseSkillMd(content);
    if (!meta) {
      log.warn(`[skill-watcher] SKILL.md 格式错误: ${filePath}`);
      return;
    }
    meta.sourcePath = dir;
    registerSkill(meta);
    log.info(`[skill-watcher] ${getSkill(meta.name) ? '更新' : '新增'}技能: ${meta.name} (${meta.category})`);
  } catch (e) {
    log.error(`[skill-watcher] 读取技能失败 ${filePath}: ${(e as Error).message}`);
  }
}

function handleUnlink(filePath: string) {
  const dir = path.dirname(filePath);
  // 推断技能名 = 目录名
  const name = path.basename(dir);
  if (unregisterSkill(name)) {
    log.info(`[skill-watcher] 移除技能: ${name}`);
  }
}

/**
 * 解析 SKILL.md 的 YAML frontmatter
 * 极简实现: 只支持 key: value 单行
 */
function parseSkillMd(content: string): SkillMeta | null {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!m) return null;
  const yaml = m[1];
  const body = m[2].trim();

  const meta: any = { description: body.slice(0, 200), tools: [], triggers: [] };
  for (const line of yaml.split('\n')) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, k, v] = kv;
    if (k === 'tools' || k === 'triggers') {
      meta[k] = v.split(',').map((s: string) => s.trim()).filter(Boolean);
    } else {
      meta[k] = v.trim();
    }
  }
  if (!meta.name) return null;

  // 从第一段非空行提取描述
  const firstPara = body.split('\n\n')[0];
  if (firstPara) meta.description = firstPara.replace(/^#+\s*/, '').trim().slice(0, 200);

  return meta as SkillMeta;
}

/**
 * 停止监听
 */
export async function stopSkillWatcher(): Promise<void> {
  if (watcherInstance) {
    await watcherInstance.close();
    watcherInstance = null;
    log.info('[skill-watcher] 已停止');
  }
  for (const t of debounceTimers.values()) clearTimeout(t);
  debounceTimers.clear();
}

/**
 * 完整刷新 (手动触发重新扫描)
 */
export async function fullRefreshSkills(): Promise<{ added: number; updated: number }> {
  const before = new Set<string>();
  // 简单实现: 全量扫描 + 重新注册
  const all = [
    ...scanBuiltInSkills(),
    ...scanProjectSkills(),
    ...scanUserSkills(),
  ];
  for (const s of all) {
    const existed = !!getSkill(s.name);
    registerSkill(s);
    if (!existed) before.add(s.name);
  }
  return { added: before.size, updated: all.length - before.size };
}
