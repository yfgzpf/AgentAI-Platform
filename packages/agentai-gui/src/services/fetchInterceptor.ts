/**
 * ═══════════════════════════════════════════════════════════════
 * 全局 Fetch 拦截器 — P0 修复: 打包后 API 请求 404 问题 + 网关状态感知
 * 
 * 关键改进：现在尊重 gatewayFallback 的状态
 * - 当 gateway 在线 (online) 时：重定向到 GATEWAY_HTTP
 * - 当 gateway 不可用 (unknown/offline/starting) 时：不重定向，让 api.ts 自行决定 base URL
 * 
 * 这样可以避免在 startup 窗口期因过早重定向导致的连接失败循环
 */

import { GATEWAY_HTTP } from './config';
import { gatewayFallback } from './GatewayFallback';

/** 需要被拦截的 API 路径前缀 */
const API_PREFIXES = ['/v1/', '/api/', '/agent/', '/socket.io'];

/**
 * 判断给定的 URL 字符串是否需要被重定向到 Gateway 或 fallback
 * 重定向的目标由 gatewayFallback 决定（在线则用 GATEWAY_HTTP，离线则用 FALLBACK_DIRECT_URL）
 */
function needsRedirect(url: string): boolean {
  if (!url.startsWith('/')) return false;
  for (const prefix of API_PREFIXES) {
    if (url.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * 安装全局 fetch 拦截器
 */
export function installFetchInterceptor(): void {
  // 不再禁用开发模式，因为 Vite 代理在 Windows 上不稳定
  // 始终使用拦截器将相对路径转换为绝对路径

  if ((window as any).__fetchInterceptorInstalled) {
    return;
  }
  (window as any).__fetchInterceptorInstalled = true;

  const originalFetch = window.fetch;

  window.fetch = async function interceptedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    let url: string;
    if (typeof input === 'string') {
      url = input;
    } else if (input instanceof URL) {
      url = input.toString();
    } else if (input instanceof Request) {
      url = input.url;
    } else {
      url = String(input);
    }

    if (needsRedirect(url)) {
      // 使用 gatewayFallback.url，它会根据状态返回正确的地址
      const targetBase = gatewayFallback.url || GATEWAY_HTTP;
      const redirectedUrl = targetBase + url;
      
      console.log(`[fetch-interceptor] ${url} → ${redirectedUrl} (gateway status: ${gatewayFallback.currentStatus})`);

      if (input instanceof Request) {
        return originalFetch.call(window, new Request(redirectedUrl, input), init);
      }

      return originalFetch.call(window, redirectedUrl, init);
    }

    return originalFetch.call(window, input, init);
  };

  gatewayFallback.onChange((status) => {
    console.log('[fetch-interceptor] gateway state changed to:', status);
  });

  console.log('[fetch-interceptor] installed (current gateway status:', gatewayFallback.currentStatus + ')');
}

installFetchInterceptor();