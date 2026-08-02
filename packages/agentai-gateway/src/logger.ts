/**
 * Logger — 可配置日志系统
 * ------------------------
 * 支持生产环境关闭日志，减少性能开销
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

interface LoggerConfig {
  level: LogLevel;
  prefix?: string;
  enableTimestamp?: boolean;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

class Logger {
  private config: LoggerConfig;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      level: (process.env.AGENTAI_LOG_LEVEL as LogLevel) || 'info',
      prefix: config.prefix || '[AgentAI]',
      enableTimestamp: config.enableTimestamp ?? true,
    };
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.level];
  }

  private formatMessage(level: LogLevel, ...args: any[]): string {
    const timestamp = this.config.enableTimestamp ? `[${new Date().toISOString()}]` : '';
    const prefix = this.config.prefix ? `${this.config.prefix}` : '';
    return `${timestamp}${prefix}[${level.toUpperCase()}]`;
  }

  debug(...args: any[]): void {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage('debug'), ...args);
    }
  }

  info(...args: any[]): void {
    if (this.shouldLog('info')) {
      console.log(this.formatMessage('info'), ...args);
    }
  }

  warn(...args: any[]): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn'), ...args);
    }
  }

  error(...args: any[]): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error'), ...args);
    }
  }

  /** 设置日志级别 */
  setLevel(level: LogLevel): void {
    this.config.level = level;
  }

  /** 获取当前日志级别 */
  getLevel(): LogLevel {
    return this.config.level;
  }

  /** 创建子 logger */
  child(prefix: string): Logger {
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
export function isLogEnabled(level: LogLevel): boolean {
  const currentLevel = (process.env.AGENTAI_LOG_LEVEL as LogLevel) || 'info';
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}
