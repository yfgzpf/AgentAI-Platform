/**
 * GatewayFallback - 网关连接状态管理
 * 
 * 核心职责：
 * 1. 定期检测网关健康状态
 * 2. 通知所有订阅者状态变化
 * 3. 在 Tauri 桌面端自动启动网关进程
 */

import { IS_DEV, IS_TAURI } from './config';

const FALLBACK_DIRECT_URL = 'https://api.agnes-ai.cn';
const HEALTH_CHECK_INTERVAL = 30000; // 在线后30秒检查一次
const FAST_CHECK_INTERVAL = 2000;   // 启动时2秒检查一次

type GatewayStatus = 'online' | 'offline' | 'starting';

/**
 * 判断是否 Tauri 桌面端环境 — 统一用 config.ts 的 IS_TAURI
 */
function isTauriEnv(): boolean {
  return IS_TAURI;
}

/**
 * 判断是否开发模式 — 统一用 config.ts 的 IS_DEV
 * 避免不同文件对开发态判断不一致导致生产态行为异常
 */
function isDevMode(): boolean {
  return IS_DEV;
}

class GatewayFallbackImpl {
  private status: GatewayStatus = 'starting';
  private failures = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners: Set<(s: GatewayStatus) => void> = new Set();
  private startAttempted = false;

  get url(): string {
    // 开发模式下返回空字符串（使用相对路径，走 Vite 代理）
    // 生产/Tauri 模式下返回直连地址
    if (isDevMode()) return '';
    return 'http://127.0.0.1:18789';
  }

  /** 获取 LLM API 的 fallback URL（用于离线时的模型调用） */
  get llmFallbackUrl(): string {
    return FALLBACK_DIRECT_URL;
  }

  get isOnline(): boolean { return this.status === 'online'; }
  get currentStatus(): GatewayStatus { return this.status; }

  setLlmBusy(_busy: boolean) {} // 保留接口，暂不实现

  onChange(fn: (s: GatewayStatus) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async start() {
    if (this.timer) return; // 防止重复启动
    
    // 初始状态为 starting
    this.status = 'starting';
    this.notify();

    // Tauri 环境下, Rust 端已在 setup 中自动启动 gateway
    // 前端只需等待并检查健康状态
    // 但如果 Rust 端启动失败, 前端也可以尝试 invoke 作为 fallback
    if (isTauriEnv()) {
      // startAttempted 标记用于 tryStartTauriGateway fallback
      // 初始为 false, 在 fallback 调用时设为 true
    }

    // 立即执行首次检查
    await this.check();
    
    // 启动定期检查（启动时快速轮询）
    this.timer = setInterval(() => this.check(), FAST_CHECK_INTERVAL);
  }

  private async tryStartTauriGateway() {
    if (!isTauriEnv()) return;
    
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      console.log('[GatewayFallback] Fallback: invoking spawn_gateway...');
      const result = await invoke<string>('spawn_gateway');
      console.log('[GatewayFallback] spawn_gateway result:', result);
      
      // 等待网关启动 (给 Node.js 进程足够时间初始化)
      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (e: any) {
      console.warn('[GatewayFallback] spawn_gateway failed:', e?.message || e);
    }
  }

  private async check() {
    try {
      // 开发模式下使用 Vite 代理，避免浏览器并发连接限制问题
      // 生产/Tauri 模式下使用直连
      const healthUrl = isDevMode() 
        ? '/v1/health'  // 走 Vite 代理，避免跨域和连接限制
        : 'http://127.0.0.1:18789/v1/health';  // 直连网关


      // 使用 Promise.race 实现超时
      const timeoutPromise = new Promise<Response>((_, reject) => {
        setTimeout(() => reject(new Error('TIMEOUT')), 15000); // 15秒超时（给慢请求留足时间）
      });

      const fetchPromise = fetch(healthUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        credentials: 'omit' // 跨域请求不需要 credentials
      });

      const resp = await Promise.race([fetchPromise, timeoutPromise]);
      
      
      if (resp.ok) {
        this.failures = 0;
        
        if (this.status !== 'online') {
          this.status = 'online';
          this.notify();
          
          // 切换到慢速检查模式
          if (this.timer) {
            clearInterval(this.timer);
            this.timer = setInterval(() => this.check(), HEALTH_CHECK_INTERVAL);
          }
        }
        return;
      } else {
        console.warn('[GatewayFallback] ⚠️ Health check returned status:', resp.status);
      }
    } catch (error: any) {
      // 区分超时错误和其他错误
      if (error.message === 'TIMEOUT') {
        console.error('[GatewayFallback] ❌ Health check TIMEOUT');
      } else {
        console.error('[GatewayFallback] ❌ Health check error:', error);
      }
    } 

    // 处理失败
    this.failures++;
    
    // Tauri 环境: 如果多次检查失败, 尝试 fallback 启动
    if (isTauriEnv() && this.failures === 2 && !this.startAttempted) {
      this.startAttempted = true;
      this.tryStartTauriGateway();
    }
    
    // 失败3次后标记为离线（无论当前状态是什么）
    if (this.failures >= 3 && this.status !== 'offline') {
      this.status = 'offline';
      this.notify();
    }
  }

  async retryNow() {
    this.failures = 0;
    this.startAttempted = false;
    await this.check();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private notify() {
    for (const fn of this.listeners) {
      try {
        fn(this.status);
      } catch (e) {
        console.error('[GatewayFallback] Error in listener:', e);
      }
    }
  }
}

// 导出单例
export const gatewayFallback = new GatewayFallbackImpl();
