import { v4 as uuidv4 } from 'uuid'

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
}

export interface Session {
  id: string
  label?: string
  messages: Message[]
  createdAt: string
  updatedAt: string
  metadata?: Record<string, any>
}

export class SessionManager {
  private sessions: Map<string, Session> = new Map()
  
  createSession(label?: string): Session {
    const id = uuidv4()
    const now = new Date().toISOString()
    
    const session: Session = {
      id,
      label: label || `会话 ${this.sessions.size + 1}`,
      messages: [],
      createdAt: now,
      updatedAt: now
    }
    
    this.sessions.set(id, session)
    return session
  }
  
  getSession(id: string): Session | undefined {
    return this.sessions.get(id)
  }
  
  getAllSessions(): Session[] {
    return Array.from(this.sessions.values())
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }
  
  deleteSession(id: string): boolean {
    return this.sessions.delete(id)
  }
  
  addMessage(sessionId: string, message: Omit<Message, 'id' | 'timestamp'>): Message | null {
    const session = this.sessions.get(sessionId)
    if (!session) return null
    
    const newMessage: Message = {
      ...message,
      id: uuidv4(),
      timestamp: new Date().toISOString()
    }
    
    session.messages.push(newMessage)
    session.updatedAt = new Date().toISOString()
    
    return newMessage
  }
  
  getMessages(sessionId: string, limit?: number): Message[] {
    const session = this.sessions.get(sessionId)
    if (!session) return []
    
    if (limit) {
      return session.messages.slice(-limit)
    }
    
    return session.messages
  }
  
  clearMessages(sessionId: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    
    session.messages = []
    session.updatedAt = new Date().toISOString()
    
    return true
  }
  
  updateMetadata(sessionId: string, metadata: Record<string, any>): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    
    session.metadata = { ...session.metadata, ...metadata }
    session.updatedAt = new Date().toISOString()
    
    return true
  }
  
  searchMessages(query: string): Array<{ sessionId: string; message: Message }> {
    const results: Array<{ sessionId: string; message: Message }> = []
    const lowerQuery = query.toLowerCase()
    
    this.sessions.forEach((session, sessionId) => {
      session.messages.forEach(message => {
        if (message.content.toLowerCase().includes(lowerQuery)) {
          results.push({ sessionId, message })
        }
      })
    })
    
    return results
  }
}
