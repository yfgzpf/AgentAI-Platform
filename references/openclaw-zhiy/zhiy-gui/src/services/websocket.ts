import { config } from '../config'

export type WebSocketEventType = 'message' | 'status' | 'error' | 'connected' | 'disconnected' | 'chat' | 'agent'

export interface WebSocketMessage {
  type: string
  sessionId?: string
  content?: string
  role?: 'user' | 'assistant'
  timestamp?: string
  data?: any
  message?: string
  clientId?: string
}

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

type EventCallback = (data: any) => void

let wsInstance: WebSocket | null = null
let isConnected = false
let isConnecting = false
let shouldReconnect = true
let reconnectAttempts = 0
const maxReconnectAttempts = 10
const reconnectDelay = 1000
const eventListeners: Map<WebSocketEventType, Set<EventCallback>> = new Map()
const pendingRequests: Map<string, { resolve: (value: any) => void; reject: (err: Error) => void }> = new Map()
let requestCounter = 0
let sessionKey = 'main'
let runId: string | null = null

function generateId(): string {
  return `req_${++requestCounter}_${Date.now()}`
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function getWebSocket(): WebSocket | null {
  return wsInstance
}

function connect(): Promise<void> {
  if (isConnected || isConnecting) {
    console.log('[WS] Already connected or connecting')
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    try {
      isConnecting = true
      shouldReconnect = true
      const url = config.gateway.wsUrl
      console.log('[WS] Connecting to:', url)
      wsInstance = new WebSocket(url)

      const connectionTimeout = setTimeout(() => {
        if (isConnecting) {
          console.log('[WS] Connection timeout')
          wsInstance?.close()
          isConnecting = false
          reject(new Error('Connection timeout'))
        }
      }, 10000)

      wsInstance.onopen = async () => {
        clearTimeout(connectionTimeout)
        console.log('[WS] Socket opened, sending connect frame...')
        
        try {
          await sendConnect()
          isConnecting = false
          isConnected = true
          reconnectAttempts = 0
          console.log('[WS] Connected successfully')
          emit('connected', { connected: true })
          resolve()
        } catch (err) {
          console.error('[WS] Connect handshake failed:', err)
          isConnecting = false
          reject(err)
        }
      }

      wsInstance.onmessage = (event) => {
        try {
          const frame: GatewayFrame = JSON.parse(event.data)
          console.log('[WS] Received frame:', frame.type, (frame as any).method || (frame as any).event || '')
          handleFrame(frame)
        } catch (error) {
          console.error('[WS] Parse error:', error)
        }
      }

      wsInstance.onerror = (error) => {
        clearTimeout(connectionTimeout)
        console.error('[WS] Error:', error)
        isConnecting = false
        emit('error', { error })
        reject(error)
      }

      wsInstance.onclose = (event) => {
        clearTimeout(connectionTimeout)
        console.log('[WS] Closed:', event.code, event.reason)
        isConnected = false
        isConnecting = false
        emit('disconnected', { connected: false, code: event.code })
        
        if (shouldReconnect) {
          attemptReconnect()
        }
      }
    } catch (error) {
      isConnecting = false
      reject(error)
    }
  })
}

async function sendConnect(challenge?: { nonce?: string; ts?: number }): Promise<void> {
  return new Promise((resolve, reject) => {
    const connectParams = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: 'webchat',
        version: '1.0.0',
        platform: 'web',
        mode: 'ui',
      },
      role: 'operator',
      scopes: ['operator.read', 'operator.write'],
      caps: [],
      commands: [],
      permissions: {},
      auth: {
        token: config.gateway.token,
      },
      locale: 'zh-CN',
      userAgent: 'zhiy-gui/1.0.0',
      device: {
        id: getOrCreateDeviceId(),
        publicKey: '',
        signature: '',
        signedAt: Date.now(),
        nonce: challenge?.nonce || '',
      },
    }

    const requestId = generateId()
    const frame: RequestFrame = {
      type: 'req',
      id: requestId,
      method: 'connect',
      params: connectParams,
    }

    pendingRequests.set(requestId, {
      resolve: (result) => {
        console.log('[WS] Connect response:', result)
        resolve()
      },
      reject: (err) => {
        console.error('[WS] Connect failed:', err)
        reject(err)
      },
    })

    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId)
      reject(new Error('Connect timeout'))
    }, 10000)

    const originalResolve = pendingRequests.get(requestId)!.resolve
    pendingRequests.get(requestId)!.resolve = (result) => {
      clearTimeout(timeout)
      originalResolve(result)
    }

    wsInstance!.send(JSON.stringify(frame))
    console.log('[WS] Sent connect frame with protocol v3')
  })
}

function getOrCreateDeviceId(): string {
  const stored = localStorage.getItem('zhiy_device_id')
  if (stored) return stored
  
  const newId = 'web-' + Math.random().toString(36).substring(2, 15)
  localStorage.setItem('zhiy_device_id', newId)
  return newId
}

function handleFrame(frame: GatewayFrame) {
  switch (frame.type) {
    case 'res':
      handleResponse(frame)
      break
    case 'event':
      handleEvent(frame)
      break
    case 'req':
      console.log('[WS] Received request from server:', frame.method)
      break
    default:
      console.log('[WS] Unknown frame type:', (frame as any).type)
  }
}

function handleResponse(frame: ResponseFrame) {
  const pending = pendingRequests.get(frame.id)
  if (pending) {
    pendingRequests.delete(frame.id)
    if (frame.ok) {
      pending.resolve(frame.payload)
    } else {
      pending.reject(new Error(frame.error?.message || 'Request failed'))
    }
  } else {
    console.log('[WS] Response for unknown request:', frame.id)
  }
}

