/**
 * 模型工厂 (ALRO 聚合平台) 模型注册表 —— 单一真源
 * ==================================================================
 * 2026-10-13 新增。存在的理由是一个实测到的严重分裂:
 *
 *   chat.ts 的 MODEL_MAP 里 alrc-* 是 glm / kimi / minimax / deepseek / hy3
 *   model-selector.ts 的 BUILTIN_MODELS 里 alrc-* 是 gpt / claude / grok / nano-banana
 *   两份清单**零重叠** —— 也就是说同一个网关进程里,
 *   "老逻辑路径"认识工厂的国内模型, "灰度新路径"认识工厂的 GPT/Claude 系,
 *   走哪条路决定了你能不能看到某个模型。这就是模型工厂"时好时坏"的来源。
 *
 * 更外层还有 GUI 用 `factory-` 前缀而 gateway 用 `alrc-` 前缀的问题,
 * 以及 6 个分组密钥(FACTORY_*_KEY)与 ALRC_API_KEY 的凭据判定分裂。
 *
 * 本文件把**工厂模型清单本身**收敛成一份, chat.ts 与 model-selector.ts 都从这里派生:
 *   - `ALRC_MODELS`      权威条目 (id = alrc-* , subModel = 上游真实模型名)
 *   - `buildFactoryAliases()`  由 alrc-* 生成 GUI 用的 factory-* 别名
 * 新增工厂模型时**只改这里一处**, 两边自动同步。
 *
 * ⚠️ 分组密钥归属必须写进 `groupEnv`: 上游按令牌分组计费/授权,
 *    把 GPT 分组的密钥当对话密钥用会被拒 (与 deepseek-v4-pro 下线时
 *    RETIRED_MODEL_ALIASES 必须按 provider 命名空间分键是同一个道理)。
 */

export interface AlrcModelEntry {
  provider: 'alrc';
  /** 上游真实模型名 —— 放进请求体 model 字段的值 */
  subModel: string;
  label: string;
  /** 该模型消耗哪个分组密钥 (Settings.tsx 的 6 个分组之一) */
  groupEnv: 'FACTORY_CHAT_KEY' | 'FACTORY_GPT_KEY' | 'FACTORY_CLAUDE_KEY'
    | 'FACTORY_GROK_KEY' | 'FACTORY_IMAGE_KEY' | 'FACTORY_VIDEO_KEY';
}

/**
 * 工厂模型权威清单。
 * groupEnv 取值与 packages/agentai-gui/src/store/modelStore.ts 的 FACTORY_KEY_GROUPS 对齐。
 */
