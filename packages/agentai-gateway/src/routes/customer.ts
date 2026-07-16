/**
 * Customer Routes — 客户管理 REST API
 * ==================================================================
 * GET    /v1/customers          — 列表 + 搜索 (search, tags, intent, industry)
 * POST   /v1/customers          — 创建客户
 * GET    /v1/customers/:id      — 获取客户详情
 * PUT    /v1/customers/:id      — 更新客户
 * DELETE /v1/customers/:id      — 删除客户
 * GET    /v1/customers/:id/journey — 客户旅程时间线
 * POST   /v1/customers/:id/channels — 绑定新渠道身份
 * POST   /v1/customers/:id/journey — 手动添加旅程事件
 * GET    /v1/customers/pending   — 待跟进客户列表
 */
import { Router, Request, Response } from 'express';
import * as store from '../customer-store.js';

export function createCustomerRouter(): Router {
  const r = Router();

  // ===== 列表 + 搜索 =====
  r.get('/v1/customers', (req: Request, res: Response) => {
    const { search, tags, intent, industry, limit } = req.query;
    const list = store.listCustomers({
      search: search as string | undefined,
      tags: tags ? (tags as string).split(',') : undefined,
      intent: intent as any | undefined,
      industry: industry as string | undefined,
      limit: limit ? parseInt(limit as string) : undefined,
    });
    res.json({ customers: list, count: list.length });
  });

  // ===== 待跟进 (放在 /:id 之前, 避免路由冲突) =====
  r.get('/v1/customers/pending', async (_req: Request, res: Response) => {
    const list = store.getPendingFollowUps();
    // 尝试获取 AI 生成的跟进建议
    let reminders: any[] = [];
    try {
      const { getFollowUpScheduler } = await import('../follow-up-scheduler.js');
      const scheduler = getFollowUpScheduler();
      reminders = scheduler.getPendingReminders();
    } catch { /* scheduler 未初始化, 忽略 */ }

    // 合并: 客户档案 + AI 建议
    const merged = list.map(c => {
      const reminder = reminders.find((r: any) => r.customerId === c.customerId);
      return {
        ...c,
        suggestedMessage: reminder?.suggestedMessage,
        reason: reminder?.reason,
      };
    });

    res.json({ customers: merged, count: merged.length });
  });

  // ===== 标记跟进完成 / 跳过 =====
  r.post('/v1/customers/follow-up/:action', async (req: Request, res: Response) => {
    const action = req.params.action;
    const { customerId } = req.body || {};
    if (!customerId) return res.status(400).json({ error: 'customerId required' });

    try {
      const { getFollowUpScheduler } = await import('../follow-up-scheduler.js');
      const scheduler = getFollowUpScheduler();
      const reminders = scheduler.getAllReminders();
      const reminder = reminders.find((r: any) => r.customerId === customerId && r.status === 'pending');

      if (action === 'done') {
        if (reminder) scheduler.markDone(reminder.id);
        else store.updateCustomer(customerId, { nextFollowUpAt: undefined });
        res.json({ ok: true });
      } else if (action === 'skip') {
        if (reminder) scheduler.skip(reminder.id);
        else store.updateCustomer(customerId, { nextFollowUpAt: undefined });
        res.json({ ok: true });
      } else {
        res.status(400).json({ error: 'action must be done or skip' });
      }
    } catch (e: any) {
      // scheduler 未初始化, 直接操作 store
      store.updateCustomer(customerId, { nextFollowUpAt: undefined });
      res.json({ ok: true });
    }
  });

  // ===== 创建 =====
  r.post('/v1/customers', (req: Request, res: Response) => {
    try {
      const { name, phone, email, channels, tags, industry, notes, intent } = req.body || {};
      if (!name) {
        return res.status(400).json({ error: 'name is required' });
      }
      const customer = store.createCustomer({ name, phone, email, channels, tags, industry, notes, intent });
      res.json({ ok: true, customer });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ===== 获取详情 =====
  r.get('/v1/customers/:id', (req: Request, res: Response) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const customer = store.getCustomer(id);
    if (!customer) return res.status(404).json({ error: '客户不存在' });
    res.json({ customer });
  });

  // ===== 更新 =====
  r.put('/v1/customers/:id', (req: Request, res: Response) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const updated = store.updateCustomer(id, req.body || {});
    if (!updated) return res.status(404).json({ error: '客户不存在' });
    res.json({ ok: true, customer: updated });
  });

  // ===== 删除 =====
  r.delete('/v1/customers/:id', (req: Request, res: Response) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const removed = store.deleteCustomer(id);
    res.json({ ok: removed });
  });

  // ===== 客户旅程时间线 =====
  r.get('/v1/customers/:id/journey', (req: Request, res: Response) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const journey = store.getJourney(id, limit);
    res.json({ journey, count: journey.length });
  });

  // ===== 绑定新渠道身份 =====
  r.post('/v1/customers/:id/channels', (req: Request, res: Response) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const { type, id: channelId, label } = req.body || {};
    if (!type || !channelId) {
      return res.status(400).json({ error: 'type, id required' });
    }
    const updated = store.bindChannel(id, {
      type,
      id: channelId,
      label,
      boundAt: Date.now(),
    });
    if (!updated) return res.status(404).json({ error: '客户不存在' });
    res.json({ ok: true, customer: updated });
  });

  // ===== 手动添加旅程事件 =====
  r.post('/v1/customers/:id/journey', (req: Request, res: Response) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const { type, channel, summary, sentiment, outcome } = req.body || {};
    if (!type || !summary) {
      return res.status(400).json({ error: 'type, summary required' });
    }
    const event = store.addJourneyEvent(id, {
      type,
      channel: channel || 'web',
      summary,
      sentiment: sentiment || 'unknown',
      outcome,
    });
    if (!event) return res.status(404).json({ error: '客户不存在' });
    res.json({ ok: true, event });
  });

  return r;
}
