import { describe, it, expect } from 'vitest';
import { MetaCognitiveLoop, MetaCognitiveInput, MetaCognitiveOutput } from './meta-cognitive-loop.js';

describe('MetaCognitiveLoop', () => {
  const createInput = (overrides: Partial<MetaCognitiveInput> = {}): MetaCognitiveInput => ({
    agentId: 'test-agent',
    task: {
      taskType: 'coding',
      description: 'write a function',
      complexity: 'medium',
    },
    currentPlan: ['plan1', 'plan2'],
    completedSteps: ['step1'],
    pendingQuestions: ['need clarifications'],
    lastToolResult: 'Partial answer',
    maxMetaSteps: 5,
    ...overrides,
  });

  it('initializes with correct strategy for coding task', () => {
    const loop = new MetaCognitiveLoop(createInput());
    const state = loop.getStateSnapshot();

    expect(state.strategy!.primary).toBe('code-first');
    expect(state.profile.agentId).toBe('test-agent');
    expect(state.stepCount).toBe(0);
  });

  it('iterates and returns meta-cognitive output', () => {
    const loop = new MetaCognitiveLoop(createInput());
    const output = loop.iterate({
      task: { taskType: 'coding', description: 'write function', complexity: 'medium' },
      currentPlan: ['plan1', 'plan2'],
      completedSteps: ['step1'],
      pendingQuestions: [],
      lastToolResult: 'Good answer with data from https://example.com',
      toolUsed: 'search',
    });

    expect(output.metaStep).toBe(1);
    expect(output.decision).toBeDefined();
    expect(output.confidence).toBeDefined();
    expect(output.confidence.overallScore).toBeGreaterThanOrEqual(0);
    expect(output.confidence.overallScore).toBeLessThanOrEqual(1);
    expect(output.strategy).toBeDefined();
    expect(output.profileSummary).toBeDefined();
    expect(output.profileSummary.topDimensions).toBeDefined();
    expect(output.profileSummary.topTools).toBeDefined();
    expect(output.profileSummary.topFailures).toBeDefined();
  });

  it('should not terminate when confidence is low', () => {
    const loop = new MetaCognitiveLoop(createInput());
    const output = loop.iterate({
      task: { taskType: 'coding', description: 'test', complexity: 'low' },
      currentPlan: [],
      completedSteps: [],
      pendingQuestions: ['unknown'],
      lastToolResult: 'maybe perhaps uncertain',
    });

    const shouldTerminate = loop.shouldTerminate(output);
    expect(shouldTerminate).toBe(false);
  });

  it('terminates when decision is stop with high confidence', () => {
    const loop = new MetaCognitiveLoop(createInput());
    const output: MetaCognitiveOutput = {
      decision: { action: 'stop', confidence: 0.9, reason: 'done' },
      confidence: { overallScore: 0.9, level: 'very-high', signals: [], recommendation: 'proceed', details: {} },
      strategy: loop.getStateSnapshot().strategy!,
      profileSummary: { topDimensions: [], topTools: [], topFailures: [] },
      metaStep: 1,
    };

    expect(loop.shouldTerminate(output)).toBe(true);
  });

  it('terminates when reaching max meta steps', () => {
    const input = createInput({ maxMetaSteps: 2 });
    const loop = new MetaCognitiveLoop(input);

    loop.iterate({
      task: { taskType: 'coding', description: 'test', complexity: 'low' },
      currentPlan: [],
      completedSteps: [],
      pendingQuestions: [],
      lastToolResult: 'ok',
    });
    // stepCount = 1

    loop.iterate({
      task: { taskType: 'coding', description: 'test', complexity: 'low' },
      currentPlan: [],
      completedSteps: [],
      pendingQuestions: [],
      lastToolResult: 'ok',
    });
    // stepCount = 2, should now reach max

    const state = loop.getStateSnapshot();
    expect(state.stepCount).toBe(2);
  });

  it('terminates when asking human', () => {
    const loop = new MetaCognitiveLoop(createInput());
    const output: MetaCognitiveOutput = {
      decision: { action: 'ask_human', confidence: 0.7, reason: 'escalated' },
      confidence: { overallScore: 0.2, level: 'very-low', signals: [], recommendation: 'retry_with_different_strategy', details: {} },
      strategy: loop.getStateSnapshot().strategy!,
      profileSummary: { topDimensions: [], topTools: [], topFailures: [] },
      metaStep: 1,
    };

    expect(loop.shouldTerminate(output)).toBe(true);
  });

  it('updates profile with task results', () => {
    const loop = new MetaCognitiveLoop(createInput());

    loop.iterate({
      task: { taskType: 'coding', description: 'test', complexity: 'low' },
      currentPlan: [],
      completedSteps: [],
      pendingQuestions: [],
      lastToolResult: 'Excellent answer with sources and data https://example.com',
      toolUsed: 'code-gen',
    });

    const state = loop.getStateSnapshot();
    expect(state.profile.dimensions.length).toBeGreaterThan(0);
    expect(state.profile.toolPatterns.length).toBeGreaterThan(0);
    expect(state.profile.toolPatterns[0]!.toolName).toBe('code-gen');
  });

  it('logs failure modes for poor results', () => {
    const loop = new MetaCognitiveLoop(createInput());

    loop.iterate({
      task: { taskType: 'math', description: 'solve equation', complexity: 'low' },
      currentPlan: [],
      completedSteps: [],
      pendingQuestions: [],
      lastToolResult: 'maybe perhaps uncertain',
      toolUsed: 'calculator',
    });

    const state = loop.getStateSnapshot();
    const failures = state.profile.getTopFailureModes(5);
    expect(failures.some(f => f.pattern.includes('math'))).toBe(true);
  });

  it('increments step count on each iteration', () => {
    const loop = new MetaCognitiveLoop(createInput());

    expect(loop.getStateSnapshot().stepCount).toBe(0);

    loop.iterate({
      task: { taskType: 'coding', description: 'test', complexity: 'low' },
      currentPlan: [],
      completedSteps: [],
      pendingQuestions: [],
      lastToolResult: 'ok',
    });

    expect(loop.getStateSnapshot().stepCount).toBe(1);

    loop.iterate({
      task: { taskType: 'coding', description: 'test', complexity: 'low' },
      currentPlan: [],
      completedSteps: [],
      pendingQuestions: [],
      lastToolResult: 'ok',
    });

    expect(loop.getStateSnapshot().stepCount).toBe(2);
  });
});
