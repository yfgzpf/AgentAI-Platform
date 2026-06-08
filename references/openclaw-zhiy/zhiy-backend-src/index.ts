import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { v4 as uuidv4 } from 'uuid'
import dotenv from 'dotenv'
import { LLMService, AIResponse, ChatMessage } from './services/llm'
import { SessionManager } from './services/session'
import { SkillExecutor } from './services/skills'
import { AgentOrchestrator } from './services/agent'
import { StreamService } from './services/stream'
import { taskOrchestrator, Task, AgentState } from './services/task-orchestrator'
import skillsRouter from './routes/skills'
import dingtalkRouter from './routes/dingtalk'
import { ZhiYAgentCore } from './services/zhiy-agent-core'

dotenv.config()

const ZHIY_AGENT_ENABLED = process.env.ZHIY_AGENT_ENABLED !== 'false'
console.log(`[ZhiY Agent] 智能体核心状态: ${ZHIY_AGENT_ENABLED ? '已启用' : '未启用'}`)

let zhiyAgentCore: ZhiYAgentCore | null = null

const app = express()
const server = createServer(app)
const wss = new WebSocketServer({ server })

const PORT = process.env.PORT || 3001
const DEFAULT_API_KEY = process.env.DEEPSEEK_API_KEY || ''

console.log('='.repeat(60))
console.log('智 Y.Ai 后端服务配置')
console.log('='.repeat(60))
console.log(`默认 API Key: ${DEFAULT_API_KEY ? DEFAULT_API_KEY.substring(0, 10) + '...' : '未配置'}`)
console.log('='.repeat(60))

const llmService = new LLMService(DEFAULT_API_KEY)
const sessionManager = new SessionManager()
const skillExecutor = new SkillExecutor()
const agentOrchestrator = new AgentOrchestrator(llmService, skillExecutor)
const streamService = new StreamService(llmService)

const DINGTALK_CONFIG = {
  enabled: process.env.DINGTALK_ENABLED === 'true',
  webhook: process.env.DINGTALK_WEBHOOK || '',
  secret: process.env.DINGTALK_SECRET || '',
  keyword: process.env.DINGTALK_KEYWORD || '智Y'
}

console.log('钉钉配置:', {
  enabled: DINGTALK_CONFIG.enabled,
  webhook_configured: !!DINGTALK_CONFIG.webhook,
  secret_configured: !!DINGTALK_CONFIG.secret,
  keyword: DINGTALK_CONFIG.keyword
})

app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:18789'],
  credentials: true
}))
app.use(express.json())

