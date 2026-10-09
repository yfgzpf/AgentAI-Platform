/**
 * 模型注册表官方值守卫测试 (2026-09-05 批次(三))
 * ----------------------------------------------------
 * 目的: classifier MODELS 与 capabilities MODEL_CAPABILITIES 曾多次被"拍脑袋值"改坏
 * (qwen-max 虚标 131K / deepseek 128K vs 1M / 成本张冠李戴), 且两表无单测拦截。
 * 本测试将官方窗口/成本 (WebSearch 核实, 2026-09-05) 固化断言, 防止数据再次漂移。
 *
 * 官方口径:
 *   - DeepSeek V4-Flash/Pro: 1M context; off-peak USD/1K: flash 0.00022/0.00066, pro 0.00066/0.00198
 *   - GLM-4.7-Flash: 200K (text-only), 免费; Kimi K2.5: 256K, 0.0006/0.003
 *   - Qwen-Max: 32,768 (阿里云官方), 0.00034/0.00137
 *   - GPT-4o-mini: 128K, 0.00015/0.0006; Claude Sonnet 4.5: 200K, 0.003/0.015
 */
import { describe, it, expect } from 'vitest';
import { MODELS } from './model-classifier.js';
import {
  MODEL_CAPABILITIES,
  getCapability,
  getModelContextWindow,
  getDefaultContextWindow,
} from './model-capabilities.js';

/** classifier 条目查询: id = 'provider:subModel' */
function classifier(id: string) {
  const m = MODELS.find(x => x.id === id);
  expect(m, `MODELS 缺少条目 ${id}`).toBeDefined();
  return m!;
}

/** capabilities 条目查询: id = provider 级 id */
function capability(id: string) {
  const m = getCapability(id);
  expect(m, `MODEL_CAPABILITIES 缺少条目 ${id}`).toBeDefined();
  return m!;
}

describe('classifier MODELS — 官方窗口/成本 (2026-09-05 校准)', () => {
  it('DeepSeek V4-Flash = 1M / 0.00022 / 0.00066', () => {
    const m = classifier('deepseek:v4-flash');
    expect(m.maxContext).toBe(1_000_000);
    expect(m.costPer1kInput).toBe(0.00022);
    expect(m.costPer1kOutput).toBe(0.00066);
  });

  it('DeepSeek V4-Pro = 1M / 0.00066 / 0.00198', () => {
    const m = classifier('deepseek:v4-pro');
    expect(m.maxContext).toBe(1_000_000);
    expect(m.costPer1kInput).toBe(0.00066);
    expect(m.costPer1kOutput).toBe(0.00198);
  });

  it('Qwen-Max = 32K (非虚标 131K/1M) / 0.00034 / 0.00137', () => {
    const m = classifier('qwen:qwen-max');
    expect(m.maxContext).toBe(32_768);
    expect(m.costPer1kInput).toBe(0.00034);
    expect(m.costPer1kOutput).toBe(0.00137);
  });

  it('Kimi K2.5 = 256K / 0.0006 / 0.003', () => {
    const m = classifier('moonshot:kimi-k2.5');
    expect(m.maxContext).toBe(262_144);
    expect(m.costPer1kInput).toBe(0.0006);
    expect(m.costPer1kOutput).toBe(0.003);
  });

  it('GLM-4.7-Flash = 200K / 免费 / maxOutput 8192', () => {
    const m = classifier('zhipu:glm-4.7-flash');
    expect(m.maxContext).toBe(200_000);
    expect(m.isFree).toBe(true);
    expect(m.costPer1kInput).toBe(0);
    expect(m.costPer1kOutput).toBe(0);
    expect(m.maxOutputTokens).toBe(8192);
  });

  it('GPT-4o-mini = 128K / 0.00015 / 0.0006', () => {
    const m = classifier('openai:gpt-4o-mini');
    expect(m.maxContext).toBe(128_000);
    expect(m.costPer1kInput).toBe(0.00015);
    expect(m.costPer1kOutput).toBe(0.0006);
  });

  it('Claude Sonnet 4.5 = 200K / 0.003 / 0.015', () => {
    const m = classifier('anthropic:claude-sonnet-4-5');
    expect(m.maxContext).toBe(200_000);
    expect(m.costPer1kInput).toBe(0.003);
    expect(m.costPer1kOutput).toBe(0.015);
  });

  it('agnes-2.0-flash (主免费模型) = 256K / 免费', () => {
    const m = classifier('agentai:agnes-2.0-flash');
    expect(m.maxContext).toBe(256_000);
    expect(m.isFree).toBe(true);
  });
});

