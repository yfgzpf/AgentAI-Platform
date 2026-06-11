import { describe, it, expect } from 'vitest';
import { estimateTokens, estimateChatCost, formatTokens } from './token-estimate.js';

describe('estimateTokens', () => {
  it('estimates English text', () => {
    const t = estimateTokens('hello world');
    expect(t).toBeGreaterThan(0);
  });
  it('estimates Chinese text', () => {
    const t = estimateTokens('你好世界');
    expect(t).toBeGreaterThan(0);
  });
  it('returns 0 for empty', () => {
    expect(estimateTokens('')).toBe(0);
  });
  it('Chinese counts more than English', () => {
    const cn = estimateTokens('你好世界');
    const en = estimateTokens('hello');
    expect(cn).toBeGreaterThan(en);
  });
});

describe('estimateChatCost', () => {
  it('returns cost for agentai', () => {
    const r = estimateChatCost('test', 0, 'agentai');
    expect(r.totalTokens).toBeGreaterThan(0);
    expect(r.cost).toBeGreaterThan(0);
  });
  it('returns cost for deepseek', () => {
    const r = estimateChatCost('test', 0, 'deepseek');
    expect(r.cost).toBeGreaterThan(0);
  });
  it('formats small cost', () => {
    const r = estimateChatCost('a', 0, 'agentai');
    expect(r.costFormatted).toMatch(/^</);
  });
});

describe('formatTokens', () => {
  it('formats small numbers', () => {
    expect(formatTokens(500)).toBe('500t');
  });
  it('formats thousands', () => {
    expect(formatTokens(1500)).toBe('1.5K');
  });
  it('formats millions', () => {
    expect(formatTokens(1500000)).toBe('1.50M');
  });
});
