import { describe, it, expect, beforeEach } from 'vitest';
import { PromptEngine, getPromptEngine, buildPrompt } from './engine.js';

describe('PromptEngine', () => {
  let engine: PromptEngine;

  beforeEach(() => {
    engine = new PromptEngine();
  });

  // ---- Persona 路由 ----

  it('should route financial queries to financial_analyst', () => {
    expect(engine.routePersona('帮我分析一下股票行情')).toBe('financial_analyst');
  });

  it('should route legal queries to legal_consultant', () => {
    expect(engine.routePersona('这个合同条款有法律风险吗')).toBe('legal_consultant');
  });

  it('should route code queries to tech_advisor', () => {
    expect(engine.routePersona('帮我重构这段代码')).toBe('tech_advisor');
  });

  it('should route data queries to data_analyst', () => {
    expect(engine.routePersona('提取数据并生成报表')).toBe('data_analyst');
  });

  it('should route review queries to code_review', () => {
    expect(engine.routePersona('审查这段代码的安全性')).toBe('code_review');
  });

  it('should default to general for ambiguous queries', () => {
    expect(engine.routePersona('你好')).toBe('general');
  });

  // ---- 模板选择 ----

  it('should select a template for general persona', () => {
    const tpl = engine.selectTemplate('general');
    expect(tpl).not.toBeNull();
    expect(tpl!.persona).toBe('general');
  });

  it('should select a template for financial persona', () => {
    const tpl = engine.selectTemplate('financial_analyst');
    expect(tpl).not.toBeNull();
    expect(tpl!.persona).toBe('financial_analyst');
  });

  // ---- 模板填充 ----

  it('should fill template variables correctly', () => {
    const tpl = engine.selectTemplate('general');
    expect(tpl).not.toBeNull();
    const result = engine.fillTemplate(tpl!.id, { query: '你好世界' });
    expect(result.prompt).toContain('你好世界');
    expect(result.unfilledVariables).toHaveLength(0);
  });

  it('should report unfilled variables', () => {
    const tpl = engine.selectTemplate('general');
    expect(tpl).not.toBeNull();
    const result = engine.fillTemplate(tpl!.id, {});
    expect(result.unfilledVariables.length).toBeGreaterThan(0);
  });

  it('should handle non-existent template', () => {
    const result = engine.fillTemplate('nonexistent', { query: 'test' });
    expect(result.prompt).toBe('');
    expect(result.unfilledVariables).toContain('TEMPLATE_NOT_FOUND');
  });

  // ---- 一站式 buildPrompt ----

  it('should build prompt end-to-end for financial query', () => {
    const result = engine.buildPrompt('分析股票走势');
    expect(result.prompt).toContain('分析股票走势');
    expect(result.prompt).toContain('金融');
  });

  it('should build prompt for general query', () => {
    const result = engine.buildPrompt('你好');
    expect(result.prompt).toContain('你好');
  });

  // ---- 评分反馈 ----

  it('should record feedback and update avgScore', () => {
    const tpl = engine.selectTemplate('general')!;
    engine.recordFeedback(tpl.id, 8);
    engine.recordFeedback(tpl.id, 6);
    const updated = engine.listByPersona('general').find(t => t.id === tpl.id);
    expect(updated!.avgScore).toBe(7);
    expect(updated!.usageCount).toBe(2);
  });

  // ---- 模板注册 ----

  it('should register a new template', () => {
    const newTpl = {
      id: 'tpl_custom_v1',
      persona: 'custom',
      template: 'Custom: {query}',
      variables: ['query'],
      version: '1.0',
      totalScore: 0,
      usageCount: 0,
      avgScore: 0,
      createdAt: new Date().toISOString(),
    };
    engine.registerTemplate(newTpl);
    expect(engine.selectTemplate('custom')).not.toBeNull();
    expect(engine.listByPersona('custom')).toHaveLength(1);
  });
});

describe('getPromptEngine', () => {
  it('should return a singleton instance', () => {
    const a = getPromptEngine();
    const b = getPromptEngine();
    expect(a).toBe(b);
  });
});

describe('buildPrompt', () => {
  it('should work as a convenience function', () => {
    const result = buildPrompt('翻译这段话');
    expect(result.prompt.length).toBeGreaterThan(0);
  });
});