export const ALRC_MODELS: Record<string, AlrcModelEntry> = {
  // ===== 对话分组 FACTORY_CHAT_KEY =====
  // 2026-10-19: 官方已把 deepseek-v4-flash 下架, 统一为 deepseek-flash (模型设置的改名依据)。
  //   ⚠️ key 仍保留 alrc-deepseek-v4-flash —— GUI 侧 id 是 factory-deepseek-v4-flash
  //   (由 buildFactoryAliases 按 key 生成), 改 key 会让已持久化的启用状态/会话解析不到。
  //   真正的上游模型名看 subModel, 所以这里改 subModel 就够了。
  'alrc-deepseek-v4-flash': { provider: 'alrc', subModel: 'deepseek-flash', label: 'DeepSeek Flash', groupEnv: 'FACTORY_CHAT_KEY' },
  'alrc-deepseek-flash': { provider: 'alrc', subModel: 'deepseek-flash', label: 'DeepSeek Flash', groupEnv: 'FACTORY_CHAT_KEY' },
  'alrc-glm-4.7': { provider: 'alrc', subModel: 'glm-4.7', label: 'GLM 4.7', groupEnv: 'FACTORY_CHAT_KEY' },
  'alrc-glm-5': { provider: 'alrc', subModel: 'glm-5', label: 'GLM 5', groupEnv: 'FACTORY_CHAT_KEY' },
  'alrc-glm-5.1': { provider: 'alrc', subModel: 'glm-5.1', label: 'GLM 5.1', groupEnv: 'FACTORY_CHAT_KEY' },
  'alrc-glm-5.2': { provider: 'alrc', subModel: 'glm-5.2', label: 'GLM 5.2', groupEnv: 'FACTORY_CHAT_KEY' },
  'alrc-kimi-k2.5': { provider: 'alrc', subModel: 'kimi-k2.5', label: 'Kimi K2.5', groupEnv: 'FACTORY_CHAT_KEY' },
  'alrc-kimi-k2.6': { provider: 'alrc', subModel: 'kimi-k2.6', label: 'Kimi K2.6', groupEnv: 'FACTORY_CHAT_KEY' },
  'alrc-kimi-k2.7-code': { provider: 'alrc', subModel: 'kimi-k2.7-code', label: 'Kimi K2.7 Code', groupEnv: 'FACTORY_CHAT_KEY' },
  'alrc-kimi-k3': { provider: 'alrc', subModel: 'kimi-k3', label: 'Kimi K3', groupEnv: 'FACTORY_CHAT_KEY' },
  'alrc-minimax-m2.5': { provider: 'alrc', subModel: 'MiniMax-M2.5', label: 'MiniMax M2.5', groupEnv: 'FACTORY_CHAT_KEY' },
  'alrc-minimax-m2.7': { provider: 'alrc', subModel: 'MiniMax-M2.7', label: 'MiniMax M2.7', groupEnv: 'FACTORY_CHAT_KEY' },
  'alrc-minimax-m3': { provider: 'alrc', subModel: 'MiniMax/MiniMax-M3', label: 'MiniMax M3', groupEnv: 'FACTORY_CHAT_KEY' },
  'alrc-hy3': { provider: 'alrc', subModel: 'hy3', label: 'HY3', groupEnv: 'FACTORY_CHAT_KEY' },
  // 2026-10-11: V4 Pro 官方已下线 → 保留为别名指向 flash (旧持久化数据静默降级)
  'alrc-deepseek-v4-pro': { provider: 'alrc', subModel: 'deepseek-flash', label: 'DeepSeek Flash (原 Pro 别名)', groupEnv: 'FACTORY_CHAT_KEY' },

  // ===== GPT 分组 FACTORY_GPT_KEY =====
  'alrc-gpt-5.4': { provider: 'alrc', subModel: 'gpt-5.4', label: 'GPT-5.4', groupEnv: 'FACTORY_GPT_KEY' },
  'alrc-gpt-5.4-mini': { provider: 'alrc', subModel: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', groupEnv: 'FACTORY_GPT_KEY' },
  'alrc-gpt-5.5': { provider: 'alrc', subModel: 'gpt-5.5', label: 'GPT-5.5', groupEnv: 'FACTORY_GPT_KEY' },
  'alrc-gpt-5.5-compact': { provider: 'alrc', subModel: 'gpt-5.5-openai-compact', label: 'GPT-5.5 Compact', groupEnv: 'FACTORY_GPT_KEY' },
  'alrc-gpt-5.6-luna': { provider: 'alrc', subModel: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', groupEnv: 'FACTORY_GPT_KEY' },
  'alrc-gpt-5.6-sol': { provider: 'alrc', subModel: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', groupEnv: 'FACTORY_GPT_KEY' },
  'alrc-gpt-5.6-terra': { provider: 'alrc', subModel: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', groupEnv: 'FACTORY_GPT_KEY' },

  // ===== Claude 分组 FACTORY_CLAUDE_KEY =====
  'alrc-claude-fable-5': { provider: 'alrc', subModel: 'claude-fable-5', label: 'Claude Fable 5', groupEnv: 'FACTORY_CLAUDE_KEY' },
  'alrc-claude-haiku-4-5': { provider: 'alrc', subModel: 'claude-haiku-4-5-20250101', label: 'Claude Haiku 4.5', groupEnv: 'FACTORY_CLAUDE_KEY' },
  'alrc-claude-opus-4-6': { provider: 'alrc', subModel: 'claude-opus-4-6', label: 'Claude Opus 4.6', groupEnv: 'FACTORY_CLAUDE_KEY' },

  // ===== Grok 分组 FACTORY_GROK_KEY =====
  'alrc-grok-4.5': { provider: 'alrc', subModel: 'grok-4.5', label: 'Grok 4.5', groupEnv: 'FACTORY_GROK_KEY' },
  'alrc-grok-composer-2.5': { provider: 'alrc', subModel: 'grok-composer-2.5-fast', label: 'Grok Composer 2.5', groupEnv: 'FACTORY_GROK_KEY' },

  // ===== 其他对话模型 (历史登记, 分组归属沿用对话组) =====
  'alrc-lingyan-3.5': { provider: 'alrc', subModel: 'lingyan-3.5', label: '灵岩 3.5', groupEnv: 'FACTORY_CHAT_KEY' },
  'alrc-doubao-seed-2-0-pro': { provider: 'alrc', subModel: 'doubao-seed-2-0-pro-260215', label: '豆包 Seed 2.0 Pro', groupEnv: 'FACTORY_CHAT_KEY' },

  // ===== 生图分组 FACTORY_IMAGE_KEY =====
  'alrc-nano-banana': { provider: 'alrc', subModel: 'nano-banana', label: 'Nano Banana', groupEnv: 'FACTORY_IMAGE_KEY' },
  'alrc-nano-banana-2': { provider: 'alrc', subModel: 'nano-banana-2', label: 'Nano Banana 2', groupEnv: 'FACTORY_IMAGE_KEY' },
  'alrc-nano-banana-pro': { provider: 'alrc', subModel: 'nano-banana-pro', label: 'Nano Banana Pro', groupEnv: 'FACTORY_IMAGE_KEY' },
  'alrc-gpt-image-2': { provider: 'alrc', subModel: 'gpt-image-2', label: 'GPT Image 2', groupEnv: 'FACTORY_IMAGE_KEY' },
  'alrc-gpt-image-2-vip': { provider: 'alrc', subModel: 'gpt-image-2-vip', label: 'GPT Image 2 VIP', groupEnv: 'FACTORY_IMAGE_KEY' },

  // ===== 视频分组 FACTORY_VIDEO_KEY =====
  // 2026-10-13 补录 seedance 2.5: GUI 侧 (modelStore.ts:138 / VideoGen.tsx:129) 与
  // video 路由都在用 2.5, 而原手写分组映射表只到 2.0 ⇒ 工厂视频密钥配了也命不中。
  'alrc-seedance-2.5': { provider: 'alrc', subModel: 'doubao-seedance-2.5', label: 'Seedance 2.5', groupEnv: 'FACTORY_VIDEO_KEY' },
  // ✅ 批次9 (2026-10-13): 补齐 Alrc 中转平台的 Seedance 2 系列 3 个变体。
  // 用户截图 (Alrc「字节跳动」分组) 实测这 4 个都存在, 但原注册表只有 2.5 一条,
  // 于是 doubao-seedance-2 / -fast / -mini 配了 FACTORY_VIDEO_KEY 也命不中。
  'alrc-seedance-2': { provider: 'alrc', subModel: 'doubao-seedance-2', label: 'Seedance 2', groupEnv: 'FACTORY_VIDEO_KEY' },
  'alrc-seedance-2-fast': { provider: 'alrc', subModel: 'doubao-seedance-2-fast', label: 'Seedance 2 Fast', groupEnv: 'FACTORY_VIDEO_KEY' },
  'alrc-seedance-2-mini': { provider: 'alrc', subModel: 'doubao-seedance-2-mini', label: 'Seedance 2 Mini', groupEnv: 'FACTORY_VIDEO_KEY' },
};

/** 工厂模型 ID 前缀 (gateway 侧) */
export const ALRC_PREFIX = 'alrc-';
/** 工厂模型 ID 前缀 (GUI 模型工厂侧) */
export const FACTORY_PREFIX = 'factory-';

/**
 * 生成 GUI 用的 `factory-*` 别名条目。
 * GUI 的 modelStore.ts 每个 factory 条目的 models[0] 与本表 subModel 完全一致,
 * 所以前缀替换是精确的 —— 不需要第二份手写清单。
 */
export function buildFactoryAliases<T extends { provider: string; subModel?: string; label: string }>(
  prefix = FACTORY_PREFIX,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [id, entry] of Object.entries(ALRC_MODELS)) {
    out[`${prefix}${id.slice(ALRC_PREFIX.length)}`] = {
      ...(entry as unknown as T),
      label: `工厂 · ${entry.label}`,
    };
  }
  return out;
}

/** 兼容旧格式 `alrc:model-name` (冒号分隔) 的别名 */
export function buildLegacyColonAliases(): Record<string, AlrcModelEntry> {
  const out: Record<string, AlrcModelEntry> = {};
  for (const [id, entry] of Object.entries(ALRC_MODELS)) {
    out[`alrc:${id.slice(ALRC_PREFIX.length)}`] = entry;
  }
  return out;
}

/** subModel (上游真实模型名) → 该模型所属分组 envVar */
export const SUBMODEL_TO_GROUP_ENV: Record<string, string> = Object.fromEntries(
  Object.values(ALRC_MODELS).map((e) => [e.subModel, e.groupEnv]),
);

/**
 * 预构建的工厂模型条目表 (供 chat.ts 的 MODEL_MAP 与 model-selector.ts 的 BUILTIN_MODELS 直接 Object.assign)
 *
 * 含三种 id 形态:
 *   alrc-*      gateway 原生
 *   alrc:*      旧格式兼容 (历史持久化数据里有)
 *   factory-*   GUI 模型工厂下发 (modelStore.ts 用这个前缀)
 * 以前 chat.ts 只认前两种、model-selector.ts 只认第三种的一部分, 于是
 * "选工厂模型静默掉免费档" 与 "同一模型时好时坏" 两个症状同时存在。
 */
export const FACTORY_MODEL_ENTRIES: Record<
  string,
  { provider: 'alrc'; subModel: string; label: string }
> = (() => {
  const out: Record<string, { provider: 'alrc'; subModel: string; label: string }> = {};
  for (const [id, entry] of Object.entries(ALRC_MODELS)) {
    out[id] = { provider: 'alrc', subModel: entry.subModel, label: `ALRC · ${entry.label}` };
    out[`alrc:${id.slice(ALRC_PREFIX.length)}`] = {
      provider: 'alrc', subModel: entry.subModel, label: `ALRC · ${entry.label}`,
    };
    out[`${FACTORY_PREFIX}${id.slice(ALRC_PREFIX.length)}`] = {
      provider: 'alrc', subModel: entry.subModel, label: `工厂 · ${entry.label}`,
    };
  }
  return out;
})();