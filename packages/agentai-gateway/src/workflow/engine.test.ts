import { describe, it, expect } from 'vitest';
import { WorkflowEngine, createWorkflow } from './engine.js';

describe('WorkflowEngine', () => {
  it('should execute full 5-step workflow', async () => {
    const engine = new WorkflowEngine();
    const result = await engine.execute({
      sessionId: 'test-1',
      query: '帮我分析 A 股股票',
      persona: 'financial_analyst',
    });

    expect(result.success).toBe(true);
    expect(result.steps.length).toBe(5);
    expect(result.steps[0]?.name).toBe('understand');
    expect(result.steps[1]?.name).toBe('plan');
    expect(result.steps[2]?.name).toBe('execute');
    expect(result.steps[3]?.name).toBe('self_check');
    expect(result.steps[4]?.name).toBe('distill');
    expect(result.selfEval).toHaveProperty('totalScore');
  });

  it('should auto-classify persona from query', async () => {
    const engine = new WorkflowEngine();
    const result = await engine.execute({
      sessionId: 'test-2',
      query: '帮我写一个 Python 代码排序函数',
      tools: ['code_executor'],
    });
    expect(result.finalOutput).toContain('code_review');
  });

  it('should return self eval with all fields', async () => {
    const engine = new WorkflowEngine();
    const result = await engine.execute({
      sessionId: 'test-3',
      query: 'hello',
    });
    const eval_ = result.selfEval!;
    expect(eval_).toHaveProperty('accuracy');
    expect(eval_).toHaveProperty('completeness');
    expect(eval_).toHaveProperty('safety');
    expect(eval_).toHaveProperty('format');
    expect(eval_).toHaveProperty('totalScore');
    expect(Array.isArray(eval_.reasons)).toBe(true);
  });

  it('should handle quality threshold', async () => {
    const engine = new WorkflowEngine({ qualityThreshold: 0 });
    const result = await engine.execute({
      sessionId: 'test-4',
      query: 'test',
      qualityThreshold: 0,
    });
    // 低阈值应该更容易通过
    expect(result.success).toBe(true);
  });

  it('should batch execute workflows', async () => {
    const engine = new WorkflowEngine();
    const results = await engine.batchExecute([
      { sessionId: 'b1', query: 'a' },
      { sessionId: 'b2', query: 'b' },
      { sessionId: 'b3', query: 'c' },
    ]);
    expect(results.length).toBe(3);
    for (const r of results) {
      expect(r).toHaveProperty('steps');
      expect(r).toHaveProperty('selfEval');
    }
  });
});

describe('createWorkflow', () => {
  it('should create engine and run function', async () => {
    const { engine, run } = createWorkflow({ sessionId: 'w1', query: 'test' });
    const result = await run();
    expect(result).toHaveProperty('finalOutput');
    expect(result).toHaveProperty('totalDurationMs');
  });

  it('should auto-generate session ID', () => {
    const { run } = createWorkflow({ query: 'no-session-id' });
    expect(run).toBeDefined();
  });
});
