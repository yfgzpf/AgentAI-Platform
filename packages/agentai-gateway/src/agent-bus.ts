/**
 * Agent Bus — Agent间通信总线
 * --------------------------------------------
 * 实现多Agent协作的消息传递机制
 * 
 * 特性:
 * - 发布/订阅模式 (Pub/Sub)
 * - 点对点消息 (Direct Message)
 * - 广播消息 (Broadcast)
 * - 消息持久化与重放
 * - 消息优先级与超时
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ===== 类型定义 =====

export type MessageType = 'command' | 'event' | 'query' | 'response' | 'broadcast';
export type MessagePriority = 'low' | 'normal' | 'high' | 'critical';

export interface AgentMessage {
  id: string;
  type: MessageType;
  priority: MessagePriority;
  from: string;      // 发送者Agent ID
  to?: string;       // 接收者Agent ID (点对点)
  topic?: string;    // 主题 (发布/订阅)
  payload: any;      // 消息内容
  timestamp: number;
  ttl?: number;      // 生存时间 (毫秒)
  replyTo?: string;  // 回复地址
  correlationId?: string; // 关联ID (用于请求-响应)
}

export interface AgentRegistration {
  id: string;
  name: string;
  capabilities: string[];
  status: 'idle' | 'busy' | 'offline';
  lastHeartbeat: number;
  metadata?: Record<string, any>;
}

export interface MessageSubscription {
  id: string;
  agentId: string;
  topic: string;
  filter?: (msg: AgentMessage) => boolean;
}

// ===== Agent Bus 核心类 =====

export class AgentBus extends EventEmitter {
  private agents = new Map<string, AgentRegistration>();
  private subscriptions = new Map<string, MessageSubscription[]>();
  private messageHistory: AgentMessage[] = [];
  private pendingResponses = new Map<string, { resolve: (msg: AgentMessage) => void; reject: (err: Error) => void; timeout: NodeJS.Timeout }>();
  
  private historyDir: string;
  private maxHistorySize = 1000;
  private defaultTTL = 5 * 60 * 1000; // 5分钟

  constructor() {
    super();
    this.historyDir = path.join(os.homedir(), '.agentai', 'agent-bus');
    this._ensureHistoryDir();
    this._startCleanupInterval();
  }

  private _ensureHistoryDir(): void {
    if (!fs.existsSync(this.historyDir)) {
      fs.mkdirSync(this.historyDir, { recursive: true });
    }
  }

  private _startCleanupInterval(): void {
    // 每30秒清理过期消息和离线Agent
    setInterval(() => {
      this._cleanupExpiredMessages();
      this._cleanupOfflineAgents();
    }, 30000);
  }

  // ---------------------------------------------------------------------------
  // Agent 注册与管理
  // ---------------------------------------------------------------------------

  /**
   * 注册Agent到总线
   */
  registerAgent(agent: Omit<AgentRegistration, 'lastHeartbeat'>): void {
    const registration: AgentRegistration = {
      ...agent,
      lastHeartbeat: Date.now(),
    };
    this.agents.set(agent.id, registration);
    this.emit('agent:registered', registration);
    console.log(`[agent-bus] Agent registered: ${agent.id} (${agent.name})`);
  }

  /**
   * 注销Agent
   */
  unregisterAgent(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      this.agents.delete(agentId);
      this.subscriptions.delete(agentId);
      this.emit('agent:unregistered', agentId);
      console.log(`[agent-bus] Agent unregistered: ${agentId}`);
    }
  }

  /**
   * 更新Agent状态
   */
  updateAgentStatus(agentId: string, status: AgentRegistration['status']): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = status;
      agent.lastHeartbeat = Date.now();
      this.emit('agent:status', agent);
    }
  }

  /**
   * 发送心跳
   */
  heartbeat(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.lastHeartbeat = Date.now();
    }
  }

  /**
   * 获取所有在线Agent
   */
  getOnlineAgents(): AgentRegistration[] {
    const now = Date.now();
    const timeout = 60000; // 1分钟无心跳视为离线
    return Array.from(this.agents.values()).filter(
      a => now - a.lastHeartbeat < timeout
    );
  }

  /**
   * 查找具备特定能力的Agent
   */
  findAgentsByCapability(capability: string): AgentRegistration[] {
    return this.getOnlineAgents().filter(a => 
      a.capabilities.includes(capability)
    );
  }

  // ---------------------------------------------------------------------------
  // 消息发布与订阅
  // ---------------------------------------------------------------------------

  /**
   * 订阅主题
   */
  subscribe(agentId: string, topic: string, filter?: (msg: AgentMessage) => boolean): string {
    const subscriptionId = `${agentId}:${topic}:${Date.now()}`;
    const subs = this.subscriptions.get(agentId) || [];
    subs.push({ id: subscriptionId, agentId, topic, filter });
    this.subscriptions.set(agentId, subs);
    return subscriptionId;
  }

  /**
   * 取消订阅
   */
  unsubscribe(agentId: string, subscriptionId?: string): void {
    if (subscriptionId) {
      const subs = this.subscriptions.get(agentId) || [];
      const idx = subs.findIndex(s => s.id === subscriptionId);
      if (idx >= 0) subs.splice(idx, 1);
    } else {
      this.subscriptions.delete(agentId);
    }
  }

  /**
   * 发布消息到主题
   */
  publish(topic: string, payload: any, from: string, priority: MessagePriority = 'normal'): void {
    const message: AgentMessage = {
      id: this._generateId(),
      type: 'event',
      priority,
      from,
      topic,
      payload,
      timestamp: Date.now(),
      ttl: this.defaultTTL,
    };

    this._storeMessage(message);
    this._deliverToSubscribers(message);
    this.emit('message:published', message);
  }

  /**
   * 发送点对点消息
   */
  send(to: string, payload: any, from: string, options?: { priority?: MessagePriority; ttl?: number }): void {
    const message: AgentMessage = {
      id: this._generateId(),
      type: 'command',
      priority: options?.priority || 'normal',
      from,
      to,
      payload,
      timestamp: Date.now(),
      ttl: options?.ttl || this.defaultTTL,
    };

    this._storeMessage(message);
    this._deliverToAgent(message);
    this.emit('message:sent', message);
  }

  /**
   * 广播消息给所有Agent
   */
  broadcast(payload: any, from: string, options?: { priority?: MessagePriority; exclude?: string[] }): void {
    const message: AgentMessage = {
      id: this._generateId(),
      type: 'broadcast',
      priority: options?.priority || 'normal',
      from,
      payload,
      timestamp: Date.now(),
      ttl: this.defaultTTL,
    };

    this._storeMessage(message);
    
    for (const agent of this.getOnlineAgents()) {
      if (options?.exclude?.includes(agent.id)) continue;
      this._deliverToAgent({ ...message, to: agent.id });
    }
    
    this.emit('message:broadcast', message);
  }

  /**
   * 发送请求并等待响应
   */
  async request(to: string, payload: any, from: string, timeoutMs: number = 30000): Promise<AgentMessage> {
    const correlationId = this._generateId();
    const message: AgentMessage = {
      id: this._generateId(),
      type: 'query',
      priority: 'high',
      from,
      to,
      payload,
      timestamp: Date.now(),
      ttl: timeoutMs,
      replyTo: from,
      correlationId,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingResponses.delete(correlationId);
        reject(new Error(`Request timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingResponses.set(correlationId, { resolve, reject, timeout });
      this._storeMessage(message);
      this._deliverToAgent(message);
    });
  }

  /**
   * 回复请求
   */
  respond(to: string, payload: any, from: string, correlationId: string): void {
    const message: AgentMessage = {
      id: this._generateId(),
      type: 'response',
      priority: 'high',
      from,
      to,
      payload,
      timestamp: Date.now(),
      correlationId,
    };

    // 如果有等待的promise，直接resolve
    const pending = this.pendingResponses.get(correlationId);
    if (pending) {
      clearTimeout(pending.timeout);
      pending.resolve(message);
      this.pendingResponses.delete(correlationId);
    }

    this._storeMessage(message);
    this._deliverToAgent(message);
  }

  // ---------------------------------------------------------------------------
  // 内部方法
  // ---------------------------------------------------------------------------

  private _generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private _storeMessage(message: AgentMessage): void {
    this.messageHistory.push(message);
    
    // 限制历史大小
    if (this.messageHistory.length > this.maxHistorySize) {
      this.messageHistory = this.messageHistory.slice(-this.maxHistorySize);
    }

    // 持久化关键消息
    if (message.priority === 'critical' || message.type === 'command') {
      this._persistMessage(message);
    }
  }

  private _persistMessage(message: AgentMessage): void {
    try {
      const file = path.join(this.historyDir, `${new Date().toISOString().split('T')[0]}.jsonl`);
      const line = JSON.stringify(message) + '\n';
      fs.appendFileSync(file, line);
    } catch (e) {
      console.warn('[agent-bus] Failed to persist message:', e);
    }
  }

  private _deliverToSubscribers(message: AgentMessage): void {
    for (const [agentId, subs] of this.subscriptions) {
      for (const sub of subs) {
        if (sub.topic === message.topic || sub.topic === '*') {
          if (!sub.filter || sub.filter(message)) {
            this.emit(`message:${agentId}`, message);
          }
        }
      }
    }
  }

  private _deliverToAgent(message: AgentMessage): void {
    if (message.to) {
      this.emit(`message:${message.to}`, message);
    }
  }

  private _cleanupExpiredMessages(): void {
    const now = Date.now();
    this.messageHistory = this.messageHistory.filter(m => 
      !m.ttl || m.timestamp + m.ttl > now
    );
  }

  private _cleanupOfflineAgents(): void {
    const now = Date.now();
    const timeout = 120000; // 2分钟
    
    for (const [id, agent] of this.agents) {
      if (now - agent.lastHeartbeat > timeout) {
        agent.status = 'offline';
        this.emit('agent:offline', agent);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 查询与统计
  // ---------------------------------------------------------------------------

  /**
   * 获取消息历史
   */
  getMessageHistory(options?: { 
    from?: string; 
    to?: string; 
    topic?: string; 
    type?: MessageType;
    limit?: number;
    since?: number;
  }): AgentMessage[] {
    let result = this.messageHistory;
    
    if (options?.from) result = result.filter(m => m.from === options.from);
    if (options?.to) result = result.filter(m => m.to === options.to);
    if (options?.topic) result = result.filter(m => m.topic === options.topic);
    if (options?.type) result = result.filter(m => m.type === options.type);
    if (options?.since) {
      const since = options.since;
      result = result.filter(m => m.timestamp >= since);
    }
    
    if (options?.limit) {
      result = result.slice(-options.limit);
    }
    
    return result;
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    agentCount: number;
    onlineCount: number;
    subscriptionCount: number;
    messageCount: number;
    pendingResponseCount: number;
  } {
    return {
      agentCount: this.agents.size,
      onlineCount: this.getOnlineAgents().length,
      subscriptionCount: Array.from(this.subscriptions.values()).reduce((sum, subs) => sum + subs.length, 0),
      messageCount: this.messageHistory.length,
      pendingResponseCount: this.pendingResponses.size,
    };
  }
}

// ---------------------------------------------------------------------------
// 单例导出
// ---------------------------------------------------------------------------

let _bus: AgentBus | null = null;

export function getAgentBus(): AgentBus {
  if (!_bus) {
    _bus = new AgentBus();
  }
  return _bus;
}

// ---------------------------------------------------------------------------
// 装饰器: 自动注册Agent方法为消息处理器
// ---------------------------------------------------------------------------

export function MessageHandler(topic?: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    
    descriptor.value = function (...args: any[]) {
      const bus = getAgentBus();
      const agentId = (this as any).agentId;
      
      if (agentId && topic) {
        bus.on(`message:${agentId}`, (msg: AgentMessage) => {
          if (msg.topic === topic) {
            originalMethod.call(this, msg);
          }
        });
      }
      
      return originalMethod.apply(this, args);
    };
    
    return descriptor;
  };
}