function handleEvent(frame: EventFrame) {
  console.log('[WS] Event:', frame.event)
  
  switch (frame.event) {
    case 'chat':
      handleChatEvent(frame.payload)
      break
    case 'agent':
      handleAgentEvent(frame.payload)
      break
    case 'tick':
    case 'presence':
    case 'health':
      break
    default:
      console.log('[WS] Unhandled event:', frame.event)
  }
}

function handleChatEvent(payload: any) {
  console.log('[WS] Chat event:', payload?.type || 'message')
  
  if (payload?.type === 'assistant' || payload?.role === 'assistant') {
    emit('message', {
      sessionId: sessionKey,
      content: payload.text || payload.content || '',
      role: 'assistant',
      timestamp: payload.ts ? new Date(payload.ts).toISOString() : new Date().toISOString(),
      runId: payload.runId,
      done: payload.done,
    })
  } else if (payload?.type === 'user' || payload?.role === 'user') {
    console.log('[WS] Received user message from server, ignoring')
  } else if (payload?.runId) {
    runId = payload.runId
    if (payload.status === 'started') {
      emit('status', { status: 'started', runId: payload.runId })
    } else if (payload.status === 'completed' || payload.done) {
      emit('status', { status: 'completed', runId: payload.runId })
    }
  }
}

function handleAgentEvent(payload: any) {
  console.log('[WS] Agent event:', payload?.stream || 'unknown')
  
  if (payload?.stream === 'assistant') {
    emit('message', {
      sessionId: sessionKey,
      content: payload.data?.text || payload.data?.content || '',
      role: 'assistant',
      timestamp: payload.ts ? new Date(payload.ts).toISOString() : new Date().toISOString(),
      runId: payload.runId,
    })
  }
}

function attemptReconnect() {
  if (!shouldReconnect) {
    console.log('[WS] Reconnect disabled')
    return
  }

  if (reconnectAttempts >= maxReconnectAttempts) {
    console.error('[WS] Max reconnect attempts reached')
    return
  }

  reconnectAttempts++
  const delay = reconnectDelay * Math.pow(2, reconnectAttempts - 1)

  console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`)

  setTimeout(() => {
    if (shouldReconnect) {
      connect().catch(console.error)
    }
  }, delay)
}

function disconnect() {
  console.log('[WS] Disconnect called')
  shouldReconnect = false
  if (wsInstance) {
    wsInstance.close()
    wsInstance = null
    isConnected = false
  }
}

async function request<T = any>(method: string, params?: any): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!wsInstance || !isConnected) {
      reject(new Error('Not connected'))
      return
    }

    const requestId = generateId()
    const frame: RequestFrame = {
      type: 'req',
      id: requestId,
      method,
      params,
    }

    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId)
      reject(new Error(`Request timeout: ${method}`))
    }, 60000)

    pendingRequests.set(requestId, {
      resolve: (result) => {
        clearTimeout(timeout)
        resolve(result)
      },
      reject: (err) => {
        clearTimeout(timeout)
        reject(err)
      },
    })

    wsInstance.send(JSON.stringify(frame))
    console.log('[WS] Sent request:', method)
  })
}

async function sendChat(message: string, targetSessionKey?: string): Promise<any> {
  const params = {
    message,
    sessionKey: targetSessionKey || sessionKey,
    idempotencyKey: generateUUID(),
  }

  console.log('[WS] Sending chat message:', message.substring(0, 50))
  
  try {
    const result = await request('chat.send', params)
    console.log('[WS] Chat send result:', result)
    
    if (result?.runId) {
      runId = result.runId
    }
    
    return result
  } catch (error) {
    console.error('[WS] Chat send error:', error)
    throw error
  }
}

function send(message: string, sessionId?: string): void {
  if (!isConnected) {
    console.log('[WS] Not connected, connecting first...')
    connect()
      .then(() => sendChat(message, sessionId))
      .catch((err) => {
        console.error('[WS] Failed to connect and send:', err)
        emit('error', { message: 'Failed to connect' })
      })
    return
  }

  sendChat(message, sessionId).catch((err) => {
    console.error('[WS] Send failed:', err)
    emit('error', { message: err.message })
  })
}

async function getHistory(limit: number = 50): Promise<any[]> {
  try {
    const result = await request('chat.history', {
      sessionKey,
      limit,
    })
    return result?.messages || []
  } catch (error) {
    console.error('[WS] Failed to get history:', error)
    return []
  }
}

async function abort(): Promise<void> {
  if (!runId) return
  
  try {
    await request('chat.abort', {
      sessionKey,
      runId,
    })
    runId = null
  } catch (error) {
    console.error('[WS] Failed to abort:', error)
  }
}

function subscribe(event: WebSocketEventType, callback: EventCallback) {
  if (!eventListeners.has(event)) {
    eventListeners.set(event, new Set())
  }
  eventListeners.get(event)!.add(callback)

  return () => {
    eventListeners.get(event)?.delete(callback)
  }
}

function emit(event: WebSocketEventType, data: any) {
  const listeners = eventListeners.get(event)
  if (listeners) {
    listeners.forEach((callback) => {
      try {
        callback(data)
      } catch (error) {
        console.error('[WS] Callback error:', error)
      }
    })
  }
}

function getConnectionStatus(): boolean {
  return isConnected
}

function setSessionKey(key: string) {
  sessionKey = key
}

function getSessionKey(): string {
  return sessionKey
}

export const openClawWebSocket = {
  connect,
  disconnect,
  send,
  request,
  sendChat,
  getHistory,
  abort,
  subscribe,
  getConnectionStatus,
  setSessionKey,
  getSessionKey,
}
