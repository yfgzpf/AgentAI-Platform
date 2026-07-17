/**
 * LeadConversionSystem - 线索转化自动化系统
 * 
 * 基于zyai微信自动化实现，构建真实的线索到成交闭环：
 * 
 * 1. 线索捕获（多渠道）
 * 2. 线索评分与分级
 * 3. 自动添加微信
 * 4. 智能话术培育
 * 5. 跟进提醒与任务
 * 6. 成交转化追踪
 * 7. 客户生命周期管理
 */

import { EventEmitter } from 'events';
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

// ═══════════════════════════════════════════════════════════
// 数据库初始化
// ═══════════════════════════════════════════════════════════

const DB_PATH = path.join(process.cwd(), '.agentai', 'lead-conversion.db');

function initDatabase(): Database.Database {
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const db = new Database(DB_PATH);
  
  db.exec(`
    -- 线索表
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL, -- wechat, xiaohongshu, douyin, website, referral
      source_detail TEXT,
      name TEXT,
      phone TEXT,
      wechat_id TEXT,
      email TEXT,
      company TEXT,
      industry TEXT,
      budget_min INTEGER,
      budget_max INTEGER,
      requirements TEXT,
      urgency TEXT, -- high, medium, low
      score INTEGER DEFAULT 0,
      stage TEXT DEFAULT 'new', -- new, contacted, qualified, proposal, negotiation, closed_won, closed_lost
      assigned_to TEXT,
      tags TEXT, -- JSON array
      notes TEXT,
      last_contact_at INTEGER,
      next_follow_up_at INTEGER,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    );

    -- 微信好友申请表
    CREATE TABLE IF NOT EXISTS wechat_friend_requests (
      id TEXT PRIMARY KEY,
      lead_id TEXT,
      wechat_id TEXT NOT NULL,
      phone TEXT,
      greeting_message TEXT,
      status TEXT DEFAULT 'pending', -- pending, sent, accepted, rejected, expired
      sent_at INTEGER,
      accepted_at INTEGER,
      error_message TEXT,
      retry_count INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    );

    -- 对话记录表
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id TEXT,
      platform TEXT, -- wechat, phone, email
      direction TEXT, -- inbound, outbound
      message_type TEXT, -- text, image, voice, file
      content TEXT,
      ai_generated INTEGER DEFAULT 0,
      intent TEXT, -- inquiry, complaint, price_query, appointment, etc.
      sentiment TEXT, -- positive, neutral, negative
      responded INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    );

    -- 跟进任务表
    CREATE TABLE IF NOT EXISTS follow_up_tasks (
      id TEXT PRIMARY KEY,
      lead_id TEXT,
      task_type TEXT, -- call, wechat, visit, email, proposal
      priority TEXT, -- high, medium, low
      description TEXT,
      scheduled_at INTEGER,
      completed_at INTEGER,
      status TEXT DEFAULT 'pending', -- pending, completed, cancelled
      result TEXT,
      created_by TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    );

    -- 成交记录表
    CREATE TABLE IF NOT EXISTS deals (
      id TEXT PRIMARY KEY,
      lead_id TEXT,
      deal_name TEXT,
      value INTEGER,
      currency TEXT DEFAULT 'CNY',
      stage TEXT, -- proposal, negotiation, contract, closed_won, closed_lost
      probability INTEGER, -- 0-100
      expected_close_date INTEGER,
      actual_close_date INTEGER,
      products TEXT, -- JSON array
      competitors TEXT,
      win_reason TEXT,
      loss_reason TEXT,
      commission INTEGER,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    );

    -- 智能话术库
    CREATE TABLE IF NOT EXISTS message_templates (
      id TEXT PRIMARY KEY,
      name TEXT,
      category TEXT, -- greeting, follow_up, proposal, objection_handling, closing
      industry TEXT,
      stage TEXT,
      content TEXT,
      variables TEXT, -- JSON array of variable names
      effectiveness_score INTEGER DEFAULT 0,
      usage_count INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(stage);
    CREATE INDEX IF NOT EXISTS idx_leads_score ON leads(score);
    CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(source);
    CREATE INDEX IF NOT EXISTS idx_conversations_lead ON conversations(lead_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON follow_up_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage);
  `);

  return db;
}

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

