/**
 * StrategySelector — picks the best strategy combination for a given task type.
 * Strategies: search-first, code-first, reasoning-first, tool-heavy, minimal.
 */

import { ConfidenceEstimator } from './confidence-estimator.js';
import { CognitiveProfile } from './cognitive-profile.js';

export type StrategyType = 'search-first' | 'code-first' | 'reasoning-first' | 'tool-heavy' | 'minimal';

export interface StrategyConfig {
  primary: StrategyType;
  secondary: StrategyType;
  maxToolCalls: number;
  maxReasoningSteps: number;
  preferTools: boolean;
  selfCheckRound: number; // how many self-check rounds to run
}

export interface TaskProfile {
  taskType: string;         // e.g. "coding", "research", "debugging", "creative"
  description: string;
  complexity: 'low' | 'medium' | 'high';
}

export class StrategySelector {
  private defaultStrategies: Record<string, StrategyConfig> = {
    'coding': {
      primary: 'code-first',
      secondary: 'tool-heavy',
      maxToolCalls: 5,
      maxReasoningSteps: 3,
      preferTools: true,
      selfCheckRound: 2,
    },
    'research': {
      primary: 'search-first',
      secondary: 'reasoning-first',
      maxToolCalls: 8,
      maxReasoningSteps: 5,
      preferTools: true,
      selfCheckRound: 1,
    },
    'debugging': {
      primary: 'tool-heavy',
      secondary: 'code-first',
      maxToolCalls: 10,
      maxReasoningSteps: 4,
      preferTools: true,
      selfCheckRound: 3,
    },
    'creative': {
      primary: 'reasoning-first',
      secondary: 'minimal',
      maxToolCalls: 3,
      maxReasoningSteps: 6,
      preferTools: false,
      selfCheckRound: 1,
    },
    'question-answering': {
      primary: 'search-first',
      secondary: 'reasoning-first',
      maxToolCalls: 4,
      maxReasoningSteps: 3,
      preferTools: true,
      selfCheckRound: 1,
    },
  };

  /**
   * Select a strategy based on task profile and agent's cognitive profile.
   */
  select(task: TaskProfile, profile?: CognitiveProfile): StrategyConfig {
    // Step 1: Look up default for task type
    const defaultConfig = this.defaultStrategies[task.taskType];
    if (!defaultConfig) {
      // Fallback to generic strategy
      return this.genericStrategy(task);
    }

    // Step 2: If agent has cognitive profile, adjust based on strengths/weaknesses
    if (profile) {
      return this.adjustBasedOnProfile(defaultConfig, profile, task);
    }

    return defaultConfig;
  }

  /**
   * Get strategy for a task type without cognitive profile.
   */
  getStrategyForType(taskType: string): StrategyConfig {
    return this.defaultStrategies[taskType] || this.genericStrategy({
      taskType,
      description: '',
      complexity: 'medium',
    });
  }

  // ---- Private ----

  private genericStrategy(task: TaskProfile): StrategyConfig {
    const complexityMultiplier = task.complexity === 'high' ? 1.5 : task.complexity === 'low' ? 0.5 : 1;
    return {
      primary: 'reasoning-first',
      secondary: 'search-first',
      maxToolCalls: Math.round(5 * complexityMultiplier),
      maxReasoningSteps: Math.round(4 * complexityMultiplier),
      preferTools: task.complexity !== 'low',
      selfCheckRound: task.complexity === 'high' ? 2 : 1,
    };
  }

  private adjustBasedOnProfile(
    baseConfig: StrategyConfig,
    profile: CognitiveProfile,
    task: TaskProfile,
  ): StrategyConfig {
    const config = { ...baseConfig };

    // Check if agent is weak in this task type
    const relevantDimensions = profile.dimensions.filter(
      d => d.label.includes(task.taskType) || task.taskType.includes(d.label),
    );

    if (relevantDimensions.length > 0) {
      const avgStrength = relevantDimensions.reduce((sum, d) => sum + d.strength, 0) / relevantDimensions.length;

      // If agent is weak in this domain, increase tool usage and self-checks
      if (avgStrength < 0.4) {
        config.maxToolCalls = Math.round(config.maxToolCalls * 1.5);
        config.selfCheckRound = Math.min(config.selfCheckRound + 1, 5);
        config.preferTools = true;
      }

      // If agent is strong, rely more on reasoning
      if (avgStrength >= 0.8) {
        config.maxToolCalls = Math.round(config.maxToolCalls * 0.7);
        config.maxReasoningSteps = Math.round(config.maxReasoningSteps * 1.3);
      }
    }

    // Check top failure modes
    const topFailures = profile.getTopFailureModes(3);
    const failurePatterns = topFailures.map(f => f.pattern);

    // If agent commonly fails on edge cases, increase self-checks
    const hasEdgeCaseFailure = failurePatterns.some(p => p.includes('edge_case') || p.includes('miss'));
    if (hasEdgeCaseFailure) {
      config.selfCheckRound = Math.min(config.selfCheckRound + 1, 5);
    }

    return config;
  }
}
