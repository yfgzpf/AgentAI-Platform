/**
 * AutoSkillDiscovery — 自动发现 agentai-skills/ 下的 Skills 并注册到 SkillOrchestrator
 * ----------------------------------------------------------------
 * 支持两种扫描模式:
 *   1. agentai-skills/ 目录结构: {category}/{skill-name}/SKILL.md  (本项目)
 *   2. .trae 目录结构: .trae/builtin/{code|work}/{persona}/skills/{name}/SKILL.md (兼容旧版)
 *
 * SKILL.md 格式: YAML frontmatter (name, description, category, tags, ...) + 正文 (指令)
 */

import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

export interface DiscoveredSkill {
  /** 技能名称 (来自 SKILL.md frontmatter name 或目录名) */
  name: string;
  /** 描述 */
  description: string;
  /** 类别: code/web/agents/image/voice/meta/... */
  category: string;
  /** 标签 */
  tags: string[];
  /** 风险等级 */
  riskLevel: 'low' | 'medium' | 'high';
  /** 技能目录路径 */
  dir: string;
  /** SKILL.md 完整路径 */
  skillFile: string;
  /** scripts 目录 (如果有) */
  scriptsDir?: string;
  /** handler.py / handler.ts (如果有) */
  handlerPath?: string;
  /** 额外文档 (REFERENCE.md, FORMS.md 等) */
  extraDocs: string[];
  /** 完整 SKILL.md 正文 (懒加载, 供按需注入 system prompt) */
  _bodyCache?: string;
}

// ===== 扫描逻辑 =====

/**
 * 扫描 agentai-skills/ 目录结构: {category}/{skill-name}/SKILL.md
 */
