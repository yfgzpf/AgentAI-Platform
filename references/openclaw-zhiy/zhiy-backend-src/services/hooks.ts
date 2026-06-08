/**
 * 智 Y.Ai Hook 系统 - 完全照抄 OpenClaw 源码实现
 * 
 * Hook 系统是事件驱动的，可以在特定事件触发时执行自定义逻辑
 * 支持的事件类型：
 * - command: 命令事件 (new, reset, stop)
 * - session: 会话事件 (start, end)
 * - agent: 智能体事件 (bootstrap, tool_result)
 * - gateway: 网关事件 (startup)
 * - stream: 流式事件 (用于流式文档写入)
 */

import * as fs from 'fs'
import * as path from 'path'
import { homedir } from 'os'
import { EventEmitter } from 'events'

export interface HookEvent {
  type: 'command' | 'session' | 'agent' | 'gateway' | 'stream'
  action: string
  sessionKey: string
  timestamp: Date
  messages: string[]
  context: {
    sessionId?: string
    sessionFile?: string
    commandSource?: string
    senderId?: string
    workspaceDir?: string
    content?: string
    filePath?: string
    [key: string]: any
  }
}

export interface HookDefinition {
  name: string
  description: string
  events: string[]
  handler: (event: HookEvent) => Promise<void> | void
  enabled: boolean
  priority: number
}

export interface HookConfig {
  enabled: boolean
  entries: Record<string, { enabled: boolean; config?: Record<string, any> }>
}

export class HookManager extends EventEmitter {
  private hooks: Map<string, HookDefinition> = new Map()
  private hookDir: string
  private config: HookConfig
  
  constructor(hookDir?: string) {
    super()
    this.hookDir = hookDir || path.join(homedir(), '.zhiy', 'hooks')
    this.config = { enabled: true, entries: {} }
    this.loadHooks()
    this.registerBuiltinHooks()
  }
  
