/**
 * ws-paths.ts — 工作区路径归一化(单一实现来源)
 * ============================================================================
 * 为什么不放在 pentest-scope-guard.ts 里:
 *   src-platforms.ts 需要复用 normWs, 而 pentest-scope-guard 又要 import
 *   src-platforms (为deny 硬闸门) —— 两者互相 import 会形成**循环依赖**,
 *   在 ESM 下表现为模块初始化顺序不确定(其中一个拿到 undefined 函数)。
 *   把纯路径工具抽到无依赖的独立模块, 循环即消失。
 *
 * ⚠️ 绝不要在别的模块里自己写一份 path.join(ws, ...):
 *   Windows 中文路径下 (如 "F:\目录已检查\澳彩"), path.join 会拼出
 *   "F:目录已检查澳彩\..." (反斜杠被当转义吞掉) → existsSync 永远 false
 *   → 表现为"授权/平台/证据数据神秘丢失", 且极难定位。
 */

/**
 * 归一化工作区路径: 反斜杠 → 正斜杠, 合并重复斜杠, 去掉尾斜杠。
 *
 * ⚠️ 实测 (2026-10-16): 不能只用 path.resolve —— 它把 "F:\目录已检查\澳彩"
 * 当成相对路径, 拼到 cwd 下仍读不到。可靠做法是先把反斜杠换成正斜杠再 join,
 * 得到 "F:/目录已检查/澳彩/.agentai/xxx" (existsSync 实测为 true)。
 */
export function normWsPath(ws: string): string {
  const s = String(ws || '').trim();
  if (!s) return '';
  return s.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
}

/** 拼工作区内的 .agentai 目录下的文件路径 */
export function agentAiPath(ws: string, ...rest: string[]): string {
  const base = normWsPath(ws);
  return [base, '.agentai', ...rest].filter(Boolean).join('/');
}