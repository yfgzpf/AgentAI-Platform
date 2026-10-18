/**
 * 日志轮转 — 防止日志文件无限膨胀
 * ----------------------------------------------------
 * P0 修复 (D2): crash.log 曾膨胀到 33.8GB 导致磁盘写满
 * 
 * 策略:
 * 1. 文件大小超过阈值 → 截断保留尾部(最近的日志), 丢弃头部
 * 2. 保留最多 2 个轮转副本 (.1, .2)
 * 3. 单文件硬上限 500MB (即使轮转后也不超过)
 * 4. 崩溃循环场景: 每分钟检查一次 (而非每小时)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const MAX_LOG_SIZE = 50 * 1024 * 1024; // 50MB → 触发轮转
const HARD_CAP = 200 * 1024 * 1024;    // 200MB → 硬截断(只保留尾部 10MB)
const TAIL_KEEP = 10 * 1024 * 1024;    // 硬截断时保留尾部 10MB
const MAX_BACKUPS = 2;                  // 保留 2 个轮转副本

// P0 修复: 添加 crash.log — 崩溃循环时膨胀最快的文件
//
// 🔴 2026-10-19 富哥实锤: 轮转形同虚设, 因为**文件名和目录都对不上**。
//   真相: 崩溃日志实际写在 `~/.agentai/gateway-crash.log` (index.ts 里
//   `path.join(os.homedir(), '.agentai', 'gateway-crash.log')`),
//   而本列表写的是 `crash.log` 且调用方传的是 gateway **包目录**
//   → 文件名不匹配 + 目录不匹配, 双重落空, 那个文件涨到 31.5GB 都没人管。
// 修法: 名单加 `gateway-crash.log`, 并让 startLogRotation 支持多目录。
const LOG_FILES = [
  'gateway-crash.log', // 2026-10-19: 真实文件名 (原来误写 crash.log)
  'crash.log',
  'gateway-restart.log',
  'gateway-dev.log',
  'gateway-tsx.log',
  'gateway-a1.log',
];

export function rotateLogs(logDir: string): void {
  for (const logFile of LOG_FILES) {
    const logPath = path.join(logDir, logFile);
    try {
      if (!fs.existsSync(logPath)) continue;
      const stats = fs.statSync(logPath);

      // 硬上限: 文件超过 HARD_CAP → 直接截断尾部保留
      if (stats.size > HARD_CAP) {
        hardTruncate(logPath, stats.size);
        console.log(`[log-rotate] ✂️ ${logFile} 硬截断 (${(stats.size / 1024 / 1024).toFixed(1)}MB → ${TAIL_KEEP / 1024 / 1024}MB 尾部)`);
        continue;
      }

      // 正常轮转: 超过 MAX_LOG_SIZE → 轮转
      if (stats.size > MAX_LOG_SIZE) {
        // 移动旧备份: .1 → .2, .old/.1 → .1
        for (let i = MAX_BACKUPS; i > 1; i--) {
          const from = `${logPath}.${i - 1}`;
          const to = `${logPath}.${i}`;
          try { if (fs.existsSync(from)) { try { fs.unlinkSync(to); } catch {} fs.renameSync(from, to); } } catch {}
        }
        // 当前日志 → .1
        const backupPath = `${logPath}.1`;
        try { if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath); } catch {}
        fs.renameSync(logPath, backupPath);
        // 新建空文件
        fs.writeFileSync(logPath, '', 'utf-8');
        console.log(`[log-rotate] 📦 ${logFile} (${(stats.size / 1024 / 1024).toFixed(1)}MB) → 轮转为 ${logFile}.1`);
      }
    } catch { /* best-effort */ }
  }
}

/** 硬截断: 保留文件尾部 TAIL_KEEP 字节, 丢弃头部 */
function hardTruncate(logPath: string, currentSize: number): void {
  try {
    const fd = fs.openSync(logPath, 'r');
    const buf = Buffer.alloc(TAIL_KEEP);
    fs.readSync(fd, buf, 0, TAIL_KEEP, currentSize - TAIL_KEEP);
    fs.closeSync(fd);
    // 写回尾部内容
    fs.writeFileSync(logPath, buf);
  } catch {
    // 截断失败 → 清空文件 (比膨胀好)
    try { fs.writeFileSync(logPath, '', 'utf-8'); } catch {}
  }
}

/**
 * 启动定期日志轮转检查 (每 2 分钟 — 崩溃循环场景需要快速响应)
 *
 * 🔴 2026-10-19: 原来只收单个目录 (调用方传的是 gateway 包目录), 而真正在膨胀的
 *   `~/.agentai/gateway-crash.log` 在 home 下 → 扫不到。现在支持多目录:
 *   `~/.agentai` (运行时日志) + 包目录 (开发期日志), 一次轮转全部覆盖。
 * 向后兼容: 传 string 仍按单目录处理。
 */
export function startLogRotation(logDirs: string | string[]): void {
  const dirs = Array.isArray(logDirs) ? logDirs.filter(Boolean) : [logDirs].filter(Boolean);
  // 启动时立即检查一次
  for (const d of dirs) rotateLogs(d);
  // 每 2 分钟检查 (原 1 小时太慢, 崩溃循环 1 小时可写 10GB+)
  const timer = setInterval(() => { for (const d of dirs) rotateLogs(d); }, 2 * 60 * 1000);
  timer.unref?.();
  console.log(`[log-rotate] 🔄 日志轮转已启动 (目录: ${dirs.join(' | ')}, 阈值 ${MAX_LOG_SIZE / 1024 / 1024}MB, 硬上限 ${HARD_CAP / 1024 / 1024}MB, 每 2 分钟检查)`);
}
