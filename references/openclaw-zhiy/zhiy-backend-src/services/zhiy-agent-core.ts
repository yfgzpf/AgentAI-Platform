/**
 * 智 Y.Ai 智能体核心 - 完全照抄 OpenClaw 源码实现
 * 
 * 基于 OpenClaw 的 AgentSession 架构
 * 核心机制：
 * 1. 系统提示包含工具描述和使用指南
 * 2. 技能通过 XML 格式嵌入系统提示
 * 3. LLM 通过 tools 参数调用工具
 */

import { EventEmitter } from 'events'
import { spawn, ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import { loadSkills, formatSkillsForPrompt, Skill } from './skills-system'
import { MultiAgentOrchestrator } from './multi-agent-orchestrator'
import type { ExecutorResult } from './multi-agent-orchestrator'
import { WorkflowOrchestrator } from './workflow-orchestrator'

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string | any[]
  name?: string
  tool_call_id?: string
  tool_calls?: any[]
}

export interface AgentTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: any
  }
}

export interface AgentSession {
  id: string
  messages: AgentMessage[]
  model: string
  tools: AgentTool[]
  activeTools: string[]
  createdAt: number
  updatedAt: number
}

export interface ToolResult {
  success: boolean
  output?: string
  error?: string
  data?: any
  screenshots?: string[]
}

const TOOL_DESCRIPTIONS: Record<string, string> = {
  read: 'Read file contents',
  bash: 'Execute bash commands (ls, grep, find, etc.)',
  edit: 'Make surgical edits to files (find exact text and replace)',
  write: 'Create or overwrite files',
  grep: 'Search file contents for patterns (respects .gitignore)',
  find: 'Find files by glob pattern (respects .gitignore)',
  ls: 'List directory contents',
  browser_navigate: '打开网页 - 执行智能体会打开浏览器并导航到指定URL',
  browser_screenshot: '截取网页截图 - 用于视觉智能体分析',
  browser_click: '点击网页元素',
  browser_type: '在网页输入框中输入文字',
  vision_analyze: '使用多模态模型分析图片内容 - 这是你的"眼睛"',
  vision_read_page: '读取并理解网页截图内容',
  vision_find_element: '在网页截图中查找特定元素',
}

