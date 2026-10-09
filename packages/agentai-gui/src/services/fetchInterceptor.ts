/**
 * 全局 Fetch 拦截器 — 打包后 API 请求 404 问题修复
 *
 * 核心逻辑:
 * - 开发态 (IS_DEV): GATEWAY_HTTP = '' → 不改 URL, 走 Vite proxy
 * - 生产态 (Tauri/Web): GATEWAY_HTTP = 'http://127.0.0.1:18789' → 重定向到 Gateway
 *
 * 统一使用 config.ts 的 GATEWAY_HTTP, 不再依赖 gatewayFallback 的运行时状态,
 * 避免启动期间状态变化导致的双重重定向矛盾。
 */

import { GATEWAY_HTTP } from './config';

/** 需要被拦截的 API 路径前缀 */
const API_PREFIXES = ['/v1/', '/api/', '/agent/', '/socket.io'];

function needsRedirect(url: string): boolean {
  if (!url.startsWith('/')) return false;
  for (const prefix of API_PREFIXES) {
    if (url.startsWith(prefix)) return true;
  }
  return false;
}

export function installFetchInterceptor(): void {
  if ((window as any).__fetchInterceptorInstalled) {
    return;
  }
  (window as any).__fetchInterceptorInstalled = true;

  const originalFetch = window.fetch;

  /**
   * 读取当前工作区（发给后端用于请求级隔离）
   * ─────────────────────────────────────────────────────────────
   * 2026-10-06 新增。后端已支持 `x-workspace` 头建立 ALS 请求作用域
   * （见 gateway/src/request-scope.ts 的 workspaceFromRequest）。
   *
   * 为什么需要: 后端原先在 POST /v1/chat 里调 `wm.setProjectDir(body.workspace)`
   * 改写**进程级**单例 → 并发请求互相污染工作区
   * → A 的任务会在 B 的项目里读写文件。修复后改由请求作用域承载，
   * 但仍需前端把 workspace 告诉后端 —— 否则 REST 端点（备份/偏好等）
   * 不知道该用哪个工作区。
   *
   * 读取顺序（与后端一致）: localStorage agentai.workspace → profile.workspace
   */
  function currentWorkspace(): string {
    try {
      return (
        localStorage.getItem('agentai.workspace') ||
        localStorage.getItem('currentWorkspace') ||
        ''
      );
    } catch {
      return '';
    }
  }

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
      // GATEWAY_HTTP: 开发态='' (不改URL), 生产态='http://127.0.0.1:18789'
      if (GATEWAY_HTTP) {
        const redirectedUrl = GATEWAY_HTTP + url;
        if (input instanceof Request) {
          return originalFetch.call(window, new Request(redirectedUrl, input), init);
        }
        return originalFetch.call(window, redirectedUrl, init);
      }
      // 开发态: GATEWAY_HTTP 为空, 不改 URL, 走 Vite proxy
    }

    // ── 注入 x-workspace 头（请求级工作区隔离）──
    // 放行条件: 是 Gateway API 路径 + 本地有工作区 + 调用方未显式设置该头。
    // 调用方显式设置时不覆盖（useIdeState.ts 已手动设过）。
    try {
      const ws = currentWorkspace();
      if (ws && url.startsWith('/') && API_PREFIXES.some((p) => url.startsWith(p))) {
        const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
        if (!headers.has('x-workspace')) {
          headers.set('x-workspace', ws);
          const nextInit: RequestInit = { ...(init || {}), headers };
          if (input instanceof Request) {
            return originalFetch.call(window, new Request(input, nextInit));
          }
          return originalFetch.call(window, input, nextInit);
        }
      }
    } catch { /* localStorage 不可用时静默降级 */ }

    return originalFetch.call(window, input, init);
  };
}

installFetchInterceptor();
