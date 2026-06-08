import { v4 as uuidv4 } from 'uuid'
import { EventEmitter } from 'events'

export interface TaskStep {
  id: string
  name: string
  description: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'waiting_input'
  progress: number
  startedAt?: string
  completedAt?: string
  result?: any
  error?: string
  skillName?: string
  question?: string
  options?: string[]
}

export interface Task {
  id: string
  sessionId: string
  type: string
  description: string
  status: 'pending' | 'planning' | 'executing' | 'waiting' | 'completed' | 'failed'
  steps: TaskStep[]
  currentStepIndex: number
  progress: number
  createdAt: string
  updatedAt: string
  result?: any
  metadata?: any
}

export interface AgentState {
  name: string
  status: 'idle' | 'thinking' | 'executing' | 'waiting'
  currentTask?: string
  currentSkill?: string
  thinking?: string
}

class TaskOrchestrator extends EventEmitter {
  private tasks: Map<string, Task> = new Map()
  private agentState: AgentState = {
    name: '智 Y',
    status: 'idle'
  }
  
  createTask(sessionId: string, type: string, description: string): Task {
    const task: Task = {
      id: uuidv4(),
      sessionId,
      type,
      description,
      status: 'pending',
      steps: [],
      currentStepIndex: 0,
      progress: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    
    this.tasks.set(task.id, task)
    this.emit('task_created', task)
    
    return task
  }
  
  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId)
  }
  
  getTasksBySession(sessionId: string): Task[] {
    return Array.from(this.tasks.values()).filter(t => t.sessionId === sessionId)
  }
  
  startPlanning(taskId: string): void {
    const task = this.tasks.get(taskId)
    if (!task) return
    
    task.status = 'planning'
    task.updatedAt = new Date().toISOString()
    
    this.updateAgentState({
      status: 'thinking',
      currentTask: taskId,
      thinking: '正在分析任务需求...'
    })
    
    this.emit('task_updated', task)
  }
  
  setPlan(taskId: string, steps: Omit<TaskStep, 'id' | 'status' | 'progress'>[]): void {
    const task = this.tasks.get(taskId)
    if (!task) return
    
    task.steps = steps.map(step => ({
      ...step,
      id: uuidv4(),
      status: 'pending' as const,
      progress: 0
    }))
    
    task.status = 'executing'
    task.updatedAt = new Date().toISOString()
    
    this.emit('task_updated', task)
    this.emit('plan_ready', task)
  }
  
  startStep(taskId: string, stepIndex: number): void {
    const task = this.tasks.get(taskId)
    if (!task || stepIndex >= task.steps.length) return
    
    const step = task.steps[stepIndex]
    step.status = 'running'
    step.startedAt = new Date().toISOString()
    step.progress = 0
    
    task.currentStepIndex = stepIndex
    task.updatedAt = new Date().toISOString()
    
    this.updateAgentState({
      status: 'executing',
      currentTask: taskId,
      currentSkill: step.skillName,
      thinking: `正在执行: ${step.name}`
    })
    
    this.emit('task_updated', task)
    this.emit('step_started', { task, step })
  }
  
  updateStepProgress(taskId: string, stepIndex: number, progress: number): void {
    const task = this.tasks.get(taskId)
    if (!task || stepIndex >= task.steps.length) return
    
    const step = task.steps[stepIndex]
    step.progress = Math.min(100, Math.max(0, progress))
    task.progress = this.calculateOverallProgress(task)
    task.updatedAt = new Date().toISOString()
    
    this.emit('task_updated', task)
  }
  
  completeStep(taskId: string, stepIndex: number, result?: any): void {
    const task = this.tasks.get(taskId)
    if (!task || stepIndex >= task.steps.length) return
    
    const step = task.steps[stepIndex]
    step.status = 'completed'
    step.progress = 100
    step.completedAt = new Date().toISOString()
    step.result = result
    
    task.progress = this.calculateOverallProgress(task)
    task.updatedAt = new Date().toISOString()
    
    this.emit('task_updated', task)
    this.emit('step_completed', { task, step })
    
    if (stepIndex < task.steps.length - 1) {
      this.startStep(taskId, stepIndex + 1)
    } else {
      this.completeTask(taskId)
    }
  }
  
  failStep(taskId: string, stepIndex: number, error: string): void {
    const task = this.tasks.get(taskId)
    if (!task || stepIndex >= task.steps.length) return
    
    const step = task.steps[stepIndex]
    step.status = 'failed'
    step.error = error
    step.completedAt = new Date().toISOString()
    
    task.status = 'failed'
    task.updatedAt = new Date().toISOString()
    
    this.updateAgentState({
      status: 'idle',
      currentTask: undefined,
      currentSkill: undefined
    })
    
    this.emit('task_updated', task)
    this.emit('step_failed', { task, step, error })
  }
  
  waitForInput(taskId: string, stepIndex: number, question: string, options?: string[]): void {
    const task = this.tasks.get(taskId)
    if (!task || stepIndex >= task.steps.length) return
    
    const step = task.steps[stepIndex]
    step.status = 'waiting_input'
    step.question = question
    step.options = options
    
    task.status = 'waiting'
    task.updatedAt = new Date().toISOString()
    
    this.updateAgentState({
      status: 'waiting',
      currentTask: taskId,
      thinking: question
    })
    
    this.emit('task_updated', task)
    this.emit('input_required', { task, step, question, options })
  }
  
  provideInput(taskId: string, stepIndex: number, input: string): void {
    const task = this.tasks.get(taskId)
    if (!task || stepIndex >= task.steps.length) return
    
    const step = task.steps[stepIndex]
    step.status = 'running'
    step.result = { userInput: input }
    
    task.status = 'executing'
    task.updatedAt = new Date().toISOString()
    
    this.updateAgentState({
      status: 'executing',
      currentTask: taskId,
      thinking: `收到用户输入，继续执行...`
    })
    
    this.emit('task_updated', task)
    this.emit('input_received', { task, step, input })
  }
  
  completeTask(taskId: string, result?: any): void {
    const task = this.tasks.get(taskId)
    if (!task) return
    
    task.status = 'completed'
    task.progress = 100
    task.result = result
    task.updatedAt = new Date().toISOString()
    
    this.updateAgentState({
      status: 'idle',
      currentTask: undefined,
      currentSkill: undefined,
      thinking: undefined
    })
    
    this.emit('task_completed', task)
  }
  
  getAgentState(): AgentState {
    return { ...this.agentState }
  }
  
  private updateAgentState(updates: Partial<AgentState>): void {
    this.agentState = { ...this.agentState, ...updates }
    this.emit('agent_state_changed', this.agentState)
  }
  
  private calculateOverallProgress(task: Task): number {
    if (task.steps.length === 0) return 0
    
    const totalProgress = task.steps.reduce((sum, step) => sum + step.progress, 0)
    return Math.round(totalProgress / task.steps.length)
  }
  
  generatePlanFromIntent(intent: string, description: string): Omit<TaskStep, 'id' | 'status' | 'progress'>[] {
    const planTemplates: Record<string, Omit<TaskStep, 'id' | 'status' | 'progress'>[]> = {
      'generate_word': [
        { name: '分析需求', description: '理解用户文档需求', skillName: 'intent-analyzer' },
        { name: '收集信息', description: '收集文档所需信息', skillName: 'guidance', question: '请提供文档标题' },
        { name: '生成文档', description: '调用文档生成技能', skillName: 'doc-generator' },
        { name: '验证结果', description: '检查生成的文档', skillName: 'validator' }
      ],
      'generate_excel': [
        { name: '分析需求', description: '理解表格需求', skillName: 'intent-analyzer' },
        { name: '收集数据', description: '收集表格数据', skillName: 'guidance' },
        { name: '生成表格', description: '创建Excel文件', skillName: 'excel-generator' },
        { name: '格式优化', description: '优化表格格式', skillName: 'formatter' }
      ],
      'generate_image': [
        { name: '解析描述', description: '理解图像描述', skillName: 'intent-analyzer' },
        { name: '优化提示词', description: '生成图像生成提示词', skillName: 'prompt-optimizer' },
        { name: '生成图像', description: '调用图像生成API', skillName: 'image-generator' },
        { name: '返回结果', description: '展示生成的图像', skillName: 'presenter' }
      ],
      'generate_video': [
        { name: '解析需求', description: '理解视频需求', skillName: 'intent-analyzer' },
        { name: '生成脚本', description: '创建视频脚本', skillName: 'script-writer' },
        { name: '生成视频', description: '调用视频生成API', skillName: 'seedance-video' },
        { name: '返回结果', description: '展示生成的视频', skillName: 'presenter' }
      ],
      'web_automation': [
        { name: '解析指令', description: '理解浏览器操作需求', skillName: 'intent-analyzer' },
        { name: '执行操作', description: '控制浏览器执行任务', skillName: 'browser-auto' },
        { name: '获取结果', description: '提取操作结果', skillName: 'data-extractor' }
      ],
      'chat': [
        { name: '理解意图', description: '分析用户意图', skillName: 'intent-analyzer' },
        { name: '生成回复', description: '调用AI生成回复', skillName: 'llm-service' }
      ]
    }
    
    return planTemplates[intent] || planTemplates['chat']
  }
}

export const taskOrchestrator = new TaskOrchestrator()