const BUILTIN_TOOLS: AgentTool[] = [
  {
    type: 'function',
    function: {
      name: 'read',
      description: 'Read file contents from the filesystem. Use this to examine files before editing or to understand code structure.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'The absolute path to the file to read' },
          offset: { type: 'number', description: 'Line number to start reading from' },
          limit: { type: 'number', description: 'Number of lines to read' }
        },
        required: ['file_path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'bash',
      description: 'Execute bash commands. Use this for system operations, file manipulation, and running scripts.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The bash command to execute' },
          timeout: { type: 'number', description: 'Timeout in milliseconds', default: 120000 }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit',
      description: 'Make surgical edits to files by finding and replacing exact text. The old_str must match exactly.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'The absolute path to the file to edit' },
          old_str: { type: 'string', description: 'The text to search for - must match exactly' },
          new_str: { type: 'string', description: 'The text to replace with' }
        },
        required: ['file_path', 'old_str', 'new_str']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write',
      description: 'Create or overwrite a file with the given content.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'The absolute path to the file to write' },
          content: { type: 'string', description: 'The content to write to the file' }
        },
        required: ['file_path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'grep',
      description: 'Search for patterns in files using ripgrep. Respects .gitignore.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'The regex pattern to search for' },
          path: { type: 'string', description: 'The directory or file to search in' },
          output_mode: { type: 'string', enum: ['content', 'files_with_matches', 'count'], description: 'Output format' }
        },
        required: ['pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'find',
      description: 'Find files matching a glob pattern. Respects .gitignore.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern to match files' },
          path: { type: 'string', description: 'Directory to search in' }
        },
        required: ['pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ls',
      description: 'List directory contents.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The directory path to list' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'execute_skill',
      description: 'Execute a skill by name. Skills are specialized tools for specific tasks.',
      parameters: {
        type: 'object',
        properties: {
          skill_name: { type: 'string', description: 'Name of the skill to execute' },
          params: { type: 'object', description: 'Parameters for the skill' }
        },
        required: ['skill_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_navigate',
      description: '打开指定网址。当需要访问网页时使用此工具。执行智能体会打开浏览器并导航到指定URL。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '要打开的网址，如 https://taobao.com' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_screenshot',
      description: '截取当前网页的截图。截图后可以传给视觉智能体进行内容识别。',
      parameters: {
        type: 'object',
        properties: {
          fullPage: { type: 'boolean', description: '是否截取整页，默认false' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_click',
      description: '点击网页上的元素。需要提供CSS选择器。',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS选择器，如 "#btn-submit", ".product-item"' }
        },
        required: ['selector']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_type',
      description: '在网页输入框中输入文字。',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: '输入框的CSS选择器' },
          text: { type: 'string', description: '要输入的文字' }
        },
        required: ['selector', 'text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'vision_analyze',
      description: '使用多模态模型分析图片内容。可以理解网页截图、识别文字、分析布局等。这是你的"眼睛"。',
      parameters: {
        type: 'object',
        properties: {
          image: { type: 'string', description: '图片的base64编码（通常来自browser_screenshot的结果）' },
          prompt: { type: 'string', description: '分析指令，如"识别页面上的所有商品名称和价格"' }
        },
        required: ['image', 'prompt']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'vision_read_page',
      description: '读取并理解网页截图内容，提取文本、元素位置等信息。配合browser_screenshot使用。',
      parameters: {
        type: 'object',
        properties: {
          screenshot: { type: 'string', description: '网页截图的base64编码' },
          url: { type: 'string', description: '网页URL（可选）' }
        },
        required: ['screenshot']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'vision_find_element',
      description: '在网页截图中查找特定元素。返回元素的位置和建议的选择器。',
      parameters: {
        type: 'object',
        properties: {
          screenshot: { type: 'string', description: '网页截图的base64编码' },
          description: { type: 'string', description: '要查找的元素描述，如"登录按钮"、"商品价格"' }
        },
        required: ['screenshot', 'description']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'workflow_create',
      description: '创建新的工作流。AI会根据用户需求自主设计工作流步骤。例如视频制作：剧本写作→分镜生成→视频合成。',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: '工作流需求描述，如"制作一个关于AI的教学视频"' }
        },
        required: ['description']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'workflow_execute',
      description: '执行已定义的工作流。可以执行内置工作流或自定义工作流。',
      parameters: {
        type: 'object',
        properties: {
          workflow_id: { type: 'string', description: '工作流ID，如video-production' },
          inputs: { type: 'object', description: '工作流输入参数' }
        },
        required: ['workflow_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'workflow_list',
      description: '列出所有可用的工作流。',
      parameters: { type: 'object', properties: {} }
    }
  }
]

export class ZhiYAgentCore extends EventEmitter {
  private sessions: Map<string, AgentSession> = new Map()
  private skills: Map<string, Skill> = new Map()
  private workspace: string
  private model: string
  private apiKey: string
  private apiEndpoint: string
  private activeProcesses: Map<string, ChildProcess> = new Map()
  private multiAgentOrchestrator: MultiAgentOrchestrator
  private workflowOrchestrator: WorkflowOrchestrator

  constructor(config: {
    workspace?: string
    model?: string
    apiKey?: string
    apiEndpoint?: string
  } = {}) {
    super()
    this.workspace = config.workspace || process.cwd()
    this.model = config.model || 'deepseek-chat'
    this.apiKey = config.apiKey || process.env.DEEPSEEK_API_KEY || ''
    this.apiEndpoint = config.apiEndpoint || 'https://api.deepseek.com/v1'
    
    this.multiAgentOrchestrator = new MultiAgentOrchestrator({
      apiKey: this.apiKey,
      apiEndpoint: this.apiEndpoint,
      model: this.model
    })
    
    this.workflowOrchestrator = new WorkflowOrchestrator({
      toolExecutor: async (toolName, params) => {
        return this.multiAgentOrchestrator.executeToolCall(toolName, params)
      },
      skillExecutor: async (skillName, params) => {
        return this.toolExecuteSkill({ skill_name: skillName, params })
      },
      llmExecutor: async (prompt, context) => {
        const response = await fetch(`${this.apiEndpoint}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            model: this.model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7,
            max_tokens: 4096
          })
        })
        const data = await response.json() as any
        return data.choices[0].message.content
      }
    })
    
    this.loadSkills()
    console.log(`[ZhiYAgentCore] 初始化完成，工作目录: ${this.workspace}`)
    console.log(`[ZhiYAgentCore] 多智能体协作系统已启用`)
  }

  private loadSkills(): void {
    const { skills } = loadSkills({ cwd: this.workspace })
    for (const skill of skills) {
      this.skills.set(skill.name, skill)
    }
    console.log(`[ZhiYAgentCore] 已加载 ${this.skills.size} 个技能`)
  }

  buildSystemPrompt(selectedTools: string[] = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls']): string {
    const tools = selectedTools
      .map(t => `- ${t}: ${TOOL_DESCRIPTIONS[t] || t}`)
      .join('\n')
    
    const guidelines: string[] = []
    const hasBash = selectedTools.includes('bash')
    const hasRead = selectedTools.includes('read')
    const hasEdit = selectedTools.includes('edit')
    const hasWrite = selectedTools.includes('write')
    const hasGrep = selectedTools.includes('grep')
    const hasFind = selectedTools.includes('find')
    const hasLs = selectedTools.includes('ls')
    const hasBrowser = selectedTools.some(t => t.startsWith('browser_'))
    const hasVision = selectedTools.some(t => t.startsWith('vision_'))
    
    if (hasBash && !hasGrep && !hasFind && !hasLs) {
      guidelines.push('Use bash for file operations like ls, rg, find')
    } else if (hasBash && (hasGrep || hasFind || hasLs)) {
      guidelines.push('Prefer grep/find/ls tools over bash for file exploration (faster, respects .gitignore)')
    }
    if (hasRead && hasEdit) {
      guidelines.push('Use read to examine files before editing. You must use this tool instead of cat or sed.')
    }
    if (hasEdit) {
      guidelines.push('Use edit for precise changes (old text must match exactly)')
    }
    if (hasWrite) {
      guidelines.push('Use write only for new files or complete rewrites')
    }
    if (hasEdit || hasWrite) {
      guidelines.push('When summarizing your actions, output plain text directly - do NOT use cat or bash to display what you did')
    }
    
    guidelines.push('Be concise in your responses')
    guidelines.push('Show file paths clearly when working with files')
    
    const guidelinesList = guidelines.map(g => `- ${g}`).join('\n')
    
    const skills = Array.from(this.skills.values())
    const skillsPrompt = formatSkillsForPrompt(skills)
    
    const now = new Date()
    const dateTime = now.toLocaleString('zh-CN', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short',
    })
    
    let multiAgentSection = ''
    if (hasBrowser || hasVision) {
      multiAgentSection = `

## 多智能体协作系统
你是这个系统的**主控智能体**，负责理解用户意图、分解任务、调度执行智能体。

### 可用的执行智能体：
- **浏览器执行者**: 负责打开网页、点击、输入、截图等操作
- **视觉智能体**: 负责理解网页截图内容、识别文字、分析布局

### 典型工作流程：
当用户说"打开淘宝找出今日热门商品"时：

1. 调用 \`browser_navigate\` 打开淘宝
2. 调用 \`browser_screenshot\` 截取网页截图
3. 调用 \`vision_read_page\` 或 \`vision_find_element\` 分析截图内容
4. 汇总结果返回用户

### 重要提示：
- 你是"大脑"，执行智能体是你的"手脚"和"眼睛"
- 浏览器操作后必须截图，视觉智能体才能"看到"网页内容
- 截图结果会包含 \`screenshots\` 字段，里面是base64编码的图片
- 将截图的base64传给视觉工具进行分析`
    }
    
    const hasWorkflow = selectedTools.some(t => t.startsWith('workflow_'))
    let workflowSection = ''
    if (hasWorkflow) {
      workflowSection = `

## 工作流编排系统
你可以**自主编制工作流**来完成复杂的多步骤任务。

### 工作流能力：
- \`workflow_list\`: 查看所有可用的工作流
- \`workflow_create\`: 根据用户需求自主设计新工作流
- \`workflow_execute\`: 执行工作流

### 工作流示例：
**用户**: "帮我制作一个关于AI的教学视频"
**你的操作**:
1. 调用 \`workflow_create\` 创建视频制作工作流
2. 工作流自动包含：剧本写作 → 分镜生成 → 视频合成 → 配音合成
3. 调用 \`workflow_execute\` 执行工作流

### 预置工作流：
- \`video-production\`: 视频制作（剧本→分镜→视频→配音）
- \`research-workflow\`: 研究分析（搜索→收集→分析→报告）

### 重要：
- 对于复杂任务，优先考虑使用工作流
- 工作流可以并行执行、条件分支、嵌套调用
- 你可以动态创建新工作流来满足用户需求`
    }
    
    return `你是智 Y.Ai，一个强大的 AI 编程助手和多智能体协作系统的主控智能体。

## 可用工具
${tools}

除了上述工具外，你可能还有其他自定义工具，具体取决于项目。

## 使用指南
${guidelinesList}
${multiAgentSection}
${workflowSection}
${skillsPrompt}

当前日期和时间: ${dateTime}
当前工作目录: ${this.workspace}`
  }

  createSession(options: {
    id?: string
    model?: string
    activeTools?: string[]
  } = {}): AgentSession {
    const id = options.id || `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const session: AgentSession = {
      id,
      messages: [],
      model: options.model || this.model,
      tools: BUILTIN_TOOLS,
      activeTools: options.activeTools || [
        'read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'execute_skill',
        'browser_navigate', 'browser_screenshot', 'browser_click', 'browser_type',
        'vision_analyze', 'vision_read_page', 'vision_find_element',
        'workflow_create', 'workflow_execute', 'workflow_list'
      ],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    
    this.sessions.set(id, session)
    this.emit('session_created', session)
    console.log(`[ZhiYAgentCore] 创建会话: ${id}`)
    console.log(`[ZhiYAgentCore] 会话工具: ${session.activeTools.join(', ')}`)
    return session
  }

  getSession(id: string): AgentSession | undefined {
    return this.sessions.get(id)
  }

  async processMessage(sessionId: string, message: string): Promise<string> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`)
    }

    session.messages.push({
      role: 'user',
      content: message
    })
    session.updatedAt = Date.now()

    this.emit('message', { sessionId, role: 'user', content: message })

    try {
      const response = await this.callLLM(session)
      
      session.messages.push({
        role: 'assistant',
        content: response
      })
      session.updatedAt = Date.now()

      this.emit('message', { sessionId, role: 'assistant', content: response })
      
      return response
    } catch (error: any) {
      this.emit('error', { sessionId, error })
      throw error
    }
  }

  private async callLLM(session: AgentSession): Promise<string> {
    const systemPrompt = this.buildSystemPrompt(session.activeTools)
    
    const messages: AgentMessage[] = [
      { role: 'system', content: systemPrompt },
      ...session.messages
    ]
    
    const tools = BUILTIN_TOOLS.filter(t => 
      session.activeTools.includes(t.function.name)
    )

    console.log(`[ZhiYAgentCore] 调用 LLM，消息数: ${messages.length}，工具数: ${tools.length}`)

    const response = await fetch(`${this.apiEndpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: session.model,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        tool_choice: tools.length > 0 ? 'auto' : undefined,
        temperature: 0.7,
        max_tokens: 4096
      })
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`LLM API 错误: ${response.status} - ${error}`)
    }

    const data = await response.json() as any
    const assistantMessage = data.choices[0].message

    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      session.messages.push(assistantMessage)
      
      for (const toolCall of assistantMessage.tool_calls) {
        const toolName = toolCall.function.name
        const toolInput = JSON.parse(toolCall.function.arguments)
        
        console.log(`[ZhiYAgentCore] 工具调用: ${toolName}`, toolInput)
        
        this.emit('tool_use', { 
          sessionId: session.id, 
          toolName, 
          toolInput 
        })

        const toolResult = await this.executeTool(session, toolName, toolInput)
        
        session.messages.push({
          role: 'tool',
          content: JSON.stringify(toolResult),
          tool_call_id: toolCall.id
        })

        this.emit('tool_result', { 
          sessionId: session.id, 
          toolName, 
          toolResult 
        })
      }

      return await this.callLLM(session)
    }

    return assistantMessage.content || ''
  }

  private async executeTool(
    session: AgentSession, 
    toolName: string, 
    params: any
  ): Promise<ToolResult> {
    try {
      switch (toolName) {
        case 'bash':
          return await this.toolBash(params)
        case 'read':
          return await this.toolRead(params)
        case 'write':
          return await this.toolWrite(params)
        case 'edit':
          return await this.toolEdit(params)
        case 'grep':
          return await this.toolGrep(params)
        case 'find':
          return await this.toolFind(params)
        case 'ls':
          return await this.toolLs(params)
        case 'execute_skill':
          return await this.toolExecuteSkill(params)
        case 'browser_navigate':
        case 'browser_screenshot':
        case 'browser_click':
        case 'browser_type':
        case 'browser_get_content':
        case 'browser_get_elements':
        case 'browser_scroll':
          return await this.toolBrowser(toolName, params)
        case 'vision_analyze':
        case 'vision_read_page':
        case 'vision_find_element':
          return await this.toolVision(toolName, params)
        case 'workflow_create':
          return await this.toolWorkflowCreate(params)
        case 'workflow_execute':
          return await this.toolWorkflowExecute(params)
        case 'workflow_list':
          return await this.toolWorkflowList(params)
        default:
          return { success: false, error: `未知工具: ${toolName}` }
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  private async toolBrowser(toolName: string, params: any): Promise<ToolResult> {
    const actionMap: Record<string, string> = {
      'browser_navigate': 'navigate',
      'browser_screenshot': 'screenshot',
      'browser_click': 'click',
      'browser_type': 'type',
      'browser_get_content': 'getContent',
      'browser_get_elements': 'getElements',
      'browser_scroll': 'scroll'
    }
    
    const action = actionMap[toolName]
    const result = await this.multiAgentOrchestrator.executeToolCall(toolName, params)
    
    return {
      success: result.success,
      output: result.output,
      error: result.error,
      data: result.data,
      screenshots: result.screenshots
    }
  }

  private async toolVision(toolName: string, params: any): Promise<ToolResult> {
    const result = await this.multiAgentOrchestrator.executeToolCall(toolName, params)
    
    return {
      success: result.success,
      output: result.output,
      error: result.error,
      data: result.data
    }
  }

  private async toolWorkflowCreate(params: any): Promise<ToolResult> {
    try {
      const workflow = await this.workflowOrchestrator.createWorkflowFromPrompt(params.description)
      return {
        success: true,
        output: `工作流已创建: ${workflow.name}`,
        data: {
          id: workflow.id,
          name: workflow.name,
          description: workflow.description,
          steps: workflow.steps.map(s => s.name)
        }
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  private async toolWorkflowExecute(params: any): Promise<ToolResult> {
    try {
      const execution = await this.workflowOrchestrator.executeWorkflow(
        params.workflow_id,
        params.inputs || {}
      )
      
      return {
        success: execution.status === 'completed',
        output: execution.status === 'completed' 
          ? `工作流执行完成，输出: ${JSON.stringify(execution.context.outputs)}`
          : `工作流执行状态: ${execution.status}`,
        data: {
          executionId: execution.id,
          status: execution.status,
          outputs: execution.context.outputs,
          completedSteps: execution.completedSteps
        }
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  private async toolWorkflowList(params: any): Promise<ToolResult> {
    const workflows = this.workflowOrchestrator.listWorkflows()
    
    return {
      success: true,
      output: `可用工作流:\n${workflows.map(w => `- ${w.id}: ${w.name} - ${w.description}`).join('\n')}`,
      data: {
        workflows: workflows.map(w => ({
          id: w.id,
          name: w.name,
          description: w.description,
          inputs: w.inputs,
          outputs: w.outputs
        }))
      }
    }
  }

  private async toolBash(params: any): Promise<ToolResult> {
    const { command, timeout = 120000 } = params
    
    return new Promise((resolve) => {
      const proc = spawn('powershell', ['-Command', command], {
        cwd: this.workspace
      })

      this.activeProcesses.set(`bash-${Date.now()}`, proc)

      let stdout = ''
      let stderr = ''

      const timer = setTimeout(() => {
        proc.kill()
        resolve({ success: false, error: `命令超时 (${timeout}ms)` })
      }, timeout)

      proc.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      proc.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        clearTimeout(timer)
        resolve({
          success: code === 0,
          output: stdout,
          error: stderr || undefined
        })
      })

      proc.on('error', (err) => {
        clearTimeout(timer)
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async toolRead(params: any): Promise<ToolResult> {
    const { file_path, offset = 0, limit = 2000 } = params
    const absolutePath = path.isAbsolute(file_path) 
      ? file_path 
      : path.join(this.workspace, file_path)

    if (!fs.existsSync(absolutePath)) {
      return { success: false, error: `文件不存在: ${absolutePath}` }
    }

    try {
      const content = fs.readFileSync(absolutePath, 'utf-8')
      const lines = content.split('\n')
      const selectedLines = lines.slice(offset, offset + limit)

      return {
        success: true,
        output: selectedLines.map((line, i) => `${offset + i + 1}→${line}`).join('\n'),
        data: {
          path: absolutePath,
          totalLines: lines.length,
          readLines: selectedLines.length
        }
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  private async toolWrite(params: any): Promise<ToolResult> {
    const { file_path, content } = params
    const absolutePath = path.isAbsolute(file_path) 
      ? file_path 
      : path.join(this.workspace, file_path)

    try {
      const dir = path.dirname(absolutePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      fs.writeFileSync(absolutePath, content, 'utf-8')

      return {
        success: true,
        output: `文件已写入: ${absolutePath}`,
        data: {
          path: absolutePath,
          bytes: Buffer.byteLength(content, 'utf-8')
        }
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  private async toolEdit(params: any): Promise<ToolResult> {
    const { file_path, old_str, new_str } = params
    const absolutePath = path.isAbsolute(file_path) 
      ? file_path 
      : path.join(this.workspace, file_path)

    if (!fs.existsSync(absolutePath)) {
      return { success: false, error: `文件不存在: ${absolutePath}` }
    }

    try {
      const content = fs.readFileSync(absolutePath, 'utf-8')
      
      if (!content.includes(old_str)) {
        return { success: false, error: `未找到要替换的内容` }
      }

      const newContent = content.replace(old_str, new_str)
      fs.writeFileSync(absolutePath, newContent, 'utf-8')

      return {
        success: true,
        output: `文件已编辑: ${absolutePath}`
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  private async toolGrep(params: any): Promise<ToolResult> {
    const { pattern, path: searchPath = this.workspace, output_mode = 'content' } = params
    
    return new Promise((resolve) => {
      const proc = spawn('rg', [
        '-n',
        output_mode === 'files_with_matches' ? '-l' : '',
        pattern,
        searchPath
      ].filter(Boolean), {
        cwd: this.workspace
      })

      let stdout = ''

      proc.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      proc.on('close', () => {
        resolve({
          success: true,
          output: stdout
        })
      })

      proc.on('error', (err) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async toolFind(params: any): Promise<ToolResult> {
    const { pattern, path: searchPath = this.workspace } = params
    
    return new Promise((resolve) => {
      const proc = spawn('rg', ['--files', '--glob', pattern, searchPath], {
        cwd: this.workspace
      })

      let stdout = ''

      proc.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      proc.on('close', () => {
        resolve({
          success: true,
          output: stdout
        })
      })

      proc.on('error', (err) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async toolLs(params: any): Promise<ToolResult> {
    const { path: listPath } = params
    const absolutePath = path.isAbsolute(listPath) 
      ? listPath 
      : path.join(this.workspace, listPath)

    if (!fs.existsSync(absolutePath)) {
      return { success: false, error: `目录不存在: ${absolutePath}` }
    }

    try {
      const entries = fs.readdirSync(absolutePath, { withFileTypes: true })
      
      return {
        success: true,
        output: entries.map(e => `${e.isDirectory() ? 'd' : '-'} ${e.name}`).join('\n'),
        data: {
          path: absolutePath,
          entries: entries.map(e => ({
            name: e.name,
            type: e.isDirectory() ? 'directory' : 'file'
          }))
        }
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  private async toolExecuteSkill(params: any): Promise<ToolResult> {
    const { skill_name, params: skillParams } = params
    
    const skill = this.skills.get(skill_name)
    if (!skill) {
      return { success: false, error: `技能不存在: ${skill_name}` }
    }

    const mainFile = skill.filePath.replace('SKILL.md', 'main.py')
    if (!fs.existsSync(mainFile)) {
      return { success: false, error: `技能主文件不存在: ${mainFile}` }
    }

    const args = [mainFile]
    if (skillParams) {
      for (const [key, value] of Object.entries(skillParams)) {
        args.push(`--${key}`, String(value))
      }
    }

    return new Promise((resolve) => {
      const proc = spawn('python', args, {
        cwd: skill.baseDir
      })

      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      proc.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        resolve({
          success: code === 0,
          output: stdout,
          error: stderr || undefined
        })
      })

      proc.on('error', (err) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  getSkills(): Skill[] {
    return Array.from(this.skills.values())
  }

  getTools(): AgentTool[] {
    return BUILTIN_TOOLS
  }

  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId)
    console.log(`[ZhiYAgentCore] 删除会话: ${sessionId}`)
  }

  getAllSessions(): AgentSession[] {
    return Array.from(this.sessions.values())
  }
}

export function createZhiYAgentCore(config?: {
  workspace?: string
  model?: string
  apiKey?: string
  apiEndpoint?: string
}): ZhiYAgentCore {
  return new ZhiYAgentCore(config)
}
