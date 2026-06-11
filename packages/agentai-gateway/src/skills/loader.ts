// @ts-nocheck
/**
 * Skill Loader — 自动扫描 + 注册 Trae 风格技能
 * ----------------------------------------------------
 * 混合方案 A: 简单技能 (文档+脚本) → 自动注册为 ToolSpec
 *
 * 技能目录结构:
 *   skills/
 *     <category>/<skill-name>/
 *       SKILL.md          # 技能描述 (YAML frontmatter + markdown body)
 *       main.py           # 可选: Python 脚本
 *       main.ts           # 可选: TypeScript 脚本
 *
 * SKILL.md 格式:
 * ---
 * name: my-skill
 * description: 技能描述
 * category: code
 * tools:           # 自动授权的工具列表
 *   - read_file
 *   - bash
 * triggers:        # 触发关键词
 *   - "写测试"
 *   - "生成文档"
 * ---
 *
 * 详细描述...
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/** 技能元数据 */
export interface SkillMeta {
  name: string;
  description: string;
  category: string;
  /** 自动授权的工具列表 */
  tools: string[];
  /** 触发关键词 */
  triggers: string[];
  /** 脚本路径 (可选) */
  scriptPath?: string;
  /** 脚本类型 */
  scriptType?: 'python' | 'typescript';
  /** 原始 SKILL.md 内容 */
  rawContent: string;
  /** 技能目录路径 */
  dir: string;
  /** 来源 (用于分类展示) */
  source?: 'built-in' | 'project' | 'user';
  /** 兼容性字段: sourcePath 指向技能目录 */
  sourcePath?: string;
}

/** 技能注册表 */
const skillRegistry = new Map<string, SkillMeta>();

/**
 * 解析 SKILL.md 的 YAML frontmatter
 */
function parseSkillMd(content: string): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return result;

  const lines = frontmatterMatch[1].split('\n');
  let currentKey = '';
  let inArray = false;

  for (const line of lines) {
    if (line.startsWith('  - ')) {
      // 数组项
      if (currentKey && Array.isArray(result[currentKey])) {
        (result[currentKey] as string[]).push(line.slice(4).trim());
      }
      inArray = true;
    } else if (line.includes(':')) {
      const [key, ...valueParts] = line.split(':');
      const value = valueParts.join(':').trim();
      currentKey = key.trim();
      if (value) {
        result[currentKey] = value;
        inArray = false;
      } else {
        result[currentKey] = [];
        inArray = true;
      }
    }
  }

  return result;
}

/**
 * 扫描技能目录
 */
export function scanSkills(skillsDir?: string): SkillMeta[] {
  const baseDir = skillsDir || path.join(process.cwd(), 'packages', 'agentai-skills');
  return scanDir(baseDir, 'project');
}

/**
 * 扫描项目内置技能 (packages/agentai-skills)
 */
export function scanProjectSkills(): SkillMeta[] {
  return scanSkills(path.join(process.cwd(), 'packages', 'agentai-skills'));
}

/**
 * 扫描用户自定义技能 (~/.agentai/skills)
 */
export function scanUserSkills(): SkillMeta[] {
  const userDir = path.join(os.homedir(), '.agentai', 'skills');
  return scanDir(userDir, 'user');
}

/**
 * 扫描 Gateway 内置技能 (src/skills/built-in)
 */
export function scanBuiltInSkills(): SkillMeta[] {
  return scanDir(path.join(process.cwd(), 'packages', 'agentai-gateway', 'src', 'skills', 'built-in'), 'built-in');
}

/**
 * 通用目录扫描 + 源标记
 */
