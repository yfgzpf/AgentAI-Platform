import { create } from 'zustand';

/**
 * 密钥制订阅系统 (Key-Based Access)
 * ----------------------------------------------------
 * 核心设计理念：
 * 1. 我们不管理用户的资金（资金在聚合平台）
 * 2. 我们只管理"访问权限"（通过密钥控制）
 * 3. 用户向作者购买密钥 → 填入系统 → 解锁全部模型
 * 4. 聚合平台负责计费和余额管理
 * 
 * 这种模式的优势：
 * - ✅ 零资金风险（不会亏钱）
 * - ✅ 简单可靠（不需要复杂的充值/扣费系统）
 * - ✅ 用户透明（看到的是聚合平台的真实价格）
 * - ✅ 私域引流（引导加微信获取密钥）
 */

/** 用户账户状态 */
export interface AccountState {
  /** 是否已激活（有有效密钥） */
  isActivated: boolean;
  /** 激活时间 */
  activatedAt: number;
  /** 密钥来源 (用于显示) */
  keySource?: 'factory' | 'custom';
  /** 聚合平台余额（如果可查询） */
  platformBalance?: number;
  /** 最后一次余额查询时间 */
  lastBalanceCheck?: number;
}

const ACCOUNT_STORAGE_KEY = 'agentai-account';

const defaultState: AccountState = {
  isActivated: false,
  activatedAt: 0,
};

interface AccountStore extends AccountState {
  // 激活/停用
  activateWithKey: (source?: 'factory' | 'custom') => void;
  deactivate: () => void;
  
  // 查询状态
  isModelAccessible: (modelId: string) => boolean;
  getActivationStatus: () => { activated: boolean; source: string; message: string };
  
  // 重置
  resetAccount: () => void;
}

export const useSubscriptionStore = create<AccountStore>()((set, get) => ({
  ...defaultState,

  /**
   * 激活账户（用户填入有效密钥后调用）
   */
  activateWithKey: (source = 'factory') => {
    set({ 
      isActivated: true, 
      activatedAt: Date.now(),
      keySource: source,
    });
    saveToStorage(get());
    
    // 触发事件，让其他组件知道账户已激活
    window.dispatchEvent(new CustomEvent('agentai:account-activated', { detail: { source } }));
  },

  /**
   * 停用账户（用户删除密钥时调用）
   */
  deactivate: () => {
    set({ isActivated: false, keySource: undefined });
    saveToStorage(get());
    window.dispatchEvent(new CustomEvent('agentai:account-deactivated'));
  },

  /**
   * 检查模型是否可访问
   * - 免费模型：始终可访问
   * - 工厂模型：需要激活
   * - 自定义模型：需要对应密钥
   */
  isModelAccessible: (modelId: string) => {
    const { isActivated } = get();
    
    // 免费模型始终可用
    if (isFreeModel(modelId)) return true;
    
    // 工厂模型需要激活
    if (modelId.startsWith('factory-')) {
      return isActivated;
    }
    
    // 其他模型需要检查是否有对应密钥
    // 这里简化处理：激活后所有模型可用
    return isActivated;
  },

  /**
   * 获取激活状态描述
   */
  getActivationStatus: () => {
    const { isActivated, keySource, activatedAt } = get();
    
    if (!isActivated) {
      return { 
        activated: false, 
        source: 'none', 
        message: '未激活 · 请添加密钥解锁高级模型' 
      };
    }
    
    const sourceLabel = keySource === 'factory' ? '模型工厂' : '自定义';
    const timeAgo = formatTimeAgo(activatedAt);
    
    return { 
      activated: true, 
      source: sourceLabel, 
      message: `已激活 (${sourceLabel}) · ${timeAgo}` 
    };
  },

  resetAccount: () => {
    set(defaultState);
    localStorage.removeItem(ACCOUNT_STORAGE_KEY);
  },
}));

/** 判断是否为免费模型 */
function isFreeModel(modelId: string): boolean {
  return modelId === 'agnes-2.5-flash' || modelId === 'zhipu';
}

/** 格式化时间为 "X小时前" / "X天前" */
function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 30) return `${days}天前`;
  return `${Math.floor(days / 30)}个月前`;
}

/** 保存到 localStorage */
function saveToStorage(state: AccountState) {
  try {
    localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify({
      isActivated: state.isActivated,
      activatedAt: state.activatedAt,
      keySource: state.keySource,
    }));
  } catch (e) {
    console.error('[AccountStore] save error:', e);
  }
}

