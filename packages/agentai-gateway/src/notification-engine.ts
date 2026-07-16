/**
 * Notification Engine — 统一通知推送引擎
 * ==================================================
 * 核心能力:
 *   1. 多渠道推送: Webhook(钉钉/企业微信/飞书) + Email + 前端 SSE
 *   2. 通知模板: 预定义常用通知模板, AI 可直接引用
 *   3. 通知队列: 异步推送, 失败自动重试
 *   4. 通知历史: 持久化通知记录, 支持查询
 *
 * 存储路径: ~/.agentai/notifications.jsonl
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Server as IOServer } from 'socket.io';

// ===== 类型定义 =====

export type NotificationChannel = 'webhook' | 'email' | 'sse' | 'desktop';
export type NotificationLevel = 'info' | 'success' | 'warning' | 'error';

export interface Notification {
  id: string;
  level: NotificationLevel;
  title: string;
  body: string;
  channel: NotificationChannel;
  /** 推送目标 (webhook URL / email address / 留空=sse) */
  target?: string;
  /** 创建时间 */
  createdAt: number;
  /** 推送状态 */
  status: 'pending' | 'sent' | 'failed';
  /** 推送结果 */
  result?: string;
  /** 推送时间 */
  sentAt?: number;
  /** 重试次数 */
  retryCount?: number;
  /** 来源 (AI 工具 / 定时任务 / 系统) */
  source?: string;
  /** 附加数据 */
  metadata?: Record<string, any>;
}

export interface NotificationConfig {
  /** 钉钉 Webhook URL */
  dingtalkWebhook?: string;
  /** 企业微信 Webhook URL */
  wechatWebhook?: string;
  /** 飞书 Webhook URL */
  feishuWebhook?: string;
  /** 自定义 Webhook URL */
  customWebhook?: string;
  /** 邮件 SMTP 配置 */
  email?: {
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
  };
}

// ===== 持久化 =====

const NOTIFICATION_FILE = path.join(os.homedir(), '.agentai', 'notifications.jsonl');
const MAX_HISTORY = 500;

function ensureFile(): void {
  const dir = path.dirname(NOTIFICATION_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(NOTIFICATION_FILE)) {
    fs.writeFileSync(NOTIFICATION_FILE, '', 'utf-8');
  }
}

// ===== 通知引擎 =====

class NotificationEngine {
  private io: IOServer | null = null;
  private config: NotificationConfig = {};
  private queue: Notification[] = [];
  private processing = false;
  private history: Notification[] = [];

  constructor() {
    this._loadHistory();
  }

  /** 初始化, 注入 socket.io 实例 */
  init(io: IOServer): void {
    this.io = io;
  }

  /** 更新配置 */
  updateConfig(config: Partial<NotificationConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /** 获取配置 */
  getConfig(): NotificationConfig {
    return { ...this.config };
  }

  private _loadHistory(): void {
    try {
      ensureFile();
      const lines = fs.readFileSync(NOTIFICATION_FILE, 'utf-8').trim().split('\n').filter(Boolean);
      this.history = lines.slice(-MAX_HISTORY).map(l => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean) as Notification[];
    } catch { /* first run */ }
  }

  private _saveNotification(n: Notification): void {
    try {
      ensureFile();
      fs.appendFileSync(NOTIFICATION_FILE, JSON.stringify(n) + '\n', 'utf-8');
      this.history.push(n);
      if (this.history.length > MAX_HISTORY) {
        this.history = this.history.slice(-MAX_HISTORY);
        // 重写文件
        fs.writeFileSync(NOTIFICATION_FILE, this.history.map(n => JSON.stringify(n)).join('\n') + '\n', 'utf-8');
      }
    } catch { /* best effort */ }
  }

  /**
   * 创建并发送通知
   */
  async send(params: {
    level?: NotificationLevel;
    title: string;
    body: string;
    channel?: NotificationChannel;
    target?: string;
    source?: string;
    metadata?: Record<string, any>;
  }): Promise<Notification> {
    const notification: Notification = {
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      level: params.level || 'info',
      title: params.title,
      body: params.body,
      channel: params.channel || 'sse',
      target: params.target,
      createdAt: Date.now(),
      status: 'pending',
      source: params.source || 'ai',
      metadata: params.metadata,
    };

    // 立即推送 SSE (前端实时显示)
    if (notification.channel === 'sse' || !notification.target) {
      this._pushSse(notification);
      notification.status = 'sent';
      notification.sentAt = Date.now();
      notification.result = 'sse_delivered';
      this._saveNotification(notification);
      return notification;
    }

    // 加入队列异步推送
    this.queue.push(notification);
    this._saveNotification(notification);
    this._processQueue();
    return notification;
  }

  /** 推送到前端 SSE */
  private _pushSse(n: Notification): void {
    if (this.io) {
      this.io.emit('notification', n);
    }
  }

  /** 异步处理推送队列 */
  private async _processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const n = this.queue.shift()!;
      try {
        let result = '';
        switch (n.channel) {
          case 'webhook':
            result = await this._sendWebhook(n);
            break;
          case 'email':
            result = await this._sendEmail(n);
            break;
          case 'desktop':
            result = await this._sendDesktop(n);
            break;
          default:
            result = 'unknown_channel';
        }
        n.status = 'sent';
        n.result = result;
        n.sentAt = Date.now();
      } catch (e: any) {
        n.status = 'failed';
        n.result = e.message;
        n.retryCount = (n.retryCount || 0) + 1;
        // 重试 3 次
        if (n.retryCount < 3) {
          this.queue.push(n);
        }
      }
      this._pushSse(n); // 推送状态更新
    }

