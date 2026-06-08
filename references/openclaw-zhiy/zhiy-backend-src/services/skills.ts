import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs'

const execAsync = promisify(exec)

export interface SkillResult {
  status: 'success' | 'error'
  data?: any
  message: string
}

export interface SkillInfo {
  name: string
  description?: string
  category?: string
  version?: string
  parameters?: Record<string, any>
}

const ORIGINAL_FRAMEWORK = path.join(process.cwd(), '..', '..', '..', 'AI系统开发原始框架')

export class SkillExecutor {
  private skillsPath: string
  private originalFrameworkSkills: string
  private originalFrameworkBackend: string
  
  constructor(skillsPath?: string) {
    this.skillsPath = skillsPath || path.join(process.cwd(), '..', '..', 'skills')
    this.originalFrameworkSkills = path.join(ORIGINAL_FRAMEWORK, 'skills')
    this.originalFrameworkBackend = path.join(ORIGINAL_FRAMEWORK, 'backend')
  }
  
  async execute(skillName: string, params: Record<string, any> = {}): Promise<SkillResult> {
    console.log(`[SkillExecutor] 执行技能: ${skillName}`, params)
    
    const skillPath = this.findSkill(skillName)
    
    if (skillPath) {
      return this.executeLocalSkill(skillPath, skillName, params)
    }
    
    return this.executeOriginalFrameworkSkill(skillName, params)
  }
  
  private async executeOriginalFrameworkSkill(skillName: string, params: Record<string, any>): Promise<SkillResult> {
    try {
      const skillManagerPath = path.join(this.originalFrameworkBackend, 'services', 'skill_manager.py')
      
      if (!fs.existsSync(skillManagerPath)) {
        return {
          status: 'error',
          message: `原始框架 skill_manager.py 不存在`
        }
      }
      
      const paramsJson = JSON.stringify(params).replace(/"/g, '\\"')
      const command = `python -c "
import sys
sys.path.insert(0, '${this.originalFrameworkBackend}')
from services.skill_manager import skill_manager
import json
result = skill_manager.execute_skill('${skillName}', **json.loads('${paramsJson}'))
print('##RESULT##', json.dumps(result, ensure_ascii=False))
"`
      
      const { stdout, stderr } = await execAsync(command, {
        timeout: 60000,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
      })
      
      if (stderr && !stderr.includes('Warning')) {
        console.warn('[SkillExecutor] Python stderr:', stderr)
      }
      
      const resultMatch = stdout.match(/##RESULT##\s*(\{[\s\S]*\})/)
      if (resultMatch) {
        return JSON.parse(resultMatch[1])
      }
      
      return {
        status: 'success',
        data: { output: stdout },
        message: '执行成功'
      }
      
    } catch (error: any) {
      console.error('[SkillExecutor] Original framework skill error:', error)
      return {
        status: 'error',
        message: `技能执行失败: ${error.message}`
      }
    }
  }
  
  private async executeLocalSkill(skillPath: string, skillName: string, params: Record<string, any>): Promise<SkillResult> {
    const mainFile = this.findMainFile(skillPath)
    
    if (!mainFile) {
      return {
        status: 'error',
        message: `技能 ${skillName} 缺少主执行文件`
      }
    }
    
    try {
      const skillMd = this.parseSkillMd(fs.readFileSync(path.join(skillPath, 'SKILL.md'), 'utf-8'), skillName)
      const args = this.buildArgsForSkill(skillName, params, skillMd)
      
      let command: string
      if (mainFile.endsWith('.py')) {
        command = `python "${mainFile}" ${args}`
      } else if (mainFile.endsWith('.js') || mainFile.endsWith('.ts')) {
        command = `node "${mainFile}" ${args}`
      } else {
        command = `"${mainFile}" ${args}`
      }
      
      console.log(`[SkillExecutor] 执行命令: ${command}`)
      
      const { stdout, stderr } = await execAsync(command, {
        cwd: skillPath,
        timeout: 30000,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
      })
      
      if (stderr && !stderr.includes('##RESULT##')) {
        console.warn('[SkillExecutor] Skill stderr:', stderr)
      }
      
      const resultMatch = stdout.match(/##RESULT##\s*(\{[\s\S]*\})/)
      if (resultMatch) {
        return JSON.parse(resultMatch[1])
      }
      
      if (stdout.includes('error:') || stdout.includes('Error:')) {
        return {
          status: 'error',
          message: stdout
        }
      }
      
      return {
        status: 'success',
        data: { output: stdout },
        message: '执行成功'
      }
    } catch (error: any) {
      console.error('[SkillExecutor] Skill execution error:', error)
      return {
        status: 'error',
        message: error.message || '执行失败'
      }
    }
  }
  
  private buildArgsForSkill(skillName: string, params: Record<string, any>, skillInfo: SkillInfo): string {
    const skillParams = skillInfo.parameters || {}
    
    if (skillName === 'ai-writer' || skillName.includes('writer')) {
      const prompt = params.content || params.prompt || params.text || '请生成内容'
      const type = params.type || 'article'
      const style = params.style || 'professional'
      return `--prompt "${prompt.replace(/"/g, '\\"')}" --type ${type} --style ${style}`
    }
    
    if (skillName === 'doc-generator' || skillName.includes('doc')) {
      const title = params.title || '未命名文档'
      const content = params.content || params.text || ''
      return `--title "${title.replace(/"/g, '\\"')}" --content "${content.replace(/"/g, '\\"')}"`
    }
    
    if (skillName === 'image-generator' || skillName.includes('image')) {
      const prompt = params.prompt || params.description || '生成图片'
      return `--prompt "${prompt.replace(/"/g, '\\"')}"`
    }
    
    if (skillName === 'wechat-bot' || skillName.includes('wechat')) {
      const contact = params.contact || params.to || ''
      const message = params.message || params.text || ''
      return `--contact "${contact}" --message "${message.replace(/"/g, '\\"')}"`
    }
    
    return this.buildArgs(params)
  }
  
  private findSkill(skillName: string): string | null {
    const possiblePaths = [
      path.join(this.skillsPath, skillName),
      path.join(this.skillsPath, 'office', skillName),
      path.join(this.skillsPath, 'web', skillName),
      path.join(this.skillsPath, 'video', skillName),
      path.join(this.skillsPath, 'image', skillName),
      path.join(this.skillsPath, 'communication', skillName),
      path.join(this.skillsPath, 'construction', skillName),
      path.join(this.skillsPath, 'auto', skillName),
      path.join(this.skillsPath, 'beauty', skillName),
      path.join(this.skillsPath, 'code', skillName),
      path.join(this.skillsPath, 'desktop', skillName),
      path.join(this.skillsPath, 'meta', skillName),
      path.join(this.skillsPath, 'design', skillName)
    ]
    
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return p
      }
    }
    
    const originalPaths = [
      path.join(this.originalFrameworkSkills, skillName),
      path.join(this.originalFrameworkSkills, 'office', skillName),
      path.join(this.originalFrameworkSkills, 'web', skillName)
    ]
    
    for (const p of originalPaths) {
      if (fs.existsSync(p)) {
        return p
      }
    }
    
    return null
  }
  
  private findMainFile(skillPath: string): string | null {
    const mainFiles = ['main.py', 'index.js', 'main.js', 'index.ts', 'run.py', 'app.py']
    
    for (const file of mainFiles) {
      const filePath = path.join(skillPath, file)
      if (fs.existsSync(filePath)) {
        return filePath
      }
    }
    
    return null
  }
  
  private buildArgs(params: Record<string, any>): string {
    return Object.entries(params)
      .map(([key, value]) => {
        if (typeof value === 'boolean') {
          return value ? `--${key}` : ''
        }
        if (typeof value === 'object') {
          return `--${key} '${JSON.stringify(value)}'`
        }
        return `--${key} "${String(value).replace(/"/g, '\\"')}"`
      })
      .filter(Boolean)
      .join(' ')
  }
  
  listSkills(): string[] {
    const skills: string[] = []
    
    const scanDir = (dir: string, prefix: string = '') => {
      if (!fs.existsSync(dir)) return
      
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillPath = path.join(dir, entry.name)
          const skillMd = path.join(skillPath, 'SKILL.md')
          const mainFile = this.findMainFile(skillPath)
          
          if (fs.existsSync(skillMd) || mainFile) {
            skills.push(prefix ? `${prefix}/${entry.name}` : entry.name)
          } else {
            scanDir(skillPath, prefix ? `${prefix}/${entry.name}` : entry.name)
          }
        }
      }
    }
    
