/**
 * 智 Y.Ai 工作流编排系统
 * 
 * 核心功能：AI自主编制和执行工作流
 * 
 * 示例：
 * 用户："帮我制作一个视频"
 * AI自主编制工作流：
 * 1. 剧本写作（调用LLM生成剧本）
 * 2. 分镜生成（调用图像生成API）
 * 3. 视频合成（调用视频生成API）
 * 4. 配音合成（调用TTS API）
 * 
 * 工作流可以嵌套、并行、条件分支
 */

import { EventEmitter } from 'events'

export interface WorkflowStep {
  id: string
  name: string
  type: 'tool' | 'skill' | 'llm' | 'workflow' | 'parallel' | 'condition'
  action: string
  params: Record<string, any>
  dependsOn?: string[]
  condition?: (context: WorkflowContext) => boolean
  onResult?: (result: any, context: WorkflowContext) => void
  retryCount?: number
  timeout?: number
}

export interface WorkflowDefinition {
  id: string
  name: string
  description: string
  steps: WorkflowStep[]
  inputs: string[]
  outputs: string[]
}

export interface WorkflowContext {
  workflowId: string
  inputs: Record<string, any>
  outputs: Record<string, any>
  stepResults: Map<string, any>
  variables: Record<string, any>
  metadata: Record<string, any>
}

export interface WorkflowExecution {
  id: string
  workflowId: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused'
  currentStep: string | null
  completedSteps: string[]
  failedStep: string | null
  error: string | null
  context: WorkflowContext
  startedAt: number
  completedAt: number | null
}

export class WorkflowOrchestrator extends EventEmitter {
  private workflows: Map<string, WorkflowDefinition> = new Map()
  private executions: Map<string, WorkflowExecution> = new Map()
  private toolExecutor: (toolName: string, params: any) => Promise<any>
  private skillExecutor: (skillName: string, params: any) => Promise<any>
  private llmExecutor: (prompt: string, context: any) => Promise<string>
  
  constructor(config: {
    toolExecutor: (toolName: string, params: any) => Promise<any>
    skillExecutor: (skillName: string, params: any) => Promise<any>
    llmExecutor: (prompt: string, context: any) => Promise<string>
  }) {
    super()
    this.toolExecutor = config.toolExecutor
    this.skillExecutor = config.skillExecutor
    this.llmExecutor = config.llmExecutor
    
    this.registerBuiltinWorkflows()
    console.log('[WorkflowOrchestrator] 工作流编排系统初始化完成')
  }
  
  private registerBuiltinWorkflows(): void {
    this.registerWorkflow({
      id: 'video-production',
      name: '视频制作工作流',
      description: '从剧本到成片的完整视频制作流程',
      inputs: ['theme', 'duration', 'style'],
      outputs: ['videoPath', 'scriptPath'],
      steps: [
        {
          id: 'write-script',
          name: '剧本写作',
          type: 'llm',
          action: 'generate',
          params: {
            prompt: '请根据主题"${inputs.theme}"创作一个${inputs.duration}分钟的${inputs.style}风格视频剧本，包含场景描述、对白、镜头指示。以JSON格式输出。'
          }
        },
        {
          id: 'generate-storyboard',
          name: '分镜生成',
          type: 'skill',
          action: 'storyboard-generator',
          params: {
            script: '${stepResults.write-script}'
          },
          dependsOn: ['write-script']
        },
        {
          id: 'generate-video',
          name: '视频生成',
          type: 'skill',
          action: 'seedance-video',
          params: {
            storyboard: '${stepResults.generate-storyboard}'
          },
          dependsOn: ['generate-storyboard']
        },
        {
          id: 'add-audio',
          name: '配音合成',
          type: 'skill',
          action: 'tts-synthesis',
          params: {
            text: '${stepResults.write-script}',
            video: '${stepResults.generate-video}'
          },
          dependsOn: ['generate-video', 'write-script']
        }
      ]
    })
    
    this.registerWorkflow({
      id: 'web-automation',
      name: '网页自动化工作流',
      description: '打开网页、识别内容、提取数据',
      inputs: ['url', 'target'],
      outputs: ['data'],
      steps: [
        {
          id: 'navigate',
          name: '打开网页',
          type: 'tool',
          action: 'browser_navigate',
          params: {
            url: '${inputs.url}'
          }
        },
        {
          id: 'screenshot',
          name: '截图',
          type: 'tool',
          action: 'browser_screenshot',
          params: {
            fullPage: true
          },
          dependsOn: ['navigate']
        },
        {
          id: 'analyze',
          name: '分析内容',
          type: 'tool',
          action: 'vision_analyze',
          params: {
            image: '${stepResults.screenshot.screenshots[0]}',
            prompt: '请分析这个网页，提取"${inputs.target}"相关信息。以JSON格式返回。'
          },
          dependsOn: ['screenshot']
        }
      ]
    })
    
    this.registerWorkflow({
      id: 'document-generation',
      name: '文档生成工作流',
      description: '根据需求生成专业文档',
      inputs: ['docType', 'content', 'template'],
      outputs: ['documentPath'],
      steps: [
        {
          id: 'analyze-requirements',
          name: '分析需求',
          type: 'llm',
          action: 'analyze',
          params: {
            prompt: '分析以下文档需求，提取关键信息和结构：${inputs.content}'
          }
        },
        {
          id: 'generate-content',
          name: '生成内容',
          type: 'llm',
          action: 'generate',
          params: {
            prompt: '根据分析结果，生成${inputs.docType}文档内容：${stepResults.analyze-requirements}'
          },
          dependsOn: ['analyze-requirements']
        },
        {
          id: 'format-document',
          name: '格式化文档',
          type: 'skill',
          action: 'doc-generator',
          params: {
            content: '${stepResults.generate-content}',
            template: '${inputs.template}'
          },
          dependsOn: ['generate-content']
        }
      ]
    })
    
    this.registerWorkflow({
      id: 'research-workflow',
      name: '研究分析工作流',
      description: '搜索、收集、分析、总结',
      inputs: ['topic', 'depth'],
      outputs: ['report'],
      steps: [
        {
          id: 'search',
          name: '搜索信息',
          type: 'tool',
          action: 'web_search',
          params: {
            query: '${inputs.topic}'
          }
        },
        {
          id: 'collect',
          name: '收集资料',
          type: 'parallel',
          action: 'parallel',
          params: {
            steps: [
              {
                id: 'collect-1',
                type: 'tool',
                action: 'browser_navigate',
                params: { url: '${stepResults.search[0].url}' }
              },
              {
                id: 'collect-2',
                type: 'tool',
                action: 'browser_navigate',
                params: { url: '${stepResults.search[1].url}' }
              }
            ]
          },
          dependsOn: ['search']
        },
        {
          id: 'analyze',
          name: '分析整合',
          type: 'llm',
          action: 'analyze',
          params: {
            prompt: '请分析以下收集的资料，深度${inputs.depth}：${stepResults.collect}'
          },
          dependsOn: ['collect']
        },
        {
          id: 'report',
          name: '生成报告',
          type: 'skill',
          action: 'doc-generator',
          params: {
            content: '${stepResults.analyze}',
            template: 'report'
          },
          dependsOn: ['analyze']
        }
      ]
    })
  }
  
