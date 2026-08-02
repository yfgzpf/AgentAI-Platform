/**
 * API 配置 - 修复 Tauri 打包后的路径问题
 * 
 * 开发模式: 使用相对路径，Vite Proxy 转发到 Gateway
 * 打包模式: 使用完整 URL，直接访问 Gateway
 */

// 检测是否在 Tauri 环境中
const isTauri = !!(window as any).__TAURI_INTERNALS__ || 
                window.location.protocol === 'tauri:' ||
                window.location.href.includes('tauri://') ||
                window.location.hostname === 'tauri.localhost';

// API 基础 URL
export const API_BASE_URL = isTauri 
    ? 'http://127.0.0.1:18789'  // Tauri 打包后使用完整 URL
    : '';  // 开发模式使用相对路径（Vite Proxy）

// WebSocket URL
export const WS_BASE_URL = isTauri
    ? 'ws://127.0.0.1:18789'
    : `ws://${window.location.host}`;

// 构建完整 API URL
export function apiUrl(path: string): string {
    // 确保 path 以 / 开头
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${API_BASE_URL}${normalizedPath}`;
}

// 导出环境检测
export { isTauri };
