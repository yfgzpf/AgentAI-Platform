/**
 * 网关地址配置
 * Tauri/Web 模式下可通过 window.__AGENTAI_GATEWAY__ 覆盖默认值
 */

/** WebSocket / 原始连接地址 */
export const GATEWAY_WS = ((window as any).__AGENTAI_GATEWAY__ || 'ws://127.0.0.1:18789');

/** HTTP(S) 基础 URL */
export const GATEWAY_HTTP = GATEWAY_WS.replace(/^ws([s]?):\/\//, 'http$1://');

/** API 版本前缀 */
export const API_PREFIX = '/v1';