describe('MODEL_CAPABILITIES — 官方窗口/成本 (2026-09-05 校准)', () => {
  it('DeepSeek = 1M / 0.00022, deepseek-pro = 1M / 0.00066', () => {
    expect(capability('deepseek').contextWindow).toBe(1_048_576);
    expect(capability('deepseek').costPer1K).toBe(0.00022);
    expect(capability('deepseek-pro').contextWindow).toBe(1_048_576);
    expect(capability('deepseek-pro').costPer1K).toBe(0.00066);
  });

  it('zhipu (GLM-4.7-Flash) = 200K / 免费', () => {
    const c = capability('zhipu');
    expect(c.contextWindow).toBe(200_000);
    expect(c.isFree).toBe(true);
    expect(c.costPer1K).toBe(0);
  });

  it('qwen (Qwen-Max) = 32K / 0.00034', () => {
    const c = capability('qwen');
    expect(c.contextWindow).toBe(32_768);
    expect(c.costPer1K).toBe(0.00034);
  });

  it('moonshot (Kimi K2.5) = 256K / 0.0006', () => {
    const c = capability('moonshot');
    expect(c.contextWindow).toBe(262_144);
    expect(c.costPer1K).toBe(0.0006);
  });

  it('anthropic (Sonnet 4.5) = 200K / 0.003; openai (gpt-4o-mini) = 128K / 0.00015', () => {
    expect(capability('anthropic').contextWindow).toBe(200_000);
    expect(capability('anthropic').costPer1K).toBe(0.003);
    expect(capability('openai').contextWindow).toBe(131_072);
    expect(capability('openai').costPer1K).toBe(0.00015);
  });

  it('agnes/agentai 主入口 = 512K (默认 2.5-flash)', () => {
    expect(capability('agnes-2.5-flash').contextWindow).toBe(524_288);
    expect(capability('agentai').contextWindow).toBe(524_288);
  });
});

describe('getModelContextWindow — subModel 精确命中 (死路径回归)', () => {
  // 2026-09-05 修复: 此前只按 provider 级 id 匹配, llm-router 传 subModel 名恒不命中
  it('subModel 名可精确返回各自窗口 (而非 provider 最大值)', () => {
    expect(getModelContextWindow('agnes-2.5-flash')).toBe(524_288);
    expect(getModelContextWindow('glm-4.7-flash')).toBe(200_000);
    expect(getModelContextWindow('kimi-k2.5')).toBe(262_144);
    expect(getModelContextWindow('qwen-max')).toBe(32_768);
    expect(getModelContextWindow('gpt-4o-mini')).toBe(131_072);
    expect(getModelContextWindow('claude-sonnet-4-5-20250929')).toBe(200_000);
    expect(getModelContextWindow('deepseek-v4-flash')).toBe(1_048_576);
    expect(getModelContextWindow('deepseek-v4-pro')).toBe(1_048_576);
  });

  it('provider 级 id 仍可按原名命中', () => {
    expect(getModelContextWindow('deepseek')).toBe(1_048_576);
    expect(getModelContextWindow('zhipu')).toBe(200_000);
    expect(getModelContextWindow('moonshot')).toBe(262_144);
  });

  it('未知模型返回 undefined (交默认值兜底)', () => {
    expect(getModelContextWindow('does-not-exist-xyz')).toBeUndefined();
  });
});

describe('getDefaultContextWindow — provider 取最大模型窗口', () => {
  it('deepseek/moonshot/zhipu 的 provider 默认窗口', () => {
    expect(getDefaultContextWindow('deepseek')).toBe(1_048_576);
    expect(getDefaultContextWindow('moonshot')).toBe(262_144);
    expect(getDefaultContextWindow('zhipu')).toBe(200_000);
  });

  it('无该 provider 时回退 128K', () => {
    expect(getDefaultContextWindow('no-such-provider')).toBe(131_072);
  });
});

describe('两表一致性 — 同 subModel 不得出现 2 倍级窗口冲突', () => {
  it('qwen-max/kimi-k2.5/glm-4.7-flash 的 classifier 与 capabilities 窗口同量级', () => {
    const pair: Array<[string, string]> = [
      // [classifier id, capabilities subModel 对应窗口来源]
      ['qwen:qwen-max', 'qwen'],
      ['moonshot:kimi-k2.5', 'moonshot'],
      ['zhipu:glm-4.7-flash', 'zhipu'],
    ];
    for (const [clsId, capId] of pair) {
      const cls = classifier(clsId);
      const cap = capability(capId);
      // 允许 1M vs 1048576 这类 1024 进制写法差异 (比率 < 1.05), 不允许 2 倍级漂移
      const ratio = Math.max(cls.maxContext, cap.contextWindow) / Math.min(cls.maxContext, cap.contextWindow);
      expect(ratio, `${clsId} 窗口 ${cls.maxContext} vs ${capId} ${cap.contextWindow} 冲突`).toBeLessThan(1.05);
    }
  });
});
