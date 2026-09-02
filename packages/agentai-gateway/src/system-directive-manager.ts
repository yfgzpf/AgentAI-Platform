/**
 * 系统指令管理器 v2 (智能延迟注入) — 从 agentai-loop.ts 提取
 * 
 * 解决: 多个模块同时注入 [SYSTEM] 指令 → 弱模型迷失
 * 策略:
 *   1. 即时队列 (pending): 错误反应类指令, 每轮取优先级最高的 1 条注入
 *   2. 延迟队列 (deferred): 质量管控类指令, 执行中缓冲, 任务完成后处理
 * 优先级: critical(安全/错误) > high(任务推进) > medium(风格建议) > low(杂项)
 * 
 * 原位置: agentai-loop.ts 行 ~176-263
 * 提取理由: 自包含类，仅被 this.directives 引用，置信度 92%
 */

/** 待处理指令 */
export interface PendingDirective {
  source: string;
  content: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
}

export class SystemDirectiveManager {
  private pending: PendingDirective[] = [];
  private deferred: PendingDirective[] = [];

  /** 可延迟的指令来源 — 质量管控类, 不阻塞任务执行 */
  private static DEFERRABLE_SOURCES = new Set([
    'meta_ask', 'meta_pua',           // 元认知决策
    'boundary_check', 'boundary_p0',  // 知识边界/认知自检
    'low_conf_search',                // 低置信度搜索 (不阻塞, 可后续补)
    'op_awareness',                    // 操作感知
    // 'ambiguity' 移除 — 歧义检测必须在首轮立即注入, 否则 AI 不会追问用户
    // 'low_conf_clarify' 移除 — 低置信度追问必须即时注入, 否则 AI 不会调用 ask_user
  ]);

  /** 添加一条指令 */
  add(source: string, content: string, priority: PendingDirective['priority']): void {
    // 可延迟来源 → 进入延迟缓冲, 不在执行中注入
    if (SystemDirectiveManager.DEFERRABLE_SOURCES.has(source)) {
      // 同来源去重: 只保留最后一条
      this.deferred = this.deferred.filter(d => d.source !== source);
      this.deferred.push({ source, content, priority });
      return;
    }
    // 即时指令: critical 始终加入; 其他如果已有 critical 则跳过
    if (this.pending.some(d => d.priority === 'critical') && priority !== 'critical') return;
    this.pending.push({ source, content, priority });
  }

  /** 刷新即时队列: 取优先级最高的 1 条, 返回消息内容 (或 null) */
  flush(): string | null {
    if (this.pending.length === 0) return null;
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    this.pending.sort((a, b) => order[a.priority] - order[b.priority]);
    const top = this.pending[0]!;
    this.pending = [];
    return top.content;
  }

  /** v3.2 修复: 按 source 读取最新一条指令 (含延迟队列) */
  get(source: string): string | null {
    const inPending = this.pending.find(d => d.source === source);
    if (inPending) return inPending.content;
    const inDeferred = this.deferred.find(d => d.source === source);
    return inDeferred?.content || null;
  }

  /** 刷新延迟队列: 返回所有缓冲指令 (任务完成后调用) */
  flushDeferred(): PendingDirective[] {
    const result = [...this.deferred];
    this.deferred = [];
    return result;
  }

  /** 延迟队列中是否有高优先级指令 (需要补一轮) */
  hasCriticalDeferred(): boolean {
    return this.deferred.some(d => d.priority === 'high');
  }

  /** 检查是否有待处理即时指令 */
  hasPending(): boolean {
    return this.pending.length > 0;
  }

  /** 清空即时队列 (每轮循环开始时调用) */
  clear(): void {
    this.pending = [];
  }

  /** 清空所有队列 */
  clearAll(): void {
    this.pending = [];
    this.deferred = [];
  }
}
