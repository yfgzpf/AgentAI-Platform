/**
 * 智 Y.Ai 多智能体协作编排器
 * 
 * 核心架构：
 * ┌─────────────────────────────────────────────────────────────┐
 * │                    用户请求                                  │
 * └─────────────────────────────────────────────────────────────┘
 *                              │
 *                              ▼
 * ┌─────────────────────────────────────────────────────────────┐
 * │              主控智能体 (DeepSeek)                           │
 * │   - 理解意图                                                 │
 * │   - 分解任务                                                 │
 * │   - 决定调用哪个执行智能体                                    │
 * │   - 汇总结果                                                 │
 * └─────────────────────────────────────────────────────────────┘
 *                              │
 *        ┌─────────────────────┼─────────────────────┐
 *        ▼                     ▼                     ▼
 * ┌─────────────┐      ┌─────────────┐      ┌─────────────┐
 * │ 浏览器执行者 │      │ 视觉智能体  │      │ 文件执行者  │
 * │ (Playwright)│      │(多模态模型) │      │ (文件操作)  │
 * └─────────────┘      └─────────────┘      └─────────────┘
 * 
 * 示例流程：
 * 用户："打开淘宝找出今日热门商品"
 * 
 * 1. 主控智能体理解意图：需要打开网页 → 识别内容 → 提取信息
 * 2. 主控调用 browser.navigate('https://taobao.com')
 * 3. 主控调用 browser.screenshot() 获取截图
 * 4. 主控调用 vision.readPage(screenshot) 识别网页内容
 * 5. 主控调用 vision.findElement(screenshot, '热门商品') 定位元素
 * 6. 主控汇总结果返回用户
 */

import { EventEmitter } from 'events'
import { 
  ExecutorRegistry, 
  BaseExecutor, 
  ExecutorResult,
  BrowserExecutor,
  VisionExecutor,
  FileExecutor,
  CodeExecutor
} from './executor-agents'

export interface AgentTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: any
  }
}

export type { ExecutorResult }

export interface AgentTask {
  id: string
  type: 'browser' | 'vision' | 'file' | 'code' | 'skill' | 'composite'
  action: string
  params: any
  status: 'pending' | 'running' | 'completed' | 'failed'
  result?: ExecutorResult
  error?: string
  subTasks?: AgentTask[]
}

export interface WorkflowStep {
  executor: string
  action: string
  params: any
  condition?: (previousResults: ExecutorResult[]) => boolean
  transform?: (previousResults: ExecutorResult[]) => any
}

export interface Workflow {
  name: string
  description: string
  steps: WorkflowStep[]
}

export class MultiAgentOrchestrator extends EventEmitter {
  private executorRegistry: ExecutorRegistry
  private apiKey: string
  private apiEndpoint: string
  private model: string
  
  constructor(config: {
    apiKey?: string
    apiEndpoint?: string
    model?: string
  } = {}) {
    super()
    this.executorRegistry = new ExecutorRegistry()
    this.apiKey = config.apiKey || process.env.DEEPSEEK_API_KEY || ''
    this.apiEndpoint = config.apiEndpoint || 'https://api.deepseek.com/v1'
    this.model = config.model || 'deepseek-chat'
    
    console.log('[MultiAgentOrchestrator] 多智能体协作编排器初始化完成')
    console.log('[MultiAgentOrchestrator] 可用执行者:', Object.keys(this.executorRegistry.getDescriptions()).join(', '))
  }
  
  getExecutorTools(): AgentTool[] {
    const tools: AgentTool[] = [
      {
        type: 'function',
        function: {
          name: 'browser_navigate',
          description: '打开指定网址。当需要访问网页时使用此工具。',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string', description: '要打开的网址' }
            },
            required: ['url']
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
          name: 'browser_screenshot',
          description: '截取当前网页的截图，用于视觉分析。',
          parameters: {
            type: 'object',
            properties: {
              fullPage: { type: 'boolean', description: '是否截取整页' }
            }
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'browser_get_content',
          description: '获取当前网页的HTML内容。',
          parameters: { type: 'object', properties: {} }
        }
      },
      {
        type: 'function',
        function: {
          name: 'browser_get_elements',
          description: '获取网页上的所有可交互元素。',
          parameters: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: 'CSS选择器，默认为body' }
            }
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'browser_scroll',
          description: '滚动网页。',
          parameters: {
            type: 'object',
            properties: {
              direction: { type: 'string', enum: ['up', 'down'], description: '滚动方向' },
              amount: { type: 'number', description: '滚动像素数' }
            },
            required: ['direction']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'vision_analyze',
          description: '使用多模态模型分析图片内容。可以理解网页截图、识别文字、分析布局等。',
          parameters: {
            type: 'object',
            properties: {
              image: { type: 'string', description: '图片的base64编码' },
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
          description: '读取并理解网页截图内容，提取文本、元素位置等信息。',
          parameters: {
            type: 'object',
            properties: {
              screenshot: { type: 'string', description: '网页截图的base64编码' },
              url: { type: 'string', description: '网页URL' }
            },
            required: ['screenshot']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'vision_find_element',
          description: '在网页截图中查找特定元素。',
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
          name: 'file_read',
          description: '读取文件内容。',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '文件路径' }
            },
            required: ['path']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'file_write',
          description: '写入文件。',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '文件路径' },
              content: { type: 'string', description: '文件内容' }
            },
            required: ['path', 'content']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'code_run',
          description: '执行代码。',
          parameters: {
            type: 'object',
            properties: {
              code: { type: 'string', description: '要执行的代码' },
              language: { type: 'string', enum: ['python', 'javascript'], description: '编程语言' }
            },
            required: ['code']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'execute_workflow',
          description: '执行预定义的工作流。用于复杂的多步骤任务。',
          parameters: {
            type: 'object',
            properties: {
              workflow_name: { type: 'string', description: '工作流名称' },
              params: { type: 'object', description: '工作流参数' }
            },
            required: ['workflow_name']
          }
        }
      }
    ]
    