function scanDir(baseDir: string, source: 'built-in' | 'project' | 'user'): SkillMeta[] {
  const results: SkillMeta[] = [];
  if (!fs.existsSync(baseDir)) return results;

  for (const entry of fs.readdirSync(baseDir)) {
    const entryPath = path.join(baseDir, entry);
    let stat;
    try { stat = fs.statSync(entryPath); } catch { continue; }
    if (!stat.isDirectory()) continue;

    const skillMdPath = path.join(entryPath, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) continue;

    try {
      const content = fs.readFileSync(skillMdPath, 'utf-8');
      const meta = parseSkillMd(content);
      if (!meta.name) continue;

      let scriptPath: string | undefined;
      let scriptType: 'python' | 'typescript' | undefined;

      const pyScript = path.join(entryPath, 'main.py');
      const tsScript = path.join(entryPath, 'main.ts');

      if (fs.existsSync(pyScript)) {
        scriptPath = pyScript;
        scriptType = 'python';
      } else if (fs.existsSync(tsScript)) {
        scriptPath = tsScript;
        scriptType = 'typescript';
      }

      const skill: SkillMeta = {
        name: meta.name as string,
        description: (meta.description as string) || '',
        category: (meta.category as string) || 'general',
        tools: Array.isArray(meta.tools) ? meta.tools as string[] : [],
        triggers: Array.isArray(meta.triggers) ? meta.triggers as string[] : [],
        scriptPath,
        scriptType,
        rawContent: content,
        dir: entryPath,
        source,
        sourcePath: entryPath,
      };

      results.push(skill);
      skillRegistry.set(skill.name, skill);
    } catch {
      // 跳过单个失败的技能, 继续扫描其他
    }
  }
  return results;
}

/**
 * 注册一个技能 (来自 watcher)
 * 重复注册会覆盖
 */
export function registerSkill(skill: SkillMeta): boolean {
  const existed = skillRegistry.has(skill.name);
  skillRegistry.set(skill.name, skill);
  return existed;
}

/**
 * 注销一个技能
 */
export function unregisterSkill(name: string): boolean {
  return skillRegistry.delete(name);
}

/**
 * 获取已注册的技能
 */
export function getSkill(name: string): SkillMeta | undefined {
  return skillRegistry.get(name);
}

/**
 * 获取所有已注册的技能
 */
export function getAllSkills(): SkillMeta[] {
  return [...skillRegistry.values()];
}

/**
 * 根据用户消息匹配技能
 * 简单的关键词匹配 + 语义相似度
 */
export function matchSkills(message: string, maxResults = 5): SkillMeta[] {
  const all = getAllSkills();
  const scored: Array<{ skill: SkillMeta; score: number }> = [];

  const msgLower = message.toLowerCase();

  for (const skill of all) {
    let score = 0;

    // 触发关键词匹配
    for (const trigger of skill.triggers) {
      if (msgLower.includes(trigger.toLowerCase())) {
        score += 10;
      }
    }

    // 名称匹配
    if (msgLower.includes(skill.name.toLowerCase())) {
      score += 5;
    }

    // 描述中的关键词匹配
    const descLower = skill.description.toLowerCase();
    const words = message.split(/[\s,，。？！]+/);
    for (const word of words) {
      if (word.length >= 2 && descLower.includes(word.toLowerCase())) {
        score += 2;
      }
    }

    if (score > 0) {
      scored.push({ skill, score });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(s => s.skill);
}

/**
 * 将技能转换为 ToolSpec (注册到系统)
 */
export function skillToToolSpec(skill: SkillMeta): {
  name: string;
  description: string;
  parameters: any;
  parallelSafe: boolean;
  riskLevel: 'low' | 'medium' | 'high';
} {
  return {
    name: `skill_${skill.name}`,
    description: skill.description,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: `Action to perform for skill "${skill.name}"`,
        },
        args: {
          type: 'object',
          description: 'Additional arguments for the skill',
          additionalProperties: true,
        },
      },
      required: ['action'],
    },
    parallelSafe: false,
    riskLevel: skill.tools.includes('bash') ? 'medium' : 'low',
  };
}

/**
 * 获取技能的系统提示注入内容
 */
export function getSkillSystemPrompt(skillNames: string[]): string {
  const skills = skillNames.map(n => getSkill(n)).filter(Boolean) as SkillMeta[];
  if (skills.length === 0) return '';

  const lines: string[] = ['# Available Skills', ''];
  for (const skill of skills) {
    lines.push(`## ${skill.name}`);
    lines.push(skill.description);
    if (skill.tools.length > 0) {
      lines.push(`**授权工具**: ${skill.tools.join(', ')}`);
    }
    if (skill.triggers.length > 0) {
      lines.push(`**触发词**: ${skill.triggers.join(', ')}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 获取用户主目录下的技能目录
 */
export function getUserSkillsDir(): string {
  return path.join(os.homedir(), '.agentai', 'skills');
}
