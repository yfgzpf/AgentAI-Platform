import { Router, Request, Response } from 'express'
import fs from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export interface SkillParameter {
  name: string
  type: string
  required: boolean
  description: string
  default?: any
  options?: string[]
}

export interface SkillMetadata {
  name: string
  description: string
  category: string
  status: 'active' | 'inactive' | 'developing'
  version?: string
  author?: string
  parameters: SkillParameter[]
  dependencies?: string[]
  examples?: string[]
  path: string
}

export interface SkillListItem {
  name: string
  description: string
  category: string
  status: 'active' | 'inactive' | 'developing'
  path: string
}

const SKILLS_BASE_PATHS = [
  path.join(process.cwd(), '..', '..', 'skills'),
  path.join(process.cwd(), '..', '..', 'workspace', 'skills')
]

const CATEGORY_MAP: Record<string, string> = {
  'office': '办公',
  'communication': '通信',
  'video': '视频',
  'image': '图像',
  'code': '代码',
  'desktop': '桌面',
  'construction': '建材',
  'auto': '汽修',
  'beauty': '美容',
  'design': '设计',
  'meta': '元技能',
  'browser': '浏览器',
  'web': '网页'
}

function getSkillsPaths(): string[] {
  const paths: string[] = []
  for (const basePath of SKILLS_BASE_PATHS) {
    if (fs.existsSync(basePath)) {
      paths.push(basePath)
    }
  }
  return paths
}

