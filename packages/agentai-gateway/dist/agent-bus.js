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
// ===== Agent Bus 核心类 =====
export class AgentBus extends EventEmitter {
    agents = new Map();
    subscriptions = new Map();
    messageHistory = [];
    pendingResponses = new Map();
    historyDir;
    maxHistorySize = 1000;
    defaultTTL = 5 * 60 * 1000; // 5分钟
    constructor() {
        super();
        this.historyDir = path.join(os.homedir(), '.agentai', 'agent-bus');
        this._ensureHistoryDir();
        this._startCleanupInterval();
    }
    _ensureHistoryDir() {
        if (!fs.existsSync(this.historyDir)) {
            fs.mkdirSync(this.historyDir, { recursive: true });
        }
    }
    _startCleanupInterval() {
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
    registerAgent(agent) {
        const registration = {
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
    unregisterAgent(agentId) {
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
    updateAgentStatus(agentId, status) {
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
    heartbeat(agentId) {
        const agent = this.agents.get(agentId);
        if (agent) {
            agent.lastHeartbeat = Date.now();
        }
    }
    /**
     * 获取所有在线Agent
     */
    getOnlineAgents() {
        const now = Date.now();
        const timeout = 60000; // 1分钟无心跳视为离线
        return Array.from(this.agents.values()).filter(a => now - a.lastHeartbeat < timeout);
    }
    /**
     * 查找具备特定能力的Agent
     */
    findAgentsByCapability(capability) {
        return this.getOnlineAgents().filter(a => a.capabilities.includes(capability));
    }
    // ---------------------------------------------------------------------------
    // 消息发布与订阅
    // ---------------------------------------------------------------------------
    /**
     * 订阅主题
     */
    subscribe(agentId, topic, filter) {
        const subscriptionId = `${agentId}:${topic}:${Date.now()}`;
        const subs = this.subscriptions.get(agentId) || [];
        subs.push({ id: subscriptionId, agentId, topic, filter });
        this.subscriptions.set(agentId, subs);
        return subscriptionId;
    }
    /**
     * 取消订阅
     */
    unsubscribe(agentId, subscriptionId) {
        if (subscriptionId) {
            const subs = this.subscriptions.get(agentId) || [];
            const idx = subs.findIndex(s => s.id === subscriptionId);
            if (idx >= 0)
                subs.splice(idx, 1);
        }
        else {
            this.subscriptions.delete(agentId);
        }
    }
    /**
     * 发布消息到主题
     */
    publish(topic, payload, from, priority = 'normal') {
        const message = {
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
    send(to, payload, from, options) {
        const message = {
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
    broadcast(payload, from, options) {
        const message = {
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
            if (options?.exclude?.includes(agent.id))
                continue;
            this._deliverToAgent({ ...message, to: agent.id });
        }
        this.emit('message:broadcast', message);
    }
    /**
     * 发送请求并等待响应
     */
    async request(to, payload, from, timeoutMs = 30000) {
        const correlationId = this._generateId();
        const message = {
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
    respond(to, payload, from, correlationId) {
        const message = {
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
    _generateId() {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    _storeMessage(message) {
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
    _persistMessage(message) {
        try {
            const file = path.join(this.historyDir, `${new Date().toISOString().split('T')[0]}.jsonl`);
            const line = JSON.stringify(message) + '\n';
            fs.appendFileSync(file, line);
        }
        catch (e) {
            console.warn('[agent-bus] Failed to persist message:', e);
        }
    }
    _deliverToSubscribers(message) {
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
    _deliverToAgent(message) {
        if (message.to) {
            this.emit(`message:${message.to}`, message);
        }
    }
    _cleanupExpiredMessages() {
        const now = Date.now();
        this.messageHistory = this.messageHistory.filter(m => !m.ttl || m.timestamp + m.ttl > now);
    }
    _cleanupOfflineAgents() {
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
    getMessageHistory(options) {
        let result = this.messageHistory;
        if (options?.from)
            result = result.filter(m => m.from === options.from);
        if (options?.to)
            result = result.filter(m => m.to === options.to);
        if (options?.topic)
            result = result.filter(m => m.topic === options.topic);
        if (options?.type)
            result = result.filter(m => m.type === options.type);
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
    getStats() {
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
let _bus = null;
export function getAgentBus() {
    if (!_bus) {
        _bus = new AgentBus();
    }
    return _bus;
}
// ---------------------------------------------------------------------------
// 装饰器: 自动注册Agent方法为消息处理器
// ---------------------------------------------------------------------------
export function MessageHandler(topic) {
    return function (target, propertyKey, descriptor) {
        const originalMethod = descriptor.value;
        descriptor.value = function (...args) {
            const bus = getAgentBus();
            const agentId = this.agentId;
            if (agentId && topic) {
                bus.on(`message:${agentId}`, (msg) => {
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
