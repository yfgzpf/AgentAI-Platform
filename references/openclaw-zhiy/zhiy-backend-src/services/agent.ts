import { LLMService, AIResponse, ChatMessage } from './llm'
import { SkillExecutor, SkillResult } from './skills'
import { IntentAnalyzer, IntentResult } from './intent_analyzer'
import { IndustryManager, IndustryConfig, FieldConfig } from './industry_manager'

interface SuggestedAction {
  action: string
  prompt: string
  label: string
  color: string
}

export interface AgentContext {
  sessionId: string
  industry?: string
  taskType?: string
  intent?: string
  skillName?: string
  collectedFields: Record<string, any>
  missingFields: string[]
  history: ChatMessage[]
  awaitingConfirmation: boolean
  suggestedIndustries?: string[]
}

export class AgentOrchestrator {
  private llmService: LLMService
  private skillExecutor: SkillExecutor
  private intentAnalyzer: IntentAnalyzer
  private industryManager: IndustryManager
  private contexts: Map<string, AgentContext> = new Map()
  
  constructor(llmService: LLMService, skillExecutor: SkillExecutor) {
    this.llmService = llmService
    this.skillExecutor = skillExecutor
    this.intentAnalyzer = new IntentAnalyzer()
    this.industryManager = new IndustryManager()
  }
  
  getContext(sessionId: string): AgentContext {
    if (!this.contexts.has(sessionId)) {
      this.contexts.set(sessionId, {
        sessionId,
        collectedFields: {},
        missingFields: [],
        history: [],
        awaitingConfirmation: false
      })
    }
    return this.contexts.get(sessionId)!
  }
  
  updateContext(sessionId: string, updates: Partial<AgentContext>): AgentContext {
    const context = this.getContext(sessionId)
    Object.assign(context, updates)
    return context
  }
  
  clearContext(sessionId: string): void {
    this.contexts.delete(sessionId)
  }
  
  async processMessage(
    message: string, 
    sessionId: string, 
    history: ChatMessage[] = [],
    model: string = 'deepseek-chat'
  ): Promise<AIResponse> {
    const context = this.getContext(sessionId)
    context.history = history
    
    if (context.awaitingConfirmation) {
      if (message.includes('确认') || message.includes('是的') || message.includes('对')) {
        context.awaitingConfirmation = false
        return this.executeSkillAndRespond(context, model)
      } else if (message.includes('修改') || message.includes('重新')) {
        context.awaitingConfirmation = false
        context.missingFields = Object.keys(context.collectedFields)
        context.collectedFields = {}
        return this.askForNextField(context)
      } else {
        context.awaitingConfirmation = false
        context.collectedFields = {}
        context.missingFields = []
        return this.handleChatIntent(message, sessionId, history, model)
      }
    }
    
    if (context.missingFields.length > 0) {
      const currentField = context.missingFields[0]
      context.collectedFields[currentField] = this.parseFieldValue(message, currentField)
      context.missingFields = context.missingFields.slice(1)
      
      if (context.missingFields.length > 0) {
        return this.askForNextField(context)
      } else {
        return this.confirmAndExecute(context, model)
      }
    }
    
    if (context.suggestedIndustries && context.suggestedIndustries.length > 0) {
      const selectedIndustry = this.matchIndustry(message, context.suggestedIndustries)
      if (selectedIndustry) {
        context.industry = selectedIndustry
        context.suggestedIndustries = undefined
        return this.askForTaskType(selectedIndustry, context)
      }
    }
    
    const intent = this.intentAnalyzer.analyze(message, context.industry)
    console.log(`[Agent] Intent analyzed:`, intent)
    
    if (intent.intent !== 'chat' && intent.skillName) {
      return this.handleSkillIntent(message, sessionId, intent, model)
    }
    
    if (intent.intent === 'chat' && this.mightNeedGuidance(message)) {
      return this.startGuidance(message, context, model)
    }
    
    return this.handleChatIntent(message, sessionId, history, model)
  }
  
