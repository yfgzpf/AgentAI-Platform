/**
 * 速率限制集成模块（简化版）
 * 直接在index.ts中集成，避免编译问题
 */

import { globalRateLimiter } from './rate-limiter.js';

/**
 * 在路由器初始化后集成速率限制
 */
export function setupRateLimit(router: any): void {
  console.log('[rate-limiter] 速率限制智能控制已启用');
  
  // 添加监控接口到路由器
  router.getRateLimitStatus = function(): string {
    return globalRateLimiter.getStatusSummary();
  };
  
  router.getAvailableModels = function(): any[] {
    return globalRateLimiter.getAvailableModels();
  };
  
  // 定期输出速率状态（每5分钟）
  setInterval(() => {
    const status = globalRateLimiter.getStatusSummary();
    console.log(`[rate-limiter] 当前状态:\n${status}`);
  }, 5 * 60 * 1000);
}