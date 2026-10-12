/**
 * modelStore 核心逻辑测试 —— 模型分层推荐安全网（阶段 0 / T0-1）
 * 覆盖：analyzeComplexity 评分分层、getModelIdsByType、getImageEditModelIds、persist 迁移
 */
import { describe, it, expect } from 'vitest';
import { analyzeComplexity, getModelIdsByType, getImageEditModelIds, useModelStore, migrateModelStore } from './modelStore';

describe('analyzeComplexity', () => {
  it('短消息 → 简单任务，无建议层级', () => {
    const r = analyzeComplexity('你好');
    expect(r.isComplex).toBe(false);
    expect(r.score).toBeLessThan(4);
    expect(r.suggestedTier).toBeUndefined();
  });

  it('超长消息（>500 字符）得分提升', () => {
    const r = analyzeComplexity('a'.repeat(600));
    expect(r.score).toBeGreaterThanOrEqual(4);
    expect(r.isComplex).toBe(true);
    expect(r.suggestedTier).toBeDefined();
  });

  it('架构/安全类关键词 → 高分并推荐最高档 (DeepSeek Flash)', () => {
    const long = '背景与需求描述。'.repeat(60);
    const r = analyzeComplexity(`请帮我做系统架构设计，关注安全与并发性能。${long}`);
    expect(r.score).toBeGreaterThanOrEqual(7);
    expect(r.isComplex).toBe(true);
    // 2026-10-11: 原断言 'Pro' —— deepseek-v4-pro 官方下线后已从 MODEL_TIERS 删除,
    // 最高档改为 DeepSeek Flash (V4.1 Flash 性能全面超越 V4 Pro)。
    expect(r.suggestedTier?.label).toContain('DeepSeek Flash');
  });

  it('仅架构关键词（短消息）→ +3 分但未达复杂阈值', () => {
    const r = analyzeComplexity('请帮我做一个系统架构设计');
    expect(r.score).toBe(3);
    expect(r.isComplex).toBe(false);
  });

  it('重构/实现类关键词 → 至少中档', () => {
    const r = analyzeComplexity('帮我重构这段代码');
    expect(r.score).toBeGreaterThanOrEqual(2);
  });
});

describe('getModelIdsByType', () => {
  it('按 modelType 过滤模型 ID', () => {
    const models = [
      { id: 'a', modelType: 'chat' },
      { id: 'b', modelType: 'image' },
      { id: 'c', modelType: 'chat' },
    ] as never[];
    expect(getModelIdsByType(models, 'chat')).toEqual(['a', 'c']);
    expect(getModelIdsByType(models, 'image')).toEqual(['b']);
  });
});

describe('getImageEditModelIds', () => {
  it('生图模型直接可选；多模态聊天模型可选；普通文本模型不可选', () => {
    const models = [
      { id: 'img-model', modelType: 'image' },
      { id: 'zhipu', modelType: 'chat' },
      { id: 'plain-chat', modelType: 'chat' },
    ] as never[];
    const ids = getImageEditModelIds(models);
    expect(ids).toContain('img-model');
    expect(ids).toContain('zhipu');
    expect(ids).not.toContain('plain-chat');
  });
});

/**
 * 回归: 官方条目的 modelName 契约
 * -------------------------------------------------
 * ChatView 把 `models[0]` 当作真实 API 模型名透传给 gateway; 若条目缺 models,
 * 它会回退到显示 label (如 "DeepSeek Flash (V4.1, 1M)"), 被当成模型名发给官方接口
 * → HTTP 400 "The supported API model names are deepseek-flash,
 *   but you passed DeepSeek Flash (V4.1, 1M)"
 * (2026-10-11: deepseek-v4-pro 已下线, 不再出现在支持列表中)
 */
describe('官方模型条目的 modelName 契约', () => {
  const store = () => useModelStore.getState().models;

  it('deepseek / openai 条目必须声明真实 API 模型名', () => {
    for (const id of ['deepseek-flash', 'openai-gpt4o']) {
      const m = store().find(x => x.id === id);
      expect(m, `${id} 应存在于 store`).toBeTruthy();
      const apiName = m!.models?.[0];
      expect(apiName, `${id} 必须声明 models[0] (真实 API 模型名)`).toBeTruthy();
      // 真实模型名不含空格/括号 —— 那是给人看的 label 才有的特征
      expect(apiName, `${id} 的 models[0] 不能是显示标签`).not.toMatch(/[\s()]/);
    }
  });

  it('内置条目凡声明 models 的, 首项都必须是模型名而非显示标签', () => {
    for (const m of store()) {
      if (!m.isBuiltIn || !m.models?.length) continue;
      expect(m.models[0], `${m.id} 的 models[0] 疑似显示标签`).not.toMatch(/[\s()]/);
    }
  });

  it('agnes-2.0 别名条目的 models[0] 指向活的 2.5-flash, 不指向已下架模型', () => {
    // 2026-10-12: agnes-2.0 / agnes-2.0-flash 官方下架 (实测 503)
    const m = store().find(x => x.id === 'agnes-2.0');
    expect(m, 'agnes-2.0 别名条目应保留 (旧持久化 activeModelId 需可解析)').toBeTruthy();
    expect(m!.models?.[0]).toBe('agnes-2.5-flash');
  });
});

/**
 * persist 迁移回归
 * -------------------------------------------------
 * 2026-10-12: agnes-2.0 全系官方下架(503)。v16 块负责把残留的已下线/隐藏 id
 * 从 activeModelId / autoModelCurrent / models[] 里清掉, 否则会被原样发给网关。
 */
describe('migrateModelStore — v16 已下架 agnes id 兜底', () => {
  const live = (id?: string) => expect(id).toBe('agnes-2.5-flash');

  it('activeModelId 是 agnes-2.0 / agnes-2.0-flash / agentai 时都转正', () => {
    for (const dead of ['agnes-2.0', 'agnes-2.0-flash', 'agentai']) {
      const out = migrateModelStore({ activeModelId: dead, models: [] }, 15);
      live(out.activeModelId);
    }
  });

  it('autoModelCurrent 同样转正', () => {
    const out = migrateModelStore({ activeModelId: 'agnes-3.0-flash', autoModelCurrent: 'agnes-2.0-flash' }, 15);
    expect(out.autoModelCurrent).toBe('agnes-2.5-flash');
    // 未命中的 activeModelId 不被改写
    expect(out.activeModelId).toBe('agnes-3.0-flash');
  });

  it('models[] 里 agnes-2.0 条目的 models[0] 被重写, 其他字段不动', () => {
    const out = migrateModelStore(
      { models: [{ id: 'agnes-2.0', isBuiltIn: true, models: ['agnes-2.0'], label: 'X', baseURL: 'https://custom' }] },
      15,
    );
    expect(out.models[0].models).toEqual(['agnes-2.5-flash']);
    expect(out.models[0].label).toBe('X');
    expect(out.models[0].baseURL).toBe('https://custom');
  });

  it('version<15 的老用户行为不变 (先被 v15 块迁到 agnes-3.0-flash, v16 不再命中)', () => {
    const out = migrateModelStore({ activeModelId: 'agnes-2.0', models: [] }, 12);
    // v15 块把它改成 3.0-flash; v16 的候选集不含 3.0-flash → 保持
    expect(out.activeModelId).toBe('agnes-3.0-flash');
  });

  it('commercialKeys 缺失时补空对象 (历史行为保持)', () => {
    expect(migrateModelStore({ activeModelId: 'deepseek' }, 15).commercialKeys).toEqual({});
  });
});