    scanDir(this.skillsPath)
    scanDir(this.originalFrameworkSkills)
    
    return [...new Set(skills)]
  }
  
  getSkillInfo(skillName: string): SkillInfo | null {
    const skillPath = this.findSkill(skillName)
    if (!skillPath) return null
    
    const skillMdPath = path.join(skillPath, 'SKILL.md')
    if (fs.existsSync(skillMdPath)) {
      const content = fs.readFileSync(skillMdPath, 'utf-8')
      return this.parseSkillMd(content, skillName)
    }
    
    return { name: skillName }
  }
  
  private parseSkillMd(content: string, defaultName: string): SkillInfo {
    const skill: SkillInfo = { name: defaultName }
    
    const nameMatch = content.match(/#\s+(.+)/)
    if (nameMatch) skill.name = nameMatch[1].trim()
    
    const descMatch = content.match(/##\s*功能\s*\n+(.+?)(?=\n##|$)/s)
    if (descMatch) skill.description = descMatch[1].trim()
    
    const paramsMatch = content.match(/##\s*参数\s*\n+([\s\S]+?)(?=\n##|$)/)
    if (paramsMatch) {
      skill.parameters = {}
      const paramLines = paramsMatch[1].split('\n').filter(l => l.trim())
      for (const line of paramLines) {
        const paramMatch = line.match(/-\s*`?(\w+)`?\s*\(?.*?\)?:?\s*(.+)/)
        if (paramMatch) {
          skill.parameters[paramMatch[1]] = {
            description: paramMatch[2].trim()
          }
        }
      }
    }
    
    return skill
  }
}
