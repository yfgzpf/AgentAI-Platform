import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// 0. 用户档案 (首次启动收集, 持久化)
export interface UserProfile {
name: string;
onboardedAt: number;
workspace?: string;
language: 'zh' | 'en';
industry?: string;           // 行业 ID (decoration/comic/ecommerce/...)
useCase?: string;            // 主要用例 (chat/image/code/auto)
questionnaire?: Record<string, string>;  // 问卷答案
industrySkills?: string[];   // 行业所需技能
devPrefs?: {                 // 开发者偏好 (developer 行业)
languages?: string[];
frontend?: string[];
backend?: string[];
packageManager?: string[];
css?: string[];
};
}
interface ProfileState {
  profile: UserProfile | null;
  setProfile: (p: UserProfile) => void;
  clearProfile: () => void;
}
export const useProfileStore = create<ProfileState>()(
  persist(
    (set) => ({
      profile: null,
      setProfile: (p) => set({ profile: p }),
      clearProfile: () => set({ profile: null }),
    }),
    { name: 'agentai-user-profile' },
  ),
);

/** 工具: 拿当前用户名 (给 Chat / Editor / ImageGen / VideoGen 用) */
export const useUserName = (): string => {
  return useProfileStore.getState().profile?.name || '你';
};

// 1. Framework 状态 (agentai / hermes + A/B 灰度)
interface FrameworkState {
  active: 'agentai' | 'hermes';
  abRatio: number;
  setActive: (f: 'agentai' | 'hermes') => void;
  setAbRatio: (r: number) => void;
}
export const useFrameworkStore = create<FrameworkState>()(
  persist(
    (set) => ({
      active: 'agentai',
      abRatio: 1,
      setActive: (f) => set({ active: f }),
      setAbRatio: (r) => set({ abRatio: r }),
    }),
    { name: 'agentai-framework' },
  ),
);

// 2. Chat 状态 (已移至 chatStore.ts, 保留此空接口供旧组件向后兼容)
// 新组件应导入: import { useChatStore } from './store/chatStore';

// 3. Settings 状态 (LLM provider / API key 状态)
interface SettingsState {
  provider: string; // "cline:deepseek-v4-flash" | "agentai:agnes-v4" | "deepseek:v4-pro" | "openai:gpt-4o-mini" | ...
  hasKey: boolean;
  setProvider: (p: string) => void;
  setHasKey: (b: boolean) => void;
}

const DEFAULT_PROVIDER = 'agentai:agnes-2.0-flash';
export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      provider: DEFAULT_PROVIDER,
      hasKey: false,
      setProvider: (p) => set({ provider: p }),
      setHasKey: (b) => set({ hasKey: b }),
    }),
    { name: 'agentai-settings' },
  ),
);

// 4. 字体大小偏好
export type FontSize = 'small' | 'medium' | 'large' | 'xlarge';

interface FontSizeState {
  fontSize: FontSize;
  setFontSize: (s: FontSize) => void;
}

export const FONT_SIZE_MAP: Record<FontSize, { label: string; scale: number; cssBase: string }> = {
  small:  { label: '小',   scale: 0.875, cssBase: '13px' },
  medium: { label: '中',   scale: 1.0,   cssBase: '14px' },
  large:  { label: '大',   scale: 1.125, cssBase: '15px' },
  xlarge: { label: '特大', scale: 1.25,  cssBase: '16px' },
};

export const useFontSizeStore = create<FontSizeState>()(
  persist(
    (set) => ({
      fontSize: 'medium',
      setFontSize: (s) => set({ fontSize: s }),
    }),
    { name: 'agentai-font-size' },
  ),
);
