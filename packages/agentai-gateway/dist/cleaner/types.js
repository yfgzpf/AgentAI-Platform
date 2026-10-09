/**
 * 清理器核心类型定义
 * 360 风格智能清理器: SAFE(直接清理) / RISKY(需确认) / ALERT(告警)
 */
export const EMPTY_STATE = {
    version: 1,
    lastFullRun: 0,
    lastScan: 0,
    pendingRiskyPlans: [],
    cumulativeBytes: 0,
    alertsLast24h: 0,
    lastRuleReload: 0,
    nextQuickCheckAt: 0,
    nextFullRunAt: 0,
};
