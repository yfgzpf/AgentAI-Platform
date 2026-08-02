/**
 * GatewayFallback - 网关连接状态管理
 * 
 * 核心职责：
 * 1. 定期检测网关健康状态
 * 2. 通知所有订阅者状态变化
 * 3. 在 Tauri 桌面端自动启动网关进程
 */

const FALLBACK_DIRECT_URL = 'https://api.agnes-ai.cn';
const HEALTH_CHECK_INTERVAL = 30000; // 在线后30秒检查一次
const FAST_CHECK_INTERVAL = 2000;   // 启动时2秒检查一次

type GatewayStatus = 'online' | 'offline' | 'starting';

/**
 * 判断是否开发模式 - 基于窗口位置判断，不依赖 import.meta.env.DEV
 */
function isDevMode(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location?.hostname || '';
  const port = window.location?.port || '';
  // 开发服务器通常在 localhost 或 127.0.0.1 的特定端口上
  return host === 'localhost' || 
         host === '127.0.0.1' || 
         port === '5173' || 
         port === '5174' || 
         port === '5176';
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
    // 注意：离线状态下也返回本地地址，不要返回 FALLBACK_DIRECT_URL
    // 因为 FALLBACK_DIRECT_URL 是 LLM API 地址，不是网关地址
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
    
    console.log('[GatewayFallback] Starting...');
    console.log('[GatewayFallback] isDevMode:', isDevMode());
    console.log('[GatewayFallback] location:', window.location?.href);
    
    // 初始状态为 starting
    this.status = 'starting';
    this.notify();

    // 非开发模式下，尝试启动 Tauri 网关
    if (!isDevMode() && !this.startAttempted) {
      this.startAttempted = true;
      this.tryStartTauriGateway();
    }

    // 立即执行首次检查
    await this.check();
    
    // 启动定期检查（启动时快速轮询）
    this.timer = setInterval(() => this.check(), FAST_CHECK_INTERVAL);
  }

  private async tryStartTauriGateway() {
    try {
      // 检测是否在 Tauri 环境
      const hasTauri = !!(window as any).__TAURI_INTERNALS__ || !!(window as any).__TAURI__;
      if (!hasTauri) return;
      
      console.log('[GatewayFallback] Detected Tauri, attempting to spawn gateway...');
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke<string>('spawn_gateway');
      console.log('[GatewayFallback] Gateway spawn result:', result);
      
      // 等待网关启动
      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (e) {
      console.warn('[GatewayFallback] Failed to spawn gateway (may already be running):', e);
    }
  }

  private async check() {
    try {
      // 开发模式下使用 Vite 代理，避免浏览器并发连接限制问题
      // 生产/Tauri 模式下使用直连
      const healthUrl = isDevMode() 
        ? '/v1/health'  // 走 Vite 代理，避免跨域和连接限制
        : 'http://127.0.0.1:18789/v1/health';  // 直连网关

      console.log('[GatewayFallback] Fetching:', healthUrl, '(devMode:', isDevMode() + ')');

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
      
      console.log('[GatewayFallback] Response status:', resp.status); 
      
      if (resp.ok) {
        console.log('[GatewayFallback] ✅ Health check OK');
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
    console.log(`[GatewayFallback] Failures: ${this.failures}/3, current status: ${this.status}`);
    
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
    console.log(`[GatewayFallback] Status changed → ${this.status}`);
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
