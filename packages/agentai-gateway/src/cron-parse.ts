/**
 * cron-parse.ts — 标准 5 段 cron 解析与匹配 (纯函数, 可测)
 * =====================================================================
 * 事故 (富哥 2026-10-19 启动日志):
 *   [automation] 不支持的 cron 表达式: 0 2 * * *, 使用默认 60 分钟   ← 连刷 10 次
 * 原 scheduleCron 只会解析 `* / N` 这一种形态, 其它一律退化成"每 60 分钟"。
 * 于是"每日代码备份(0 2 * * *)""日志清理(0 4 * * *)""Git 同步(0 * * * *)"
 * 这些**全都在按小时乱跑** —— 备份/清理的时间点完全不是用户设定的。
 *
 * 支持语法 (标准 5 段: 分 时 日 月 周):
 *   *        任意
 *   N        具体值
 *   a-b      区间
 *   a-b/n    区间步长
 *   * /n     步长
 *   a,b,c    枚举 (每段内部可混用上面任意写法)
 * 周: 0-6 (0=周日), 也接受 7 表示周日。
 *
 * 日/周同时被限定时, 按 vixie cron 的惯例取 **OR** (任一满足即触发)。
 */

export interface CronFields {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
}

const RANGES: Array<[keyof CronFields, number, number]> = [
  ['minute', 0, 59],
  ['hour', 0, 23],
  ['dom', 1, 31],
  ['month', 1, 12],
  ['dow', 0, 6], // 7 会在解析时折成 0
];

/** 解析单个字段; 非法返回 null (调用方据此回退) */
export function parseCronField(expr: string, min: number, max: number, allowSeven = false): Set<number> | null {
  const out = new Set<number>();
  const parts = String(expr ?? '').trim().split(',');
  if (parts.length === 0) return null;

  for (const raw of parts) {
    const part = raw.trim();
    if (!part) return null;

    let step = 1;
    let body = part;
    const slash = part.indexOf('/');
    if (slash >= 0) {
      body = part.slice(0, slash);
      const stepStr = part.slice(slash + 1);
      if (!/^\d+$/.test(stepStr)) return null;
      step = parseInt(stepStr, 10);
      if (step <= 0) return null;
    }

    let lo: number;
    let hi: number;
    if (body === '*') {
      lo = min;
      hi = max;
    } else if (body.includes('-')) {
      const [a, b] = body.split('-');
      if (!/^\d+$/.test(a ?? '') || !/^\d+$/.test(b ?? '')) return null;
      lo = parseInt(a!, 10);
      hi = parseInt(b!, 10);
    } else {
      if (!/^\d+$/.test(body)) return null;
      lo = parseInt(body, 10);
      // "5/10" 这类写法: 从 5 开始按步长走到上界
      hi = slash >= 0 ? max : lo;
    }

    // 周日写成 7 也认
    if (allowSeven) {
      if (lo === 7) lo = 0;
      if (hi === 7) hi = 0;
    }

    if (lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }

  return out.size > 0 ? out : null;
}

/** 解析整条表达式; 非法返回 null */
export function parseCron(expression: string): CronFields | null {
  const fields = String(expression ?? '').trim().split(/\s+/);
  if (fields.length !== 5) return null;

  const parsed: Partial<CronFields> = {};
  for (let i = 0; i < RANGES.length; i++) {
    const [key, min, max] = RANGES[i]!;
    const set = parseCronField(fields[i]!, min, max, key === 'dow');
    if (!set) return null;
    parsed[key] = set;
  }
  return parsed as CronFields;
}

/** 判断某时刻是否命中该 cron (星期取本地时区) */
export function cronMatches(f: CronFields, date: Date): boolean {
  if (!f.minute.has(date.getMinutes())) return false;
  if (!f.hour.has(date.getHours())) return false;
  if (!f.month.has(date.getMonth() + 1)) return false;

  const domAny = f.dom.size >= 31;
  const dowAny = f.dow.size >= 7;
  const domHit = f.dom.has(date.getDate());
  const dowHit = f.dow.has(date.getDay());

  if (domAny && dowAny) return true;
  if (domAny) return dowHit;
  if (dowAny) return domHit;
  // 两者都被限定 → vixie cron 惯例: OR
  return domHit || dowHit;
}

/**
 * 兼容老的 `* / N` 语义: 返回"N 分钟一次"的间隔 (毫秒), 非该形态返回 null。
 * 保留它是因为历史任务里有 `* / 30 * * * *` 这类写法, 走分钟级匹配一样能算出来。
 */
export function legacyIntervalMs(expression: string): number | null {
  const m = String(expression ?? '').match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
  if (!m) return null;
  const n = parseInt(m[1]!, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n * 60 * 1000;
}