    return tools
  }
  
  async executeToolCall(toolName: string, params: any): Promise<ExecutorResult> {
    console.log(`[MultiAgentOrchestrator] 执行工具: ${toolName}`, JSON.stringify(params).substring(0, 200))
    
    this.emit('tool_start', { toolName, params })
    
    let result: ExecutorResult
    
    try {
      switch (toolName) {
        case 'browser_navigate':
          result = await this.executeBrowserTask('navigate', { url: params.url })
          break
        case 'browser_click':
          result = await this.executeBrowserTask('click', { selector: params.selector })
          break
        case 'browser_type':
          result = await this.executeBrowserTask('type', { selector: params.selector, text: params.text })
          break
        case 'browser_screenshot':
          result = await this.executeBrowserTask('screenshot', { fullPage: params.fullPage || false })
          break
        case 'browser_get_content':
          result = await this.executeBrowserTask('getContent', {})
          break
        case 'browser_get_elements':
          result = await this.executeBrowserTask('getElements', { selector: params.selector || 'body' })
          break
        case 'browser_scroll':
          result = await this.executeBrowserTask('scroll', { direction: params.direction, amount: params.amount || 300 })
          break
        case 'vision_analyze':
          result = await this.executeVisionTask('analyze', { image: params.image, prompt: params.prompt })
          break
        case 'vision_read_page':
          result = await this.executeVisionTask('readPage', { screenshot: params.screenshot, url: params.url || '' })
          break
        case 'vision_find_element':
          result = await this.executeVisionTask('findElement', { screenshot: params.screenshot, description: params.description })
          break
        case 'file_read':
          result = await this.executeFileTask('read', { path: params.path })
          break
        case 'file_write':
          result = await this.executeFileTask('write', { path: params.path, content: params.content })
          break
        case 'code_run':
          result = await this.executeCodeTask('run', { code: params.code, language: params.language || 'python' })
          break
        case 'execute_workflow':
          result = await this.executeWorkflow(params.workflow_name, params.params || {})
          break
        default:
          result = { success: false, error: `未知工具: ${toolName}` }
      }
    } catch (error: any) {
      result = { success: false, error: error.message }
    }
    
    this.emit('tool_end', { toolName, result })
    
    console.log(`[MultiAgentOrchestrator] 工具执行完成: ${toolName}, 成功: ${result.success}`)
    
    return result
  }
  
  private async executeBrowserTask(action: string, params: any): Promise<ExecutorResult> {
    const executor = this.executorRegistry.get('browser')
    if (!executor) {
      return { success: false, error: '浏览器执行者未注册' }
    }
    return executor.execute(action, params)
  }
  
  private async executeVisionTask(action: string, params: any): Promise<ExecutorResult> {
    const executor = this.executorRegistry.get('vision')
    if (!executor) {
      return { success: false, error: '视觉智能体未注册' }
    }
    return executor.execute(action, params)
  }
  
  private async executeFileTask(action: string, params: any): Promise<ExecutorResult> {
    const executor = this.executorRegistry.get('file')
    if (!executor) {
      return { success: false, error: '文件执行者未注册' }
    }
    return executor.execute(action, params)
  }
  
  private async executeCodeTask(action: string, params: any): Promise<ExecutorResult> {
    const executor = this.executorRegistry.get('code')
    if (!executor) {
      return { success: false, error: '代码执行者未注册' }
    }
    return executor.execute(action, params)
  }
  
  async executeWorkflow(workflowName: string, params: any): Promise<ExecutorResult> {
    const workflows: Record<string, Workflow> = {
      'web_scrape': {
        name: 'web_scrape',
        description: '打开网页并提取内容',
        steps: [
          { executor: 'browser', action: 'navigate', params: { url: params.url } },
          { executor: 'browser', action: 'screenshot', params: { fullPage: true } },
          { executor: 'vision', action: 'readPage', params: { screenshot: '${previous.screenshots[0]}', url: params.url } }
        ]
      },
      'web_search_and_extract': {
        name: 'web_search_and_extract',
        description: '搜索并提取网页信息',
        steps: [
          { executor: 'browser', action: 'navigate', params: { url: params.url } },
          { executor: 'browser', action: 'screenshot', params: { fullPage: false } },
          { executor: 'vision', action: 'findElement', params: { screenshot: '${previous.screenshots[0]}', description: params.targetDescription } }
        ]
      },
      'fill_form': {
        name: 'fill_form',
        description: '填写网页表单',
        steps: [
          { executor: 'browser', action: 'navigate', params: { url: params.url } },
          { executor: 'browser', action: 'type', params: { selector: params.inputSelector, text: params.inputText } },
          { executor: 'browser', action: 'click', params: { selector: params.submitSelector } }
        ]
      }
    }
    
    const workflow = workflows[workflowName]
    if (!workflow) {
      return { success: false, error: `工作流不存在: ${workflowName}` }
    }
    
    const results: ExecutorResult[] = []
    
    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i]
      let stepParams = { ...step.params }
      
      if (i > 0 && stepParams.screenshot && stepParams.screenshot.includes('${previous')) {
        const prevResult = results[i - 1]
        if (prevResult.screenshots && prevResult.screenshots.length > 0) {
          stepParams.screenshot = prevResult.screenshots[0]
        }
      }
      
      const result = await this.executeToolCall(
        `${step.executor}_${step.action}` as any,
        stepParams
      )
      
      results.push(result)
      
      if (!result.success) {
        return {
          success: false,
          error: `工作流步骤 ${i + 1} 失败: ${result.error}`,
          data: { completedSteps: results }
        }
      }
    }
    
    return {
      success: true,
      data: { results },
      output: results.map((r, i) => `步骤 ${i + 1}: ${r.output || '完成'}`).join('\n')
    }
  }
  
  buildSystemPrompt(): string {
    const executorDescriptions = this.executorRegistry.getDescriptions()
    
    return `你是智 Y.Ai，一个强大的多智能体协作系统的主控智能体。

## 你的角色
你是整个系统的"大脑"，负责：
1. 理解用户意图
2. 分解复杂任务
3. 调度执行智能体完成具体操作
4. 汇总结果并返回给用户

## 可用的执行智能体
${Object.entries(executorDescriptions).map(([name, desc]) => `- **${name}**: ${desc}`).join('\n')}

## 工作流程
当用户提出请求时，你需要：
1. 分析请求需要哪些执行智能体配合
2. 按顺序调用相应的工具
3. 根据执行结果决定下一步操作
4. 最终汇总结果返回用户

## 示例场景

**用户**: "打开淘宝找出今日热门商品"

**你的思考过程**:
1. 需要打开淘宝网页 → 调用 browser_navigate
2. 需要看到网页内容 → 调用 browser_screenshot
3. 需要理解截图内容 → 调用 vision_read_page
4. 需要找到热门商品 → 调用 vision_find_element
5. 汇总结果返回用户

**重要提示**:
- 浏览器操作后，必须截图才能让视觉智能体"看到"网页内容
- 视觉智能体需要图片的base64编码，这通常来自截图结果
- 你是主控，执行智能体是你的"手脚"和"眼睛"

请根据用户的请求，自主决定调用哪些工具来完成任务的。`
  }
  
  async processWithLLM(userMessage: string, conversationHistory: any[] = []): Promise<string> {
    const systemPrompt = this.buildSystemPrompt()
    const tools = this.getExecutorTools()
    
    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory,
      { role: 'user', content: userMessage }
    ]
    
    let currentResponse = ''
    let iterations = 0
    const maxIterations = 10
    
    while (iterations < maxIterations) {
      iterations++
      
      const response = await fetch(`${this.apiEndpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          tools,
          tool_choice: 'auto',
          temperature: 0.7,
          max_tokens: 4096
        })
      })
      
      if (!response.ok) {
        throw new Error(`LLM API 错误: ${response.status}`)
      }
      
      const data = await response.json() as any
      const assistantMessage = data.choices[0].message
      
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        messages.push(assistantMessage)
        
        for (const toolCall of assistantMessage.tool_calls) {
          const toolName = toolCall.function.name
          const toolInput = JSON.parse(toolCall.function.arguments)
          
          console.log(`[MultiAgentOrchestrator] LLM 调用工具: ${toolName}`)
          
          const toolResult = await this.executeToolCall(toolName, toolInput)
          
          messages.push({
            role: 'tool',
            content: JSON.stringify(toolResult),
            tool_call_id: toolCall.id
          })
        }
        
        continue
      }
      
      currentResponse = assistantMessage.content || ''
      break
    }
    
    return currentResponse
  }
}
