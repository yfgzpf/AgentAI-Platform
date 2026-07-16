/**
 * CustomerStore — 客户档案持久化系统
 * ==================================================================
 * 存储路径: ~/.agentai/customers/
 *   - customers.jsonl  — 所有客户档案 (JSONL, 一行一个客户)
 *   - journey-{customerId}.jsonl — 客户旅程事件 (每个客户独立文件)
 *
 * 与 channel-session-bridge 的关系:
 *   bridge 负责 渠道身份 → 统一 sessionId 映射
 *   customer-store 负责 渠道身份 → 客户档案 映射
 *   一个客户可以绑定多个渠道 (QQ + 微信 + 电话)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ===== 类型定义 =====

export type ChannelType = 'qq' | 'wechat' | 'web' | 'phone';

export interface ChannelIdentity {
  type: ChannelType;
  id: string;               // 渠道内唯一标识
  label?: string;            // 显示名 (QQ昵称/微信名)
  boundAt: number;
}

export type JourneyType = 'message' | 'call' | 'visit' | 'quote' | 'followup' | 'note' | 'signup';
export type Sentiment = 'positive' | 'neutral' | 'negative' | 'unknown';

export interface JourneyEvent {
  id: string;
  ts: number;
  type: JourneyType;
  channel: ChannelType;
  summary: string;           // AI 自动摘要
  sentiment?: Sentiment;
  /** 关联的消息ID (如果有) */
  messageId?: string;
  /** 跟进结果 (followup 类型时) */
  outcome?: 'pending' | 'success' | 'failed' | 'rescheduled';
}

export interface Customer {
  customerId: string;        // 内部唯一ID: cust-{timestamp}-{random}
  name: string;              // 客户名称
  phone?: string;            // 电话
  email?: string;            // 邮箱
  channels: ChannelIdentity[];  // 多渠道身份
  tags: string[];            // 标签: "高意向", "已签约", "待跟进"
  industry?: string;         // 行业: "装修", "教育"
  notes?: string;            // 备注
  intent?: 'high' | 'medium' | 'low' | 'none';  // 意向度
  /** 下次跟进时间 (timestamp, AI 推荐) */
  nextFollowUpAt?: number;
  /** 上次沟通时间 */
  lastContactAt?: number;
  /** 总沟通次数 */
  contactCount: number;
  createdAt: number;
  updatedAt: number;
}

// ===== 持久化路径 =====

const CUSTOMERS_DIR = path.join(os.homedir(), '.agentai', 'customers');
const CUSTOMERS_FILE = path.join(CUSTOMERS_DIR, 'customers.jsonl');

function ensureDir(): void {
  if (!fs.existsSync(CUSTOMERS_DIR)) {
    fs.mkdirSync(CUSTOMERS_DIR, { recursive: true });
  }
}

function journeyFilePath(customerId: string): string {
  return path.join(CUSTOMERS_DIR, `journey-${customerId}.jsonl`);
}

// ===== 内存缓存 =====

let _customersCache: Map<string, Customer> | null = null;

function loadCache(): Map<string, Customer> {
  if (_customersCache) return _customersCache;
  _customersCache = new Map();
  ensureDir();
  try {
    if (fs.existsSync(CUSTOMERS_FILE)) {
      const lines = fs.readFileSync(CUSTOMERS_FILE, 'utf-8').split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const c = JSON.parse(line) as Customer;
          _customersCache.set(c.customerId, c);
        } catch { /* skip bad lines */ }
      }
    }
  } catch { /* best effort */ }
  return _customersCache;
}

function persistAll(): void {
  ensureDir();
  const cache = loadCache();
  const lines = Array.from(cache.values()).map(c => JSON.stringify(c));
  // 原子写入
  const tmp = CUSTOMERS_FILE + '.tmp';
  fs.writeFileSync(tmp, lines.join('\n') + '\n', 'utf-8');
  fs.renameSync(tmp, CUSTOMERS_FILE);
}

function appendJourney(customerId: string, event: JourneyEvent): void {
  ensureDir();
  try {
    fs.appendFileSync(journeyFilePath(customerId), JSON.stringify(event) + '\n', 'utf-8');
  } catch (e: any) {
    console.warn('[customer-store] journey append failed:', e?.message);
  }
}

// ===== 核心 API =====