function parseSkillMd(content: string, skillPath: string): SkillMetadata {
  const skill: SkillMetadata = {
    name: path.basename(skillPath),
    description: '',
    category: 'other',
    status: 'active',
    parameters: [],
    path: skillPath
  }

  const frontMatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (frontMatterMatch) {
    const frontMatter = frontMatterMatch[1]
    const nameMatch = frontMatter.match(/name:\s*(.+)/)
    if (nameMatch) skill.name = nameMatch[1].trim()
    
    const descMatch = frontMatter.match(/description:\s*(.+)/)
    if (descMatch) skill.description = descMatch[1].trim()
    
    const categoryMatch = frontMatter.match(/category:\s*(.+)/)
    if (categoryMatch) skill.category = categoryMatch[1].trim()
    
    const statusMatch = frontMatter.match(/status:\s*(.+)/)
    if (statusMatch && ['active', 'inactive', 'developing'].includes(statusMatch[1].trim())) {
      skill.status = statusMatch[1].trim() as 'active' | 'inactive' | 'developing'
    }
  }

  const titleMatch = content.match(/#\s+(.+?)(?:\n|$)/)
  if (titleMatch && !skill.description) {
    skill.name = titleMatch[1].trim()
  }

  const descMatch = content.match(/##\s*功能\s*\n+([\s\S]*?)(?=\n##|$)/)
  if (descMatch) {
    const descText = descMatch[1].trim()
    const firstParagraph = descText.split('\n\n')[0]
    skill.description = firstParagraph.replace(/[#*`]/g, '').trim()
  }

  const paramsMatch = content.match(/##\s*参数\s*\n+([\s\S]*?)(?=\n##|$)/)
  if (paramsMatch) {
    const paramsText = paramsMatch[1]
    const paramLines = paramsText.split('\n').filter(line => line.trim().startsWith('-'))
    
    for (const line of paramLines) {
      const paramMatch = line.match(/-\s*`?--?(\w+)`?\s*\((\w+),\s*(required|optional)\):?\s*(.+)/)
      if (paramMatch) {
        skill.parameters.push({
          name: paramMatch[1],
          type: paramMatch[2],
          required: paramMatch[3] === 'required',
          description: paramMatch[4].trim()
        })
      } else {
        const simpleMatch = line.match(/-\s*`?(\w+)`?\s*[:：]?\s*(.+)/)
        if (simpleMatch) {
          skill.parameters.push({
            name: simpleMatch[1],
            type: 'text',
            required: false,
            description: simpleMatch[2].trim()
          })
        }
      }
    }
  }

  const depsMatch = content.match(/##\s*依赖\s*\n+([\s\S]*?)(?=\n##|$)/)
  if (depsMatch) {
    skill.dependencies = depsMatch[1]
      .split('\n')
      .filter(line => line.trim())
      .map(line => line.replace(/^[-*]\s*/, '').trim())
  }

  const examplesMatch = content.match(/##\s*示例\s*\n+([\s\S]*?)(?=\n##|$)/)
  if (examplesMatch) {
    const exampleCodeMatch = examplesMatch[1].match(/```[\s\S]*?```/g)
    if (exampleCodeMatch) {
      skill.examples = exampleCodeMatch.map(e => e.replace(/```\w*\n?/g, '').trim())
    }
  }

  const authorMatch = content.match(/##\s*作者\s*\n+(.+)/)
  if (authorMatch) {
    skill.author = authorMatch[1].trim()
  }

  const versionMatch = content.match(/##\s*版本\s*\n+(.+)/)
  if (versionMatch) {
    skill.version = versionMatch[1].trim()
  }

  const relativePath = skillPath
  for (const [key, value] of Object.entries(CATEGORY_MAP)) {
    if (relativePath.includes(path.sep + key + path.sep) || relativePath.endsWith(path.sep + key)) {
      skill.category = key
      break
    }
  }

  return skill
}

function scanSkillsDirectory(basePath: string): SkillListItem[] {
  const skills: SkillListItem[] = []
  
  if (!fs.existsSync(basePath)) {
    return skills
  }

  const scanDir = (dir: string, category: string = '') => {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') {
        continue
      }
      
      const fullPath = path.join(dir, entry.name)
      
      if (entry.isDirectory()) {
        const skillMdPath = path.join(fullPath, 'SKILL.md')
        
        if (fs.existsSync(skillMdPath)) {
          try {
            const content = fs.readFileSync(skillMdPath, 'utf-8')
            const metadata = parseSkillMd(content, fullPath)
            
            skills.push({
              name: metadata.name,
              description: metadata.description || `${metadata.name} 技能`,
              category: category || metadata.category,
              status: metadata.status,
              path: fullPath
            })
          } catch (err) {
            console.error(`[Skills] 解析技能元数据失败: ${fullPath}`, err)
          }
        } else {
          const hasMainFile = ['main.py', 'index.js', 'main.js', 'app.py'].some(f => 
            fs.existsSync(path.join(fullPath, f))
          )
          
          if (!hasMainFile) {
            const newCategory = category || entry.name
            scanDir(fullPath, newCategory)
          }
        }
      }
    }
  }

  const entries = fs.readdirSync(basePath, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      const fullPath = path.join(basePath, entry.name)
      scanDir(fullPath, entry.name)
    }
  }

  return skills
}

function findSkillPath(skillName: string): string | null {
  const skillsPaths = getSkillsPaths()
  
  for (const basePath of skillsPaths) {
    const directPath = path.join(basePath, skillName)
    if (fs.existsSync(directPath) && fs.existsSync(path.join(directPath, 'SKILL.md'))) {
      return directPath
    }
    
    const entries = fs.readdirSync(basePath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const nestedPath = path.join(basePath, entry.name, skillName)
        if (fs.existsSync(nestedPath) && fs.existsSync(path.join(nestedPath, 'SKILL.md'))) {
          return nestedPath
        }
      }
    }
  }
  
  return null
}

async function executeSkill(skillPath: string, params: Record<string, any>): Promise<any> {
  const mainFiles = ['main.py', 'index.js', 'main.js', 'app.py', 'run.py']
  let mainFile: string | null = null
  
  for (const file of mainFiles) {
    const filePath = path.join(skillPath, file)
    if (fs.existsSync(filePath)) {
      mainFile = filePath
      break
    }
  }
  
  if (!mainFile) {
    throw new Error('技能缺少主执行文件')
  }
  
  const args = Object.entries(params)
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
  
  let command: string
  if (mainFile.endsWith('.py')) {
    command = `python "${mainFile}" ${args}`
  } else if (mainFile.endsWith('.js') || mainFile.endsWith('.ts')) {
    command = `node "${mainFile}" ${args}`
  } else {
    command = `"${mainFile}" ${args}`
  }
  
  console.log(`[Skills] 执行命令: ${command}`)
  
  const { stdout, stderr } = await execAsync(command, {
    cwd: skillPath,
    timeout: 60000,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
  })
  
  const resultMatch = stdout.match(/##RESULT##\s*(\{[\s\S]*\})/)
  if (resultMatch) {
    return JSON.parse(resultMatch[1])
  }
  
  if (stderr && !stderr.includes('Warning')) {
    console.warn('[Skills] 执行警告:', stderr)
  }
  
  return {
    status: 'success',
    output: stdout,
    errors: stderr || null
  }
}

const router = Router()

router.get('/', (req: Request, res: Response) => {
  try {
    const skillsPaths = getSkillsPaths()
    let allSkills: SkillListItem[] = []
    
    for (const basePath of skillsPaths) {
      const skills = scanSkillsDirectory(basePath)
      allSkills = [...allSkills, ...skills]
    }
    
    const uniqueSkills = allSkills.reduce((acc, skill) => {
      const existing = acc.find(s => s.name === skill.name)
      if (!existing) {
        acc.push(skill)
      }
      return acc
    }, [] as SkillListItem[])
    
    const groupedSkills = uniqueSkills.reduce((acc, skill) => {
      const category = skill.category || 'other'
      if (!acc[category]) {
        acc[category] = []
      }
      acc[category].push(skill)
      return acc
    }, {} as Record<string, SkillListItem[]>)
    
    res.json({
      success: true,
      data: {
        total: uniqueSkills.length,
        categories: Object.keys(groupedSkills),
        grouped: groupedSkills,
        skills: uniqueSkills
      }
    })
  } catch (error: any) {
    console.error('[Skills] 获取技能列表失败:', error)
    res.status(500).json({
      success: false,
      error: error.message || '获取技能列表失败'
    })
  }
})

router.get('/:name', (req: Request, res: Response) => {
  const { name } = req.params
  
  try {
    const skillPath = findSkillPath(name)
    
    if (!skillPath) {
      return res.status(404).json({
        success: false,
        error: `技能 "${name}" 不存在`
      })
    }
    
    const skillMdPath = path.join(skillPath, 'SKILL.md')
    if (!fs.existsSync(skillMdPath)) {
      return res.status(404).json({
        success: false,
        error: `技能 "${name}" 缺少 SKILL.md 文件`
      })
    }
    
    const content = fs.readFileSync(skillMdPath, 'utf-8')
    const metadata = parseSkillMd(content, skillPath)
    
    const files = fs.readdirSync(skillPath)
    const hasMainFile = files.some(f => ['main.py', 'index.js', 'main.js', 'app.py'].includes(f))
    
    res.json({
      success: true,
      data: {
        ...metadata,
        files,
        hasMainFile,
        skillMdContent: content
      }
    })
  } catch (error: any) {
    console.error(`[Skills] 获取技能详情失败: ${name}`, error)
    res.status(500).json({
      success: false,
      error: error.message || '获取技能详情失败'
    })
  }
})

router.post('/:name/execute', async (req: Request, res: Response) => {
  const { name } = req.params
  const params = req.body.params || req.body
  
  try {
    const skillPath = findSkillPath(name)
    
    if (!skillPath) {
      return res.status(404).json({
        success: false,
        error: `技能 "${name}" 不存在`
      })
    }
    
    const skillMdPath = path.join(skillPath, 'SKILL.md')
    if (fs.existsSync(skillMdPath)) {
      const content = fs.readFileSync(skillMdPath, 'utf-8')
      const metadata = parseSkillMd(content, skillPath)
      
      const missingParams = metadata.parameters
        .filter(p => p.required)
        .filter(p => params[p.name] === undefined)
      
      if (missingParams.length > 0) {
        return res.status(400).json({
          success: false,
          error: '缺少必需参数',
          missingParams: missingParams.map(p => ({
            name: p.name,
            type: p.type,
            description: p.description
          }))
        })
      }
    }
    
    console.log(`[Skills] 执行技能: ${name}`, params)
    
    const result = await executeSkill(skillPath, params)
    
    res.json({
      success: true,
      data: {
        skillName: name,
        params,
        result,
        timestamp: new Date().toISOString()
      }
    })
  } catch (error: any) {
    console.error(`[Skills] 执行技能失败: ${name}`, error)
    res.status(500).json({
      success: false,
      error: error.message || '执行技能失败'
    })
  }
})

router.get('/category/:category', (req: Request, res: Response) => {
  const { category } = req.params
  
  try {
    const skillsPaths = getSkillsPaths()
    let allSkills: SkillListItem[] = []
    
    for (const basePath of skillsPaths) {
      const categoryPath = path.join(basePath, category)
      if (fs.existsSync(categoryPath)) {
        const entries = fs.readdirSync(categoryPath, { withFileTypes: true })
        
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            const skillPath = path.join(categoryPath, entry.name)
            const skillMdPath = path.join(skillPath, 'SKILL.md')
            
            if (fs.existsSync(skillMdPath)) {
              const content = fs.readFileSync(skillMdPath, 'utf-8')
              const metadata = parseSkillMd(content, skillPath)
              
              allSkills.push({
                name: metadata.name,
                description: metadata.description || `${metadata.name} 技能`,
                category: category,
                status: metadata.status,
                path: skillPath
              })
            }
          }
        }
      }
    }
    
    res.json({
      success: true,
      data: {
        category,
        categoryName: CATEGORY_MAP[category] || category,
        total: allSkills.length,
        skills: allSkills
      }
    })
  } catch (error: any) {
    console.error(`[Skills] 获取分类技能失败: ${category}`, error)
    res.status(500).json({
      success: false,
      error: error.message || '获取分类技能失败'
    })
  }
})

export default router
