/**
 * 简单日志工具
 * 支持 console 输出 + 可选的文件日志
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const LOGS_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '.',
  '.agentai-wechat',
  'logs'
);

let fileLoggingEnabled = false;

function writeToFile(level: string, message: string, meta?: any): void {
  if (!fileLoggingEnabled) return;
  try {
    const dateStr = (new Date().toISOString().split('T')[0]) || '';
    const logDir = path.join(LOGS_DIR, dateStr.substring(0, 7)); // monthly rotation
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, `${dateStr}.log`);
    const line = `[${new Date().toISOString()}] [${level}] ${message}` +
      (meta ? ` ${JSON.stringify(meta)}` : '') + '\n';
    fs.appendFileSync(logFile, line);
  } catch {
    // Silently ignore log write errors
  }
}

export const logger = {
  info(msg: string, meta?: any) {
    console.log(`\x1b[32m[INFO]\x1b[0m ${msg}`, meta || '');
    writeToFile('INFO', msg, meta);
  },
  warn(msg: string, meta?: any) {
    console.warn(`\x1b[33m[WARN]\x1b[0m ${msg}`, meta || '');
    writeToFile('WARN', msg, meta);
  },
  error(msg: string, meta?: any) {
    console.error(`\x1b[31m[ERROR]\x1b[0m ${msg}`, meta || '');
    writeToFile('ERROR', msg, meta);
  },
  debug(msg: string, meta?: any) {
    if (process.env.DEBUG) {
      console.log(`\x1b[90m[DEBUG]\x1b[0m ${msg}`, meta || '');
    }
    writeToFile('DEBUG', msg, meta);
  },
  enableFileLogging(dir?: string) {
    fileLoggingEnabled = true;
    if (dir) {
      // Could extend to support custom log dir
    }
  },
};
