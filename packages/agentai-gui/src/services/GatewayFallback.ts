/**
 * GatewayFallback — 网关健康检测 + 降级直连 + 自动重启
 * ----------------------------------------------------
 * 设计:
 *   1. 启动时探测网关 /v1/health
 *   2. 网关掉线 → 尝试自启 (Tauri 环境)
 *   3. 自启失败/超时 → 直连免费模型 API (agnes-ai.com)
 *   4. 后台持续探测, 网关恢复后自动切回
 *
 * 运行环境:
 *   - Vite dev: 走 proxy ('/v1/*' → 127.0.0.1:18789)
 *   - Tauri 打包后: 直连 http://127.0.0.1:18789 (无 proxy)
 *   - 纯浏览器: 直连 GATEWAY_HTTP
 */

import { GATEWAY_HTTP } from './config';

/** 免费模型直连地址 (网关不可用时的最终 fallback) */
const FALLBACK_DIRECT_URL = 'https://apihub.agnes-ai.com/v1';
const HEALTH_CHECK_INTERVAL = 15_000; // 15s
const MAX_FAILURES = 2;
const GATEWAY_START_TIMEOUT = 10_000; // 自启后等待 10s

type GatewayStatus = 'online' | 'offline' | 'starting' | 'unknown';

/** 判断是否 Tauri 环境 (可自启 gateway) */
function isTauri(): boolean {
  return !!(window as any).__TAURI_INTERNALS__ || !!(window as any).__TAURI__;
}

/**
 * 尝试通过 Tauri Rust 端自启 gateway
 * 浏览器环境无法 spawn 进程, 直接返回 false
 */
async function tryStartGateway(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke('spawn_gateway');
    console.log('[gateway-fallback] spawn_gateway result:', result);
    return result === true || result === 'started';
  } catch (e: any) {
    console.warn('[gateway-fallback] spawn_gateway failed:', e?.message || e);
    return false;
  }
}

class GatewayFallbackImpl {
  private status: GatewayStatus = 'unknown';
  private failures = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners: Set<(s: GatewayStatus) => void> = new Set();
  private startAttempted = false; // 防止重复自启

  /**
   * 当前 API base URL:
   * - online: GATEWAY_HTTP (打包后直连 127.0.0.1:18789, dev 模式走 proxy='')
   * - offline: 免费模型直连地址
   */
  get url(): string {
    if (this.status === 'offline') return FALLBACK_DIRECT_URL;
    // dev 模式 (vite proxy 在) → 用 '' (走 proxy)
    // 打包后 → 用 GATEWAY_HTTP (直连 127.0.0.1:18789)
    const isDev = import.meta.env.DEV;
    return isDev ? '' : GATEWAY_HTTP;
  }

  get isOnline(): boolean {
    return this.status === 'online';
  }

  get currentStatus(): GatewayStatus {
    return this.status;
  }

  onChange(fn: (s: GatewayStatus) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  start() {
    if (this.timer) return;
    // 启动时立即检查一次
    this.check();
    this.timer = setInterval(() => this.check(), HEALTH_CHECK_INTERVAL);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async check() {
    const base = this.url;
    const healthUrl = import.meta.env.DEV ? '/v1/health' : `${GATEWAY_HTTP}/v1/health`;

    try {
      const resp = await fetch(healthUrl, {
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        this.failures = 0;
        if (this.status !== 'online') {
          this.status = 'online';
          this.notify();
          console.log('[gateway-fallback] gateway back online');
        }
        return;
      }
      this.failures++;
    } catch {
      this.failures++;
    }

    // 达到失败阈值, 尝试自启
    if (this.failures >= MAX_FAILURES) {
      if (this.status !== 'offline') {
        // Tauri 环境: 尝试自启 gateway
        if (isTauri() && !this.startAttempted) {
          this.startAttempted = true;
          this.status = 'starting';
          this.notify();
          console.log('[gateway-fallback] gateway offline, attempting auto-start...');
          const started = await tryStartGateway();
          if (started) {
            // 等待 gateway 启动
            console.log(`[gateway-fallback] waiting ${GATEWAY_START_TIMEOUT}ms for gateway to boot...`);
            await new Promise(r => setTimeout(r, GATEWAY_START_TIMEOUT));
            // 重新检查
            this.failures = 0;
            this.startAttempted = false;
            return; // 下一次 check 会判定结果
          }
        }

        // 自启失败或非 Tauri 环境: 进入直连模式
        this.status = 'offline';
        this.notify();
        console.warn('[gateway-fallback] gateway offline, falling back to direct API');
      }
    }
  }

  private notify() {
    for (const fn of this.listeners) fn(this.status);
  }
}

export const gatewayFallback = new GatewayFallbackImpl();