    this.processing = false;
  }

  /** Webhook 推送 (钉钉/企业微信/飞书/自定义) */
  private async _sendWebhook(n: Notification): Promise<string> {
    const target = n.target || this._getDefaultWebhook();
    if (!target) throw new Error('未配置 Webhook URL');

    // 根据目标 URL 判断平台, 构造对应格式
    let payload: any;
    if (target.includes('oapi.dingtalk.com')) {
      // 钉钉
      payload = {
        msgtype: 'markdown',
        markdown: {
          title: n.title,
          text: `### ${n.title}\n\n${n.body}\n\n> 级别: ${n.level} | 来源: ${n.source || 'AI'} | 时间: ${new Date(n.createdAt).toLocaleString()}`,
        },
      };
    } else if (target.includes('qyapi.weixin.qq.com')) {
      // 企业微信
      payload = {
        msgtype: 'markdown',
        markdown: {
          content: `## ${n.title}\n${n.body}\n> 级别: ${n.level} | ${new Date(n.createdAt).toLocaleString()}`,
        },
      };
    } else if (target.includes('open.feishu.cn')) {
      // 飞书
      payload = {
        msg_type: 'interactive',
        card: {
          header: { title: { tag: 'plain_text', content: n.title } },
          elements: [
            { tag: 'div', text: { tag: 'lark_md', content: n.body } },
            { tag: 'note', elements: [{ tag: 'plain_text', content: `级别: ${n.level} | ${new Date(n.createdAt).toLocaleString()}` }] },
          ],
        },
      };
    } else {
      // 自定义 Webhook
      payload = { title: n.title, body: n.body, level: n.level, source: n.source, timestamp: n.createdAt };
    }

    const resp = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) throw new Error(`Webhook 响应 ${resp.status}: ${await resp.text()}`);
    return `webhook_${resp.status}`;
  }

  /** 获取默认 Webhook (从配置中选第一个可用的) */
  private _getDefaultWebhook(): string | undefined {
    return this.config.dingtalkWebhook || this.config.wechatWebhook || this.config.feishuWebhook || this.config.customWebhook;
  }

  /** 邮件推送 */
  private async _sendEmail(n: Notification): Promise<string> {
    if (!this.config.email || !n.target) throw new Error('邮件未配置或缺少收件人');
    // 动态导入 nodemailer (可选依赖)
    let nodemailer: any;
    try {
      // @ts-ignore - optional dependency, declaration in sql-js.d.ts
      nodemailer = await import('nodemailer');
    } catch {
      throw new Error('nodemailer 未安装, 请运行 npm install nodemailer');
    }
    const transporter = nodemailer.createTransport({
      host: this.config.email.host,
      port: this.config.email.port,
      auth: { user: this.config.email.user, pass: this.config.email.pass },
    });
    await transporter.sendMail({
      from: this.config.email.from,
      to: n.target,
      subject: `[${n.level.toUpperCase()}] ${n.title}`,
      text: n.body,
      html: `<h2>${n.title}</h2><p>${n.body.replace(/\n/g, '<br>')}</p><hr><small>级别: ${n.level} | 来源: ${n.source} | ${new Date(n.createdAt).toLocaleString()}</small>`,
    });
    return 'email_sent';
  }

  /** 桌面通知 (Windows Toast) */
  private async _sendDesktop(n: Notification): Promise<string> {
    const { execSync } = await import('node:child_process');
    // 使用 PowerShell 的 BurntToast 或原生 toast
    const psScript = `
      Add-Type -AssemblyName System.Windows.Forms
      $notify = New-Object System.Windows.Forms.NotifyIcon
      $notify.Icon = [System.Drawing.SystemIcons]::Information
      $notify.Visible = $true
      $notify.ShowBalloonTip(5000, '${n.title.replace(/'/g, "''")}', '${n.body.replace(/'/g, "''").slice(0, 200)}', [System.Windows.Forms.ToolTipIcon]::Info)
      Start-Sleep -Seconds 6
      $notify.Dispose()
    `;
    execSync(`powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, { stdio: 'ignore', timeout: 15_000 });
    return 'desktop_sent';
  }

  /** 获取通知历史 */
  getHistory(limit = 50, level?: NotificationLevel): Notification[] {
    let result = this.history;
    if (level) result = result.filter(n => n.level === level);
    return result.slice(-limit).reverse();
  }

  /** 获取统计 */
  getStats(): { total: number; sent: number; failed: number; pending: number; byLevel: Record<string, number> } {
    const byLevel: Record<string, number> = {};
    let sent = 0, failed = 0, pending = 0;
    for (const n of this.history) {
      byLevel[n.level] = (byLevel[n.level] || 0) + 1;
      if (n.status === 'sent') sent++;
      else if (n.status === 'failed') failed++;
      else if (n.status === 'pending') pending++;
    }
    return { total: this.history.length, sent, failed, pending, byLevel };
  }
}

// ===== 单例 =====

let _instance: NotificationEngine | null = null;

export function getNotificationEngine(): NotificationEngine {
  if (!_instance) _instance = new NotificationEngine();
  return _instance;
}
