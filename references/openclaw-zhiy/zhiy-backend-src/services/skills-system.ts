/**
 * 智 Y.Ai 技能系统 - 完全照抄 OpenClaw 源码实现
 * 
 * OpenClaw 技能系统核心机制：
 * 1. 技能不是通过工具定义来调用的
 * 2. 技能是通过系统提示中的 XML 格式告知 LLM
 * 3. LLM 使用 read 工具来读取技能文件内容
 * 4. LLM 根据技能描述自主决定何时读取和执行
 */

import * as fs from 'fs'
import * as path from 'path'
import { homedir } from 'os'

export interface Skill {
  name: string
  description: string
  filePath: string
  baseDir: string
  source: string
  disableModelInvocation?: boolean
}

export interface SkillDiagnostic {
  type: 'warning' | 'error' | 'collision'
  message: string
  path: string
  collision?: {
    resourceType: string
    name: string
    winnerPath: string
    loserPath: string
  }
}

const MAX_NAME_LENGTH = 64
const MAX_DESCRIPTION_LENGTH = 1024

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function toPosixPath(p: string): string {
  return p.split(path.sep).join('/')
}

function validateName(name: string, parentDirName: string): string[] {
  const errors: string[] = []
  if (name !== parentDirName) {
    errors.push(`name "${name}" does not match parent directory "${parentDirName}"`)
  }
  if (name.length > MAX_NAME_LENGTH) {
    errors.push(`name exceeds ${MAX_NAME_LENGTH} characters (${name.length})`)
  }
  if (!/^[a-z0-9-]+$/.test(name)) {
    errors.push(`name contains invalid characters (must be lowercase a-z, 0-9, hyphens only)`)
  }
  if (name.startsWith('-') || name.endsWith('-')) {
    errors.push(`name must not start or end with a hyphen`)
  }
  if (name.includes('--')) {
    errors.push(`name must not contain consecutive hyphens`)
  }
  return errors
}

function validateDescription(description: string): string[] {
  const errors: string[] = []
  if (!description || description.trim() === '') {
    errors.push('description is required')
  } else if (description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(`description exceeds ${MAX_DESCRIPTION_LENGTH} characters (${description.length})`)
  }
  return errors
}

function parseFrontmatter(content: string): { frontmatter: Record<string, any>; body: string } {
  const frontmatter: Record<string, any> = {}
  let body = content
  
  if (content.startsWith('---')) {
    const endIndex = content.indexOf('\n---', 3)
    if (endIndex !== -1) {
      const frontmatterStr = content.slice(4, endIndex)
      body = content.slice(endIndex + 4).trim()
      
      const lines = frontmatterStr.split('\n')
      for (const line of lines) {
        const match = line.match(/^([\w-]+):\s*(.*)$/)
        if (match) {
          const key = match[1]
          let value = match[2].trim()
          if (value.startsWith('"') && value.endsWith('"')) {
            value = value.slice(1, -1)
          } else if (value.startsWith("'") && value.endsWith("'")) {
            value = value.slice(1, -1)
          }
          frontmatter[key] = value
        }
      }
    }
  }
  
  return { frontmatter, body }
}

function loadSkillFromFile(filePath: string, source: string): { skill: Skill | null; diagnostics: SkillDiagnostic[] } {
  const diagnostics: SkillDiagnostic[] = []
  
  try {
    const rawContent = fs.readFileSync(filePath, 'utf-8')
    const { frontmatter } = parseFrontmatter(rawContent)
    const skillDir = path.dirname(filePath)
    const parentDirName = path.basename(skillDir)
    
    const descErrors = validateDescription(frontmatter.description || '')
    for (const error of descErrors) {
      diagnostics.push({ type: 'warning', message: error, path: filePath })
    }
    
    const name = frontmatter.name || parentDirName
    const nameErrors = validateName(name, parentDirName)
    for (const error of nameErrors) {
      diagnostics.push({ type: 'warning', message: error, path: filePath })
    }
    
    if (!frontmatter.description || frontmatter.description.trim() === '') {
      return { skill: null, diagnostics }
    }
    
    return {
      skill: {
        name,
        description: frontmatter.description,
        filePath,
        baseDir: skillDir,
        source,
        disableModelInvocation: frontmatter['disable-model-invocation'] === true,
      },
      diagnostics,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'failed to parse skill file'
    diagnostics.push({ type: 'warning', message, path: filePath })
    return { skill: null, diagnostics }
  }
}

export function loadSkillsFromDir(dir: string, source: string): { skills: Skill[]; diagnostics: SkillDiagnostic[] } {
  const skills: Skill[] = []
  const diagnostics: SkillDiagnostic[] = []
  
  if (!fs.existsSync(dir)) {
    return { skills, diagnostics }
  }
  
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (entry.name === 'node_modules') continue
    
    const fullPath = path.join(dir, entry.name)
    
    if (entry.isDirectory()) {
      const skillFile = path.join(fullPath, 'SKILL.md')
      if (fs.existsSync(skillFile)) {
        const result = loadSkillFromFile(skillFile, source)
        if (result.skill) {
          skills.push(result.skill)
        }
        diagnostics.push(...result.diagnostics)
      } else {
        const subResult = loadSkillsFromDir(fullPath, source)
        skills.push(...subResult.skills)
        diagnostics.push(...subResult.diagnostics)
      }
    } else if (entry.name === 'SKILL.md' || entry.name.endsWith('.md')) {
      const result = loadSkillFromFile(fullPath, source)
      if (result.skill) {
        skills.push(result.skill)
      }
      diagnostics.push(...result.diagnostics)
    }
  }
  
  return { skills, diagnostics }
}

