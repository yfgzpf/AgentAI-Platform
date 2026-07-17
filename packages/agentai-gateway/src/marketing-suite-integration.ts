/**
 * Marketing Suite Integration - 营销套件集成
 * 
 * 统一入口，整合所有营销获客能力
 */

import { getAgentAIRouter } from './llm-router.js';
import { getMarketingAcquisitionEngine } from './marketing-acquisition-engine.js';
import { getContentDistributionSystem } from './content-distribution-system.js';
import { getAcquisitionAnalyticsPlatform } from './acquisition-analytics-platform.js';

// 初始化营销套件
export function initializeMarketingSuite() {
  const router = getAgentAIRouter();
  
  // 1. 营销获客引擎
  const engine = getMarketingAcquisitionEngine(router);
  console.log('[MarketingSuite] MarketingAcquisitionEngine initialized');
  
  // 2. 内容分发系统
  const distribution = getContentDistributionSystem();
  console.log('[MarketingSuite] ContentDistributionSystem initialized');
  
  // 3. 获客分析平台
  const analytics = getAcquisitionAnalyticsPlatform();
  console.log('[MarketingSuite] AcquisitionAnalyticsPlatform initialized');
  
  // 返回集成对象
  return {
    engine,
    distribution,
    analytics,
  };
}

// 导出所有模块
export { getMarketingAcquisitionEngine } from './marketing-acquisition-engine.js';
export { getContentDistributionSystem } from './content-distribution-system.js';
export { getAcquisitionAnalyticsPlatform } from './acquisition-analytics-platform.js';

// 类型导出
export type { 
  ContentStrategy, 
  ContentPiece, 
  SEOAnalysis, 
  GEOOptimization,
  CompetitorAnalysis,
  LeadJourney 
} from './marketing-acquisition-engine.js';

export type { 
  DistributionJob, 
  PlatformAdapter,
  ContentAdaptation 
} from './content-distribution-system.js';

export type { 
  AcquisitionData, 
  ConversionFunnel, 
  ChannelPerformance,
  CohortAnalysis,
  PredictiveInsight 
} from './acquisition-analytics-platform.js';
