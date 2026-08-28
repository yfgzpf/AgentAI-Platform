/**
 * modelStore 核心逻辑测试 —— 模型分层推荐安全网（阶段 0 / T0-1）
 * 覆盖：analyzeComplexity 评分分层、getModelIdsByType、getImageEditModelIds
 */
import { describe, it, expect } from 'vitest';
import { analyzeComplexity, getModelIdsByType, getImageEditModelIds } from './modelStore';

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

  it('架构/安全类关键词 → 高分并推荐 Pro 层', () => {
    const long = '背景与需求描述。'.repeat(60);
    const r = analyzeComplexity(`请帮我做系统架构设计，关注安全与并发性能。${long}`);
    expect(r.score).toBeGreaterThanOrEqual(7);
    expect(r.isComplex).toBe(true);
    expect(r.suggestedTier?.label).toContain('Pro');
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
