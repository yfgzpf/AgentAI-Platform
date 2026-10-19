/**
 * 环境变量优先级合并 (2026-10-19 P0 修复)
 * =================================================
 * 背景: 用户通过前端 GUI 把 API Key 保存到 .env, 但重启网关后 loadEnv() 用
 *   `!process.env[name]` 守卫让 **shell 环境变量优先于 .env** ⇒ .env 被忽略,
 *   导致"前端改了密钥、重启又变回旧密钥"。实锤: shell 里静态设了
 *   DEEPSEEK_API_KEY, 而 .env 里是新密钥, 重启后旧值胜出。
 *
 * 规则 (意图对齐):
 *   - 非 key 变量 (如 AGENTAI_PORT / AGENTAI_WORKSPACE): 保持原语义 ——
 *     shell 环境变量优先, .env 仅填补缺失, 不破坏合法的 shell 覆盖。
 *   - key 变量 (*_API_KEY / FACTORY_*_KEY): .env 是 GUI 的持久化意图,
 *     **强制覆盖**已存在的 shell 环境变量, 保证前端保存的密钥重启后仍然生效。
 */
export function isKeyEnvVar(name: string): boolean {
  return /_API_KEY$/.test(name) || /^FACTORY_.*_KEY$/.test(name);
}

export interface EnvMergeResult {
  /** 最终应采用的值 */
  value: string;
  /** true 表示 .env 覆盖了已存在的 shell 环境变量 (供警告日志) */
  overridden: boolean;
}

/**
 * 计算单个环境变量的最终值。
 * @param name         变量名
 * @param envFileValue .env 文件里解析出的值
 * @param existingValue 进程启动时已存在的 shell 环境变量值 (可能为 undefined)
 */
export function mergeEnvValue(
  name: string,
  envFileValue: string,
  existingValue: string | undefined,
): EnvMergeResult {
  // 1) 缺失 → 用 .env (原行为, 无变化)
  if (existingValue === undefined) {
    return { value: envFileValue, overridden: false };
  }
  // 2) key 变量 + .env 有值 → .env (GUI 持久化意图) 强制覆盖 shell 环境变量
  if (isKeyEnvVar(name) && envFileValue) {
    return { value: envFileValue, overridden: existingValue !== envFileValue };
  }
  // 3) 非 key 变量 / .env 为空 → shell 环境变量优先 (原行为, 无变化)
  return { value: existingValue, overridden: false };
}
