/**
 * Logger — 可配置日志系统
 * ------------------------
 * 支持生产环境关闭日志，减少性能开销
 */
const LOG_LEVELS = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    silent: 4,
};
class Logger {
    config;
    constructor(config = {}) {
        this.config = {
            level: process.env.AGENTAI_LOG_LEVEL || 'info',
            prefix: config.prefix || '[AgentAI]',
            enableTimestamp: config.enableTimestamp ?? true,
        };
    }
    shouldLog(level) {
        return LOG_LEVELS[level] >= LOG_LEVELS[this.config.level];
    }
    formatMessage(level, ...args) {
        const timestamp = this.config.enableTimestamp ? `[${new Date().toISOString()}]` : '';
        const prefix = this.config.prefix ? `${this.config.prefix}` : '';
        return `${timestamp}${prefix}[${level.toUpperCase()}]`;
    }
    debug(...args) {
        if (this.shouldLog('debug')) {
            console.debug(this.formatMessage('debug'), ...args);
        }
    }
    info(...args) {
        if (this.shouldLog('info')) {
            console.log(this.formatMessage('info'), ...args);
        }
    }
    warn(...args) {
        if (this.shouldLog('warn')) {
            console.warn(this.formatMessage('warn'), ...args);
        }
    }
    error(...args) {
        if (this.shouldLog('error')) {
            console.error(this.formatMessage('error'), ...args);
        }
    }
    /** 设置日志级别 */
    setLevel(level) {
        this.config.level = level;
    }
    /** 获取当前日志级别 */
    getLevel() {
        return this.config.level;
    }
    /** 创建子 logger */
    child(prefix) {
        return new Logger({
            ...this.config,
            prefix: `${this.config.prefix}${prefix}`,
        });
    }
}
// 全局 logger 实例
export const logger = new Logger({ prefix: '[AgentAI]' });
// 专用 logger 实例
export const loopLogger = logger.child('[Loop]');
export const memoryLogger = logger.child('[Memory]');
export const toolLogger = logger.child('[Tool]');
export const workflowLogger = logger.child('[Workflow]');
/** 快速检查日志是否启用（用于高频调用前的判断） */
export function isLogEnabled(level) {
    const currentLevel = process.env.AGENTAI_LOG_LEVEL || 'info';
    return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}
