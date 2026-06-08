import fs from 'fs'
import path from 'path'
import os from 'os'

export interface MemoryEntry {
  id: string
  content: string
  category: 'core' | 'daily' | 'task'
  timestamp: string
  metadata?: Record<string, any>
}

export class MemoryService {
  private memoryDir: string
  private coreMemoryPath: string
  private dailyMemoryDir: string
  
  constructor() {
    this.memoryDir = path.join(os.homedir(), '.zhiy', 'workspace-magic', 'memory')
    this.coreMemoryPath = path.join(os.homedir(), '.zhiy', 'workspace-magic', 'MEMORY.md')
    this.dailyMemoryDir = this.memoryDir
    
    this.ensureDirectories()
  }
  
  private ensureDirectories() {
    const dirs = [
      this.memoryDir,
      path.dirname(this.coreMemoryPath)
    ]
    
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
    }
    
    if (!fs.existsSync(this.coreMemoryPath)) {
      fs.writeFileSync(this.coreMemoryPath, `# 智 Y 核心记忆\n\n> 此文件存储用户偏好、角色种子等长期信息\n\n## 用户偏好\n\n- 默认模型：deepseek-chat\n- 语言：中文\n\n## 角色种子\n\n（暂无）\n\n## 重要决策\n\n（暂无）\n`, 'utf-8')
    }
  }
  
  getCoreMemory(): string {
    try {
      return fs.readFileSync(this.coreMemoryPath, 'utf-8')
    } catch {
      return ''
    }
  }
  
  updateCoreMemory(content: string): void {
    fs.writeFileSync(this.coreMemoryPath, content, 'utf-8')
  }
  
  appendToCoreMemory(section: string, content: string): void {
    const current = this.getCoreMemory()
    const sectionHeader = `## ${section}`
    
    let newContent: string
    if (current.includes(sectionHeader)) {
      const lines = current.split('\n')
      let foundSection = false
      let insertIndex = -1
      
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith(sectionHeader)) {
          foundSection = true
        } else if (foundSection && lines[i].startsWith('## ')) {
          insertIndex = i
          break
        }
      }
      
      if (insertIndex === -1) {
        newContent = current + '\n' + content + '\n'
      } else {
        lines.splice(insertIndex, 0, content)
        newContent = lines.join('\n')
      }
    } else {
      newContent = current + '\n' + sectionHeader + '\n\n' + content + '\n'
    }
    
    fs.writeFileSync(this.coreMemoryPath, newContent, 'utf-8')
  }
  
  getDailyMemory(date?: Date): string {
    const dateStr = (date || new Date()).toISOString().split('T')[0]
    const filePath = path.join(this.dailyMemoryDir, `${dateStr}.md`)
    
    try {
      return fs.readFileSync(filePath, 'utf-8')
    } catch {
      return ''
    }
  }
  
  appendToDailyMemory(content: string, date?: Date): string {
    const dateStr = (date || new Date()).toISOString().split('T')[0]
    const filePath = path.join(this.dailyMemoryDir, `${dateStr}.md`)
    
    const timestamp = new Date().toISOString()
    const entry = `\n### ${timestamp}\n\n${content}\n`
    
    let currentContent = ''
    if (fs.existsSync(filePath)) {
      currentContent = fs.readFileSync(filePath, 'utf-8')
    } else {
      currentContent = `# ${dateStr} 日志\n\n> 智 Y 自动记录的每日对话摘要\n`
    }
    
    fs.writeFileSync(filePath, currentContent + entry, 'utf-8')
    
    return filePath
  }
  
  createTaskArchive(taskName: string, content: string, metadata?: Record<string, any>): string {
    const dateStr = new Date().toISOString().split('T')[0]
    const safeTaskName = taskName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')
    const fileName = `${dateStr}-${safeTaskName}.md`
    const filePath = path.join(this.dailyMemoryDir, fileName)
    
    const header = `# 任务归档：${taskName}\n\n> 创建时间：${new Date().toISOString()}\n`
    const metadataSection = metadata 
      ? `\n## 元数据\n\n\`\`\`json\n${JSON.stringify(metadata, null, 2)}\n\`\`\`\n`
      : ''
    
    fs.writeFileSync(filePath, header + metadataSection + '\n## 内容\n\n' + content, 'utf-8')
    
    return filePath
  }
  
  searchMemory(query: string): MemoryEntry[] {
    const results: MemoryEntry[] = []
    const lowerQuery = query.toLowerCase()
    
    const coreContent = this.getCoreMemory()
    if (coreContent.toLowerCase().includes(lowerQuery)) {
      results.push({
        id: 'core',
        content: coreContent,
        category: 'core',
        timestamp: fs.statSync(this.coreMemoryPath).mtime.toISOString()
      })
    }
    
    if (fs.existsSync(this.dailyMemoryDir)) {
      const files = fs.readdirSync(this.dailyMemoryDir).filter(f => f.endsWith('.md'))
      
      for (const file of files) {
        const filePath = path.join(this.dailyMemoryDir, file)
        const content = fs.readFileSync(filePath, 'utf-8')
        
        if (content.toLowerCase().includes(lowerQuery)) {
          const isTask = file.includes('-') && !file.match(/^\d{4}-\d{2}-\d{2}\.md$/)
          
          results.push({
            id: file.replace('.md', ''),
            content,
            category: isTask ? 'task' : 'daily',
            timestamp: fs.statSync(filePath).mtime.toISOString()
          })
        }
      }
    }
    
    return results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  }
  
  getRecentMemories(days: number = 7): MemoryEntry[] {
    const results: MemoryEntry[] = []
    
    for (let i = 0; i < days; i++) {
      const date = new Date()
      date.setDate(date.getDate() - i)
      const dateStr = date.toISOString().split('T')[0]
      const filePath = path.join(this.dailyMemoryDir, `${dateStr}.md`)
      
      if (fs.existsSync(filePath)) {
        results.push({
          id: dateStr,
          content: fs.readFileSync(filePath, 'utf-8'),
          category: 'daily',
          timestamp: date.toISOString()
        })
      }
    }
    
    return results
  }
  
  summarizeForContext(maxEntries: number = 5): string {
    const coreMemory = this.getCoreMemory()
    const recentMemories = this.getRecentMemories(3)
    
    let context = '## 核心记忆摘要\n\n'
    
    const coreLines = coreMemory.split('\n').slice(0, 20)
    context += coreLines.join('\n') + '\n\n'
    
    if (recentMemories.length > 0) {
      context += '## 最近记忆\n\n'
      for (const memory of recentMemories.slice(0, maxEntries)) {
        const lines = memory.content.split('\n').slice(0, 10)
        context += `### ${memory.id}\n${lines.join('\n')}\n\n`
      }
    }
    
    return context
  }
}

export const memoryService = new MemoryService()
