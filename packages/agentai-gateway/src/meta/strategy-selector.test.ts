import { describe, it, expect } from 'vitest';
import { StrategySelector, StrategyConfig, TaskProfile } from './strategy-selector.js';
import { CognitiveProfile } from './cognitive-profile.js';

describe('StrategySelector', () => {
  const selector = new StrategySelector();

  const makeTask = (overrides: Partial<TaskProfile> = {}): TaskProfile => ({
    taskType: 'coding',
    description: 'test task',
    complexity: 'medium',
    ...overrides,
  });

  it('selects coding strategy', () => {
    const strategy = selector.select(makeTask({ taskType: 'coding' }));
    expect(strategy.primary).toBe('code-first');
    expect(strategy.secondary).toBe('tool-heavy');
    expect(strategy.maxToolCalls).toBe(5);
    expect(strategy.selfCheckRound).toBe(2);
  });

  it('selects research strategy', () => {
    const strategy = selector.select(makeTask({ taskType: 'research' }));
    expect(strategy.primary).toBe('search-first');
    expect(strategy.maxToolCalls).toBe(8);
    expect(strategy.selfCheckRound).toBe(1);
  });

  it('selects debugging strategy', () => {
    const strategy = selector.select(makeTask({ taskType: 'debugging' }));
    expect(strategy.primary).toBe('tool-heavy');
    expect(strategy.maxToolCalls).toBe(10);
    expect(strategy.selfCheckRound).toBe(3);
  });

  it('selects creative strategy', () => {
    const strategy = selector.select(makeTask({ taskType: 'creative' }));
    expect(strategy.primary).toBe('reasoning-first');
    expect(strategy.secondary).toBe('minimal');
    expect(strategy.maxToolCalls).toBe(3);
    expect(strategy.preferTools).toBe(false);
  });

  it('selects question-answering strategy', () => {
    const strategy = selector.select(makeTask({ taskType: 'question-answering' }));
    expect(strategy.primary).toBe('search-first');
    expect(strategy.maxToolCalls).toBe(4);
  });

  it('returns generic strategy for unknown task type', () => {
    const strategy = selector.select(makeTask({ taskType: 'unknown-type' }));
    expect(strategy.primary).toBe('reasoning-first');
    expect(strategy.secondary).toBe('search-first');
  });

  it('adjusts for high complexity', () => {
    const strategy = selector.select(makeTask({ complexity: 'high' }));
    expect(strategy.maxToolCalls).toBeGreaterThan(5);
    expect(strategy.maxReasoningSteps).toBeGreaterThan(4);
  });

  it('adjusts for low complexity', () => {
    const strategy = selector.select(makeTask({ complexity: 'low' }));
    expect(strategy.maxToolCalls).toBeLessThan(5);
  });

  it('adjusts based on weak cognitive profile', () => {
    const profile = new CognitiveProfile({
      agentId: 'weak-agent',
      personasUsed: [],
      dimensions: [
        { label: 'coding', strength: 0.3, trialCount: 5 },
      ],
      toolPatterns: [],
      failureModes: [{ pattern: 'misses_edge_cases', count: 3, lastSeen: new Date().toISOString() }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const strategy = selector.select(makeTask({ taskType: 'coding' }), profile);

    // Weak agent should have more tool calls and self-checks
    expect(strategy.maxToolCalls).toBeGreaterThan(5);
    expect(strategy.selfCheckRound).toBeGreaterThan(2);
  });

  it('adjusts based on strong cognitive profile', () => {
    const profile = new CognitiveProfile({
      agentId: 'strong-agent',
      personasUsed: [],
      dimensions: [
        { label: 'coding', strength: 0.9, trialCount: 20 },
      ],
      toolPatterns: [],
      failureModes: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const strategy = selector.select(makeTask({ taskType: 'coding' }), profile);

    // Strong agent should have fewer tool calls, more reasoning
    expect(strategy.maxToolCalls).toBeLessThan(5);
    expect(strategy.maxReasoningSteps).toBeGreaterThan(4);
  });

  it('gets strategy for type without profile', () => {
    const strategy = selector.getStrategyForType('debugging');
    expect(strategy.primary).toBe('tool-heavy');
  });

  it('returns generic strategy when type not found', () => {
    const strategy = selector.getStrategyForType('nonexistent');
    expect(strategy.primary).toBe('reasoning-first');
  });
});
