/**
 * FollowUpScheduler — 跟进提醒引擎 (纯提醒模式)
 * ==================================================================
 * 核心认知: QQ/微信 Bot 只能被动回复, 不能主动推送
 *
 * 因此本模块不做"发送消息", 只做:
 *   1. 扫描到期客户 (nextFollowUpAt <= now)
 *   2. 生成跟进建议 (AI 话术 + 理由) — 供用户参考
 *   3. 推送到前端 CustomerWidget 显示提醒
 *   4. 用户看到后自行决定如何联系客户
 *
 * 被动跟进 (最自然的场景):
 *   客户主动发消息 → agentai-loop 检查有无 pending 跟进
 *   → 注入上下文 → AI 在回复中自然提起
 */
import { EventEmitter } from 'events';
import * as store from './customer-store.js';

export interface FollowUpReminder {
  id: string;
  customerId: string;
  customerName: string;
  /** 可用渠道 (用户可自行选择如何联系) */
  channels: Array<{ type: string; id: string; label?: string }>;
  /** AI 生成的跟进建议话术 — 供用户参考 */
  suggestedMessage: string;
  /** 跟进理由 */
  reason: string;
  /** 创建时间 */
  createdAt: number;
  /** 状态: pending / done / skipped */
  status: 'pending' | 'done' | 'skipped';
  resolvedAt?: number;
}

class FollowUpScheduler extends EventEmitter {
  private reminders: Map<string, FollowUpReminder> = new Map();
  private gatewayUrl: string = '';

  setGatewayUrl(url: string): void {
    this.gatewayUrl = url;
  }

  /**
   * 扫描到期客户 + 生成跟进建议
   * 由 CronDispatcher 每小时调用
   */
  async checkAndGenerate(): Promise<FollowUpReminder[]> {
    const pending = store.getPendingFollowUps();
    if (pending.length === 0) return [];

    const newReminders: FollowUpReminder[] = [];

    for (const customer of pending) {
      // 跳过已有 pending 提醒的客户
      const hasExisting = Array.from(this.reminders.values()).some(
        r => r.customerId === customer.customerId && r.status === 'pending'
      );
      if (hasExisting) continue;

      // 生成 AI 跟进建议
      const draft = await this.generateSuggestion(customer);

      const reminder: FollowUpReminder = {
        id: `reminder-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        customerId: customer.customerId,
        customerName: customer.name,
        channels: customer.channels.map(c => ({ type: c.type, id: c.id, label: c.label })),
        suggestedMessage: draft.message,
        reason: draft.reason,
        createdAt: Date.now(),
        status: 'pending',
      };

      this.reminders.set(reminder.id, reminder);
      newReminders.push(reminder);

      this.emit('reminder:created', reminder);
    }

    if (newReminders.length > 0) {
      console.log(`[follow-up] 生成 ${newReminders.length} 条跟进提醒`);
    }

    return newReminders;
  }

  /**
   * AI 生成跟进建议话术 (供用户参考, 不是自动发送)
   */
  private async generateSuggestion(customer: any): Promise<{ message: string; reason: string }> {
    const journey = store.getJourney(customer.customerId, 5);
    const lastContact = customer.lastContactAt
      ? new Date(customer.lastContactAt).toLocaleDateString()
      : '从未联系';

    const journeyText = journey.length > 0
      ? journey.map(j => `- ${j.type}: ${j.summary}`).join('\n')
      : '无历史记录';

    const intentMap: Record<string, string> = {
      high: '高意向', medium: '中意向', low: '低意向', none: '未知',
    };

    const prompt = `你是客户跟进助手。请根据以下客户信息生成一条简短的跟进建议。

客户: ${customer.name}
意向: ${intentMap[customer.intent] || '未知'}
标签: ${customer.tags.join(', ') || '无'}
行业: ${customer.industry || '未指定'}
上次联系: ${lastContact}
备注: ${customer.notes || '无'}
最近沟通:
${journeyText}

要求:
1. 消息要简短 (50-100字), 像朋友聊天一样自然
2. 不要太推销, 要有温度
3. 基于历史沟通内容, 体现"我记得你上次说的..."
4. 只输出建议的话术内容, 不要加引号或解释

请直接输出:`;

    try {
      const resp = await fetch(`${this.gatewayUrl}/v1/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: prompt,
          userId: 'follow-up-bot',
          workspace: '',
          stream: false,
          model: 'agentai',
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (resp.ok) {
        const data = await resp.json() as any;
        const message = (data.content || '').trim();
        if (message && message.length > 5) {
          return {
            message,
            reason: `${customer.name} 已 ${Math.round((Date.now() - (customer.lastContactAt || 0)) / 86400000)} 天未联系, 意向: ${intentMap[customer.intent] || '未知'}`,
          };
        }
      }
    } catch { /* AI 生成失败, 使用模板 */ }

    // 模板兜底
    const nm: string = customer.name || '您';
    const templates: string[] = [
      `${nm}您好, 最近忙吗? 上次聊到的事有需要我帮忙的吗?`,
      `您好, 想跟您同步一下进度。有什么问题随时联系我~`,
      `${nm}好, 一直没收到您的消息, 想确认下目前的情况~`,
    ];
    const idx = Math.floor(Math.random() * templates.length);
    const pick: string = templates[idx] || templates[0]!;
    return {
      message: pick,
      reason: `${nm} 已 ${Math.round((Date.now() - (customer.lastContactAt || 0)) / 86400000)} 天未联系`,
    };
  }

  /**
   * 标记提醒为已完成 (用户手动联系了客户)
   */
  markDone(reminderId: string): boolean {
    const r = this.reminders.get(reminderId);
    if (!r || r.status !== 'pending') return false;
    r.status = 'done';
    r.resolvedAt = Date.now();

    // 记录到客户旅程
    store.addJourneyEvent(r.customerId, {
      type: 'followup',
      channel: 'web',
      summary: `用户已跟进: ${r.suggestedMessage.slice(0, 50)}`,
      outcome: 'success',
    });

    // 清除 nextFollowUpAt (避免重复提醒)
    store.updateCustomer(r.customerId, { nextFollowUpAt: undefined });
    this.emit('reminder:done', r);
    return true;
  }

  /**
   * 跳过提醒
   */
  skip(reminderId: string): boolean {
    const r = this.reminders.get(reminderId);
    if (!r || r.status !== 'pending') return false;
    r.status = 'skipped';
    r.resolvedAt = Date.now();
    // 清除 nextFollowUpAt
    store.updateCustomer(r.customerId, { nextFollowUpAt: undefined });
    this.emit('reminder:skipped', r);
    return true;
  }

  /**
   * 获取所有待处理提醒
   */
  getPendingReminders(): FollowUpReminder[] {
    return Array.from(this.reminders.values()).filter(r => r.status === 'pending');
  }

  /**
   * 获取所有提醒 (含历史)
   */
  getAllReminders(): FollowUpReminder[] {
    return Array.from(this.reminders.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 清理旧提醒 (保留最近 100 条)
   */
  cleanup(): void {
    const all = this.getAllReminders();
    if (all.length > 100) {
      for (const r of all.slice(100)) {
        this.reminders.delete(r.id);
      }
    }
  }
}

// ===== 单例 =====

let _instance: FollowUpScheduler | null = null;

export function getFollowUpScheduler(): FollowUpScheduler {
  if (!_instance) {
    _instance = new FollowUpScheduler();
  }
  return _instance;
}