function scanAgentAISkillsDir(skillsRoot: string): DiscoveredSkill[] {
  const skills: DiscoveredSkill[] = [];
  if (!fs.existsSync(skillsRoot)) return skills;

  let categories: fs.Dirent[];
  try {
    categories = fs.readdirSync(skillsRoot, { withFileTypes: true }).filter(d => d.isDirectory());
  } catch { return skills; }

  for (const catEntry of categories) {
    const catDir = path.join(skillsRoot, catEntry.name);
    let skillDirs: fs.Dirent[];
    try {
      skillDirs = fs.readdirSync(catDir, { withFileTypes: true }).filter(d => d.isDirectory());
    } catch { continue; }

    for (const sn of skillDirs) {
      const skillDir = path.join(catDir, sn.name);
      const skillFile = path.join(skillDir, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;

      const meta = parseSkillMeta(skillFile);
      const skill = buildSkillEntry(skillDir, skillFile, sn.name, catEntry.name, meta);
      skills.push(skill);
    }
  }

  return dedup(skills);
}

/**
 * 扫描 .trae 目录结构 (兼容): .trae/builtin/{code|work}/{persona}/skills/{name}/SKILL.md
 */
function scanTraeDir(traeDir: string): DiscoveredSkill[] {
  const skills: DiscoveredSkill[] = [];
  const builtinDir = path.join(traeDir, 'builtin');
  if (!fs.existsSync(builtinDir)) return skills;

  const categories = ['code', 'work'] as const;
  for (const cat of categories) {
    const catDir = path.join(builtinDir, cat);
    if (!fs.existsSync(catDir)) continue;

    let personas: fs.Dirent[];
    try { personas = fs.readdirSync(catDir, { withFileTypes: true }).filter(d => d.isDirectory()); }
    catch { continue; }

    for (const persona of personas) {
      const skillsDir = path.join(catDir, persona.name, 'skills');
      if (!fs.existsSync(skillsDir)) continue;

      let skillNames: fs.Dirent[];
      try { skillNames = fs.readdirSync(skillsDir, { withFileTypes: true }).filter(d => d.isDirectory()); }
      catch { continue; }

      for (const sn of skillNames) {
        const skillDir = path.join(skillsDir, sn.name);
        const skillFile = path.join(skillDir, 'SKILL.md');
        if (!fs.existsSync(skillFile)) continue;

        const meta = parseSkillMeta(skillFile);
        const skill = buildSkillEntry(skillDir, skillFile, sn.name, cat, meta);
        skills.push(skill);
      }
    }
  }

  return dedup(skills);
}

function buildSkillEntry(
  skillDir: string,
  skillFile: string,
  dirName: string,
  defaultCategory: string,
  meta: ReturnType<typeof parseSkillMeta>
): DiscoveredSkill {
  const scriptsDir = path.join(skillDir, 'scripts');
  const handlerPy = path.join(skillDir, 'handler.py');
  const handlerTs = path.join(skillDir, 'handler.ts');
  const handlerPath = fs.existsSync(handlerPy) ? handlerPy
    : fs.existsSync(handlerTs) ? handlerTs : undefined;
  const extraDocs = listMarkdownDocs(skillDir);

  return {
    name: meta.name || dirName,
    description: meta.description || `${dirName} skill`,
    category: meta.category || defaultCategory,
    tags: meta.tags || [],
    riskLevel: (meta.riskLevel as any) || 'low',
    dir: skillDir,
    skillFile,
    scriptsDir: fs.existsSync(scriptsDir) ? scriptsDir : undefined,
    handlerPath,
    extraDocs,
  };
}

function dedup(skills: DiscoveredSkill[]): DiscoveredSkill[] {
  const seen = new Set<string>();
  return skills.filter(s => {
    if (seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  });
}

// ===== 解析工具 =====

/**
 * 解析 SKILL.md YAML frontmatter
 */
export function parseSkillMeta(filePath: string): {
  name?: string;
  description?: string;
  category?: string;
  tags?: string[];
  riskLevel?: string;
  version?: string;
} {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (match) {
      const lines = match[1]!.split('\n');
      const meta: Record<string, any> = {};
      for (const line of lines) {
        const kv = line.match(/^(\w+):\s*(.+)/);
        if (!kv) continue;
        const key = kv[1]!;
        const val = kv[2]!.trim().replace(/^"(.*)"$/, '$1');
        if (key === 'tags') {
          meta['tags'] = val.replace(/[\[\]]/g, '').split(',').map((s: string) => s.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean);
        } else {
          meta[key] = val;
        }
      }
      return {
        name: meta['name'],
        description: meta['description'],
        category: meta['category'],
        tags: meta['tags'],
        riskLevel: meta['riskLevel'],
        version: meta['version'],
      };
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

// ===== 内容工具 =====

/**
 * 读取 SKILL.md 正文 (去掉 frontmatter, 保留指令内容)
 * 供 smartDispatch 按需注入 system prompt
 */
export function readSkillBody(skillFile: string): string {
  try {
    const content = fs.readFileSync(skillFile, 'utf-8');
    // 去掉 frontmatter
    return content.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
  } catch { return ''; }
}

/**
 * 构建 Skill 工具描述 (给 LLM 看)
 */
function buildSkillToolDef(skill: DiscoveredSkill): string {
  const parts: string[] = [`## ${skill.name} [${skill.category}]`, skill.description];
  if (skill.tags.length > 0) parts.push(`  Tags: ${skill.tags.join(', ')}`);
  if (skill.scriptsDir) {
    try {
      const pyFiles = fs.readdirSync(skill.scriptsDir).filter(f => f.endsWith('.py') || f.endsWith('.ts'));
      if (pyFiles.length > 0) parts.push(`  Scripts: ${pyFiles.slice(0, 5).join(', ')}`);
    } catch {}
  }
  if (skill.handlerPath) parts.push(`  Handler: ${path.basename(skill.handlerPath)}`);
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
    const tagsAttr = s.tags.length > 0 ? ` tags="${s.tags.join(',')}"` : '';
    lines.push(`  <skill name="${s.name}" category="${s.category}"${tagsAttr}>${s.description.slice(0, 200)}</skill>`);
  }
  lines.push('</available_skills>');
  return lines.join('\n');
}

// ===== 主类 =====

/**
 * Skills 发现器 (支持 agentai-skills/ 和 .trae/ 两种目录结构)
 */
export class AutoSkillDiscovery extends EventEmitter {
  private skills: DiscoveredSkill[] = [];
  /** agentai-skills/ 根目录 (优先) */
  private agentAISkillsRoot: string;
  /** .trae/ 根目录 (兼容回退) */
  private traeDir: string;

  constructor(opts?: {
    /** agentai-skills/ 根目录, 默认从 AGENTAI_SKILLS_ROOT env 或项目推断 */
    agentAISkillsRoot?: string;
    /** .trae/ 根目录, 默认 ~/.trae */
    traeDir?: string;
  }) {
    super();

    // agentai-skills 目录优先级: 参数 > 环境变量 > 项目内推断 > 包目录兄弟
    this.agentAISkillsRoot = opts?.agentAISkillsRoot
      || process.env['AGENTAI_SKILLS_ROOT']
      || resolveAgentAISkillsRoot();

    this.traeDir = opts?.traeDir || path.join(
      process.env['USERPROFILE'] || process.env['HOME'] || '~',
      '.trae'
    );
  }

  /** 执行扫描 (优先 agentai-skills/, 找不到则回退 .trae/) */
  discover(): DiscoveredSkill[] {
    let found = scanAgentAISkillsDir(this.agentAISkillsRoot);

    if (found.length === 0) {
      // 回退到 .trae 兼容扫描
      found = scanTraeDir(this.traeDir);
      if (found.length > 0) {
        console.log(`[skill-discovery] agentai-skills/ 目录为空, 回退到 .trae/: ${this.traeDir}`);
      }
    }

    this.skills = found;
    this.emit('discovered', { count: this.skills.length, root: this.agentAISkillsRoot });

    if (this.skills.length === 0) {
      console.warn(`[skill-discovery] 未发现任何技能。检查目录: ${this.agentAISkillsRoot}`);
    } else {
      console.log(`[skill-discovery] 发现 ${this.skills.length} 个技能 (${this.agentAISkillsRoot})`);
    }

    return this.skills;
  }

  /** 获取所有已发现 skills */
  list(): DiscoveredSkill[] {
    return this.skills;
  }

  /** 按分类获取 */
  listByCategory(category: string): DiscoveredSkill[] {
    return this.skills.filter(s => s.category === category);
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

  /**
   * 按需加载 Skill 正文 (用于 smartDispatch 后注入 system prompt)
   * @param name 技能名称
   * @returns SKILL.md 正文内容 (去掉 frontmatter)
   */
  loadSkillBody(name: string): string {
    const skill = this.skills.find(s => s.name === name);
    if (!skill) return '';
    if (skill._bodyCache) return skill._bodyCache;
    const body = readSkillBody(skill.skillFile);
    skill._bodyCache = body;
    return body;
  }

  /**
   * 构建精简技能摘要 (注入 system prompt 仅用 ~200 token)
   * 格式: "技能名(分类): 描述"
   */
  toSkillsSummary(): string {
    if (this.skills.length === 0) return '';
    const lines = this.skills.map(s => `- **${s.name}** (${s.category}): ${s.description}`);
    return `## 可用技能 (${this.skills.length} 个)\n${lines.join('\n')}`;
  }
}

// ===== 路径推断 =====

/**
 * 推断 agentai-skills/ 根目录:
 * 1. 从当前文件向上找 packages/agentai-skills/
 * 2. 从 process.cwd() 向上找
 * 3. 兜底: ~/.agentai/skills
 */
function resolveAgentAISkillsRoot(): string {
  // ES module compatible __dirname
  const __esm_dirname = path.dirname(new URL(import.meta.url).pathname);
  
  // 尝试从包目录找
  const candidateBases = [
    path.join(__esm_dirname, '../../agentai-skills'),       // packages/agentai-gateway → packages/agentai-skills
    path.join(__esm_dirname, '../../../packages/agentai-skills'), // src/ → packages/agentai-skills
    path.join(process.cwd(), 'packages/agentai-skills'),
    path.join(process.cwd(), '../agentai-skills'),
  ];

  for (const candidate of candidateBases) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch {}
  }

  // 兜底: ~/.agentai/skills
  return path.join(
    process.env['USERPROFILE'] || process.env['HOME'] || '~',
    '.agentai', 'skills'
  );
}
