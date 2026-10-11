/**
 * modelPicker — 模型选择器的「来源判定 / 可见性 / 隐藏」单一实现来源
 * -------------------------------------------------------------------
 * 背景: 模型列表同时存在「官方直连 API」和「中转聚合站」两类来源,
 *       同一个模型 (如 DeepSeek Flash) 在多个来源下都有条目, 名字几乎一样,
 *       用户无法分辨。本模块统一给出:
 *         1. 来源判定 (官方 / 哪个中转站)
 *         2. 徽章文案与配色
 *         3. 可见性规则 (中转模型必须先配好密钥)
 *         4. 隐藏规则 (过时/兼容条目不再出现在选择器里)
 *
 * ModelSelector.tsx 与 Composer.tsx 的内联选择器都必须用这里的规则,
 * 避免两处各写一份 (历史上两处的 isFree/isFactory 就不一致)。
 */
import type { ModelConfig } from '../store/modelStore';

/* ===== 中转 / 聚合站 (非官方直连) ===== */
/** provider → 渠道名。'factory' 是 ALRO 的历史 provider 别名。 */
export const RELAY_CHANNELS: Record<string, string> = {
  alrc: 'ALRO 中转',
  factory: 'ALRO 中转',
  superapi: 'SuperAPI 中转',
  sensenova: '商汤 SenseNova',
  longcat: '美团 LongCat',
};

/** provider → 徽章文案 + antd 预置色 */
const RELAY_BADGE: Record<string, { text: string; color: string }> = {
  alrc: { text: 'ALRO', color: 'purple' },
  factory: { text: 'ALRO', color: 'purple' },
  superapi: { text: 'SuperAPI', color: 'geekblue' },
  sensenova: { text: 'SenseNova', color: 'cyan' },
  longcat: { text: 'LongCat', color: 'gold' },
};

/* ===== 官方直连主机名 ===== */
const HOST_CHANNELS: Record<string, string> = {
  'api.agnes-ai.cn': 'Agnes',
  'api.deepseek.com': 'DeepSeek',
  'api.openai.com': 'OpenAI',
  'open.bigmodel.cn': '智谱',
  'dashscope.aliyuncs.com': '通义',
  'api.moonshot.cn': 'Moonshot',
  'api.minimax.chat': 'MiniMax',
  'api.anthropic.com': 'Anthropic',
  'ark.cn-beijing.volces.com': '火山引擎',
  'superapi.vanguard.dpdns.org': 'SuperAPI',
  'alro.huazhiweilai.com': 'ALRO 中转',
  'token.sensenova.cn': '商汤 SenseNova',
  'api.longcat.chat': '美团 LongCat',
};

/** 从 baseURL 提取渠道简称 (官方主机名映射, 未命中则取域名首段) */
export function channelName(baseURL: string): string {
  const host = baseURL.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return HOST_CHANNELS[host] || host.split('.')[0];
}

/* ===== 来源判定 ===== */

/** 是否为中转/聚合站来源 (非官方直连) */
export function isRelayModel(m: ModelConfig): boolean {
  return !!RELAY_CHANNELS[m.provider || ''];
}

/** 中转账的渠道名 (如 'ALRO 中转'), 官方模型返回 null */
export function relayChannel(m: ModelConfig): string | null {
  return RELAY_CHANNELS[m.provider || ''] || null;
}

export interface SourceBadge {
  /** 徽章文案: 官方 → '官方'; 中转 → 中转站简称 */
  text: string;
  /** antd Tag color */
  color: string;
  /** Tooltip 说明 */
  tip: string;
}

/** 来源徽章信息; 用户自建模型返回 null (不标注) */
export function getSourceBadge(m: ModelConfig): SourceBadge | null {
  const relay = RELAY_BADGE[m.provider || ''];
  if (relay) {
    return {
      text: relay.text,
      color: relay.color,
      tip: `来源: ${RELAY_CHANNELS[m.provider || '']}（中转站转发, 非官方直连）`,
    };
  }
  if (m.isBuiltIn === false) return null;
  return {
    text: '官方',
    color: 'default',
    tip: `来源: 官方直连 ${channelName(m.baseURL)}`,
  };
}

/* ===== 免费 / 隐藏 ===== */

