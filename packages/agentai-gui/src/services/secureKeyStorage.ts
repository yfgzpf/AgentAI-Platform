/**
 * secureKeyStorage — 安全的 API Key 存储
 * ----------------------------------------------------
 * 用途: 把 API Key 从 localStorage 迁移到 sessionStorage
 * 防护: 1. 关闭浏览器自动销毁
 *       2. 显式白名单（防止任意 key 写入）
 *       3. 加 agentai. 前缀（避免污染 sessionStorage）
 */
const SESSION_KEY_PREFIX = 'agentai.';

// 已知敏感的 env var 名（白名单）
const SENSITIVE_KEYS = new Set([
  'DEEPSEEK_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'ZHIPU_API_KEY',
  'TENCENT_TC_ID',
  'TENCENT_TC_SECRET',
  'TTS_API_KEY',
  'TENCENT_SECRET_ID',
  'TENCENT_SECRET_KEY',
  'ALIYUN_ACCESS_KEY_ID',
  'ALIYUN_ACCESS_KEY_SECRET',
]);

function isSensitive(envVar: string): boolean {
  return SENSITIVE_KEYS.has(envVar) ||
    /_API_KEY$|_SECRET$|_TOKEN$|_PASSWORD$/i.test(envVar);
}

export function saveApiKey(envVar: string, value: string): void {
  if (!isSensitive(envVar)) {
    throw new Error(`Refused to save non-sensitive key to sessionStorage: ${envVar}`);
  }
  try {
    sessionStorage.setItem(SESSION_KEY_PREFIX + envVar, value);
  } catch (e) {
    // sessionStorage 满了或被禁用
    console.error('[secureKeyStorage] save failed:', e);
  }
}

export function getApiKey(envVar: string): string | null {
  if (!isSensitive(envVar)) return null;
  try {
    return sessionStorage.getItem(SESSION_KEY_PREFIX + envVar);
  } catch {
    return null;
  }
}

export function removeApiKey(envVar: string): void {
  if (!isSensitive(envVar)) return;
  try {
    sessionStorage.removeItem(SESSION_KEY_PREFIX + envVar);
  } catch {}
}

export function listApiKeys(): { envVar: string; masked: string }[] {
  const result: { envVar: string; masked: string }[] = [];
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      // 防御性检查：确保 k 是字符串
      if (typeof k === 'string' && k.startsWith(SESSION_KEY_PREFIX)) {
        const envVar = k.slice(SESSION_KEY_PREFIX.length);
        const v = sessionStorage.getItem(k) || '';
        result.push({
          envVar,
          masked: v.length > 6 ? v.slice(0, 2) + '****' + v.slice(-4) : '****',
        });
      }
    }
  } catch (e) {
    console.error('[secureKeyStorage] listApiKeys failed:', e);
  }
  return result;
}