  registerWorkflow(workflow: WorkflowDefinition): void {
    this.workflows.set(workflow.id, workflow)
    console.log(`[WorkflowOrchestrator] 注册工作流: ${workflow.name}`)
  }
  
  getWorkflow(id: string): WorkflowDefinition | undefined {
    return this.workflows.get(id)
  }
  
  listWorkflows(): WorkflowDefinition[] {
    return Array.from(this.workflows.values())
  }
  
  async createWorkflowFromPrompt(userPrompt: string): Promise<WorkflowDefinition> {
    const prompt = `你是一个工作流设计专家。用户需求如下：

"${userPrompt}"

请设计一个工作流来完成这个任务。以JSON格式返回工作流定义：

{
  "id": "workflow-id",
  "name": "工作流名称",
  "description": "工作流描述",
  "inputs": ["输入参数列表"],
  "outputs": ["输出参数列表"],
  "steps": [
    {
      "id": "step-id",
      "name": "步骤名称",
      "type": "tool|skill|llm|parallel|condition",
      "action": "要执行的动作",
      "params": { "参数": "值" },
      "dependsOn": ["依赖的步骤id"]
    }
  ]
}

可用的工具类型：
- tool: 内置工具（browser_navigate, browser_screenshot, vision_analyze, file_read, file_write等）
- skill: 技能（doc-generator, seedance-video, storyboard-generator等）
- llm: 调用大模型生成内容
- parallel: 并行执行多个步骤
- condition: 条件分支

请只返回JSON，不要有其他内容。`

    const result = await this.llmExecutor(prompt, {})
    
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const workflow = JSON.parse(jsonMatch[0]) as WorkflowDefinition
        this.registerWorkflow(workflow)
        return workflow
      }
    } catch (error) {
      console.error('[WorkflowOrchestrator] 解析工作流失败:', error)
    }
    
    throw new Error('无法创建工作流')
  }
  
  async executeWorkflow(workflowId: string, inputs: Record<string, any>): Promise<WorkflowExecution> {
    const workflow = this.workflows.get(workflowId)
    if (!workflow) {
      throw new Error(`工作流不存在: ${workflowId}`)
    }
    
    const executionId = `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const context: WorkflowContext = {
      workflowId,
      inputs,
      outputs: {},
      stepResults: new Map(),
      variables: {},
      metadata: {}
    }
    
    const execution: WorkflowExecution = {
      id: executionId,
      workflowId,
      status: 'running',
      currentStep: null,
      completedSteps: [],
      failedStep: null,
      error: null,
      context,
      startedAt: Date.now(),
      completedAt: null
    }
    
    this.executions.set(executionId, execution)
    this.emit('execution_started', { executionId, workflowId })
    
    try {
      const sortedSteps = this.topologicalSort(workflow.steps)
      
      for (const step of sortedSteps) {
        if (execution.status !== 'running') break
        
        execution.currentStep = step.id
        this.emit('step_started', { executionId, stepId: step.id })
        
        try {
          const params = this.resolveParams(step.params, context)
          let result: any
          
          switch (step.type) {
            case 'tool':
              result = await this.toolExecutor(step.action, params)
              break
            case 'skill':
              result = await this.skillExecutor(step.action, params)
              break
            case 'llm':
              result = await this.llmExecutor(params.prompt || '', context)
              break
            case 'parallel':
              result = await this.executeParallel(params.steps || [], context)
              break
            case 'condition':
              result = await this.executeCondition(step, context)
              break
            default:
              throw new Error(`未知步骤类型: ${step.type}`)
          }
          
          context.stepResults.set(step.id, result)
          execution.completedSteps.push(step.id)
          
          if (step.onResult) {
            step.onResult(result, context)
          }
          
          this.emit('step_completed', { executionId, stepId: step.id, result })
          
        } catch (error: any) {
          execution.status = 'failed'
          execution.failedStep = step.id
          execution.error = error.message
          this.emit('step_failed', { executionId, stepId: step.id, error: error.message })
          throw error
        }
      }
      
      execution.status = 'completed'
      execution.completedAt = Date.now()
      this.emit('execution_completed', { executionId, context })
      
    } catch (error: any) {
      execution.error = error.message
      this.emit('execution_failed', { executionId, error: error.message })
    }
    
    return execution
  }
  
  private topologicalSort(steps: WorkflowStep[]): WorkflowStep[] {
    const sorted: WorkflowStep[] = []
    const visited = new Set<string>()
    const stepMap = new Map(steps.map(s => [s.id, s]))
    
    const visit = (stepId: string) => {
      if (visited.has(stepId)) return
      visited.add(stepId)
      
      const step = stepMap.get(stepId)
      if (step?.dependsOn) {
        for (const dep of step.dependsOn) {
          visit(dep)
        }
      }
      
      if (step) {
        sorted.push(step)
      }
    }
    
    for (const step of steps) {
      visit(step.id)
    }
    
    return sorted
  }
  
  private resolveParams(params: Record<string, any>, context: WorkflowContext): Record<string, any> {
    const resolved: Record<string, any> = {}
    
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string') {
        resolved[key] = this.resolveTemplate(value, context)
      } else if (typeof value === 'object' && value !== null) {
        resolved[key] = this.resolveParams(value, context)
      } else {
        resolved[key] = value
      }
    }
    
    return resolved
  }
  
  private resolveTemplate(template: string, context: WorkflowContext): string {
    return template.replace(/\$\{([^}]+)\}/g, (_, path) => {
      const parts = path.split('.')
      let value: any = context
      
      for (const part of parts) {
        if (value instanceof Map) {
          value = value.get(part)
        } else if (value && typeof value === 'object') {
          if (part.includes('[')) {
            const match = part.match(/^(\w+)\[(\d+)\]$/)
            if (match) {
              value = value[match[1]]?.[parseInt(match[2])]
            } else {
              value = value[part]
            }
          } else {
            value = value[part]
          }
        } else {
          return ''
        }
      }
      
      return value !== undefined ? String(value) : ''
    })
  }
  
  private async executeParallel(steps: WorkflowStep[], context: WorkflowContext): Promise<any[]> {
    const promises = steps.map(step => {
      const params = this.resolveParams(step.params, context)
      
      switch (step.type) {
        case 'tool':
          return this.toolExecutor(step.action, params)
        case 'skill':
          return this.skillExecutor(step.action, params)
        case 'llm':
          return this.llmExecutor(params.prompt || '', context)
        default:
          return Promise.resolve(null)
      }
    })
    
    return Promise.all(promises)
  }
  
  private async executeCondition(step: WorkflowStep, context: WorkflowContext): Promise<any> {
    if (step.condition && !step.condition(context)) {
      return null
    }
    
    const params = this.resolveParams(step.params, context)
    
    switch (step.type) {
      case 'tool':
        return this.toolExecutor(step.action, params)
      case 'skill':
        return this.skillExecutor(step.action, params)
      case 'llm':
        return this.llmExecutor(params.prompt || '', context)
      default:
        return null
    }
  }
  
  getExecution(executionId: string): WorkflowExecution | undefined {
    return this.executions.get(executionId)
  }
  
  pauseExecution(executionId: string): void {
    const execution = this.executions.get(executionId)
    if (execution && execution.status === 'running') {
      execution.status = 'paused'
      this.emit('execution_paused', { executionId })
    }
  }
  
  resumeExecution(executionId: string): void {
    const execution = this.executions.get(executionId)
    if (execution && execution.status === 'paused') {
      execution.status = 'running'
      this.emit('execution_resumed', { executionId })
    }
  }
  
  cancelExecution(executionId: string): void {
    const execution = this.executions.get(executionId)
    if (execution) {
      execution.status = 'failed'
      execution.error = '用户取消'
      this.emit('execution_cancelled', { executionId })
    }
  }
}
