/**
 * 网关地址配置
 * Tauri/Web 模式下可通过 window.__AGENTAI_GATEWAY__ 覆盖默认值
 */

/** WebSocket / 原始连接地址 */
export const GATEWAY_WS = ((window as any).__AGENTAI_GATEWAY__ || 'ws://127.0.0.1:18789');

/** 判断是否 Tauri 环境 (统一检测逻辑) */
const isTauri = typeof window !== 'undefined' && (
  !!(window as any).__TAURI_INTERNALS__ || 
  !!(window as any).__TAURI__ ||
  window.location?.protocol === 'tauri:' ||
  window.location?.hostname === 'tauri.localhost'
);

/** 判断是否 Vite dev server 环境 */
const isDev = !isTauri && typeof window !== 'undefined' && (
  (window.location?.hostname === 'localhost' || 
   window.location?.hostname === '127.0.0.1') &&
  (window.location?.port === '5173' ||
   window.location?.port === '5174' ||
   window.location?.port === '5176')
);

/**
 * HTTP 基础 URL:
 * - dev 模式使用相对路径走 Vite proxy
 * - Tauri/生产模式直连 http://127.0.0.1:18789
 */
export const GATEWAY_HTTP = isDev ? '' : 'http://127.0.0.1:18789';

/** 导出环境标志供其他模块使用 */
export const IS_TAURI = isTauri;
export const IS_DEV = isDev;
