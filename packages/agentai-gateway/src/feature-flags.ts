/**
 * 功能开关配置 (灰度测试)
 * --------------------------------------------------
 * 通过环境变量控制新功能的启用，确保随时可回滚
 * 
 * 使用方法:
 * 1. 开发测试: USE_NEW_MODEL_SELECTOR=true npm run dev
 * 2. 生产灰度: 10% 流量启用，观察日志
 * 3. 全量启用: 移除环境变量，默认启用新逻辑
 * 4. 紧急回滚: USE_NEW_MODEL_SELECTOR=false 立即恢复旧逻辑
 */

export interface FeatureFlags {
  /** 使用新的模型选择器 (统一流式/非流式路径) */
  useNewModelSelector: boolean;
  /** 启用模型选择对比日志 (用于验证新旧逻辑一致性) */
  enableModelSelectorDiff: boolean;
  /** 新模型选择器流量百分比 (0-100) */
  newModelSelectorTrafficPercent: number;
  /** [ALTES | 岐黄] 启用诊断优先主链路 (望闻问切 → 因证施治) */
  enableDiagnosisPipeline: boolean;
}

function getEnvBool(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  return value === 'true' || value === '1';
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  const num = parseInt(value, 10);
  return isNaN(num) ? defaultValue : Math.max(0, Math.min(100, num));
}

/** 当前功能开关配置 */
export const FEATURE_FLAGS: FeatureFlags = {
  // 默认 false，验证稳定后改为 true
  useNewModelSelector: getEnvBool('USE_NEW_MODEL_SELECTOR', false),

  // 灰度期间开启，对比新旧逻辑差异
  enableModelSelectorDiff: getEnvBool('ENABLE_MODEL_SELECTOR_DIFF', true),

  // 灰度流量百分比，默认 0% (全量旧逻辑)
  newModelSelectorTrafficPercent: getEnvNumber('NEW_MODEL_SELECTOR_TRAFFIC_PERCENT', 0),
  
  // [ALTES | 岐黄] 诊断优先主链路，默认 false (开发中)
  enableDiagnosisPipeline: getEnvBool('ENABLE_DIAGNOSIS_PIPELINE', false),
};

/** 判断是否对新模型选择器启用 */
export function shouldUseNewModelSelector(userId: string): boolean {
  // 如果全局开关关闭，直接返回 false
  if (!FEATURE_FLAGS.useNewModelSelector) {
    return false;
  }
  
  // 如果流量百分比为 100，全部启用
  if (FEATURE_FLAGS.newModelSelectorTrafficPercent >= 100) {
    return true;
  }
  
  // 根据 userId 哈希决定是否启用 (确保同一用户始终走同一路径)
  const hash = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const bucket = hash % 100;
  return bucket < FEATURE_FLAGS.newModelSelectorTrafficPercent;
}

/** 打印当前功能开关状态 */
export function logFeatureFlags(): void {
  console.log('[feature-flags] Current configuration:');
  console.log(`  useNewModelSelector: ${FEATURE_FLAGS.useNewModelSelector}`);
  console.log(`  enableModelSelectorDiff: ${FEATURE_FLAGS.enableModelSelectorDiff}`);
  console.log(`  newModelSelectorTrafficPercent: ${FEATURE_FLAGS.newModelSelectorTrafficPercent}%`);
}

// 启动时打印配置
logFeatureFlags();
