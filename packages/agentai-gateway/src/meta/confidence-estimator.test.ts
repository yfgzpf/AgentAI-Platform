import { describe, it, expect } from 'vitest';
import { ConfidenceEstimator, ConfidenceLevel } from './confidence-estimator.js';

describe('ConfidenceEstimator', () => {
  it('returns zero score with no signals', () => {
    const estimator = new ConfidenceEstimator();
    const report = estimator.evaluate();
    expect(report.overallScore).toBe(0);
    expect(report.level).toBe('very-low');
    expect(report.signals).toHaveLength(0);
  });

  it('computes weighted score from signals', () => {
    const estimator = new ConfidenceEstimator();
    estimator.addSignal('evidence_density', 0.5, 0.8);
    estimator.addSignal('tool_coverage', 0.5, 0.6);

    const report = estimator.evaluate();
    // (0.5 * 0.8 + 0.5 * 0.6) / (0.5 + 0.5) = 0.7
    expect(report.overallScore).toBeCloseTo(0.7, 2);
    expect(report.signals).toHaveLength(2);
  });

  it('maps score to confidence level — very-high', () => {
    const estimator = new ConfidenceEstimator();
    estimator.addSignal('test', 1.0, 1.0);
    const report = estimator.evaluate();
    expect(report.level).toBe('very-high');
    expect(report.recommendation).toBe('proceed');
  });

  it('maps score to confidence level — high', () => {
    const estimator = new ConfidenceEstimator();
    estimator.addSignal('test', 1.0, 0.8);
    const report = estimator.evaluate();
    expect(report.level).toBe('high');
  });

  it('maps score to confidence level — medium', () => {
    const estimator = new ConfidenceEstimator();
    estimator.addSignal('test', 1.0, 0.6);
    const report = estimator.evaluate();
    expect(report.level).toBe('medium');
  });

  it('maps score to confidence level — low', () => {
    const estimator = new ConfidenceEstimator();
    estimator.addSignal('test', 1.0, 0.4);
    const report = estimator.evaluate();
    expect(report.level).toBe('low');
    expect(report.recommendation).toBe('gather_more_evidence');
  });

  it('maps score to confidence level — very-low', () => {
    const estimator = new ConfidenceEstimator();
    estimator.addSignal('test', 1.0, 0.1);
    const report = estimator.evaluate();
    expect(report.level).toBe('very-low');
    expect(report.recommendation).toBe('retry_with_different_strategy');
  });

  it('uses custom factor weights', () => {
    const estimator = new ConfidenceEstimator({
      custom_factor: 1.0,
    });
    estimator.addSignal('custom_factor', 1.0, 0.5);
    const report = estimator.evaluate();
    expect(report.overallScore).toBeCloseTo(0.5, 2);
    expect(report.details.custom_factor).toBeDefined();
  });

  it('provides human-readable explanations', () => {
    const estimator = new ConfidenceEstimator();
    estimator.addSignal('evidence_density', 0.3, 0.9);
    const report = estimator.evaluate();
    expect(report.details.evidence_density).toContain('丰富');
  });

  it('resets signals', () => {
    const estimator = new ConfidenceEstimator();
    estimator.addSignal('test', 1.0, 0.8);
    estimator.evaluate();
    estimator.reset();

    const report2 = estimator.evaluate();
    expect(report2.overallScore).toBe(0);
    expect(report2.signals).toHaveLength(0);
  });

  it('weights different factors appropriately', () => {
    const estimator = new ConfidenceEstimator({
      factor_a: 0.7,
      factor_b: 0.3,
    });
    estimator.addSignal('factor_a', 0.7, 1.0);
    estimator.addSignal('factor_b', 0.3, 0.0);

    const report = estimator.evaluate();
    // (0.7 * 1.0 + 0.3 * 0.0) / (0.7 + 0.3) = 0.7
    expect(report.overallScore).toBeCloseTo(0.7, 2);
  });
});
