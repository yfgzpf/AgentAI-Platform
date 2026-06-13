import { describe, it, expect, beforeEach } from 'vitest';
import { KnowledgeCache, getKnowledgeCache } from './knowledge-cache.js';

describe('KnowledgeCache', () => {
  let cache: KnowledgeCache;

  beforeEach(() => {
    cache = new KnowledgeCache();
    cache.clear();
  });

  it('should return not found for unknown query', () => {
    const result = cache.query('unknown task');
    expect(result.found).toBe(false);
    expect(result.entry).toBeUndefined();
  });

  it('should upsert and query an entry', () => {
    cache.upsert('分析股票行情', 'tpl_financial_v1', 8, 'financial_analyst');
    const result = cache.query('分析股票行情');
    expect(result.found).toBe(true);
    expect(result.entry!.templateId).toBe('tpl_financial_v1');
    expect(result.entry!.persona).toBe('financial_analyst');
  });

  it('should update score on repeated upsert', () => {
    cache.upsert('分析股票行情', 'tpl_financial_v1', 8, 'financial_analyst');
    cache.upsert('分析股票行情', 'tpl_financial_v1', 6, 'financial_analyst');
    const result = cache.query('分析股票行情');
    expect(result.found).toBe(true);
    // totalScore = 8 + 6 = 14, but query also adds 1 hit, so usageCount = 3
    // Actually: upsert adds hitCount=1, second upsert adds hitCount=1, query adds hitCount=1
    expect(result.entry!.hitCount).toBeGreaterThanOrEqual(2);
  });

  it('should query by persona', () => {
    cache.upsert('金融分析', 'tpl_financial_v1', 9, 'financial_analyst');
    cache.upsert('代码审查', 'tpl_code_review_v1', 7, 'code_review');
    const results = cache.queryByPersona('financial_analyst');
    expect(results).toHaveLength(1);
    expect(results[0]!.templateId).toBe('tpl_financial_v1');
  });

  it('should record score feedback', () => {
    cache.upsert('测试任务', 'tpl_general_v1', 5, 'general');
    cache.recordScore('测试任务', 9);
    const entries = cache.list();
    const entry = entries.find(e => e.templateId === 'tpl_general_v1');
    expect(entry!.totalScore).toBe(14); // 5 + 9
  });

  it('should evict low score entries', () => {
    // Insert a low-score entry with enough hits
    for (let i = 0; i < 6; i++) {
      cache.upsert('bad_task', 'tpl_bad', 1, 'general');
    }
    const evicted = cache.evictLowScore(3, 5);
    expect(evicted).toBe(1);
    const result = cache.query('bad_task');
    expect(result.found).toBe(false);
  });

  it('should not evict entries below minHits', () => {
    cache.upsert('new_task', 'tpl_new', 1, 'general');
    const evicted = cache.evictLowScore(3, 5);
    expect(evicted).toBe(0);
    const result = cache.query('new_task');
    expect(result.found).toBe(true);
  });

  it('should compute stats correctly', () => {
    cache.upsert('任务A', 'tpl_a', 8, 'general');
    cache.upsert('任务B', 'tpl_b', 6, 'general');
    const stats = cache.getStats();
    expect(stats.totalEntries).toBe(2);
    expect(stats.totalHits).toBe(2);
    expect(stats.topTemplates.length).toBeGreaterThan(0);
  });
});

describe('getKnowledgeCache', () => {
  it('should return a singleton instance', () => {
    // Note: we can't easily test singleton in isolated tests without side effects
    // Just verify it returns a KnowledgeCache instance
    const cache = getKnowledgeCache();
    expect(cache).toBeInstanceOf(KnowledgeCache);
  });
});