// 初始化：从 localStorage 恢复
try {
  const saved = localStorage.getItem(ACCOUNT_STORAGE_KEY);
  if (saved) {
    const parsed = JSON.parse(saved);
    useSubscriptionStore.setState({
      isActivated: parsed.isActivated || false,
      activatedAt: parsed.activatedAt || 0,
      keySource: parsed.keySource,
    });
  }
} catch {}

// ===== 价格显示工具函数 =====

/**
 * 格式化价格显示（美元转人民币估算）
 * 使用汇率 ~7.2 进行估算
 */
export function formatPriceUSD(usdPrice: number): string {
  const cnyPrice = usdPrice * 7.2; // 粗略汇率转换
  if (cnyPrice < 0.01) return '≈¥0';
  if (cnyPrice < 1) return `≈¥${cnyPrice.toFixed(2)}`;
  return `≈¥${cnyPrice.toFixed(1)}`;
}

/**
 * 格式化按次计费价格
 */
export function formatPerUsePrice(usdPrice: number): string {
  const cnyPrice = usdPrice * 7.2;
  return `≈¥${cnyPrice.toFixed(3)}/次`;
}

// ===== 订阅计划配置（用于模型访问控制）=====
export interface SubscriptionPlan {
  id: 'starter' | 'pro' | 'ultimate';
  name: string;
  icon: string;
  priceMonth: number;
  priceYear: number;
  discount: string;
  chatModels: string[];
  imageQuota: number;
  tokenLimit: number;
  features: string[];
  popular?: boolean;
}

export const SUBSCRIPTION_PLANS: Record<string, SubscriptionPlan> = {
  starter: {
    id: 'starter',
    name: '入门版',
    icon: '🚀',
    priceMonth: 29,
    priceYear: 299,
    discount: '省¥149',
    chatModels: ['alrc-gpt-5.4-mini', 'alrc-claude-haiku-4-5', 'alrc-grok-4.5', 'alrc-doubao-seed-2-0-pro'],
    imageQuota: 20,
    tokenLimit: 5_000_000,
    features: ['500万Tokens/月', '20次生图/月', '基础模型', '客服支持'],
  },
  pro: {
    id: 'pro',
    name: '专业版',
    icon: '⚡',
    priceMonth: 99,
    priceYear: 999,
    discount: '省¥189',
    chatModels: ['alrc-gpt-5.4', 'alrc-gpt-5.4-mini', 'alrc-gpt-5.5', 'alrc-gpt-5.5-compact', 'alrc-gpt-5.6-luna', 'alrc-gpt-5.6-sol', 'alrc-gpt-5.6-terra', 'alrc-claude-fable-5', 'alrc-claude-haiku-4-5', 'alrc-grok-4.5', 'alrc-grok-composer-2.5', 'alrc-lingyan-3.5', 'alrc-doubao-seed-2-0-pro'],
    imageQuota: 100,
    tokenLimit: 200_000_000,
    features: ['2亿Tokens/月', '100次生图/月', '全部对话模型', '优先支持'],
    popular: true,
  },
  ultimate: {
    id: 'ultimate',
    name: '旗舰版',
    icon: '👑',
    priceMonth: 299,
    priceYear: 2999,
    discount: '省¥689',
    chatModels: ['alrc-gpt-5.4', 'alrc-gpt-5.4-mini', 'alrc-gpt-5.5', 'alrc-gpt-5.5-compact', 'alrc-gpt-5.6-luna', 'alrc-gpt-5.6-sol', 'alrc-gpt-5.6-terra', 'alrc-claude-fable-5', 'alrc-claude-haiku-4-5', 'alrc-claude-opus-4-6', 'alrc-grok-4.5', 'alrc-grok-composer-2.5', 'alrc-lingyan-3.5', 'alrc-doubao-seed-2-0-pro'],
    imageQuota: 500,
    tokenLimit: 0,
    features: ['无限Tokens', '500次生图/月', '全部模型+生图', 'VIP支持'],
  },
};

// ===== 简化的订阅状态（用于模型访问控制）=====
interface SimpleSubState {
  planId: 'free' | 'starter' | 'pro' | 'ultimate';
  expiresAt: number;
  isPaid: boolean;
}

export const useSimpleSubscriptionStore = create<SimpleSubState>()((set) => ({
  planId: 'free',
  expiresAt: 0,
  isPaid: false,
}));