/** Agnes 全系免费 + 智谱免费 */
const FREE_MODEL_IDS = new Set(['agnes-3.0-flash', 'agnes-2.5-flash', 'agnes-2.0', 'agentai', 'zhipu']);

export function isFreeModel(m: ModelConfig): boolean {
  return FREE_MODEL_IDS.has(m.id);
}

/**
 * 不进入选择器的条目 (仍保留在 store.models 中, 以便旧会话的 activeModelId 能解析到)。
 *  - agnes-2.0       : 备用档, 收敛到 3.0 + 2.5
 *  - agentai         : Agnes 旧版兼容 id, 与 agnes-3.0-flash 同源同密钥
 * 用 id 判定而非字段, 因为 persist 水合会用旧数组覆盖 DEFAULT_MODELS,
 * 加字段对老用户不生效。
 */
const HIDDEN_MODEL_IDS = new Set(['agnes-2.0', 'agentai']);

export function isModelHidden(m: ModelConfig): boolean {
  return HIDDEN_MODEL_IDS.has(m.id);
}

/* ===== 可见性 ===== */

/** 前端是否持有该模型的密钥 (非浏览器环境如单测下优雅降级) */
export function hasFrontendKey(m: ModelConfig, commercialKeys: Record<string, string>): boolean {
  const envVar = m.apiKeyEnv || `${m.id.toUpperCase()}_API_KEY`;
  if (commercialKeys[envVar]) return true;
  const ls = typeof localStorage === 'undefined' ? null : localStorage;
  const ss = typeof sessionStorage === 'undefined' ? null : sessionStorage;
  return !!ls?.getItem(envVar) ||
    !!ls?.getItem(`__agentai_key_${m.provider || m.id}`) ||
    !!ss?.getItem('agentai.' + envVar) ||
    !!ss?.getItem(`agentai.__agentai_key_${m.provider || m.id}`);
}

export interface VisibilityCtx {
  commercialKeys: Record<string, string>;
  /** provider 在后端是否配了密钥 (后端 env 有 key 也算可用) */
  hasBackendKey: (provider?: string) => boolean;
}

/**
 * 是否在选择器中可见。
 *  - 免费模型           → 始终可见
 *  - 中转模型           → 前后端任一持有密钥才可见 (中转站是要单独买额度的, 没配就不该出现)
 *  - 官方 / 自定义模型  → 有密钥 或 已启用
 */
export function isModelVisible(m: ModelConfig, ctx: VisibilityCtx): boolean {
  if (isModelHidden(m)) return false;
  if (isFreeModel(m)) return true;
  if (isRelayModel(m)) return hasFrontendKey(m, ctx.commercialKeys) || ctx.hasBackendKey(m.provider);
  if (hasFrontendKey(m, ctx.commercialKeys)) return true;
  return !!m.enabled;
}

/* ===== 分组 ===== */

export interface ModelGroup {
  key: string;
  label: string;
  color: string;
  models: ModelConfig[];
  /** 是否多模型分组 (中转站按分组密钥聚合, 需要二级展开) */
  isRelayGroup: boolean;
}

/**
 * 分组: 中转站按 provider + groupLabel 聚合 (每个分组对应一把密钥),
 * 其余模型各自独立成组。
 * 注意 groupLabel 必须用渠道名兜底 —— 历史实现直接取「组内第一个模型的 groupLabel」,
 * 导致 ALRO 的 GLM/Kimi/MiniMax 全被归到「国内·DeepSeek」名下。
 */
export function groupModels(models: ModelConfig[]): ModelGroup[] {
  const map = new Map<string, ModelGroup>();
  for (const m of models) {
    const channel = relayChannel(m);
    const isRelayGroup = !!channel && !!m.groupLabel;
    const gKey = isRelayGroup ? `${m.provider}::${m.groupLabel}` : m.id;
    if (!map.has(gKey)) {
      let label = m.label;
      if (isRelayGroup) {
        // groupLabel 已含渠道简称时 (如 'SuperAPI 聚合') 不再重复加前缀
        const brand = channel!.replace(/\s*中转$/, '');
        label = m.groupLabel!.includes(brand) ? m.groupLabel! : `${channel} · ${m.groupLabel}`;
      }
      map.set(gKey, { key: gKey, label, color: m.color, models: [], isRelayGroup });
    }
    map.get(gKey)!.models.push(m);
  }
  return Array.from(map.values());
}
