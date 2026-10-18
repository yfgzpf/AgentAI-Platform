/**
 * profile-local — localStorage 直读的用户身份 (2026-10-12 从 App.tsx 拆出)
 * ---------------------------------------------------------------------
 * 原 App.tsx:304-343。之所以要直读 localStorage 而不用 zustand:
 * persist 是异步 hydration, 首次渲染拿不到值 → 会闪「游客」并误跳转。
 */
import type { UserProfile } from '../store';

/** 从 localStorage 直接读取缓存的用户身份 (绕过 zustand persist 异步 hydration) */
export function getLocalProfile(): UserProfile | null {
  try {
    const raw = localStorage.getItem('agentai-user-profile');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // zustand persist v4 格式: { state: { profile: ... } }
    return parsed?.state?.profile || parsed?.profile || null;
  } catch { return null; }
}

/** 获取所有已知的用户身份 (从 localStorage 中读取所有 agentai.user.* 键) */
export function getAllUserProfiles(): Array<UserProfile & { userId: string }> {
  const profiles: Array<UserProfile & { userId: string }> = [];
  try {
    // 读取 agentai-user-profile (当前用户)
    const currentRaw = localStorage.getItem('agentai-user-profile');
    if (currentRaw) {
      const parsed = JSON.parse(currentRaw);
      const profile = parsed?.state?.profile || parsed?.profile || null;
      if (profile?.name) {
        profiles.push({ ...profile, userId: profile.name });
      }
    }
    // 读取 agentai.user.* 键 (历史用户)
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('agentai.user.')) {
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.name) {
            profiles.push({ ...parsed, userId: parsed.name });
          }
        }
      }
    }
  } catch { /* ignore */ }
  return profiles;
}