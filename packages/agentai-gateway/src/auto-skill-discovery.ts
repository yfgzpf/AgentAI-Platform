/**
 * AutoSkillDiscovery — 自动发现 .trae 下的 Skills 并注册到 ToolRegistry
 * ----------------------------------------------------------------
 * 学自: Reasonix skills.ts (lazy-load) + Hermes skill discover
 * 
 * Skill 结构: .trae/builtin/{code|work}/{persona}/skills/{name}/SKILL.md
 * SKILL.md 格式: YAML frontmatter (name, description) + 正文
 */

import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

export interface DiscoveredSkill {
  /** 技能名称 (来自 SKILL.md frontmatter name) */
  name: string;
  /** 描述 */
  description: string;
  /** 类别: code/work */
  category: 'code' | 'work';
  /** 技能目录路径 */
  dir: string;
  /** SKILL.md 完整路径 */
  skillFile: string;
  /** scripts 目录 (如果有) */
  scriptsDir?: string;
  /** 额外文档 (REFERENCE.md, FORMS.md 等) */
  extraDocs: string[];
}

/**
 * 扫描所有 .trae 目录下的 SKILL.md
 */
function scanSkillDirs(baseDir: string): DiscoveredSkill[] {
  const skills: DiscoveredSkill[] = [];
  const builtinDir = path.join(baseDir, 'builtin');
  
  if (!fs.existsSync(builtinDir)) return skills;

  // .trae/builtin/{code|work}/
  const categories = ['code', 'work'] as const;
  
  for (const cat of categories) {
    const catDir = path.join(builtinDir, cat);
    if (!fs.existsSync(catDir)) continue;

    // {persona}/  eg: default, deidamia, eurydice, medea, penelope, thetis
    const personas = fs.readdirSync(catDir, { withFileTypes: true })
      .filter(d => d.isDirectory());
    
    for (const persona of personas) {
      const skillsDir = path.join(catDir, persona.name, 'skills');
      if (!fs.existsSync(skillsDir)) continue;

      const skillNames = fs.readdirSync(skillsDir, { withFileTypes: true })
        .filter(d => d.isDirectory());

      for (const sn of skillNames) {
        const skillDir = path.join(skillsDir, sn.name);
        const skillFile = path.join(skillDir, 'SKILL.md');
        
        if (!fs.existsSync(skillFile)) continue;

        const meta = parseSkillMeta(skillFile);
        const scriptsDir = path.join(skillDir, 'scripts');
        const extraDocs = listMarkdownDocs(skillDir);

        skills.push({
          name: meta.name || sn.name,
          description: meta.description || `${sn.name} skill`,
          category: cat,
          dir: skillDir,
          skillFile,
          scriptsDir: fs.existsSync(scriptsDir) ? scriptsDir : undefined,
          extraDocs,
        });
      }
    }
  }

  // 去重 (同一个 skill 可能在多个 persona 下)
  const seen = new Set<string>();
  return skills.filter(s => {
    if (seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  });
}

/**
 * 解析 SKILL.md YAML frontmatter
 */
function parseSkillMeta(filePath: string): { name?: string; description?: string } {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (match) {
      const lines = match[1]!.split('\n');
      const meta: Record<string, string> = {};
      for (const line of lines) {
        const kv = line.match(/^(\w+):\s*(.+)/);
        if (kv) meta[kv[1]!] = kv[2]!.trim().replace(/^"(.*)"$/, '$1');
      }
      return { name: meta['name'], description: meta['description'] };
    }
  } catch {}
  return {};
}

function listMarkdownDocs(dir: string): string[] {
  try {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.md') && f !== 'SKILL.md')
      .map(f => path.join(dir, f));
  } catch { return []; }
}

/**
 * 构建 Skill 工具描述 (给 LLM 看)
 */
function buildSkillToolDef(skill: DiscoveredSkill): string {
  const parts: string[] = [];
  parts.push(`## ${skill.name}`);
  parts.push(`${skill.description}`);
  if (skill.scriptsDir) {
    parts.push('  Has executable scripts.');
    try {
      const pyFiles = fs.readdirSync(skill.scriptsDir).filter(f => f.endsWith('.py'));
      if (pyFiles.length > 0) {
        parts.push(`  Scripts: ${pyFiles.slice(0, 5).join(', ')}`);
      }
    } catch {}
  }
  if (skill.extraDocs.length > 0) {
    const docNames = skill.extraDocs.map(d => path.basename(d, '.md'));
    parts.push(`  Docs: ${docNames.join(', ')}`);
  }
  return parts.join('\n');
}

/**
 * 构建所有 Skills 的 XML 索引 (注入 system prompt)
 */
export function buildSkillsIndexXml(skills: DiscoveredSkill[]): string {
  if (skills.length === 0) return '<available_skills>\n</available_skills>';
  const lines = ['<available_skills>'];
  for (const s of skills) {
    lines.push(`  <skill name="${s.name}" category="${s.category}">${s.description.slice(0, 200)}</skill>`);
  }
  lines.push('</available_skills>');
  return lines.join('\n');
}

/**
 * Skills 发现器 (带热加载)
 */
export class AutoSkillDiscovery extends EventEmitter {
  private skills: DiscoveredSkill[] = [];
  private traeDir: string;

  constructor(traeDir?: string) {
    super();
    this.traeDir = traeDir || path.join(
      process.env['USERPROFILE'] || process.env['HOME'] || '~',
      '.trae'
    );
  }

  /** 执行扫描 */
  discover(): DiscoveredSkill[] {
    this.skills = scanSkillDirs(this.traeDir);
    this.emit('discovered', { count: this.skills.length });
    return this.skills;
  }

  /** 获取所有已发现 skills */
  list(): DiscoveredSkill[] {
    return this.skills;
  }

  /** 获取 Skill 目录路径 */
  getSkillDir(name: string): string | undefined {
    return this.skills.find(s => s.name === name)?.dir;
  }

  /** 构建 XML 索引 */
  toSkillsXML(): string {
    return buildSkillsIndexXml(this.skills);
  }

  /** 构建 LLM 可读的 Skill 描述 */
  toSkillsDescription(): string {
    if (this.skills.length === 0) return '';
    return this.skills.map(buildSkillToolDef).join('\n\n');
  }

  /** 检查是否有某个 skill */
  hasSkill(name: string): boolean {
    return this.skills.some(s => s.name === name);
  }
}