/**
 * 创建新客户
 */
export function createCustomer(data: {
  name: string;
  phone?: string;
  email?: string;
  channels?: ChannelIdentity[];
  tags?: string[];
  industry?: string;
  notes?: string;
  intent?: Customer['intent'];
}): Customer {
  const now = Date.now();
  const customer: Customer = {
    customerId: `cust-${now}-${Math.random().toString(36).slice(2, 8)}`,
    name: data.name,
    phone: data.phone,
    email: data.email,
    channels: data.channels || [],
    tags: data.tags || [],
    industry: data.industry,
    notes: data.notes,
    intent: data.intent || 'none',
    contactCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  const cache = loadCache();
  cache.set(customer.customerId, customer);
  persistAll();
  return customer;
}

/**
 * 获取客户
 */
export function getCustomer(customerId: string): Customer | null {
  return loadCache().get(customerId) || null;
}

/**
 * 更新客户
 */
export function updateCustomer(customerId: string, updates: Partial<Customer>): Customer | null {
  const cache = loadCache();
  const existing = cache.get(customerId);
  if (!existing) return null;
  const updated = { ...existing, ...updates, updatedAt: Date.now() };
  cache.set(customerId, updated);
  persistAll();
  return updated;
}

/**
 * 删除客户
 */
export function deleteCustomer(customerId: string): boolean {
  const cache = loadCache();
  if (!cache.has(customerId)) return false;
  cache.delete(customerId);
  persistAll();
  // 删除旅程文件
  try { fs.unlinkSync(journeyFilePath(customerId)); } catch { /* best effort */ }
  return true;
}

/**
 * 列出所有客户 (支持搜索和筛选)
 */
export function listCustomers(opts?: {
  search?: string;           // 搜索 name/phone/notes
  tags?: string[];           // 按标签筛选
  intent?: Customer['intent'];  // 按意向筛选
  industry?: string;         // 按行业筛选
  limit?: number;
}): Customer[] {
  const cache = loadCache();
  let list = Array.from(cache.values());

  if (opts?.search) {
    const q = opts.search.toLowerCase();
    list = list.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.phone?.includes(q) ||
      c.notes?.toLowerCase().includes(q)
    );
  }
  if (opts?.tags && opts.tags.length > 0) {
    list = list.filter(c => opts.tags!.some(t => c.tags.includes(t)));
  }
  if (opts?.intent) {
    list = list.filter(c => c.intent === opts.intent);
  }
  if (opts?.industry) {
    list = list.filter(c => c.industry === opts.industry);
  }

  // 按最后联系时间降序
  list.sort((a, b) => (b.lastContactAt || b.updatedAt) - (a.lastContactAt || a.updatedAt));

  if (opts?.limit) list = list.slice(0, opts.limit);
  return list;
}

/**
 * 按渠道身份查找客户 (多渠道合并的关键)
 */
export function findByChannel(channel: ChannelType, channelId: string): Customer | null {
  const cache = loadCache();
  for (const c of cache.values()) {
    if (c.channels.some(ch => ch.type === channel && ch.id === channelId)) {
      return c;
    }
  }
  return null;
}

/**
 * 给客户绑定新渠道身份
 */
export function bindChannel(customerId: string, channel: ChannelIdentity): Customer | null {
  const cache = loadCache();
  const existing = cache.get(customerId);
  if (!existing) return null;
  // 去重: 同渠道同ID不重复绑定
  if (existing.channels.some(ch => ch.type === channel.type && ch.id === channel.id)) {
    return existing;
  }
  existing.channels.push(channel);
  existing.updatedAt = Date.now();
  cache.set(customerId, existing);
  persistAll();
  return existing;
}

/**
 * 添加客户旅程事件
 */