  private loadHooks(): void {
    if (!fs.existsSync(this.hookDir)) {
      fs.mkdirSync(this.hookDir, { recursive: true })
      console.log(`[HookManager] 创建 Hook 目录: ${this.hookDir}`)
      return
    }
    
    const entries = fs.readdirSync(this.hookDir, { withFileTypes: true })
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const hookPath = path.join(this.hookDir, entry.name)
        const hookFile = path.join(hookPath, 'HOOK.md')
        
        if (fs.existsSync(hookFile)) {
          this.loadHookFromDir(hookPath)
        }
      }
    }
    
    console.log(`[HookManager] 已加载 ${this.hooks.size} 个 Hook`)
  }
  
  private loadHookFromDir(dir: string): void {
    const hookFile = path.join(dir, 'HOOK.md')
    const handlerFile = path.join(dir, 'handler.js')
    
    if (!fs.existsSync(hookFile)) return
    
    try {
      const content = fs.readFileSync(hookFile, 'utf-8')
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
      
      if (!frontmatterMatch) return
      
      const frontmatter = frontmatterMatch[1]
      const nameMatch = frontmatter.match(/^name:\s*(.+)$/m)
      const descMatch = frontmatter.match(/^description:\s*(.+)$/m)
      const eventsMatch = frontmatter.match(/^events:\s*\[(.+)\]/m)
      
      if (!nameMatch) return
      
      const name = nameMatch[1].trim()
      const description = descMatch?.[1]?.trim() || ''
      const events = eventsMatch?.[1]?.split(',').map(e => e.trim().replace(/['"]/g, '')) || []
      
      let handler: (event: HookEvent) => Promise<void> | void = () => {}
      
      if (fs.existsSync(handlerFile)) {
        try {
          delete require.cache[require.resolve(handlerFile)]
          const handlerModule = require(handlerFile)
          handler = handlerModule.default || handlerModule.handler || handler
        } catch (err) {
          console.warn(`[HookManager] 加载 handler 失败: ${name}`, err)
        }
      }
      
      this.hooks.set(name, {
        name,
        description,
        events,
        handler,
        enabled: this.config.entries[name]?.enabled ?? true,
        priority: 0
      })
      
      console.log(`[HookManager] 加载 Hook: ${name} (事件: ${events.join(', ')})`)
    } catch (err) {
      console.warn(`[HookManager] 解析 Hook 失败: ${dir}`, err)
    }
  }
  
  private registerBuiltinHooks(): void {
    this.registerHook({
      name: 'stream-doc',
      description: '流式文档写入 - AI 生成内容时实时追加到文档',
      events: ['stream:content', 'agent:tool_result'],
      handler: this.streamDocHandler.bind(this),
      enabled: true,
      priority: 10
    })
    
    this.registerHook({
      name: 'memory-logger',
      description: '记忆日志 - 自动记录对话摘要到记忆文件',
      events: ['session:end', 'command:new'],
      handler: this.memoryLoggerHandler.bind(this),
      enabled: true,
      priority: 5
    })
    
    this.registerHook({
      name: 'command-audit',
      description: '命令审计 - 记录所有命令到审计日志',
      events: ['command'],
      handler: this.commandAuditHandler.bind(this),
      enabled: false,
      priority: 0
    })
    
    console.log(`[HookManager] 已注册 ${this.hooks.size} 个内置 Hook`)
  }
  
  private async streamDocHandler(event: HookEvent): Promise<void> {
    const { context } = event
    const content = context.content || ''
    
    const appendMatch = content.match(/##APPEND_DOC:(.+?)##/)
    const writeMatch = content.match(/##WRITE_DOC:(.+?)##/)
    const excelMatch = content.match(/##APPEND_EXCEL:(.+?)##/)
    
    if (appendMatch) {
      const text = appendMatch[1]
      const docPath = context.filePath || path.join(context.workspaceDir || homedir(), '.zhiy', 'output.docx')
      
      console.log(`[Hook:stream-doc] 追加内容到文档: ${docPath}`)
      
      try {
        const { exec } = require('child_process')
        const skillPath = path.join(homedir(), '.zhiy', 'skills', 'office', 'doc-generator', 'main.py')
        
        if (fs.existsSync(skillPath)) {
          exec(`python "${skillPath}" --action append --file "${docPath}" --text "${text}"`, (err: any, stdout: string, stderr: string) => {
            if (err) {
              console.error(`[Hook:stream-doc] 追加失败:`, stderr)
            } else {
              console.log(`[Hook:stream-doc] 追加成功`)
            }
          })
        }
      } catch (err) {
        console.error(`[Hook:stream-doc] 执行失败:`, err)
      }
    }
    
    if (writeMatch) {
      const text = writeMatch[1]
      const docPath = context.filePath || path.join(context.workspaceDir || homedir(), '.zhiy', 'output.docx')
      
      console.log(`[Hook:stream-doc] 写入新文档: ${docPath}`)
      
      try {
        const { exec } = require('child_process')
        const skillPath = path.join(homedir(), '.zhiy', 'skills', 'office', 'doc-generator', 'main.py')
        
        if (fs.existsSync(skillPath)) {
          exec(`python "${skillPath}" --action create --file "${docPath}" --text "${text}"`, (err: any, stdout: string, stderr: string) => {
            if (err) {
              console.error(`[Hook:stream-doc] 写入失败:`, stderr)
            } else {
              console.log(`[Hook:stream-doc] 写入成功`)
            }
          })
        }
      } catch (err) {
        console.error(`[Hook:stream-doc] 执行失败:`, err)
      }
    }
    
    if (excelMatch) {
      const data = excelMatch[1]
      const excelPath = context.filePath || path.join(context.workspaceDir || homedir(), '.zhiy', 'output.xlsx')
      
      console.log(`[Hook:stream-doc] 追加内容到 Excel: ${excelPath}`)
      
      try {
        const { exec } = require('child_process')
        const skillPath = path.join(homedir(), '.zhiy', 'skills', 'office', 'excel-generator', 'main.py')
        
        if (fs.existsSync(skillPath)) {
          exec(`python "${skillPath}" --action append --file "${excelPath}" --data "${data}"`, (err: any, stdout: string, stderr: string) => {
            if (err) {
              console.error(`[Hook:stream-doc] Excel 追加失败:`, stderr)
            } else {
              console.log(`[Hook:stream-doc] Excel 追加成功`)
            }
          })
        }
      } catch (err) {
        console.error(`[Hook:stream-doc] 执行失败:`, err)
      }
    }
  }
  
  private async memoryLoggerHandler(event: HookEvent): Promise<void> {
    const { context } = event
    const memoryDir = path.join(context.workspaceDir || homedir(), '.zhiy', 'workspace-magic', 'memory')
    
    if (!fs.existsSync(memoryDir)) {
      fs.mkdirSync(memoryDir, { recursive: true })
    }
    
    const today = new Date().toISOString().split('T')[0]
    const memoryFile = path.join(memoryDir, `${today}.md`)
    
    const timestamp = new Date().toISOString()
    const entry = `\n## ${timestamp}\n会话: ${event.sessionKey}\n事件: ${event.action}\n\n`
    
    fs.appendFileSync(memoryFile, entry, 'utf-8')
    console.log(`[Hook:memory-logger] 记录到: ${memoryFile}`)
  }
  
  private async commandAuditHandler(event: HookEvent): Promise<void> {
    const logDir = path.join(homedir(), '.zhiy', 'logs')
    
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true })
    }
    
    const logFile = path.join(logDir, 'commands.log')
    const entry = JSON.stringify({
      timestamp: event.timestamp.toISOString(),
      type: event.type,
      action: event.action,
      sessionKey: event.sessionKey,
      senderId: event.context.senderId,
      source: event.context.commandSource
    }) + '\n'
    
    fs.appendFileSync(logFile, entry, 'utf-8')
  }
  
  registerHook(hook: HookDefinition): void {
    this.hooks.set(hook.name, hook)
    console.log(`[HookManager] 注册 Hook: ${hook.name}`)
  }
  
  unregisterHook(name: string): void {
    this.hooks.delete(name)
    console.log(`[HookManager] 注销 Hook: ${name}`)
  }
  
  enableHook(name: string): void {
    const hook = this.hooks.get(name)
    if (hook) {
      hook.enabled = true
      this.config.entries[name] = { enabled: true }
    }
  }
  
  disableHook(name: string): void {
    const hook = this.hooks.get(name)
    if (hook) {
      hook.enabled = false
      this.config.entries[name] = { enabled: false }
    }
  }
  
  async trigger(event: HookEvent): Promise<void> {
    const eventKey = `${event.type}:${event.action}`
    const genericKey = event.type
    
    const matchingHooks = Array.from(this.hooks.values())
      .filter(h => h.enabled && (h.events.includes(eventKey) || h.events.includes(genericKey)))
      .sort((a, b) => b.priority - a.priority)
    
    for (const hook of matchingHooks) {
      try {
        await hook.handler(event)
      } catch (err) {
        console.error(`[HookManager] Hook ${hook.name} 执行失败:`, err)
      }
    }
    
    this.emit(eventKey, event)
    this.emit(genericKey, event)
  }
  
  createEvent(
    type: HookEvent['type'],
    action: string,
    sessionKey: string,
    context: Partial<HookEvent['context']> = {}
  ): HookEvent {
    return {
      type,
      action,
      sessionKey,
      timestamp: new Date(),
      messages: [],
      context: {
        workspaceDir: path.join(homedir(), '.zhiy'),
        ...context
      }
    }
  }
  
  getHooks(): HookDefinition[] {
    return Array.from(this.hooks.values())
  }
  
  getEnabledHooks(): HookDefinition[] {
    return Array.from(this.hooks.values()).filter(h => h.enabled)
  }
}

export const hookManager = new HookManager()