export interface Lead {
  id: string;
  source: string;
  sourceDetail?: string;
  name?: string;
  phone?: string;
  wechatId?: string;
  email?: string;
  company?: string;
  industry?: string;
  budgetMin?: number;
  budgetMax?: number;
  requirements?: string;
  urgency?: 'high' | 'medium' | 'low';
  score: number;
  stage: string;
  assignedTo?: string;
  tags?: string[];
  notes?: string;
  lastContactAt?: number;
  nextFollowUpAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface WeChatFriendRequest {
  id: string;
  leadId?: string;
  wechatId: string;
  phone?: string;
  greetingMessage: string;
  status: 'pending' | 'sent' | 'accepted' | 'rejected' | 'expired';
  sentAt?: number;
  acceptedAt?: number;
  errorMessage?: string;
  retryCount: number;
}

export interface Conversation {
  id: number;
  leadId: string;
  platform: string;
  direction: 'inbound' | 'outbound';
  messageType: string;
  content: string;
  aiGenerated: boolean;
  intent?: string;
  sentiment?: string;
  responded: boolean;
  createdAt: number;
}

export interface FollowUpTask {
  id: string;
  leadId: string;
  taskType: string;
  priority: string;
  description: string;
  scheduledAt: number;
  completedAt?: number;
  status: string;
  result?: string;
}

export interface Deal {
  id: string;
  leadId: string;
  dealName: string;
  value: number;
  stage: string;
  probability: number;
  expectedCloseDate?: number;
  actualCloseDate?: number;
}

// ═══════════════════════════════════════════════════════════
// 线索评分引擎
// ═══════════════════════════════════════════════════════════

export class LeadScoringEngine {
  calculateScore(lead: Partial<Lead>): number {
    let score = 0;

    // 基础信息完整度 (最高30分)
    if (lead.name) score += 5;
    if (lead.phone) score += 5;
    if (lead.wechatId) score += 5;
    if (lead.email) score += 5;
    if (lead.company) score += 5;
    if (lead.requirements) score += 5;

    // 预算 (最高25分)
    if (lead.budgetMin && lead.budgetMax) {
      const avgBudget = (lead.budgetMin + lead.budgetMax) / 2;
      if (avgBudget > 100000) score += 25;
      else if (avgBudget > 50000) score += 20;
      else if (avgBudget > 20000) score += 15;
      else if (avgBudget > 10000) score += 10;
      else score += 5;
    }

    // 紧急程度 (最高20分)
    switch (lead.urgency) {
      case 'high': score += 20; break;
      case 'medium': score += 12; break;
      case 'low': score += 5; break;
    }

    // 来源质量 (最高15分)
    const sourceQuality: Record<string, number> = {
      'referral': 15,
      'wechat': 12,
      'website': 10,
      'xiaohongshu': 10,
      'douyin': 8,
      'cold_call': 5,
    };
    score += sourceQuality[lead.source || ''] || 5;

    // 行业匹配 (最高10分)
    const targetIndustries = ['decoration', 'real_estate', 'enterprise'];
    if (lead.industry && targetIndustries.includes(lead.industry)) {
      score += 10;
    }

    return Math.min(100, score);
  }

  getPriority(score: number): 'high' | 'medium' | 'low' {
    if (score >= 70) return 'high';
    if (score >= 40) return 'medium';
    return 'low';
  }
}

// ═══════════════════════════════════════════════════════════
// 微信自动化接口（基于zyai实现）
// ═══════════════════════════════════════════════════════════

export interface WeChatAutomationInterface {
  sendFriendRequest(phone: string, greeting: string): Promise<{ success: boolean; message: string }>;
  sendMessage(to: string, content: string): Promise<{ success: boolean; messageId: string }>;
  getMessages(): Promise<Array<{ from: string; content: string; timestamp: number }>>;
  acceptFriendRequest(wechatId: string): Promise<boolean>;
}

// ═══════════════════════════════════════════════════════════
// 线索转化系统主类
// ═══════════════════════════════════════════════════════════

export class LeadConversionSystem extends EventEmitter {
  private db: Database.Database;
  private scoringEngine: LeadScoringEngine;
  private wechatInterface?: WeChatAutomationInterface;

  constructor() {
    super();
    this.db = initDatabase();
    this.scoringEngine = new LeadScoringEngine();
  }

  /**
   * 设置微信自动化接口
   */
  setWeChatInterface(iface: WeChatAutomationInterface): void {
    this.wechatInterface = iface;
  }

