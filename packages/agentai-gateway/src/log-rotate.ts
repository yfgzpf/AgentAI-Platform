/**
 * 日志轮转 — 防止日志文件无限膨胀
 * ----------------------------------------------------
 * 检查 gateway-restart.log 等日志文件大小
 * 超过阈值时自动轮转 (重命名为 .old, 新建空文件)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB
const LOG_FILES = [
  'gateway-restart.log',
  'gateway-dev.log',
  'gateway-tsx.log',
];

export function rotateLogs(logDir: string): void {
  for (const logFile of LOG_FILES) {
    const logPath = path.join(logDir, logFile);
    try {
      if (!fs.existsSync(logPath)) continue;
      const stats = fs.statSync(logPath);
      if (stats.size > MAX_LOG_SIZE) {
        const oldPath = `${logPath}.old`;
        // 删除旧 .old 文件 (只保留1个轮转)
        try { fs.unlinkSync(oldPath); } catch { /* ignore */ }
        // 重命名当前日志为 .old
        fs.renameSync(logPath, oldPath);
        // 新建空文件
        fs.writeFileSync(logPath, '', 'utf-8');
        console.log(`[log-rotate] 📦 ${logFile} (${(stats.size / 1024 / 1024).toFixed(1)}MB) → 轮转为 ${logFile}.old`);
      }
    } catch { /* best-effort */ }
  }
}

/** 启动定期日志轮转检查 (每小时) */
export function startLogRotation(logDir: string): void {
  // 启动时立即检查一次
  rotateLogs(logDir);
  // 每小时检查
  const timer = setInterval(() => rotateLogs(logDir), 60 * 60 * 1000);
  timer.unref?.();
  console.log(`[log-rotate] 🔄 日志轮转已启动 (阈值 ${MAX_LOG_SIZE / 1024 / 1024}MB, 每小时检查)`);
}
