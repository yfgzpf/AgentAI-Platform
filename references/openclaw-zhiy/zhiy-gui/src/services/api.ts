import { config } from '../config'

export interface Session {
  id: string
  label?: string
  createdAt: string
  updatedAt: string
  messages: Message[]
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

export interface Industry {
  id: string
  name: string
  icon?: string
  tasks?: Record<string, TaskConfig>
}

export interface TaskConfig {
  name: string
  fields: FieldConfig[]
}

export interface FieldConfig {
  name: string
  label: string
  type: 'text' | 'number' | 'choice' | 'textarea'
  options?: string[]
  required: boolean
}

class APIService {
  private baseUrl: string

  constructor() {
    this.baseUrl = config.api.baseUrl
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }))
      throw new Error(error.message || `HTTP ${response.status}`)
    }

    return response.json()
  }

  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    return this.request('/health')
  }

  async getIndustries(): Promise<Industry[]> {
    const result = await this.request<{ industries: Industry[] }>('/api/industries')
    return result.industries
  }

  async getIndustry(id: string): Promise<Industry> {
    return this.request(`/api/industries/${id}`)
  }

  async createSession(label?: string): Promise<Session> {
    return this.request('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ label }),
    })
  }

  async getSessions(): Promise<Session[]> {
    const result = await this.request<{ sessions: Session[] }>('/api/sessions')
    return result.sessions
  }

  async getSession(id: string): Promise<Session> {
    return this.request(`/api/sessions/${id}`)
  }

  async deleteSession(id: string): Promise<void> {
    await this.request(`/api/sessions/${id}`, { method: 'DELETE' })
  }

  async chat(message: string, sessionId?: string, model?: string): Promise<{
    sessionId: string
    message: string
    timestamp: string
  }> {
    return this.request('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message, sessionId, model }),
    })
  }

  async executeSkill(skillName: string, params: Record<string, any>): Promise<any> {
    return this.request('/api/skills/execute', {
      method: 'POST',
      body: JSON.stringify({ skillName, params }),
    })
  }
}

export const apiService = new APIService()
export const openClawAPI = apiService