  /**
   * 创建线索
   */
  createLead(leadData: Omit<Lead, 'id' | 'score' | 'stage' | 'createdAt' | 'updatedAt'>): Lead {
    const id = `lead-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    
    // 计算评分
    const score = this.scoringEngine.calculateScore(leadData);
    const priority = this.scoringEngine.getPriority(score);

    const lead: Lead = {
      ...leadData,
      id,
      score,
      stage: 'new',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tags: [...(leadData.tags || []), priority],
    };

    // 保存到数据库
    const stmt = this.db.prepare(`
      INSERT INTO leads (id, source, source_detail, name, phone, wechat_id, email, 
        company, industry, budget_min, budget_max, requirements, urgency, score, 
        stage, assigned_to, tags, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      lead.id, lead.source, lead.sourceDetail, lead.name, lead.phone, lead.wechatId,
      lead.email, lead.company, lead.industry, lead.budgetMin, lead.budgetMax,
      lead.requirements, lead.urgency, lead.score, lead.stage, lead.assignedTo,
      JSON.stringify(lead.tags), lead.notes, lead.createdAt, lead.updatedAt
    );

    this.emit('lead:created', lead);

    // 自动触发后续动作
    this.processNewLead(lead);

    return lead;
  }

  /**
   * 处理新线索
   */
  private async processNewLead(lead: Lead): Promise<void> {
    // 高优先级线索立即分配
    if (lead.score >= 70) {
      this.createFollowUpTask({
        leadId: lead.id,
        taskType: 'call',
        priority: 'high',
        description: `高优先级线索跟进：${lead.name || '未知'}`,
        scheduledAt: Date.now() + 30 * 60 * 1000, // 30分钟后
      });
    }

    // 如果有手机号，自动发送微信好友申请
    if (lead.phone && this.wechatInterface) {
      await this.sendWeChatFriendRequest(lead);
    }
  }