app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`)
  next()
})

app.get('/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    defaultApiKeyConfigured: !!DEFAULT_API_KEY
  })
})

app.get('/api/models', (req: Request, res: Response) => {
  const models = llmService.getAvailableModels()
  res.json({ models })
})

app.post('/api/config/apikey', (req: Request, res: Response) => {
  const { provider, apiKey } = req.body
  
  if (!provider || !apiKey) {
    return res.status(400).json({ error: 'provider 和 apiKey 是必需参数' })
  }
  
  llmService.setUserApiKey(provider, apiKey)
  
  console.log(`[API] 配置了 ${provider} API Key`)
  
  res.json({ 
    success: true, 
    message: `${provider} API 密钥已配置`,
    models: llmService.getAvailableModels()
  })
})

app.get('/api/config/status', (req: Request, res: Response) => {
  const models = llmService.getAvailableModels()
  const configured = models.filter(m => m.configured)
  
  res.json({
    hasDefaultKey: !!DEFAULT_API_KEY,
    configuredProviders: configured.map(m => m.provider),
    availableModels: models
  })
})

app.use('/api/skills', skillsRouter)
app.use('/api/dingtalk', dingtalkRouter)

app.get('/api/industries', (req: Request, res: Response) => {
  res.json({
    industries: [
      { id: 'construction', name: '装饰建材', icon: '🏠' },
      { id: 'auto', name: '汽修服务', icon: '🚗' },
      { id: 'beauty', name: '美容美发', icon: '💇' },
      { id: 'office', name: '办公自动化', icon: '📊' }
    ]
  })
})

app.get('/api/industries/:id', (req: Request, res: Response) => {
  const { id } = req.params
  const configs: Record<string, any> = {
    construction: {
      id: 'construction',
      name: '装饰建材',
      tasks: {
        contract: {
          name: '生成装修合同',
          fields: [
            { name: 'customerName', label: '客户姓名', type: 'text', required: true },
            { name: 'area', label: '装修面积（平方米）', type: 'number', required: true },
            { name: 'style', label: '户型风格', type: 'choice', options: ['现代', '欧式', '中式', '美式'], required: true },
            { name: 'budget', label: '预算范围', type: 'text', required: false }
          ]
        },
        quote: {
          name: '生成报价单',
          fields: [
            { name: 'products', label: '产品清单', type: 'textarea', required: true },
            { name: 'discount', label: '折扣（%）', type: 'number', required: false }
          ]
        }
      }
    },
    auto: {
      id: 'auto',
      name: '汽修服务',
      tasks: {
        'repair-quote': {
          name: '维修报价',
          fields: [
            { name: 'carModel', label: '车型', type: 'text', required: true },
            { name: 'issue', label: '问题描述', type: 'textarea', required: true },
            { name: 'urgency', label: '紧急程度', type: 'choice', options: ['普通', '紧急', '非常紧急'], required: true }
          ]
        },
        maintenance: {
          name: '保养计划',
          fields: [
            { name: 'carModel', label: '车型', type: 'text', required: true },
            { name: 'mileage', label: '当前里程', type: 'number', required: true }
          ]
        }
      }
    },
    beauty: {
      id: 'beauty',
      name: '美容美发',
      tasks: {
        appointment: {
          name: '预约管理',
          fields: [
            { name: 'customerName', label: '客户姓名', type: 'text', required: true },
            { name: 'service', label: '服务项目', type: 'choice', options: ['剪发', '染发', '美甲', '护肤'], required: true },
            { name: 'date', label: '预约日期', type: 'text', required: true },
            { name: 'time', label: '预约时间', type: 'text', required: true }
          ]
        }
      }
    },
    office: {
      id: 'office',
      name: '办公自动化',
      tasks: {
        document: {
          name: '文档生成',
          fields: [
            { name: 'docType', label: '文档类型', type: 'choice', options: ['合同', '报告', '通知', '备忘录'], required: true },
            { name: 'title', label: '文档标题', type: 'text', required: true },
            { name: 'content', label: '主要内容', type: 'textarea', required: true }
          ]
        }
      }
    }
  }
  
  if (configs[id]) {
    res.json(configs[id])
  } else {
    res.status(404).json({ error: '行业不存在' })
  }
})

app.post('/api/sessions', async (req: Request, res: Response) => {
  const { label } = req.body
  const session = sessionManager.createSession(label)
  res.json(session)
})

app.get('/api/sessions', (req: Request, res: Response) => {
  const sessions = sessionManager.getAllSessions()
  res.json({ sessions })
})

app.get('/api/sessions/:id', (req: Request, res: Response) => {
  const { id } = req.params
  const session = sessionManager.getSession(id)
  if (session) {
    res.json(session)
  } else {
    res.status(404).json({ error: '会话不存在' })
  }
})

app.delete('/api/sessions/:id', (req: Request, res: Response) => {
  const { id } = req.params
  sessionManager.deleteSession(id)
  res.json({ success: true })
})

app.post('/api/chat', async (req: Request, res: Response) => {
  const { message, sessionId, model = 'deepseek-chat' } = req.body
  
  console.log('Chat API called:', { message, sessionId, model })
  
  if (!message) {
    return res.status(400).json({ error: '消息不能为空' })
  }
  
  try {
    let session = sessionId ? sessionManager.getSession(sessionId) : null
    if (!session) {
      session = sessionManager.createSession()
    }
    
    sessionManager.addMessage(session.id, { role: 'user', content: message })
    
    console.log('Processing through Agent Orchestrator...')
    const response = await agentOrchestrator.processMessage(message, session.id, session.messages, model)
    
    const responseMessage = typeof response === 'string' ? response : response.message
    sessionManager.addMessage(session.id, { role: 'assistant', content: responseMessage })
    
    res.json({
      sessionId: session.id,
      message: responseMessage,
      suggestedActions: response.suggestedActions,
      metadata: response.metadata,
      timestamp: new Date().toISOString()
    })
  } catch (error: any) {
    console.error('Chat error:', error)
    res.status(500).json({ error: error.message || '处理消息失败' })
  }
})

app.post('/api/chat/stream', async (req: Request, res: Response) => {
  const { message, sessionId, model = 'deepseek-chat' } = req.body
  
  if (!message) {
    return res.status(400).json({ error: '消息不能为空' })
  }
  
  let session = sessionId ? sessionManager.getSession(sessionId) : null
  if (!session) {
    session = sessionManager.createSession()
  }
  
  sessionManager.addMessage(session.id, { role: 'user', content: message })
  
  await streamService.streamChat(req, res, message, session.messages, model)
})

app.post('/api/skills/execute', async (req: Request, res: Response) => {
  const { skillName, params } = req.body
  
  try {
    const result = await skillExecutor.execute(skillName, params)
    res.json(result)
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/tasks', (req: Request, res: Response) => {
  const { sessionId } = req.query
  if (sessionId) {
    res.json({ tasks: taskOrchestrator.getTasksBySession(sessionId as string) })
  } else {
    res.json({ tasks: [] })
  }
})

app.get('/api/agent/state', (req: Request, res: Response) => {
  res.json(taskOrchestrator.getAgentState())
})

interface WSClient extends WebSocket {
  sessionId?: string
  isAlive?: boolean
  clientId?: string
  authenticated?: boolean
  sessionKey?: string
  runId?: string
}

const clients = new Map<string, WSClient>()

interface RequestFrame {
  type: 'req'
  id: string
  method: string
  params?: any
}

interface ResponseFrame {
  type: 'res'
  id: string
  ok: boolean
  payload?: any
  error?: {
    code: string
    message: string
  }
}

interface EventFrame {
  type: 'event'
  event: string
  payload?: any
  seq?: number
}

type GatewayFrame = RequestFrame | ResponseFrame | EventFrame

const broadcastToClient = (clientId: string, event: string, data: any) => {
  const client = clients.get(clientId)
  if (client && client.readyState === WebSocket.OPEN) {
    const frame: EventFrame = {
      type: 'event',
      event,
      payload: data,
      seq: Date.now()
    }
    client.send(JSON.stringify(frame))
  }
}

const sendResponse = (ws: WSClient, requestId: string, ok: boolean, payload?: any, error?: { code: string; message: string }) => {
  const frame: ResponseFrame = {
    type: 'res',
    id: requestId,
    ok,
    payload,
    error
  }
  ws.send(JSON.stringify(frame))
}

const sendEvent = (ws: WSClient, event: string, payload?: any) => {
  const frame: EventFrame = {
    type: 'event',
    event,
    payload,
    seq: Date.now()
  }
  ws.send(JSON.stringify(frame))
}

taskOrchestrator.on('task_created', (task: Task) => {
  clients.forEach((client, clientId) => {
    if (client.sessionId === task.sessionId) {
      broadcastToClient(clientId, 'task_created', { task })
    }
  })
})

taskOrchestrator.on('task_updated', (task: Task) => {
  clients.forEach((client, clientId) => {
    if (client.sessionId === task.sessionId) {
      broadcastToClient(clientId, 'task_updated', { task })
    }
  })
})

taskOrchestrator.on('agent_state_changed', (state: AgentState) => {
  clients.forEach((client, clientId) => {
    broadcastToClient(clientId, 'agent_state_changed', { ...state })
  })
})

taskOrchestrator.on('input_required', (data: any) => {
  clients.forEach((client, clientId) => {
    if (client.sessionId === data.task.sessionId) {
      broadcastToClient(clientId, 'input_required', data)
    }
  })
})

taskOrchestrator.on('task_completed', (task: Task) => {
  clients.forEach((client, clientId) => {
    if (client.sessionId === task.sessionId) {
      broadcastToClient(clientId, 'task_completed', { task })
    }
  })
})

wss.on('connection', (ws: WSClient) => {
  const clientId = uuidv4()
  ws.clientId = clientId
  ws.sessionId = clientId
  ws.sessionKey = 'main'
  ws.authenticated = false
  clients.set(clientId, ws)
  
  console.log(`[WS] Client connected: ${clientId}`)
  
  ws.on('message', async (data: Buffer) => {
    const dataStr = data.toString()
    console.log(`[WS] Received from ${clientId}:`, dataStr.substring(0, 200))
    
    try {
      const frame: GatewayFrame = JSON.parse(dataStr)
      
      if (frame.type === 'req') {
        await handleRequest(ws, frame as RequestFrame)
      } else if (frame.type === 'event') {
        handleClientEvent(ws, frame as EventFrame)
      } else {
        console.log('[WS] Unknown frame type:', (frame as any).type)
        sendResponse(ws, (frame as any).id || 'unknown', false, undefined, {
          code: 'INVALID_FRAME',
          message: `未知的帧类型: ${(frame as any).type}`
        })
      }
    } catch (error: any) {
      console.error('[WS] Message parse error:', error)
      sendResponse(ws, 'unknown', false, undefined, {
        code: 'PARSE_ERROR',
        message: `消息解析错误: ${error.message}`
      })
    }
  })
  
  ws.on('close', () => {
    clients.delete(clientId)
    console.log(`[WS] Client disconnected: ${clientId}`)
  })
  
  ws.on('error', (error) => {
    console.error(`[WS] Client error ${clientId}:`, error)
  })
})

async function handleRequest(ws: WSClient, frame: RequestFrame) {
  const { id, method, params } = frame
  
  console.log(`[WS] Request: ${method} (id: ${id})`)
  
  try {
    switch (method) {
      case 'connect':
        await handleConnect(ws, id, params)
        break
      case 'chat.send':
        await handleChatSend(ws, id, params)
        break
      case 'chat.history':
        await handleChatHistory(ws, id, params)
        break
      case 'chat.abort':
        await handleChatAbort(ws, id, params)
        break
      case 'config.apikey':
        handleConfigApiKeyRequest(ws, id, params)
        break
      case 'skill.execute':
        await handleSkillExecute(ws, id, params)
        break
      case 'ping':
        sendResponse(ws, id, true, { pong: true, timestamp: Date.now() })
        break
      default:
        sendResponse(ws, id, false, undefined, {
          code: 'UNKNOWN_METHOD',
          message: `未知方法: ${method}`
        })
    }
  } catch (error: any) {
    console.error(`[WS] Error handling ${method}:`, error)
    sendResponse(ws, id, false, undefined, {
      code: 'INTERNAL_ERROR',
      message: error.message || '内部服务器错误'
    })
  }
}

function handleClientEvent(ws: WSClient, frame: EventFrame) {
  console.log(`[WS] Client event: ${frame.event}`)
}

async function handleConnect(ws: WSClient, requestId: string, params: any) {
  const { auth, client } = params || {}
  
  console.log('[WS] Connect request from client:', client?.id || 'unknown')
  
  const validToken = '0ef9252293171e2f7400e10173268086c4d818ccb23de50c'
  const token = auth?.token
  
  if (token && token !== validToken) {
    console.log('[WS] Invalid token, but allowing connection for development')
  }
  
  ws.authenticated = true
  
  sendResponse(ws, requestId, true, {
    protocol: 1,
    server: {
      id: 'zhiy-backend',
      version: '1.0.0',
      name: '智 Y.Ai Backend'
    },
    sessionKey: ws.sessionKey,
    models: llmService.getAvailableModels(),
    agentState: taskOrchestrator.getAgentState()
  })
  
  sendEvent(ws, 'presence', {
    type: 'joined',
    clientId: ws.clientId,
    timestamp: Date.now()
  })
}

async function handleChatSend(ws: WSClient, requestId: string, params: any) {
  const { message, sessionKey, idempotencyKey, model = 'deepseek-chat' } = params || {}
  
  if (!message) {
    sendResponse(ws, requestId, false, undefined, {
      code: 'INVALID_PARAMS',
      message: '消息不能为空'
    })
    return
  }
  
  console.log(`[WS] Chat message: ${message.substring(0, 50)}...`)
  console.log(`[WS] SessionKey from client: ${sessionKey}`)
  
  const runId = uuidv4()
  ws.runId = runId
  
  sendResponse(ws, requestId, true, {
    runId,
    sessionKey: sessionKey || ws.sessionKey,
    status: 'started',
    timestamp: Date.now()
  })
  
  sendEvent(ws, 'chat', {
    type: 'status',
    status: 'started',
    runId,
    ts: Date.now()
  })
  
  try {
    const targetSessionId = sessionKey || ws.sessionId || ws.sessionKey
    let session = targetSessionId ? sessionManager.getSession(targetSessionId) : null
    
    if (!session) {
      session = sessionManager.createSession()
      console.log(`[WS] Created new session: ${session.id}`)
    }
    
    ws.sessionId = session.id
    ws.sessionKey = session.id
    
    sessionManager.addMessage(session.id, { role: 'user', content: message })
    
    console.log(`[WS] Session ${session.id} has ${session.messages.length} messages`)
    
    let responseMessage: string
    
    if (ZHIY_AGENT_ENABLED && zhiyAgentCore) {
      console.log('[ZhiYAgentCore] 使用智Y智能体核心处理消息')
      let agentSession = zhiyAgentCore.getSession(session.id)
      if (!agentSession) {
        agentSession = zhiyAgentCore.createSession({
          id: session.id,
          model: model.includes('deepseek') ? 'deepseek-chat' : model
        })
      }
      responseMessage = await zhiyAgentCore.processMessage(session.id, message)
    } else {
      console.log('[Agent] 使用 AgentOrchestrator 处理消息')
      const response = await agentOrchestrator.processMessage(message, session.id, session.messages, model)
      responseMessage = typeof response === 'string' ? response : (response as AIResponse).message
    }
    
    sessionManager.addMessage(session.id, { role: 'assistant', content: responseMessage })
    
    sendEvent(ws, 'chat', {
      type: 'assistant',
      role: 'assistant',
      text: responseMessage,
      runId,
      ts: Date.now(),
      done: true
    })
    
    sendEvent(ws, 'chat', {
      type: 'status',
      status: 'completed',
      runId,
      ts: Date.now()
    })
    
    ws.runId = undefined
    
  } catch (error: any) {
    console.error('[WS] Chat error:', error)
    
    sendEvent(ws, 'chat', {
      type: 'assistant',
      role: 'assistant',
      text: `抱歉，处理您的请求时出现错误：${error.message}`,
      runId,
      ts: Date.now(),
      done: true,
      error: true
    })
    
    sendEvent(ws, 'chat', {
      type: 'status',
      status: 'failed',
      runId,
      error: error.message,
      ts: Date.now()
    })
  }
}

async function handleChatHistory(ws: WSClient, requestId: string, params: any) {
  const { sessionKey, limit = 50 } = params || {}
  
  const session = ws.sessionId ? sessionManager.getSession(ws.sessionId) : null
  const messages = session?.messages || []
  
  sendResponse(ws, requestId, true, {
    messages: messages.slice(-limit),
    sessionKey: sessionKey || ws.sessionKey,
    total: messages.length
  })
}

async function handleChatAbort(ws: WSClient, requestId: string, params: any) {
  const { runId } = params || {}
  
  if (runId && ws.runId === runId) {
    ws.runId = undefined
  }
  
  sendResponse(ws, requestId, true, {
    aborted: true,
    runId
  })
}

function handleConfigApiKeyRequest(ws: WSClient, requestId: string, params: any) {
  const { provider, apiKey } = params || {}
  
  if (!provider || !apiKey) {
    sendResponse(ws, requestId, false, undefined, {
      code: 'INVALID_PARAMS',
      message: 'provider 和 apiKey 是必需参数'
    })
    return
  }
  
  llmService.setUserApiKey(provider, apiKey)
  console.log(`[WS] 配置了 ${provider} API Key`)
  
  sendResponse(ws, requestId, true, {
    provider,
    configured: true,
    models: llmService.getAvailableModels()
  })
}

async function handleSkillExecute(ws: WSClient, requestId: string, params: any) {
  const { skillName, params: skillParams } = params || {}
  
  if (!skillName) {
    sendResponse(ws, requestId, false, undefined, {
      code: 'INVALID_PARAMS',
      message: 'skillName 是必需参数'
    })
    return
  }
  
  console.log(`[WS] Skill execution: ${skillName}`)
  
  try {
    const result = await skillExecutor.execute(skillName, skillParams || {})
    sendResponse(ws, requestId, true, { result })
  } catch (error: any) {
    sendResponse(ws, requestId, false, undefined, {
      code: 'SKILL_ERROR',
      message: error.message
    })
  }
}

const interval = setInterval(() => {
  wss.clients.forEach((ws: WSClient) => {
    if (!ws.isAlive) {
      return ws.terminate()
    }
    ws.isAlive = false
    ws.ping()
  })
}, 30000)

wss.on('close', () => {
  clearInterval(interval)
})

server.listen(PORT, async () => {
  if (ZHIY_AGENT_ENABLED) {
    try {
      zhiyAgentCore = new ZhiYAgentCore({
        workspace: process.cwd(),
        model: 'deepseek-chat',
        apiKey: DEFAULT_API_KEY,
        apiEndpoint: 'https://api.deepseek.com/v1'
      })
      console.log('[ZhiYAgentCore] 智能体核心初始化成功')
      console.log(`[ZhiYAgentCore] 可用工具: ${zhiyAgentCore.getTools().map(t => t.function.name).join(', ')}`)
      console.log(`[ZhiYAgentCore] 可用技能: ${zhiyAgentCore.getSkills().map(s => s.name).join(', ')}`)
    } catch (error) {
      console.error('[ZhiYAgentCore] 智能体核心初始化失败:', error)
      zhiyAgentCore = null
    }
  }
  
  if (DINGTALK_CONFIG.enabled) {
    try {
      const response = await fetch(`http://localhost:${PORT}/api/dingtalk/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(DINGTALK_CONFIG)
      })
      console.log('[DingTalk] 钉钉服务配置完成')
    } catch (error) {
      console.error('[DingTalk] 钉钉服务配置失败:', error)
    }
  }
  
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   智 Y.Ai 后端服务已启动                                    ║
║   ZhiY Backend Server Started                             ║
║                                                           ║
║   HTTP: http://localhost:${PORT}                            ║
║   WebSocket: ws://localhost:${PORT}                         ║
║                                                           ║
║   默认 API Key: ${DEFAULT_API_KEY ? '已配置' : '未配置'}                       ║
║                                                           ║
║   智Y智能体核心: ${ZHIY_AGENT_ENABLED && zhiyAgentCore ? '已启用' : '未启用'}                                  ║
║   技能系统: 已启用                                          ║
║   智能体编排: 已启用                                        ║
║   任务编排器: 已启用                                        ║
║   流式输出: 已启用                                          ║
║   钉钉机器人: ${DINGTALK_CONFIG.enabled ? '已启用' : '未启用'}                                       ║
║                                                           ║
║   提示: 用户可通过对话或API配置自己的API密钥                   ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `)
})

export { app, server, wss }
