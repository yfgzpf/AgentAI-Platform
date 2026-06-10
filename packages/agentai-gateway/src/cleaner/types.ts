/**
 * 清理器核心类型定义
 * 360 风格智能清理器: SAFE(直接清理) / RISKY(需确认) / ALERT(告警)
 */

export type RiskLevel = 'safe' | 'risky' | 'alert' | 'keep';

/**
 * 动作类型:
 *  - delete: 直接删除
 *  - gzip-archive: 压缩归档 (如审计日志)
 *  - move-archive: 移动归档 (如会话记忆)
 *  - llm-free-archive: 启发式压缩 (保留 markdown 标题)
 *  - confirm-required: 需用户确认
 *  - alert-and-confirm: 告警并需确认
 *  - alert: 仅告警
 *  - none: 不处理
 */
export type Action =
    | 'delete'
    | 'gzip-archive'
    | 'move-archive'
    | 'llm-free-archive'
    | 'confirm-required'
    | 'alert-and-confirm'
    | 'alert'
    | 'none';

/**
 * 清理规则: 声明式,支持 path glob + 阈值表达式
 * 路径支持 ~ (用户目录) 和 <workspace> (当前工作区) 占位符
 */
export interface Rule {
    id: string;
    match: {
        path?: string;         // glob pattern, supports ~ and <workspace>
        mtimeDaysAgo?: string; // e.g. ">7",">=30"
        sizeBytes?: string;    // e.g. ">104857600" (100MB)
        totalBytes?: string;   // e.g. ">1073741824" (1GB) — 配额阈值
    };
    action: Action;
    risk: RiskLevel;
    archiveDir?: string;       // 归档目标目录
    strategy?: 'keep-section-titles-only';  // 启发式压缩策略
}

/**
 * 文件元信息: 扫描器产出
 */
export interface FileMeta {
    path: string;
    size: number;
    mtime: number;
    atime: number;
    isFile: boolean;
}

/**
 * 计划项: 规则匹配 + 文件元信息绑定
 */
export interface FileAction {
    planId: string;        // p_<12位hash>
    ruleId: string;
    risk: RiskLevel;
    action: Action;
    file: FileMeta;
    archiveDir?: string;
}

/**
 * 风险计划: 待用户确认的项,聚合同一类文件
 */
export interface RiskyPlan {
    planId: string;
    category: string;      // rule id
    files: FileMeta[];
    createdAt: number;
    reason: string;
}

/**
 * 清理器全局状态(持久化到 ~/.agentai/cleaner/state.json)
 */
export interface CleanerState {
    version: 1;
    lastFullRun: number;        // 上次全量运行时间 (ms)
    lastScan: number;           // 上次扫描时间 (ms)
    pendingRiskyPlans: RiskyPlan[];
    cumulativeBytes: number;    // 累计释放字节数
    alertsLast24h: number;      // 最近 24h 告警数
    lastRuleReload: number;     // 上次规则重载时间
    nextQuickCheckAt: number;   // 下次 5min 磁盘检查时间 (ms); 0=未调度
    nextFullRunAt: number;      // 下次 24h 全量清理时间 (ms); 0=未调度
}

/**
 * 审计写入器接口(对接现有 audit 系统)
 */
export interface AuditWriter {
    log: (entry: {
        action: string;
        payload?: any;
        result?: 'ok' | 'error' | 'denied';
        userId?: string;     // 兼容 audit.ts 中的 AuditEntry
    }) => Promise<void> | void;
}

export const EMPTY_STATE: CleanerState = {
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
