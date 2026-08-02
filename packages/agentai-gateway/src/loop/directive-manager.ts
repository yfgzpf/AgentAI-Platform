/**
 * 系统指令管理器
 * 从 agentai-loop.ts 提取
 */

import { IDirectiveManager, PendingDirective, DirectivePriority } from './types.js';

/**
 * 系统指令管理器: 每轮只保留优先级最高的 1 条 [SYSTEM] 指令
 * 解决弱模型被过多 [SYSTEM] 指令干扰的问题
 */
export class SystemDirectiveManager implements IDirectiveManager {
  private pending: PendingDirective[] = [];
  private deferred: PendingDirective[] = [];

  /** 可延迟的指令来源 (非紧急, 可攒着一起发) */
  private static DEFERRABLE_SOURCES = new Set([
    'meta_ask',      // 元认知: 需要追问
    'meta_pua',      // 元认知: 鼓励/提醒
    'boundary_check', // 边界检查 (一般性)
    'boundary_p0',   // 边界检查 (P0 紧急)
    'low_conf_search', // 低置信度: 建议搜索
    'op_awareness',  // 操作感知
  ]);

  /**
   * 添加指令到队列
   * @param source 指令来源标识 (如 'ambiguity', 'meta_ask')
   * @param content 指令内容 (应包含 [SYSTEM] 标记)
   * @param priority 优先级: critical > high > medium > low
   */
  add(source: string, content: string, priority: DirectivePriority = 'medium'): void {
    // 去重: 同一来源只保留最新的
    this.pending = this.pending.filter(d => d.source !== source);
    this.deferred = this.deferred.filter(d => d.source !== source);

    const directive: PendingDirective = {
      source,
      content,
      priority,
      ts: Date.now(),
    };

    // 关键/高优先级直接放入 pending，其他延迟处理
    if (priority === 'critical' || priority === 'high' || !SystemDirectiveManager.DEFERRABLE_SOURCES.has(source)) {
      this.pending.push(directive);
      // 按优先级排序
      this.pending.sort((a, b) => {
        const order = { critical: 0, high: 1, medium: 2, low: 3 };
        return order[a.priority] - order[b.priority];
      });
    } else {
      this.deferred.push(directive);
    }
  }

  /**
   * 获取当前最高优先级的指令 (用于立即发送)
   * @returns 最高优先级指令，或 null
   */
  getTop(): PendingDirective | null {
    return this.pending[0] || null;
  }

  /**
   * 获取所有待发送的指令 (合并 pending + deferred)
   * @returns 合并后的指令字符串
   */
  getAllForPrompt(): string {
    const result = [...this.deferred];
    if (this.pending.length > 0) {
      result.push(this.pending[0]!);
    }
    if (result.length === 0) return '';
    return result.map(d => d.content).join('\n');
  }

  /**
   * 清空所有指令
   */
  clear(): void {
    this.pending = [];
    this.deferred = [];
  }

  /**
   * 消费最高优先级的指令 (发送后调用)
   */
  consumeTop(): void {
    if (this.pending.length > 0) {
      this.pending.shift();
    }
  }
}

/**
 * 合并系统指令注入
 * 将连续的 [SYSTEM] 消息合并为一条，减少 token 消耗
 */
export function consolidateSystemInjections(messages: Array<{ role: string; content: any }>): Array<{ role: string; content: any }> {
  const result: Array<{ role: string; content: any }> = [];
  let pendingSystem: string[] = [];

  const flushPending = () => {
    if (pendingSystem.length === 0) return;
    if (pendingSystem.length === 1) {
      result.push({ role: 'user', content: pendingSystem[0] });
    } else {
      // 保留 critical/P0，合并其他
      const critical = pendingSystem.filter(s => /\[CRITICAL\]|\[P0\]/i.test(s));
      const latest = pendingSystem[pendingSystem.length - 1]!;
      const merged = critical.join('\n---\n') + '\n---\n' + latest;
      result.push({ role: 'user', content: merged });
    }
    pendingSystem = [];
  };

  for (const msg of messages) {
    const content = typeof msg.content === 'string' ? msg.content : '';
    const isSystemInjection = msg.role === 'user' && content.startsWith('[SYSTEM]');

    if (isSystemInjection) {
      pendingSystem.push(content);
    } else {
      flushPending();
      result.push(msg);
    }
  }
  flushPending();
  return result;
}
