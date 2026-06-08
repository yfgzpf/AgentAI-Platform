import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fetch from 'node-fetch'

const execAsync = promisify(exec)

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  name?: string
  tool_calls?: any[]
  tool_call_id?: string
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, any>
      required?: string[]
    }
  }
}

export interface AIResponse {
  message: string
  suggestedActions?: any[]
  thinking?: string
  toolCalls?: any[]
  metadata?: any
}

const PYTHON_BRIDGE = path.join(__dirname, 'python_bridge.py')

const AVAILABLE_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'open_browser',
      description: '打开浏览器并访问指定网址，支持自动搜索',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '要访问的网址' },
          search_query: { type: 'string', description: '可选的搜索关键词' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'desktop_automation',
      description: '桌面自动化操作：打开应用、点击、输入、截图等',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['open_app', 'click', 'type', 'screenshot', 'hotkey'] },
          params: { type: 'object', description: '操作参数' }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'generate_document',
      description: '生成 Word/Excel/PPT 文档',
      parameters: {
        type: 'object',
        properties: {
          doc_type: { type: 'string', enum: ['word', 'excel', 'ppt'] },
          title: { type: 'string', description: '文档标题' },
          content: { type: 'string', description: '文档内容' }
        },
        required: ['doc_type', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_wechat_message',
      description: '发送微信消息给指定联系人',
      parameters: {
        type: 'object',
        properties: {
          contact: { type: 'string', description: '联系人名称' },
          message: { type: 'string', description: '消息内容' }
        },
        required: ['contact', 'message']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'generate_video',
      description: '使用 AI 生成视频（豆包 Seedance）',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: '视频描述' },
          duration: { type: 'number', description: '视频时长（秒）' }
        },
        required: ['prompt']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'generate_image',
      description: '使用 AI 生成图片',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: '图片描述' },
          style: { type: 'string', enum: ['现代', '古典', '简约', '华丽'] }
        },
        required: ['prompt']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'social_promotion',
      description: '发布内容到社交媒体（微博、小红书等）',
      parameters: {
        type: 'object',
        properties: {
          platform: { type: 'string', enum: ['weibo', 'xiaohongshu', 'douyin'] },
          content: { type: 'string', description: '发布内容' }
        },
        required: ['platform', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'execute_code',
      description: '执行 Python/JavaScript 代码',
      parameters: {
        type: 'object',
        properties: {
          language: { type: 'string', enum: ['python', 'javascript'] },
          code: { type: 'string', description: '要执行的代码' }
        },
        required: ['code']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'execute_skill',
      description: '执行已安装的技能',
      parameters: {
        type: 'object',
        properties: {
          skill_name: { type: 'string', description: '技能名称' },
          params: { type: 'object', description: '技能参数' }
        },
        required: ['skill_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ask_user',
      description: '向用户提问以收集更多信息',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: '问题内容' },
          options: { type: 'array', items: { type: 'string' }, description: '选项列表' }
        },
        required: ['question']
      }
    }
  }
]

export class LLMService {
  private defaultApiKey: string
  private userApiKeys: Map<string, string> = new Map()
  
  private providers: Record<string, { baseUrl: string; models: string[] }> = {
    deepseek: {
      baseUrl: 'https://api.deepseek.com',
      models: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner']
    },
    qwen: {
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      models: ['qwen-turbo', 'qwen-plus', 'qwen-max']
    },
    kimi: {
      baseUrl: 'https://api.moonshot.cn/v1',
      models: ['moonshot-v1-8k', 'moonshot-v1-32k']
    }
  }

  constructor(defaultApiKey: string = '') {
    this.defaultApiKey = defaultApiKey
  }

  setUserApiKey(provider: string, apiKey: string) {
    this.userApiKeys.set(provider, apiKey)
  }

  getApiKey(provider: string): string {
    return this.userApiKeys.get(provider) || this.defaultApiKey
  }

