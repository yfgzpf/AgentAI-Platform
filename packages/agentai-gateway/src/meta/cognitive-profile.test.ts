import { describe, it, expect } from 'vitest';
import { CognitiveProfileBuilder, CognitiveDimension, ToolUsagePattern, FailureMode } from './cognitive-profile.js';

describe('CognitiveProfileBuilder', () => {
  const builder = CognitiveProfileBuilder.empty('test-agent');

  it('creates empty profile with correct agentId', () => {
    const profile = builder.build();
    expect(profile.agentId).toBe('test-agent');
    expect(profile.personasUsed).toEqual([]);
    expect(profile.dimensions).toEqual([]);
    expect(profile.toolPatterns).toEqual([]);
    expect(profile.failureModes).toEqual([]);
    expect(profile.createdAt).toBeDefined();
    expect(profile.updatedAt).toBeDefined();
  });

  it('updates dimension — new dimension', () => {
    const b = CognitiveProfileBuilder.empty('dim-test');
    b.updateDimension('reasoning', 0.8);
    const profile = b.build();

    expect(profile.dimensions).toHaveLength(1);
    expect(profile.dimensions[0]!).toMatchObject({
      label: 'reasoning',
      strength: 0.8,
      trialCount: 1,
    });
  });

  it('updates dimension — EMA for existing dimension', () => {
    const b = CognitiveProfileBuilder.empty('ema-test');
    b.updateDimension('coding', 1.0); // trial 1: strength = 1.0
    b.updateDimension('coding', 0.0); // trial 2: alpha = 0.5, strength = 1.0*0.5 + 0.0*0.5 = 0.5

    const profile = b.build();
    expect(profile.dimensions[0]!.strength).toBeCloseTo(0.5, 2);
    expect(profile.dimensions[0]!.trialCount).toBe(2);
  });

  it('records tool usage — new tool', () => {
    const b = CognitiveProfileBuilder.empty('tool-test');
    b.recordToolUsage({
      toolName: 'search',
      callCount: 3,
      avgScore: 0.8,
      avgLatencyMs: 200,
    });

    const profile = b.build();
    expect(profile.toolPatterns).toHaveLength(1);
    expect(profile.toolPatterns[0]!).toMatchObject({
      toolName: 'search',
      callCount: 3,
      avgScore: 0.8,
      avgLatencyMs: 200,
    });
  });

  it('records tool usage — merges with existing tool', () => {
    const b = CognitiveProfileBuilder.empty('tool-merge');
    b.recordToolUsage({ toolName: 'search', callCount: 2, avgScore: 0.6, avgLatencyMs: 100 });
    b.recordToolUsage({ toolName: 'search', callCount: 2, avgScore: 1.0, avgLatencyMs: 300 });

    const profile = b.build();
    expect(profile.toolPatterns[0]!.callCount).toBe(4);
    expect(profile.toolPatterns[0]!.avgScore).toBeCloseTo(0.8, 1);
  });

  it('logs failure mode', () => {
    const b = CognitiveProfileBuilder.empty('fail-test');
    b.logFailureMode('misses_edge_cases');
    b.logFailureMode('misses_edge_cases');
    b.logFailureMode('hallucinates_urls');

    const profile = b.build();
    expect(profile.failureModes).toHaveLength(2);
    expect(profile.failureModes.find(f => f.pattern === 'misses_edge_cases')!.count).toBe(2);
    expect(profile.failureModes.find(f => f.pattern === 'hallucinates_urls')!.count).toBe(1);
  });

  it('registers personas', () => {
    const b = CognitiveProfileBuilder.empty('persona-test');
    b.registerPersona('coder');
    b.registerPersona('researcher');
    b.registerPersona('coder'); // duplicate

    const profile = b.build();
    expect(profile.personasUsed).toEqual(['coder', 'researcher']);
  });

  it('gets top dimensions', () => {
    const b = CognitiveProfileBuilder.empty('top-dim');
    b.updateDimension('reasoning', 0.9);
    b.updateDimension('coding', 0.7);
    b.updateDimension('debugging', 0.5);

    const top = b.getTopDimensions(2);
    expect(top).toHaveLength(2);
    expect(top[0]!.label).toBe('reasoning');
    expect(top[1]!.label).toBe('coding');
  });

  it('gets top tools', () => {
    const b = CognitiveProfileBuilder.empty('top-tools');
    b.recordToolUsage({ toolName: 'tool-a', callCount: 1, avgScore: 0.9, avgLatencyMs: 0 });
    b.recordToolUsage({ toolName: 'tool-b', callCount: 1, avgScore: 0.5, avgLatencyMs: 0 });
    b.recordToolUsage({ toolName: 'tool-c', callCount: 1, avgScore: 0.7, avgLatencyMs: 0 });

    const top = b.getTopTools(2);
    expect(top).toHaveLength(2);
    expect(top[0]!.toolName).toBe('tool-a');
    expect(top[1]!.toolName).toBe('tool-c');
  });

  it('gets top failure modes', () => {
    const b = CognitiveProfileBuilder.empty('top-fail');
    b.logFailureMode('common-issue');
    b.logFailureMode('common-issue');
    b.logFailureMode('rare-issue');
    b.logFailureMode('another-rare');

    const top = b.getTopFailureModes(2);
    expect(top).toHaveLength(2);
    expect(top[0]!.pattern).toBe('common-issue');
    expect(top[0]!.count).toBe(2);
  });
});