  private mightNeedGuidance(message: string): boolean {
    const guidanceKeywords = [
      '合同', '报价', '文档', '报告', '方案', '计划',
      '生成', '制作', '创建', '写', '帮我',
      '效果图', '设计', '装修', '建材', '美容', '汽修'
    ]
    return guidanceKeywords.some(kw => message.includes(kw))
  }
  
  private async startGuidance(message: string, context: AgentContext, model: string): Promise<AIResponse> {
    const industries = this.industryManager.getIndustries()
    
    if (industries.length > 0 && !context.industry) {
      const matchedIndustries = this.matchIndustriesFromMessage(message, industries)
      
      if (matchedIndustries.length === 1) {
        context.industry = matchedIndustries[0].id
        return this.askForTaskType(matchedIndustries[0].id, context)
      } else if (matchedIndustries.length > 1) {
        context.suggestedIndustries = matchedIndustries.map(i => i.id)
        return this.askForIndustry(matchedIndustries)
      } else {
        context.suggestedIndustries = industries.map(i => i.id)
        return this.askForIndustry(industries)
      }
    }
    
    return this.handleChatIntent(message, context.sessionId, context.history, model)
  }
  
  private matchIndustriesFromMessage(message: string, industries: { id: string; name: string; description?: string }[]): { id: string; name: string; description?: string }[] {
    const industryKeywords: Record<string, string[]> = {
      'construction': ['装修', '建材', '装饰', '施工', '合同', '报价'],
      'beauty': ['美容', '美发', '护肤', 'SPA', '预约'],
      'auto': ['汽修', '汽车', '保养', '维修', '4S']
    }
    
    const matched: { id: string; name: string; description?: string }[] = []
    for (const industry of industries) {
      const keywords = industryKeywords[industry.id] || []
      if (keywords.some(kw => message.includes(kw))) {
        matched.push(industry)
      }
    }
    return matched
  }
  
  private matchIndustry(message: string, industries: { id: string; name: string; description?: string }[] | string[]): string | null {
    const lowerMessage = message.toLowerCase()
    
    if (Array.isArray(industries) && industries.length > 0) {
      if (typeof industries[0] === 'string') {
        for (const industryId of industries as string[]) {
          if (lowerMessage.includes(industryId.toLowerCase())) {
            return industryId
          }
        }
      } else {
        for (const industry of industries as { id: string; name: string }[]) {
          if (lowerMessage.includes(industry.id.toLowerCase()) || 
              lowerMessage.includes(industry.name)) {
            return industry.id
          }
        }
      }
    }
    return null
  }
  
  private getIndustryDisplayName(industry: string): string {
    const names: Record<string, string> = {
      'construction': '装饰建材',
      'beauty': '美容美发',
      'auto': '汽车维修'
    }
    return names[industry] || industry
  }
  
  private askForIndustry(industries: { id: string; name: string; description?: string }[] | string[]): AIResponse {
    const industryIds = Array.isArray(industries) && typeof industries[0] === 'string' 
      ? industries as string[]
      : (industries as { id: string; name: string }[]).map(i => i.id)
    
    const actions: SuggestedAction[] = industryIds.map(industry => ({
      action: `select_industry_${industry}`,
      prompt: this.getIndustryDisplayName(industry),
      label: this.getIndustryDisplayName(industry),
      color: '#5A67D8'
    }))
    
    return {
      message: '好的，请问您属于哪个行业？',
      suggestedActions: actions
    }
  }
  
  private askForTaskType(industry: string, context: AgentContext): AIResponse {
    const config = this.industryManager.getIndustryConfig(industry)
    
    if (!config || !config.tasks) {
      return {
        message: `请告诉我您想要完成什么任务？`,
        suggestedActions: []
      }
    }
    
    const taskTypes = Object.keys(config.tasks)
    const actions: SuggestedAction[] = taskTypes.map(task => ({
      action: `select_task_${task}`,
      prompt: task,
      label: task,
      color: '#F687B3'
    }))
    
    return {
      message: `请选择您要执行的任务类型：`,
      suggestedActions: actions,
      metadata: { industry }
    }
  }
  