export function addJourneyEvent(customerId: string, event: Omit<JourneyEvent, 'id' | 'ts'> & { ts?: number }): JourneyEvent | null {
  const customer = getCustomer(customerId);
  if (!customer) return null;

  const fullEvent: JourneyEvent = {
    id: `jrn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    ts: event.ts || Date.now(),
    ...event,
  };

  appendJourney(customerId, fullEvent);

  // 更新客户统计
  updateCustomer(customerId, {
    lastContactAt: fullEvent.ts,
    contactCount: customer.contactCount + 1,
  });

  return fullEvent;
}

/**
 * 获取客户旅程时间线
 */
export function getJourney(customerId: string, limit = 50): JourneyEvent[] {
  const filePath = journeyFilePath(customerId);
  if (!fs.existsSync(filePath)) return [];
  try {
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(l => l.trim());
    const events = lines.slice(-limit).map(l => {
      try { return JSON.parse(l) as JourneyEvent; } catch { return null; }
    }).filter(Boolean) as JourneyEvent[];
    return events.sort((a, b) => b.ts - a.ts);  // 最新的在前
  } catch {
    return [];
  }
}

/**
 * 自动记录消息到客户旅程 (供 QQ/微信消息处理调用)
 */
export function recordMessage(channel: ChannelType, channelId: string, content: string, sentiment: Sentiment = 'unknown'): { customer: Customer; event: JourneyEvent } | null {
  // 查找已有客户
  let customer = findByChannel(channel, channelId);

  // 未找到则自动创建
  if (!customer) {
    customer = createCustomer({
      name: `${channel}-${channelId.slice(0, 8)}`,
      channels: [{ type: channel, id: channelId, boundAt: Date.now() }],
      tags: ['自动创建'],
      intent: 'none',
    });
  }

  // 生成摘要 (截取前50字)
  const summary = content.length > 50 ? content.slice(0, 50) + '...' : content;

  const event = addJourneyEvent(customer.customerId, {
    type: 'message',
    channel,
    summary,
    sentiment,
  });

  if (!event) return null;
  return { customer, event };
}

/**
 * 获取待跟进客户列表 (nextFollowUpAt 已到期)
 */
export function getPendingFollowUps(): Customer[] {
  const now = Date.now();
  return listCustomers().filter(c =>
    c.nextFollowUpAt && c.nextFollowUpAt <= now && c.intent !== 'none'
  );
}

/**
 * 生成客户上下文 (供 AI 对话注入)
 * ==================================================================
 * 当 QQ/微信客户发来消息时, 调用此函数获取客户档案 + 跟进提醒
 * 注入到 AI 消息前缀, 让 AI 自然地:
 *   - 记住客户是谁
 *   - 如果有待跟进事项, 在回复中自然提起
 *
 * @returns 上下文字符串 (无客户时返回 null)
 */
export function getCustomerContext(channel: ChannelType, channelId: string): string | null {
  const customer = findByChannel(channel, channelId);
  if (!customer) return null;

  const parts: string[] = [];

  // 客户档案摘要
  parts.push(`[客户档案] 姓名: ${customer.name} | 意向: ${customer.intent || '未知'} | 标签: ${customer.tags.join(', ') || '无'} | 行业: ${customer.industry || '未指定'} | 沟通次数: ${customer.contactCount}`);

  if (customer.notes) {
    parts.push(`[备注] ${customer.notes}`);
  }

  // 最近沟通记录 (最近 3 条)
  const journey = getJourney(customer.customerId, 3);
  if (journey.length > 0) {
    const journeyText = journey.map(j => `  - ${j.type}(${j.channel}): ${j.summary}`).join('\n');
    parts.push(`[最近沟通]\n${journeyText}`);
  }

  // 跟进提醒: 如果 nextFollowUpAt 已到期, 提示 AI 自然跟进
  if (customer.nextFollowUpAt && customer.nextFollowUpAt <= Date.now()) {
    const daysOverdue = Math.floor((Date.now() - customer.nextFollowUpAt) / 86400000);
    const lastContact = customer.lastContactAt
      ? `${Math.floor((Date.now() - customer.lastContactAt) / 86400000)}天前`
      : '从未';
    parts.push(`[跟进提醒] 该客户已有待跟进事项 (逾期${daysOverdue}天, 上次联系: ${lastContact}). 请在回复中自然地跟进客户近况, 不要生硬推销.`);
  }

  return parts.join('\n');
}

/**
 * 客户主动联系后, 清除跟进标记 (已自然完成跟进)
 */
export function clearFollowUp(channel: ChannelType, channelId: string): void {
  const customer = findByChannel(channel, channelId);
  if (customer && customer.nextFollowUpAt) {
    updateCustomer(customer.customerId, { nextFollowUpAt: undefined });
    console.log(`[customer-store] 清除跟进标记: ${customer.name}`);
  }
}
