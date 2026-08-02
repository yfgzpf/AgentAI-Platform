/**
 * 网关地址配置
 * Tauri/Web 模式下可通过 window.__AGENTAI_GATEWAY__ 覆盖默认值
 */

/** WebSocket / 原始连接地址 */
export const GATEWAY_WS = ((window as any).__AGENTAI_GATEWAY__ || 'ws://127.0.0.1:18789');

/** HTTP(S) 基础 URL — dev 模式使用相对路径走 vite proxy, prod 直连 Gateway */
const isDev = typeof window !== 'undefined' && (
  window.location?.hostname === 'localhost' || 
  window.location?.hostname === '127.0.0.1' || 
  window.location?.port === '5173' ||
  window.location?.port === '5174' ||
  window.location?.port === '5176'
);

/** 判断是否 Tauri 环境 */
const isTauri = typeof window !== 'undefined' && (
  !!(window as any).__TAURI_INTERNALS__ || 
  !!(window as any).__TAURI__ ||
  window.location?.hostname === 'tauri.localhost'
);

/**
 * HTTP 基础 URL:
 * - 始终直连 http://127.0.0.1:18789（避免 Vite 代理问题）
 */
export const GATEWAY_HTTP = 'http://127.0.0.1:18789';
