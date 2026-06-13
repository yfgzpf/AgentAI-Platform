import { describe, it, expect } from 'vitest';
import { MetaReasoner, MetaReasoningContext } from './meta-reasoner.js';

describe('MetaReasoner', () => {
  const metaReasoner = new MetaReasoner();

  it('decides stop when confidence is high', () => {
    const context: MetaReasoningContext = {
      taskDescription: 'test',
      currentPlan: ['step1'],
      completedSteps: ['step1'],
      pendingQuestions: [],
      lastToolResult: 'Complete answer with data',
      confidenceReport: {
        overallScore: 0.9,
        level: 'very-high',
        signals: [],
        recommendation: 'proceed',
        details: {},
      },
      maxSteps: 10,
      currentStep: 2,
    };

    const decision = metaReasoner.decide(context);
    expect(decision.action).toBe('stop');
    expect(decision.confidence).toBe(0.9);
  });

  it('decides ask_human when max steps exceeded', () => {
    const context: MetaReasoningContext = {
      taskDescription: 'test',
      currentPlan: ['step1'],
      completedSteps: ['step1'],
      pendingQuestions: [],
      lastToolResult: null,
      confidenceReport: null,
      maxSteps: 2,
      currentStep: 2,
    };

    const decision = metaReasoner.decide(context);
    expect(decision.action).toBe('ask_human');
    expect(decision.reason).toContain('最大推理步数');
  });

  it('decides reason when pending questions are answered with good result', () => {
    const context: MetaReasoningContext = {
      taskDescription: 'test',
      currentPlan: ['step1', 'step2'],
      completedSteps: ['step1', 'step2'],
      pendingQuestions: [],
      lastToolResult: 'Detailed answer with data sourced from multiple references and citations',
      confidenceReport: null,
      maxSteps: 10,
      currentStep: 2,
    };

    const decision = metaReasoner.decide(context);
    expect(decision.action).toBe('reason');
  });

  it('decides call_tool when profile suggests best tool', () => {
    const profile = {
      getTopTools: (n: number) => [
        { toolName: 'search', avgScore: 0.85, avgLatencyMs: 200, callCount: 10 },
      ],
    } as any;

    const context: MetaReasoningContext = {
      taskDescription: 'research',
      currentPlan: ['step1'],
      completedSteps: [],
      pendingQuestions: ['need data'],
      lastToolResult: null,
      confidenceReport: null,
      profile,
      maxSteps: 10,
      currentStep: 0,
    };

    const decision = metaReasoner.decide(context);
    expect(decision.action).toBe('call_tool');
    expect(decision.toolName).toBe('search');
  });

  it('decides ask_human when confidence is too low', () => {
    const context: MetaReasoningContext = {
      taskDescription: 'test',
      currentPlan: ['step1'],
      completedSteps: [],
      pendingQuestions: ['unknown'],
      lastToolResult: null,
      confidenceReport: {
        overallScore: 0.2,
        level: 'very-low',
        signals: [],
        recommendation: 'retry_with_different_strategy',
        details: {},
      },
      maxSteps: 10,
      currentStep: 0,
    };

    const decision = metaReasoner.decide(context);
    expect(decision.action).toBe('ask_human');
  });

  it('estimates result quality — high quality result', () => {
    const result = `
根据数据表明：
- 来源1: https://example.com
- 来源2: https://example.org

例如：
1. 研究发现A>B
2. 数据显示C>D
`;
    const quality = metaReasoner.estimateResultQuality(result);
    expect(quality).toBeGreaterThan(0.5);
  });

  it('estimates result quality — low quality result', () => {
    const result = '可能也许大概不确定';
    const quality = metaReasoner.estimateResultQuality(result);
    expect(quality).toBeLessThan(0.3);
  });

  it('estimates result quality — empty returns 0', () => {
    expect(metaReasoner.estimateResultQuality('')).toBe(0);
    expect(metaReasoner.estimateResultQuality('   ')).toBe(0);
  });

  it('checks result sufficiency', () => {
    expect(metaReasoner.isResultSufficient('Good result with data and sources')).toBe(true);
    expect(metaReasoner.isResultSufficient('maybe')).toBe(false);
  });

  it('updates cognitive profile with tool usage', () => {
    const profileBuilder = {
      updateDimension: vi.fn(),
      recordToolUsage: vi.fn(),
      logFailureMode: vi.fn(),
    } as any;

    metaReasoner.updateProfile(profileBuilder, 'coding', 0.8, 'search');

    expect(profileBuilder.updateDimension).toHaveBeenCalledWith('coding', 0.8);
    expect(profileBuilder.recordToolUsage).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'search' }),
    );
    expect(profileBuilder.logFailureMode).not.toHaveBeenCalled();
  });

  it('logs failure mode when score < 0.3', () => {
    const profileBuilder = {
      updateDimension: vi.fn(),
      recordToolUsage: vi.fn(),
      logFailureMode: vi.fn(),
    } as any;

    metaReasoner.updateProfile(profileBuilder, 'math', 0.2, 'calculator');

    expect(profileBuilder.logFailureMode).toHaveBeenCalledWith('low_performance_on_math');
  });
});