export function loadSkills(options: {
  cwd?: string
  agentDir?: string
  skillPaths?: string[]
  includeDefaults?: boolean
} = {}): { skills: Skill[]; diagnostics: SkillDiagnostic[] } {
  const { cwd = process.cwd(), agentDir, skillPaths = [], includeDefaults = true } = options
  
  const resolvedAgentDir = agentDir || path.join(homedir(), '.zhiy')
  const skillMap = new Map<string, Skill>()
  const allDiagnostics: SkillDiagnostic[] = []
  
  const addSkills = (result: { skills: Skill[]; diagnostics: SkillDiagnostic[] }) => {
    allDiagnostics.push(...result.diagnostics)
    for (const skill of result.skills) {
      const existing = skillMap.get(skill.name)
      if (existing) {
        allDiagnostics.push({
          type: 'collision',
          message: `name "${skill.name}" collision`,
          path: skill.filePath,
          collision: {
            resourceType: 'skill',
            name: skill.name,
            winnerPath: existing.filePath,
            loserPath: skill.filePath,
          },
        })
      } else {
        skillMap.set(skill.name, skill)
      }
    }
  }
  
  if (includeDefaults) {
    const defaultSkillDir = path.join(resolvedAgentDir, 'skills')
    addSkills(loadSkillsFromDir(defaultSkillDir, 'zhiy-bundled'))
  }
  
  for (const skillPath of skillPaths) {
    const resolvedPath = path.isAbsolute(skillPath) ? skillPath : path.resolve(cwd, skillPath)
    if (fs.existsSync(resolvedPath)) {
      const stat = fs.statSync(resolvedPath)
      if (stat.isDirectory()) {
        addSkills(loadSkillsFromDir(resolvedPath, 'user-configured'))
      } else {
        const result = loadSkillFromFile(resolvedPath, 'user-configured')
        if (result.skill) {
          skillMap.set(result.skill.name, result.skill)
        }
        allDiagnostics.push(...result.diagnostics)
      }
    }
  }
  
  return { skills: Array.from(skillMap.values()), diagnostics: allDiagnostics }
}

export function formatSkillsForPrompt(skills: Skill[]): string {
  const visibleSkills = skills.filter(s => !s.disableModelInvocation)
  
  if (visibleSkills.length === 0) {
    return ''
  }
  
  const lines = [
    '',
    'The following skills provide specialized instructions for specific tasks.',
    'Use the read tool to load a skill\'s file when the task matches its description.',
    'When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.',
    '',
    '<available_skills>',
  ]
  
  for (const skill of visibleSkills) {
    lines.push('  <skill>')
    lines.push(`    <name>${escapeXml(skill.name)}</name>`)
    lines.push(`    <description>${escapeXml(skill.description)}</description>`)
    lines.push(`    <location>${escapeXml(skill.filePath)}</location>`)
    lines.push('  </skill>')
  }
  
  lines.push('</available_skills>')
  
  return lines.join('\n')
}

export class SkillManager {
  private skills: Map<string, Skill> = new Map()
  private skillDir: string
  
  constructor(skillDir?: string) {
    this.skillDir = skillDir || path.join(homedir(), '.zhiy', 'skills')
    this.load()
  }
  
  load(): void {
    const { skills, diagnostics } = loadSkills({ agentDir: path.dirname(this.skillDir) })
    
    this.skills.clear()
    for (const skill of skills) {
      this.skills.set(skill.name, skill)
    }
    
    for (const diagnostic of diagnostics) {
      if (diagnostic.type === 'warning') {
        console.warn(`[SkillManager] Warning: ${diagnostic.message} (${diagnostic.path})`)
      } else if (diagnostic.type === 'collision') {
        console.warn(`[SkillManager] Collision: ${diagnostic.message}`)
      }
    }
    
    console.log(`[SkillManager] Loaded ${this.skills.size} skills`)
  }
  
  getSkill(name: string): Skill | undefined {
    return this.skills.get(name)
  }
  
  getAllSkills(): Skill[] {
    return Array.from(this.skills.values())
  }
  
  getVisibleSkills(): Skill[] {
    return this.getAllSkills().filter(s => !s.disableModelInvocation)
  }
  
  formatForPrompt(): string {
    return formatSkillsForPrompt(this.getAllSkills())
  }
}