  /**
   * 发送微信好友申请
   */
  async sendWeChatFriendRequest(lead: Lead): Promise<WeChatFriendRequest> {
    if (!this.wechatInterface) {
      throw new Error('微信自动化接口未配置');
    }

    const requestId = `req-${Date.now()}`;
    
    // 生成个性化问候语
    const greeting = this.generateGreetingMessage(lead);

    const request: WeChatFriendRequest = {
      id: requestId,
      leadId: lead.id,
      wechatId: lead.wechatId || lead.phone!,
      phone: lead.phone,
      greetingMessage: greeting,
      status: 'pending',
      retryCount: 0,
    };

    // 保存到数据库
    const stmt = this.db.prepare(`
      INSERT INTO wechat_friend_requests 
      (id, lead_id, wechat_id, phone, greeting_message, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(request.id, request.leadId, request.wechatId, request.phone, 
             request.greetingMessage, request.status, Date.now());

    try {
      // 调用微信自动化接口
      const result = await this.wechatInterface.sendFriendRequest(
        request.phone!,
        request.greetingMessage
      );

      if (result.success) {
        request.status = 'sent';
        request.sentAt = Date.now();
        
        this.updateFriendRequestStatus(request.id, 'sent', { sentAt: request.sentAt });
        this.emit('friend_request:sent', request);
      } else {
        throw new Error(result.message);
      }
    } catch (error: any) {
      request.errorMessage = error.message;
      this.updateFriendRequestStatus(request.id, 'pending', { 
        errorMessage: error.message,
        retryCount: request.retryCount + 1
      });
      this.emit('friend_request:failed', request);
    }

    return request;
  }

  /**
   * 生成个性化问候语
   */
  private generateGreetingMessage(lead: Lead): string {
    const templates = [
      `您好${lead.name ? '，' + lead.name : ''}！我是XX公司的顾问，看到您对${lead.requirements?.slice(0, 10) || '我们的服务'}感兴趣，想为您提供专业建议。`,
      `您好！我是专门做${lead.industry === 'decoration' ? '装修' : '企业服务'}的顾问，可以加个微信详细沟通一下您的需求吗？`,
      `您好${lead.name ? ' ' + lead.name : ''}！感谢您关注我们的服务，我是您的专属顾问，有任何问题随时找我。`,
    ];

    // 根据来源选择最合适的模板
    const index = lead.source === 'website' ? 0 : lead.source === 'referral' ? 2 : 1;
    return templates[index];
  }

  /**
   * 更新好友申请状态
   */
  private updateFriendRequestStatus(
    requestId: string, 
    status: string, 
    updates: Partial<WeChatFriendRequest>
  ): void {
    const fields = ['status = ?'];
    const values = [status];

    if (updates.sentAt) {
      fields.push('sent_at = ?');
      values.push(updates.sentAt);
    }
    if (updates.acceptedAt) {
      fields.push('accepted_at = ?');
      values.push(updates.acceptedAt);
    }
    if (updates.errorMessage) {
      fields.push('error_message = ?');
      values.push(updates.errorMessage);
    }
    if (updates.retryCount !== undefined) {
      fields.push('retry_count = ?');
      values.push(updates.retryCount);
    }

    values.push(requestId);

    const stmt = this.db.prepare(`
      UPDATE wechat_friend_requests SET ${fields.join(', ')} WHERE id = ?
    `);
    stmt.run(...values);
  }

  /**
   * 记录对话
   */
  recordConversation(conv: Omit<Conversation, 'id' | 'createdAt'>): Conversation {
    const stmt = this.db.prepare(`
      INSERT INTO conversations 
      (lead_id, platform, direction, message_type, content, ai_generated, intent, sentiment, responded, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const createdAt = Date.now();
    const result = stmt.run(
      conv.leadId, conv.platform, conv.direction, conv.messageType,
      conv.content, conv.aiGenerated ? 1 : 0, conv.intent, conv.sentiment,
      conv.responded ? 1 : 0, createdAt
    );

    // 更新线索最后联系时间
    this.updateLeadContactTime(conv.leadId);

    this.emit('conversation:recorded', { ...conv, id: result.lastInsertRowid, createdAt });

    return { ...conv, id: result.lastInsertRowid as number, createdAt };
  }

  /**
   * 更新线索联系时间
   */
  private updateLeadContactTime(leadId: string): void {
    const stmt = this.db.prepare(`
      UPDATE leads SET last_contact_at = ?, updated_at = ? WHERE id = ?
    `);
    stmt.run(Date.now(), Date.now(), leadId);
  }

  /**
   * 创建跟进任务
   */
  createFollowUpTask(task: Omit<FollowUpTask, 'id' | 'status' | 'created_at'>): FollowUpTask {
    const id = `task-${Date.now()}`;
    
    const newTask: FollowUpTask = {
      ...task,
      id,
      status: 'pending',
    };

    const stmt = this.db.prepare(`
      INSERT INTO follow_up_tasks 
      (id, lead_id, task_type, priority, description, scheduled_at, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      newTask.id, newTask.leadId, newTask.taskType, newTask.priority,
      newTask.description, newTask.scheduledAt, newTask.status, Date.now()
    );

    this.emit('task:created', newTask);

    return newTask;
  }

  /**
   * 更新线索阶段
   */
  updateLeadStage(leadId: string, newStage: string, notes?: string): void {
    const stmt = this.db.prepare(`
      UPDATE leads SET stage = ?, notes = COALESCE(notes, '') || ? || '\n', updated_at = ? WHERE id = ?
    `);
    
    const noteText = notes ? `\n[${new Date().toLocaleString()}] ${notes}` : '';
    stmt.run(newStage, noteText, Date.now(), leadId);

    this.emit('lead:stage_changed', { leadId, newStage, notes });

    // 阶段变更触发相应动作
    if (newStage === 'closed_won') {
      this.createDealFromLead(leadId);
    }
  }

  /**
   * 从线索创建成交
   */
  private createDealFromLead(leadId: string): Deal {
    const lead = this.getLead(leadId);
    if (!lead) throw new Error('线索不存在');

    const deal: Deal = {
      id: `deal-${Date.now()}`,
      leadId,
      dealName: `${lead.company || lead.name || '未知客户'} - 成交`,
      value: lead.budgetMax || lead.budgetMin || 0,
      stage: 'closed_won',
      probability: 100,
      actualCloseDate: Date.now(),
    };

    const stmt = this.db.prepare(`
      INSERT INTO deals 
      (id, lead_id, deal_name, value, stage, probability, actual_close_date, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      deal.id, deal.leadId, deal.dealName, deal.value, deal.stage,
      deal.probability, deal.actualCloseDate, Date.now(), Date.now()
    );

    this.emit('deal:created', deal);

    return deal;
  }

  /**
   * 获取线索
   */
  getLead(leadId: string): Lead | null {
    const stmt = this.db.prepare('SELECT * FROM leads WHERE id = ?');
    const row = stmt.get(leadId) as any;
    
    if (!row) return null;

    return this.rowToLead(row);
  }

  /**
   * 获取线索列表
   */
  getLeads(filters?: { stage?: string; source?: string; minScore?: number }): Lead[] {
    let sql = 'SELECT * FROM leads WHERE 1=1';
    const params: any[] = [];

    if (filters?.stage) {
      sql += ' AND stage = ?';
      params.push(filters.stage);
    }
    if (filters?.source) {
      sql += ' AND source = ?';
      params.push(filters.source);
    }
    if (filters?.minScore) {
      sql += ' AND score >= ?';
      params.push(filters.minScore);
    }

    sql += ' ORDER BY score DESC, created_at DESC';

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => this.rowToLead(row));
  }

  private rowToLead(row: any): Lead {
    return {
      id: row.id,
      source: row.source,
      sourceDetail: row.source_detail,
      name: row.name,
      phone: row.phone,
      wechatId: row.wechat_id,
      email: row.email,
      company: row.company,
      industry: row.industry,
      budgetMin: row.budget_min,
      budgetMax: row.budget_max,
      requirements: row.requirements,
      urgency: row.urgency,
      score: row.score,
      stage: row.stage,
      assignedTo: row.assigned_to,
      tags: JSON.parse(row.tags || '[]'),
      notes: row.notes,
      lastContactAt: row.last_contact_at,
      nextFollowUpAt: row.next_follow_up_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * 获取转化漏斗数据
   */
  getConversionFunnel(): { stage: string; count: number; value: number }[] {
    const stmt = this.db.prepare(`
      SELECT stage, COUNT(*) as count, COALESCE(SUM(budget_max), 0) as value
      FROM leads
      GROUP BY stage
      ORDER BY 
        CASE stage
          WHEN 'new' THEN 1
          WHEN 'contacted' THEN 2
          WHEN 'qualified' THEN 3
          WHEN 'proposal' THEN 4
          WHEN 'negotiation' THEN 5
          WHEN 'closed_won' THEN 6
          WHEN 'closed_lost' THEN 7
          ELSE 8
        END
    `);

    return stmt.all() as any[];
  }

  /**
   * 获取统计报表
   */
  getDashboardStats(): {
    totalLeads: number;
    newLeadsToday: number;
    dealsThisMonth: number;
    revenueThisMonth: number;
    conversionRate: number;
    avgDealValue: number;
  } {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const totalLeads = this.db.prepare('SELECT COUNT(*) as count FROM leads').get() as any;
    
    const newLeadsToday = this.db.prepare(
      'SELECT COUNT(*) as count FROM leads WHERE created_at >= ?'
    ).get(today.getTime()) as any;

    const dealsThisMonth = this.db.prepare(
      'SELECT COUNT(*) as count, COALESCE(SUM(value), 0) as revenue FROM deals WHERE stage = ? AND actual_close_date >= ?'
    ).get('closed_won', thisMonth.getTime()) as any;

    const wonDeals = this.db.prepare(
      'SELECT COUNT(*) as count FROM deals WHERE stage = ?'
    ).get('closed_won') as any;

    const totalQualified = this.db.prepare(
      "SELECT COUNT(*) as count FROM leads WHERE stage IN ('qualified', 'proposal', 'negotiation', 'closed_won')"
    ).get() as any;

    return {
      totalLeads: totalLeads.count,
      newLeadsToday: newLeadsToday.count,
      dealsThisMonth: dealsThisMonth.count,
      revenueThisMonth: dealsThisMonth.revenue,
      conversionRate: totalQualified.count > 0 ? (wonDeals.count / totalQualified.count) : 0,
      avgDealValue: dealsThisMonth.count > 0 ? (dealsThisMonth.revenue / dealsThisMonth.count) : 0,
    };
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    this.db.close();
  }
}

// 单例导出
let leadConversionSystem: LeadConversionSystem | null = null;

export function getLeadConversionSystem(): LeadConversionSystem {
  if (!leadConversionSystem) {
    leadConversionSystem = new LeadConversionSystem();
  }
  return leadConversionSystem;
}
