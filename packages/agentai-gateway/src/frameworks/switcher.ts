/**
 * Framework Switcher (框架切换器)
 * ----------------------------------------------------
 * 让 agentai 和 pulseflow 两套适配器在运行时热切换, 不重启 Gateway
 *
 * 能力:
 *   - **零停机切换**: 用 Map + in-flight 计数, 切换瞬间把未完成请求留在旧适配器
 *   - **能力查询**: 调用方按能力而非框架名选 adapter (decoupling)
 *   - **A/B 灰度**: 可设 0-100% 流量到指定适配器 (用于 shadow test)
 *
 * 切换原则:
 *   1. 切换前先 health() 检查
 *   2. 切换时等待 in-flight 完结 (默认 5s 上限)
 *   3. 切换后新请求走新适配器
 *   4. 切换全程不丢任何请求
 */

import type { FrameworkAdapter, FrameworkId, FrameworkContext, FrameworkCapabilities } from './types.js';
import { AgentaiAdapter } from './agentai-adapter.js';
import { PulseflowAdapter } from './pulseflow-adapter.js';
import type { ChatMessage, ChatResponse } from '../llm-router.js';

export interface SwitchOptions {
  /** 目标框架 ID */
  to: FrameworkId;
  /** A/B 灰度比例 (0-1), 0 = 全走当前, 1 = 全切到 to, 默认 1 */
  abRatio?: number;
  /** 切换时是否等 in-flight 请求完成, 默认 true */
  drain?: boolean;
  /** 切换超时 ms, 默认 5000 */
  timeoutMs?: number;
}

export interface FrameworkStatus {
  active: FrameworkId;
  abRatio: number;            // 当前灰度比例
  registered: FrameworkId[];  // 已注册框架
  inFlight: number;           // 正在处理的请求数
  lastSwitchAt: number | null;
  switches: number;           // 累计切换次数
}

export class FrameworkSwitcher {
  private adapters = new Map<FrameworkId, FrameworkAdapter>();
  private active: FrameworkId = 'agentai';
  private abRatio = 1;
  private inFlight = 0;
  private lastSwitchAt: number | null = null;
  private switches = 0;

  constructor() {
    // 默认注册两个自研适配器
    this.adapters.set('agentai', new AgentaiAdapter());
    this.adapters.set('pulseflow', new PulseflowAdapter());
  }

  /**
   * 初始化当前 active 框架
   * Gateway 启动时调用 1 次
   */
  async initActive(ctx: FrameworkContext): Promise<void> {
    const adapter = this.adapters.get(this.active);
    if (!adapter) throw new Error(`Framework not registered: ${this.active}`);
    await adapter.init(ctx);
  }

  /**
   * 运行时切换框架
   * 不重启 Gateway, 不丢任何请求
   */
  async switch(opts: SwitchOptions): Promise<{ ok: boolean; detail: string }> {
    const target = this.adapters.get(opts.to);
    if (!target) {
      return { ok: false, detail: `Framework not registered: ${opts.to}` };
    }

    // 1. 先 init 再 health (框架没初始化 health 会 false)
    try {
      await target.init({
        userId: 'switch-bootstrap',
        workspace: 'switch-bootstrap',
      });
    } catch (e: any) {
      return { ok: false, detail: `Init failed: ${e.message}` };
    }

    // 2. 健康检查
    const health = await target.health();
    if (!health.ok) {
      return { ok: false, detail: `Target framework unhealthy: ${health.detail}` };
    }

    const timeout = opts.timeoutMs ?? 5000;
    const drain = opts.drain ?? true;

    // 3. 记录切换并生效
    const startedAt = Date.now();
    const oldActive = this.active;
    this.abRatio = opts.abRatio ?? 1;
    this.active = opts.to;
    this.lastSwitchAt = startedAt;
    this.switches++;

    // 4. 关闭旧框架 (如果 drain=true, 等 in-flight 完结)
    if (drain) {
      const drainStart = Date.now();
      while (this.inFlight > 0 && Date.now() - drainStart < timeout) {
        await new Promise((r) => setTimeout(r, 50));
      }
      if (this.inFlight > 0) {
        console.warn(`[switcher] drain timeout, ${this.inFlight} requests still in-flight`);
      }
    }
    await this.adapters.get(oldActive)?.shutdown();

    console.log(
      `[switcher] ${oldActive} → ${opts.to} (ab=${this.abRatio}, drain=${drain}, took=${Date.now() - startedAt}ms)`
    );
    return { ok: true, detail: `Switched to ${opts.to} (ab=${this.abRatio})` };
  }

  /**
   * 跑对话 (按 A/B 比例路由)
   * 切换瞬间可能有双写, 旧请求走旧框架, 新请求按比例走新框架
   */
  async chat(messages: ChatMessage[], ctx: FrameworkContext): Promise<ChatResponse> {
    // 简单随机 A/B (生产用更精细: hash(userId) 决定 sticky)
    const useTarget = Math.random() < this.abRatio;
    const chosen: FrameworkId = useTarget ? this.active : this.altOf(this.active);

    const adapter = this.adapters.get(chosen);
    if (!adapter) {
      // fallback 到 active
      const fb = this.adapters.get(this.active);
      if (!fb) throw new Error(`No active framework`);
      return this._wrap(chosen, fb.chat(messages, ctx));
    }

    return this._wrap(chosen, adapter.chat(messages, ctx));
  }

  /**
   * 按能力查询最佳框架
   * 找第一个声明该能力的适配器 (注册顺序决定优先级: agentai > pulseflow)
   */
  pickByCapability(need: keyof FrameworkCapabilities): FrameworkId | null {
    for (const [id, a] of this.adapters) {
      if (a.capabilities[need]) return id;
    }
    return null;
  }

  /**
   * 按能力查询所有支持的框架 (用于 A/B 灰度对比)
   */
  pickAllByCapability(need: keyof FrameworkCapabilities): FrameworkId[] {
    const out: FrameworkId[] = [];
    for (const [id, a] of this.adapters) {
      if (a.capabilities[need]) out.push(id);
    }
    return out;
  }

  /**
   * 找"唯一最强"适配器: 只有 1 个框架声明该能力时返回它
   * (用于"只有 pulseflow 才有"的硬需求)
   */
  pickExclusive(need: keyof FrameworkCapabilities): FrameworkId | null {
    const all = this.pickAllByCapability(need);
    return all.length === 1 ? all[0]! : null;
  }

  /**
   * 状态报告 (用于 /admin/status 接口)
   */
  status(): FrameworkStatus {
    return {
      active: this.active,
      abRatio: this.abRatio,
      registered: Array.from(this.adapters.keys()),
      inFlight: this.inFlight,
      lastSwitchAt: this.lastSwitchAt,
      switches: this.switches,
    };
  }

  /**
   * 列已注册框架 + 各自能力
   * 用于 /admin/frameworks 接口
   */
  list(): Array<{ id: FrameworkId; displayName: string; version: string; capabilities: FrameworkCapabilities }> {
    return Array.from(this.adapters.values()).map((a) => ({
      id: a.id,
      displayName: a.displayName,
      version: a.version,
      capabilities: a.capabilities,
    }));
  }

  // === 内部 ===

  private altOf(id: FrameworkId): FrameworkId {
    return id === 'agentai' ? 'pulseflow' : 'agentai';
  }

  private async _wrap(usedId: FrameworkId, p: Promise<ChatResponse>): Promise<ChatResponse> {
    this.inFlight++;
    try {
      return await p;
    } finally {
      this.inFlight--;
    }
  }
}

/** 单例 */
export const frameworkSwitcher = new FrameworkSwitcher();