  private async handleSkillIntent(
    message: string,
    sessionId: string,
    intent: IntentResult,
    model: string
  ): Promise<AIResponse> {
    const context = this.getContext(sessionId)
    
    if (context.missingFields.length > 0) {
      const currentField = context.missingFields[0]
      context.collectedFields[currentField] = message
      context.missingFields = context.missingFields.slice(1)
      
      if (context.missingFields.length > 0) {
        return this.askForNextField(context)
      } else {
        return this.executeSkillAndRespond(context, model)
      }
    }
    
    if (intent.needsMoreInfo && intent.missingFields.length > 0) {
      context.intent = intent.intent
      context.skillName = intent.skillName
      context.taskType = intent.intent
      context.missingFields = intent.missingFields
      
      Object.assign(context.collectedFields, intent.parameters)
      
      return this.askForNextField(context)
    }
    
    const hasRequiredParams = Object.keys(intent.parameters).length > 0 || 
                              !intent.needsMoreInfo
    
    if (hasRequiredParams) {
      context.intent = intent.intent
      context.skillName = intent.skillName
      context.collectedFields = intent.parameters
      
      return this.executeSkillAndRespond(context, model)
    }
    
    context.intent = intent.intent
    context.skillName = intent.skillName
    context.missingFields = intent.missingFields
    
    return this.askForNextField(context)
  }
  
  private askForNextField(context: AgentContext): AIResponse {
    const nextField = context.missingFields[0]
    const fieldInfo = this.intentAnalyzer.getFieldQuestion(nextField)
    
    const description = this.intentAnalyzer.getIntentDescription(context.intent || '')
    
    const prompt = `用户想要${description}，但缺少必要信息。
已收集的信息: ${JSON.stringify(context.collectedFields)}
缺少的字段: ${nextField} (${fieldInfo?.label || nextField})

请用自然、友好的方式询问用户缺少的信息，不要使用固定模板。
如果用户说"没有标题"或"不需要"，请根据上下文智能处理。`

    return {
      message: prompt,
      suggestedActions: [],
      metadata: {
        intent: context.intent,
        skillName: context.skillName,
        currentField: nextField,
        collectedFields: context.collectedFields,
        needsLLMProcessing: true
      }
    }
  }
  
  private generateFieldActions(fieldName: string, fieldInfo: any): SuggestedAction[] {
    if (fieldInfo.type === 'choice' && fieldInfo.options) {
      return fieldInfo.options.map((option: string) => ({
        action: `field_${fieldName}`,
        prompt: option,
        label: option,
        color: '#5A67D8'
      }))
    }
    return []
  }
  
  private async executeSkillAndRespond(context: AgentContext, model: string): Promise<AIResponse> {
    const skillName = context.skillName!
    
    console.log(`[Agent] Executing skill: ${skillName}`, context.collectedFields)
    
    try {
      const result = await this.skillExecutor.execute(skillName, context.collectedFields)
      console.log(`[Agent] Skill result:`, result)
      
      this.clearContext(context.sessionId)
      
      if (result.status === 'success') {
        return {
          message: `✅ ${this.intentAnalyzer.getIntentDescription(context.intent || '')} 执行成功！\n\n${result.message}`,
          suggestedActions: [
            {
              action: 'view_result',
              prompt: '查看详细结果',
              label: '📋 查看结果',
              color: '#5A67D8'
            },
            {
              action: 'new_task',
              prompt: '开始新任务',
              label: '✨ 新任务',
              color: '#F687B3'
            }
          ],
          metadata: {
            intent: context.intent,
            skillResult: result
          }
        }
      } else {
        return {
          message: `❌ 执行失败：${result.message}`,
          suggestedActions: [
            {
              action: 'retry',
              prompt: '重试',
              label: '🔄 重试',
              color: '#FF6B00'
            },
            {
              action: 'help',
              prompt: '获取帮助',
              label: '❓ 帮助',
              color: '#666'
            }
          ],
          metadata: {
            intent: context.intent,
            skillResult: result
          }
        }
      }
    } catch (error: any) {
      console.error(`[Agent] Skill execution error:`, error)
      
      return {
        message: `❌ 技能执行出错：${error.message}\n\n您可以尝试重新描述您的需求，或者让我帮您用其他方式完成。`,
        suggestedActions: [
          {
            action: 'retry',
            prompt: '重试',
            label: '🔄 重试',
            color: '#FF6B00'
          },
          {
            action: 'chat',
            prompt: '换一种方式',
            label: '💬 对话',
            color: '#5A67D8'
          }
        ]
      }
    }
  }
  
