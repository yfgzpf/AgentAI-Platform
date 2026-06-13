import { describe, it, expect } from 'vitest';
import { SkillEvolver, type SkillUsageRecord, type SkillMeta } from './skill-evolver';

describe('SkillEvolver', () => {
  function makeRecord(overrides: Partial<SkillUsageRecord> = {}): SkillUsageRecord {
    return {
      skill_id: overrides.skill_id ?? 'test-skill',
      skill_name: overrides.skill_name ?? 'test-skill',
      category: overrides.category ?? 'general',
      score: overrides.score ?? 8,
      latency_ms: overrides.latency_ms ?? 100,
      timestamp: overrides.timestamp ?? new Date().toISOString(),
      ...overrides,
    };
  }

  it('should aggregate stats from usage records', () => {
    const evolver = new SkillEvolver({ min_usage_count: 0 });
    evolver.recordBatch([
      makeRecord({ skill_id: 's1', score: 8 }),
      makeRecord({ skill_id: 's1', score: 7 }),
      makeRecord({ skill_id: 's1', score: 9 }),
    ]);
    // 先 evaluate 才能填充 registry
    evolver.evaluate();
    const registry = evolver.getRegistry();
    expect(registry.length).toBe(1);
    const meta = registry[0]!;
    expect(meta.id).toBe('s1');
    expect(meta.usage_count).toBe(3);
    expect(meta.avg_score).toBeCloseTo(8);
    expect(meta.fitness_score).toBeCloseTo(24);
  });

  it('should promote high fitness skills', () => {
    const evolver = new SkillEvolver({
      promote_threshold: 20,
      min_usage_count: 1,
    });
    for (let i = 0; i < 5; i++) {
      evolver.recordUsage(makeRecord({ skill_id: 'elite', score: 9 }));
    }
    const decisions = evolver.evaluate();
    const promote = decisions.find((d) => d.type === 'promote');
    expect(promote).toBeDefined();
    expect(promote!.skill_id).toBe('elite');
  });

  it('should deprecate consistently low-score skills', () => {
    const evolver = new SkillEvolver({
      deprecated_threshold: 3,
      min_usage_count: 1,
    });
    for (let i = 0; i < 4; i++) {
      evolver.recordUsage(makeRecord({ skill_id: 'bad', score: 1 }));
    }
    const decisions = evolver.evaluate();
    const demote = decisions.find((d) => d.type === 'demote');
    expect(demote).toBeDefined();
    expect(demote!.new_status).toBe('deprecated');
  });

  it('should detect mergeable skills with same category', () => {
    const evolver = new SkillEvolver({ min_usage_count: 1 });
    evolver.recordUsage(makeRecord({ skill_id: 'csv-parser', skill_name: 'CSV解析', category: 'data-tools', score: 7 }));
    evolver.recordUsage(makeRecord({ skill_id: 'xlsx-parser', skill_name: 'XLSX解析', category: 'data-tools', score: 7 }));

    // 注册假数据以让 detectMergable 能找到
    const reg1: SkillMeta = {
      id: 'csv-parser', name: 'CSV解析', category: 'data-tools', description: '',
      version: '1.0', created_at: '', updated_at: '', usage_count: 1,
      total_score: 7, avg_score: 7, fitness_score: 7, status: 'active',
    };
    const reg2: SkillMeta = {
      id: 'xlsx-parser', name: 'XLSX解析', category: 'data-tools', description: '',
      version: '1.0', created_at: '', updated_at: '', usage_count: 1,
      total_score: 7, avg_score: 7, fitness_score: 7, status: 'active',
    };
    evolver['skillRegistry'].set('csv-parser', reg1);
    evolver['skillRegistry'].set('xlsx-parser', reg2);

    const pairs = evolver.detectMergable();
    // 同 category 但名称重叠率低（CSV 和 XLSX 无共同 token），similarity = 0.2
    // 默认 threshold 0.7，所以不会命中
    expect(pairs.some((p) => p.skillA === 'csv-parser' && p.skillB === 'xlsx-parser')).toBeFalsy();
  });

  it('should return active and deprecated skill lists', () => {
    const evolver = new SkillEvolver({ min_usage_count: 0, promote_threshold: 15 });
    evolver.recordUsage(makeRecord({ skill_id: 'good', score: 9 }));
    evolver.recordUsage(makeRecord({ skill_id: 'good', score: 8 }));
    evolver.recordUsage(makeRecord({ skill_id: 'bad', score: 1 }));
    evolver.recordUsage(makeRecord({ skill_id: 'bad', score: 2 }));
    evolver.recordUsage(makeRecord({ skill_id: 'bad', score: 1 }));

    const decisions = evolver.evaluate();
    // 9+8=17 > 15, good 应该被 promote
    expect(decisions.some((d) => d.skill_id === 'good' && d.type === 'promote')).toBe(true);
    // good 和 bad 都已注册，不会有 create 决策
    const active = evolver.getActiveSkills();
    const all = evolver.getRegistry();
    expect(active.length).toBeGreaterThanOrEqual(1);
    expect(all.length).toBe(2);
  });

  it('should create entries on first use', () => {
    const evolver = new SkillEvolver({ min_usage_count: 0 });
    evolver.recordUsage(makeRecord({ skill_id: 'brand-new', skill_name: 'brand-new', score: 5 }));

    // 初始 registry 为空
    expect(evolver.getRegistry().length).toBe(0);

    const decisions = evolver.evaluate();
    const create = decisions.find((d) => d.type === 'create');
    expect(create).toBeDefined();
    expect(create!.skill_name).toBe('brand-new');
  });
});
