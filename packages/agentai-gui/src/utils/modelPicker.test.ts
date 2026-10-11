/**
 * modelPicker 测试 —— 模型来源标注 / 可见性 / 分组规则的回归安全网
 * 覆盖两个真实修过的 bug:
 *   1. ALRO 中转的 GLM/Kimi/MiniMax 全被归到「国内·DeepSeek」名下 (=分组标签取了组内第一项)
 *   2. 单模型组同时渲染组名与标签, 造成 deepseek/agnes「名字出现两次」
 */
import { describe, it, expect } from 'vitest';
import {
  RELAY_CHANNELS, channelName, isRelayModel, getSourceBadge,
  isFreeModel, isModelHidden, isModelVisible, groupModels,
} from './modelPicker';
import type { ModelConfig } from '../store/modelStore';

const mk = (over: Partial<ModelConfig> & { id: string }): ModelConfig => ({
  label: over.id,
  baseURL: 'https://api.deepseek.com/v1',
  apiKeyEnv: 'DEEPSEEK_API_KEY',
  color: '#10B981',
  enabled: false,
  isBuiltIn: true,
  ...over,
});

describe('isRelayModel / RELAY_CHANNELS', () => {
  it('alrc / factory / superapi / sensenova / longcat 判为中转', () => {
    for (const provider of Object.keys(RELAY_CHANNELS)) {
      expect(isRelayModel(mk({ id: 'x', provider }))).toBe(true);
    }
  });

  it('官方直连 provider 不算中转', () => {
    for (const provider of ['deepseek', 'openai', 'agnes', 'zhipu', 'anthropic']) {
      expect(isRelayModel(mk({ id: 'x', provider }))).toBe(false);
    }
  });
});

describe('getSourceBadge', () => {
  it('官方直连 → 灰色「官方」', () => {
    const b = getSourceBadge(mk({ id: 'deepseek-flash', provider: 'deepseek' }));
    expect(b?.text).toBe('官方');
    expect(b?.color).toBe('default');
  });

  it('中转站 → 站点名彩色徽章', () => {
    expect(getSourceBadge(mk({ id: 'f', provider: 'alrc' }))?.text).toBe('ALRO');
    expect(getSourceBadge(mk({ id: 'f', provider: 'superapi' }))?.text).toBe('SuperAPI');
    expect(getSourceBadge(mk({ id: 'f', provider: 'sensenova' }))?.text).toBe('SenseNova');
    expect(getSourceBadge(mk({ id: 'f', provider: 'longcat' }))?.text).toBe('LongCat');
    expect(getSourceBadge(mk({ id: 'f', provider: 'alrc' }))?.color).not.toBe('default');
  });

  it('用户自建模型不标注来源', () => {
    expect(getSourceBadge(mk({ id: 'custom-1', isBuiltIn: false }))).toBeNull();
  });
});

describe('isFreeModel / isModelHidden', () => {
  it('Agnes 全系与智谱免费', () => {
    for (const id of ['agnes-3.0-flash', 'agnes-2.5-flash', 'agnes-2.0', 'agentai', 'zhipu']) {
      expect(isFreeModel(mk({ id }))).toBe(true);
    }
    expect(isFreeModel(mk({ id: 'deepseek-flash' }))).toBe(false);
  });

  it('agnes-2.0 与旧兼容 id agentai 隐藏', () => {
    expect(isModelHidden(mk({ id: 'agnes-2.0' }))).toBe(true);
    expect(isModelHidden(mk({ id: 'agentai' }))).toBe(true);
    expect(isModelHidden(mk({ id: 'agnes-3.0-flash' }))).toBe(false);
  });
});

describe('isModelVisible', () => {
  const ctx = (keys: string[] = [], backend: string[] = []) => ({
    commercialKeys: {} as Record<string, string>,
    hasBackendKey: (p?: string) => !!p && backend.includes(p),
    _keys: keys,
  });

  it('隐藏模型永不可见', () => {
    expect(isModelVisible(mk({ id: 'agnes-2.0', provider: 'agnes' }), ctx())).toBe(false);
  });

  it('中转模型无密钥 → 不可见 (即便 enabled=true, 旧实现会被 sticky enabled 放进来)', () => {
    const m = mk({ id: 'factory-glm-5', provider: 'alrc', enabled: true });
    expect(isModelVisible(m, ctx())).toBe(false);
    expect(isModelVisible(m, ctx([], ['alrc']))).toBe(true);
  });

  it('官方模型 enabled 即可见', () => {
    expect(isModelVisible(mk({ id: 'openai-gpt4o', provider: 'openai', enabled: true }), ctx())).toBe(true);
  });
});

describe('groupModels', () => {
  it('ALRO 的中转模型按 groupLabel 各自成组, 不再全并到「国内·DeepSeek」', () => {
    const groups = groupModels([
      mk({ id: 'factory-deepseek-v4-flash', provider: 'alrc', groupLabel: '国内·DeepSeek' }),
      mk({ id: 'factory-glm-5.2', provider: 'alrc', groupLabel: '国内·智谱' }),
      mk({ id: 'factory-kimi-k3', provider: 'alrc', groupLabel: '国内·Kimi' }),
    ]);
    expect(groups).toHaveLength(3);
    expect(groups.map(g => g.label).sort()).toEqual([
      'ALRO 中转 · 国内·DeepSeek',
      'ALRO 中转 · 国内·Kimi',
      'ALRO 中转 · 国内·智谱',
    ].sort());
    expect(groups.every(g => g.models.length === 1)).toBe(true);
  });

  it('groupLabel 已含渠道名时不再重复加前缀', () => {
    const groups = groupModels([mk({ id: 'superapi-glm-5.2', provider: 'superapi', groupLabel: 'SuperAPI 聚合' })]);
    expect(groups[0]!.label).toBe('SuperAPI 聚合');
  });

  it('同 groupLabel 的中转模型聚为一组', () => {
    const groups = groupModels([
      mk({ id: 'factory-glm-4.7', provider: 'alrc', groupLabel: '国内·智谱' }),
      mk({ id: 'factory-glm-5', provider: 'alrc', groupLabel: '国内·智谱' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.models).toHaveLength(2);
    expect(groups[0]!.isRelayGroup).toBe(true);
  });

  it('官方/免费模型各自独立成组 (单模型组, UI 不会再渲染同名组头)', () => {
    const groups = groupModels([
      mk({ id: 'agnes-3.0-flash', provider: 'agnes', groupLabel: 'Agnes AI' }),
      mk({ id: 'deepseek-flash', provider: 'deepseek', groupLabel: 'DeepSeek' }),
      mk({ id: 'deepseek-v4-pro', provider: 'deepseek', groupLabel: 'DeepSeek' }),
    ]);
    expect(groups.map(g => g.key)).toEqual(['agnes-3.0-flash', 'deepseek-flash', 'deepseek-v4-pro']);
    expect(groups.every(g => g.isRelayGroup === false)).toBe(true);
  });
});

describe('channelName', () => {
  it('已收录主机名走映射, 未收录取域名首段', () => {
    expect(channelName('https://api.deepseek.com/v1')).toBe('DeepSeek');
    expect(channelName('https://alro.huazhiweilai.com/v1')).toBe('ALRO 中转');
    expect(channelName('https://example.org/v1')).toBe('example');
  });
});