  private parseFieldValue(message: string, fieldName: string): any {
    const numValue = parseFloat(message)
    if (!isNaN(numValue)) {
      return numValue
    }
    return message.trim()
  }
  
  private async confirmAndExecute(context: AgentContext, model: string): Promise<AIResponse> {
    const fieldsSummary = Object.entries(context.collectedFields)
      .map(([key, value]) => `- ${this.getFieldLabel(key)}: ${value}`)
      .join('\n')
    
    context.awaitingConfirmation = true
    
    return {
      message: `信息已收集，请确认：\n\n${fieldsSummary}`,
      suggestedActions: [
        {
          action: 'confirm',
          prompt: '确认',
          label: '✅ 确认',
          color: '#5A67D8'
        },
        {
          action: 'modify',
          prompt: '修改',
          label: '✏️ 修改',
          color: '#F687B3'
        }
      ],
      metadata: {
        collectedFields: context.collectedFields,
        awaitingConfirmation: true
      }
    }
  }
  
  private getFieldLabel(fieldName: string): string {
    const labels: Record<string, string> = {
      'customerName': '客户姓名',
      'area': '面积',
      'style': '风格',
      'budget': '预算',
      'title': '标题',
      'content': '内容',
      'url': '网址',
      'query': '查询内容'
    }
    return labels[fieldName] || fieldName
  }
  
  private async handleChatIntent(
    message: string,
    sessionId: string,
    history: ChatMessage[],
    model: string
  ): Promise<AIResponse> {
    const llmResponse = await this.llmService.chat(message, history, model)
    
    const responseMessage = typeof llmResponse === 'string' ? llmResponse : llmResponse.message
    const suggestedActions = this.enhanceChatActions(
      llmResponse.suggestedActions || [], 
      message
    )
    
    return {
      message: responseMessage,
      suggestedActions,
      thinking: llmResponse.thinking,
      metadata: llmResponse.metadata
    }
  }
  
  private enhanceChatActions(actions: SuggestedAction[], message: string): SuggestedAction[] {
    if (actions.length > 0) return actions
    
    const intent = this.intentAnalyzer.analyze(message)
    
    if (intent.intent !== 'chat' && intent.skillName) {
      return [
        {
          action: `execute_${intent.intent}`,
          prompt: `执行${this.intentAnalyzer.getIntentDescription(intent.intent)}`,
          label: `🚀 ${this.intentAnalyzer.getIntentDescription(intent.intent)}`,
          color: '#5A67D8'
        },
        {
          action: 'more_options',
          prompt: '更多选项',
          label: '⚙️ 更多',
          color: '#666'
        }
      ]
    }
    
    return [
      {
        action: 'generate_doc',
        prompt: '生成文档',
        label: '📄 生成文档',
        color: '#5A67D8'
      },
      {
        action: 'generate_image',
        prompt: '生成图片',
        label: '🎨 生成图片',
        color: '#F687B3'
      },
      {
        action: 'generate_video',
        prompt: '生成视频',
        label: '🎬 生成视频',
        color: '#00D4AA'
      }
    ]
  }
  
  async executeSkillDirectly(skillName: string, params: Record<string, any>): Promise<SkillResult> {
    console.log(`[Agent] Direct skill execution: ${skillName}`, params)
    return this.skillExecutor.execute(skillName, params)
  }
  
  listAvailableSkills(): string[] {
    return this.skillExecutor.listSkills()
  }
}