  getAvailableModels() {
    const models: any[] = []
    for (const [provider, config] of Object.entries(this.providers)) {
      const apiKey = this.getApiKey(provider)
      for (const model of config.models) {
        models.push({
          provider,
          name: model,
          apiKey: apiKey ? `${apiKey.substring(0, 8)}...` : '',
          baseUrl: config.baseUrl,
          configured: !!apiKey
        })
      }
    }
    return models
  }

  getProviderForModel(model: string): string {
    for (const [provider, config] of Object.entries(this.providers)) {
      if (config.models.includes(model)) return provider
    }
    return 'deepseek'
  }

  async chat(message: string, history: ChatMessage[] = [], model: string = 'deepseek-chat'): Promise<AIResponse> {
    const provider = this.getProviderForModel(model)
    const apiKey = this.getApiKey(provider)
    
    if (!apiKey) {
      return {
        message: `请先配置 ${provider} API 密钥。`,
        suggestedActions: [{ action: 'config_apikey', label: '🔑 配置密钥', prompt: '配置 API 密钥', color: '#FF6B00' }]
      }
    }

    const baseUrl = this.providers[provider]?.baseUrl || 'https://api.deepseek.com'
    
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `你是智 Y.Ai，一个强大的 AI 助手。

## 核心能力
你可以通过调用工具函数来执行各种任务：

1. **浏览器自动化** (open_browser): 打开网页、搜索、提取内容、截图
2. **桌面自动化** (desktop_automation): 控制应用、鼠标键盘操作、截图
3. **文档生成** (generate_document): 创建 Word、Excel、PPT 文档
4. **图像生成** (generate_image): AI 绘图、图像编辑
5. **视频生成** (generate_video): AI 视频创作
6. **微信控制** (send_wechat_message): 发送微信消息
7. **社交发布** (social_promotion): 发布内容到社交媒体
8. **代码执行** (execute_code): 运行 Python/JavaScript 代码
9. **技能执行** (execute_skill): 执行已安装的技能

## 工具调用规则
1. 当用户请求需要执行具体任务时，**必须调用相应的工具**
2. 不要只是描述你会做什么，而是**实际调用工具**
3. 如果信息不足，可以先用默认值调用工具，或询问用户
4. 工具调用后，根据结果回复用户

## 示例
用户: "帮我写一份合同"
助手: [调用 generate_document 工具，参数: {doc_type: "word", title: "合同", content: "..."}]

用户: "打开百度"
助手: [调用 open_browser 工具，参数: {url: "https://www.baidu.com"}]

当前时间: ${new Date().toLocaleString('zh-CN')}`
      },
      ...history,
      { role: 'user' as const, content: message }
    ]

    try {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.7,
          max_tokens: 4096,
          tools: AVAILABLE_TOOLS,
          tool_choice: 'auto'
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`API 请求失败: ${response.status} - ${errorText}`)
      }

      const data = await response.json() as any
      const choice = data.choices?.[0]
      const assistantMessage = choice?.message
      
      if (assistantMessage?.tool_calls && assistantMessage.tool_calls.length > 0) {
        const toolResults: any[] = []
        
        for (const toolCall of assistantMessage.tool_calls) {
          const functionName = toolCall.function.name
          const functionArgs = JSON.parse(toolCall.function.arguments)
          
          console.log(`[LLM] Tool call: ${functionName}`, functionArgs)
          
          const result = await this.executeTool(functionName, functionArgs)
          
          toolResults.push({
            tool_call_id: toolCall.id,
            name: functionName,
            arguments: functionArgs,
            result
          })
        }
        
        const responseMessage = this.formatToolResults(toolResults)
        
        return {
          message: responseMessage,
          toolCalls: toolResults,
          suggestedActions: this.generateSuggestedActions(toolResults),
          metadata: { model, provider, usage: data.usage }
        }
      }
      
      const content = assistantMessage?.content || '抱歉，我无法生成回复。'
      
      return {
        message: content,
        suggestedActions: this.getDefaultActions(),
        metadata: { model, provider, usage: data.usage }
      }

    } catch (error: any) {
      console.error('[LLM] Chat error:', error)
      return {
        message: `抱歉，处理您的请求时出现错误：${error.message}`,
        suggestedActions: [{ action: 'retry', label: '🔄 重试', prompt: '重试', color: '#FF6B00' }]
      }
    }
  }

  private async executeTool(name: string, args: any): Promise<any> {
    try {
      const argsBase64 = Buffer.from(JSON.stringify(args)).toString('base64')
      
      switch (name) {
        case 'open_browser': {
          const cmd = `python "${PYTHON_BRIDGE}" --action open_browser --params-base64 "${argsBase64}"`
          const { stdout } = await execAsync(cmd, { timeout: 60000 })
          return this.parseResult(stdout)
        }
        
        case 'desktop_automation': {
          const cmd = `python "${PYTHON_BRIDGE}" --action desktop_automation --params-base64 "${argsBase64}"`
          const { stdout } = await execAsync(cmd, { timeout: 30000 })
          return this.parseResult(stdout)
        }
        
        case 'generate_document': {
          const cmd = `python "${PYTHON_BRIDGE}" --action generate_document --params-base64 "${argsBase64}"`
          const { stdout } = await execAsync(cmd, { timeout: 60000 })
          return this.parseResult(stdout)
        }
        
        case 'send_wechat_message': {
          const cmd = `python "${PYTHON_BRIDGE}" --action send_wechat --params-base64 "${argsBase64}"`
          const { stdout } = await execAsync(cmd, { timeout: 30000 })
          return this.parseResult(stdout)
        }
        
        case 'generate_video': {
          const cmd = `python "${PYTHON_BRIDGE}" --action generate_video --params-base64 "${argsBase64}"`
          const { stdout } = await execAsync(cmd, { timeout: 120000 })
          return this.parseResult(stdout)
        }
        
        case 'generate_image': {
          const cmd = `python "${PYTHON_BRIDGE}" --action generate_image --params-base64 "${argsBase64}"`
          const { stdout } = await execAsync(cmd, { timeout: 60000 })
          return this.parseResult(stdout)
        }
        
        case 'social_promotion': {
          const cmd = `python "${PYTHON_BRIDGE}" --action social_promotion --params-base64 "${argsBase64}"`
          const { stdout } = await execAsync(cmd, { timeout: 60000 })
          return this.parseResult(stdout)
        }
        
        case 'execute_code': {
          const cmd = `python "${PYTHON_BRIDGE}" --action execute_code --params-base64 "${argsBase64}"`
          const { stdout } = await execAsync(cmd, { timeout: 60000 })
          return this.parseResult(stdout)
        }
        
        case 'execute_skill': {
          const cmd = `python "${PYTHON_BRIDGE}" --action execute_skill --params-base64 "${argsBase64}"`
          const { stdout } = await execAsync(cmd, { timeout: 60000 })
          return this.parseResult(stdout)
        }
        
        case 'ask_user': {
          return {
            success: true,
            needsUserInput: true,
            question: args.question,
            options: args.options
          }
        }
        
        default:
          return { success: false, error: `未知工具: ${name}` }
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  private parseResult(stdout: string): any {
    const match = stdout.match(/##RESULT##\s*(\{[\s\S]*\})/)
    if (match) {
      try {
        return JSON.parse(match[1])
      } catch {
        return { success: true, raw: stdout }
      }
    }
    return { success: true, output: stdout }
  }

  private formatToolResults(results: any[]): string {
    const messages: string[] = []
    
    for (const result of results) {
      if (result.result?.needsUserInput) {
        return result.result.question
      }
      
      if (result.result?.success) {
        const desc = this.getToolDescription(result.name)
        const msg = result.result.message || result.result.output || '执行成功'
        messages.push(`✅ ${desc}: ${msg}`)
      } else {
        messages.push(`❌ ${this.getToolDescription(result.name)}: ${result.result?.error || '执行失败'}`)
      }
    }
    
    return messages.join('\n')
  }

  private getToolDescription(name: string): string {
    const descriptions: Record<string, string> = {
      'open_browser': '打开浏览器',
      'desktop_automation': '桌面自动化',
      'generate_document': '生成文档',
      'send_wechat_message': '发送微信消息',
      'generate_video': '生成视频',
      'generate_image': '生成图片',
      'social_promotion': '社交发布',
      'execute_code': '执行代码',
      'execute_skill': '执行技能',
      'ask_user': '询问用户'
    }
    return descriptions[name] || name
  }

  private generateSuggestedActions(results: any[]): any[] {
    const actions: any[] = []
    
    for (const result of results) {
      if (result.result?.options) {
        actions.push(...result.result.options.map((opt: string) => ({
          action: `select_${result.name}`,
          prompt: opt,
          label: opt,
          color: '#5A67D8'
        })))
      }
    }
    
    return actions.length > 0 ? actions : this.getDefaultActions()
  }

  private getDefaultActions(): any[] {
    return [
      { action: 'open_browser', label: '🌐 打开浏览器', prompt: '打开浏览器', color: '#5A67D8' },
      { action: 'generate_document', label: '📄 生成文档', prompt: '生成文档', color: '#F687B3' },
      { action: 'generate_image', label: '🎨 生成图片', prompt: '生成图片', color: '#00D4AA' },
      { action: 'send_wechat', label: '💬 发送微信', prompt: '发送微信消息', color: '#07C160' }
    ]
  }

  async *streamChat(message: string, history: ChatMessage[] = [], model: string = 'deepseek-chat'): AsyncGenerator<any> {
    const provider = this.getProviderForModel(model)
    const apiKey = this.getApiKey(provider)
    
    if (!apiKey) {
      throw new Error(`未配置 ${provider} API 密钥`)
    }

    const baseUrl = this.providers[provider]?.baseUrl || 'https://api.deepseek.com'
    
    const messages: ChatMessage[] = [
      { role: 'system', content: '你是智 Y.Ai，一个强大的 AI 助手。' },
      ...history,
      { role: 'user' as const, content: message }
    ]

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.7,
        max_tokens: 4096,
        stream: true
      })
    })

    if (!response.ok) {
      throw new Error(`API 请求失败: ${response.status}`)
    }

    const reader = response.body
    let buffer = ''

    for await (const chunk of reader as any) {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data:')) continue
        const data = trimmed.slice(5).trim()
        if (data === '[DONE]') return
        try {
          yield JSON.parse(data)
        } catch {}
      }
    }
  }

  async *streamChatWithTools(messages: ChatMessage[], model: string = 'deepseek-chat', tools?: any[]): AsyncGenerator<any> {
    const provider = this.getProviderForModel(model)
    const apiKey = this.getApiKey(provider)
    
    if (!apiKey) {
      throw new Error(`未配置 ${provider} API 密钥`)
    }

    const baseUrl = this.providers[provider]?.baseUrl || 'https://api.deepseek.com'
    
    const systemMessage: ChatMessage = {
      role: 'system',
      content: `你是智 Y.Ai，一个强大的 AI 助手，具备以下能力：

【浏览器自动化】打开网页、搜索、提取内容、截图
【桌面自动化】控制应用、鼠标键盘操作、截图
【文档生成】Word、Excel、PPT 文档创建和编辑
【图像生成】AI 绘图、图像编辑
【视频生成】AI 视频创作（豆包 Seedance）
【微信控制】发送消息、接收消息、自动回复
【社交发布】微博、小红书、抖音内容发布
【代码执行】Python、JavaScript 代码运行

当用户需要执行这些任务时，你应该调用相应的工具函数。
如果信息不足，使用 ask_user 工具向用户提问。`
    }
    
    const allMessages = [systemMessage, ...messages]

    const requestBody: any = {
      model,
      messages: allMessages,
      temperature: 0.7,
      max_tokens: 4096,
      stream: true
    }
    
    if (tools && tools.length > 0) {
      requestBody.tools = tools
      requestBody.tool_choice = 'auto'
    }

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      throw new Error(`API 请求失败: ${response.status}`)
    }

    const reader = response.body
    let buffer = ''

    for await (const chunk of reader as any) {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data:')) continue
        const data = trimmed.slice(5).trim()
        if (data === '[DONE]') return
        try {
          yield JSON.parse(data)
        } catch {}
      }
    }
  }
}
