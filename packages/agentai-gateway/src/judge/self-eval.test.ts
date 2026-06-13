import { describe, it, expect } from 'vitest';
import { SelfEvaluator, JudgePromptBuilder, quickScore, scoreCardToLabel } from './self-eval.js';

describe('SelfEvaluator', () => {
  const evaluator = new SelfEvaluator();

  it('should give high score to valid JSON output', () => {
    const card = evaluator.evaluate(
      'extract name and age',
      '{"name": "Alice", "age": 30}',
      'general',
      { checkJSON: true },
    );
    expect(card.format).toBe(5);
    expect(card.totalScore).toBeGreaterThanOrEqual(8);
  });

  it('should penalize hallucination patterns', () => {
    const card = evaluator.evaluate(
      'what is 2+2?',
      '[hallucinated] it is 5.',
    );
    expect(card.accuracy).toBeLessThan(10);
    expect(card.totalScore).toBeLessThan(8);
  });

  it('should detect security violations', () => {
    const card = evaluator.evaluate(
      'run cleanup',
      'I will run rm -rf / on your system',
    );
    expect(card.safety).toBe(0);
    expect(card.totalScore).toBeLessThanOrEqual(-4);
  });

  it('should handle plain text output', () => {
    const card = evaluator.evaluate(
      'give me a summary',
      'This is a plain text summary about the topic you asked for.',
    );
    expect(card.totalScore).toBeGreaterThanOrEqual(1); // not zero
  });
});

describe('JudgePromptBuilder', () => {
  it('should build a self-eval prompt', () => {
    const builder = new JudgePromptBuilder();
    const prompt = builder.buildSelfEvalPrompt(
      { rules: [{ name: 'test', weight: 5 }], negativePatterns: [] },
      'Hello world',
      'Some output here',
    );
    expect(prompt).toContain('Hello world');
    expect(prompt).toContain('Some output here');
    expect(prompt).toContain('JSON');
  });
});

describe('quickScore', () => {
  it('should return a valid ScoreCard', () => {
    const card = quickScore('find data', '{"key": "value"}');
    expect(card).toHaveProperty('totalScore');
    expect(card).toHaveProperty('reasons');
    expect(Array.isArray(card.reasons)).toBe(true);
  });
});

describe('scoreCardToLabel', () => {
  it('should map scores to labels correctly', () => {
    expect(scoreCardToLabel({ totalScore: 10, accuracy: 10, completeness: 10, safety: 10, format: 10, reasons: [] })).toBe('good');
    expect(scoreCardToLabel({ totalScore: 6, accuracy: 6, completeness: 6, safety: 10, format: 6, reasons: [] })).toBe('passable');
    expect(scoreCardToLabel({ totalScore: 2, accuracy: 3, completeness: 3, safety: 5, format: 2, reasons: [] })).toBe('bad');
    expect(scoreCardToLabel({ totalScore: -5, accuracy: 0, completeness: 0, safety: 0, format: 0, reasons: [] })).toBe('fail');
  });
});
