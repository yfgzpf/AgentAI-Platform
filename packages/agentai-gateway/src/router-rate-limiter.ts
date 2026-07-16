/**
 * 智能速率控制路由增强器
 * ----------------------------------------------------
 * 集成RateLimiter到路由策略，实现智能任务分配。
 * 
 * 核心能力:
 *   - 根据速率限制智能选择模型
 *   - 过滤掉速率已达的模型
 *   - 动态调整路由策略
 *   - 实时监控速率状态
 * 
 * @example
 * import { enhanceRouterWithRateLimit } from './router-rate-limiter.js';
 * enhanceRouterWithRateLimit(router);
 */

import { globalRateLimiter, ProviderStatus } from './rate-limiter.js';

/**
 * 增强路由器，添加速率限制控制
 * @param router - AgentAIRouter实例
 */
export function enhanceRouterWithRateLimit(router: any): void {
  // 1. 在路由选择时集成速率限制
  const originalRankProviders = router.rankProviders.bind(router);
  
  router.rankProviders = function(): any[] {
    // 获取原始排序结果
    const rankedProviders = originalRankProviders();
    
    // 过滤掉速率限制已达的模型
    const availableProviders = rankedProviders.filter((p: any) => {
      const status = globalRateLimiter.getProviderStatus(p.id);
      
      // 如果模型不可用（速率限制），跳过
      if (!status.isAvailable) {
        console.log(`[router-rate-limiter] ${p.id} 速率限制已达 (${status.currentRpm}/${globalRateLimiter.rateLimits[p.id]?.rpm || 100} RPM), 跳过`);
        return false;
      }
      
      return true;
    });
    
    // 如果所有模型都达到速率限制，返回原始排序（降级处理）
    if (availableProviders.length === 0) {
      console.warn('[router-rate-limiter] 所有模型都达到速率限制，使用原始排序（可能触发429错误）');
      return rankedProviders;
    }
    
    // 按剩余配额重新排序（优先选择剩余配额多的）
    availableProviders.sort((a: any, b: any) => {
      const statusA = globalRateLimiter.getProviderStatus(a.id);
      const statusB = globalRateLimiter.getProviderStatus(b.id);
      
      // 优先选择剩余RPM多的
      if (statusA.remainingRpm !== statusB.remainingRpm) {
        return statusB.remainingRpm - statusA.remainingRpm;
      }
      
      // 其次选择剩余TPM多的
      return statusB.remainingTpm - statusA.remainingTpm;
    });
    
    console.log(`[router-rate-limiter] 可用模型: ${availableProviders.map((p: any) => p.id).join(', ')}`);
    return availableProviders;
  };
  
  // 2. 在chat函数中记录请求到RateLimiter
  const originalChat = router.chat.bind(router);
  
  router.chat = async function(req: any): Promise<any> {
    // 预估本次请求的token数
    const estimatedTokens = estimateRequestTokens(req);
    
    // 智能选择最佳模型（根据速率限制）
    const bestProvider = globalRateLimiter.selectBestModel(estimatedTokens, req.model);
    
    // 如果没有可用模型，抛出错误
    if (!bestProvider) {
      console.error('[router-rate-limiter] 所有模型都达到速率限制，建议等待');
      throw new Error('所有模型都达到速率限制，建议等待几分钟后重试');
    }
    
    // 如果用户指定了模型，但该模型速率限制已达，自动降级
    if (req.model && req.model !== bestProvider) {
      const status = globalRateLimiter.getProviderStatus(req.model);
      if (!status.isAvailable) {
        console.log(`[router-rate-limiter] 用户指定${req.model}但速率限制已达，自动降级到${bestProvider}`);
        req.model = bestProvider;
      }
    }
    
    // 调用原始chat函数
    try {
      const response = await originalChat(req);
      
      // 记录成功请求到RateLimiter
      const actualTokens = response.usage?.total_tokens || estimatedTokens;
      globalRateLimiter.recordRequest(bestProvider, actualTokens, true);
      
      return response;
    } catch (error: any) {
      // 记录失败请求到RateLimiter
      globalRateLimiter.recordRequest(bestProvider, estimatedTokens, false);
      
      // 如果是429错误（速率限制），标记该模型为不可用
      if (error.message?.includes('429') || error.message?.includes('rate limit')) {
        console.warn(`[router-rate-limiter] ${bestProvider}触发429错误，标记为不可用`);
        
        // 自动重置该模型（等待速率限制解除）
        setTimeout(() => {
          globalRateLimiter.resetProvider(bestProvider);
          console.log(`[router-rate-limiter] ${bestProvider}速率限制已重置`);
        }, 60000); // 60秒后重置
      }
      
      throw error;
    }
  };
  
  // 3. 添加速率限制监控接口
  router.getRateLimitStatus = function(): string {
    return globalRateLimiter.getStatusSummary();
  };
  
  router.getAvailableModels = function(): ProviderStatus[] {
    return globalRateLimiter.getAvailableModels();
  };
  
  console.log('[router-rate-limiter] 速率限制控制已集成到路由器');
}

/**
 * 预估请求的token数
 */
function estimateRequestTokens(req: any): number {
  let totalTokens = 0;
  
  // 预估消息token数
  if (req.messages) {
    for (const msg of req.messages) {
      if (typeof msg.content === 'string') {
        totalTokens += Math.ceil(msg.content.length / 4); // 中文约4字符/token
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text') {
            totalTokens += Math.ceil(block.text.length / 4);
          } else if (block.type === 'image_url') {
            totalTokens += 1000; // 图片预估1000 tokens
          }
        }
      }
    }
  }
  
  // 预估工具调用token数
  if (req.tools) {
    totalTokens += req.tools.length * 200; // 每个工具预估200 tokens
  }
  
  return totalTokens;
}

/**
 * 导出增强函数和监控接口
 */
export { globalRateLimiter };