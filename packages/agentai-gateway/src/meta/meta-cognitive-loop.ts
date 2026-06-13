/**
 * Meta-Cognitive Loop — orchestrator for the "thinking about thinking" system.
 * Connects CognitiveProfile, ConfidenceEstimator, MetaReasoner, and StrategySelector
 * into a unified meta-cognitive loop that sits on top of the main agentai-loop.
 */

import { CognitiveProfile, CognitiveProfileBuilder } from './cognitive-profile.js';
import { ConfidenceEstimator, ConfidenceReport } from './confidence-estimator.js';
import { MetaReasoner, MetaDecision, MetaReasoningContext } from './meta-reasoner.js';
import { StrategySelector, StrategyConfig, TaskProfile } from './strategy-selector.js';

export interface MetaCognitiveState {
  profileBuilder: CognitiveProfileBuilder;
  confidence: ConfidenceEstimator;
  metaReasoner: MetaReasoner;
  strategySelector: StrategySelector;
  currentStrategy: StrategyConfig | null;
  lastDecision: MetaDecision | null;
  stepCount: number;
  maxMetaSteps: number;
}

export interface MetaCognitiveInput {
  agentId: string;
  task: TaskProfile;
  currentPlan: string[];
  completedSteps: string[];
  pendingQuestions: string[];
  lastToolResult: string | null;
  toolUsed?: string;
  maxMetaSteps?: number;
}

export interface MetaCognitiveOutput {
  decision: MetaDecision;
  confidence: ConfidenceReport;
  strategy: StrategyConfig;
  profileSummary: {
    topDimensions: Array<{ label: string; strength: number }>;
    topTools: Array<{ toolName: string; avgScore: number }>;
    topFailures: Array<{ pattern: string; count: number }>;
  };
  metaStep: number;
}

export class MetaCognitiveLoop {
  private state: MetaCognitiveState;

  constructor(input: MetaCognitiveInput) {
    // Initialize or load profile
    const profileBuilder = CognitiveProfileBuilder.empty(input.agentId);
    // In real usage, this would load from persistent storage
    profileBuilder.registerPersona('default');

    this.state = {
      profileBuilder,
      confidence: new ConfidenceEstimator(),
      metaReasoner: new MetaReasoner(),
      strategySelector: new StrategySelector(),
      currentStrategy: null,
      lastDecision: null,
      stepCount: 0,
      maxMetaSteps: input.maxMetaSteps || 10,
    };

    // Select initial strategy
    this.state.currentStrategy = this.state.strategySelector.select(input.task);
  }

  /**
   * Run one iteration of the meta-cognitive loop.
   * Returns the decision for the next action.
   */
  iterate(input: Omit<MetaCognitiveInput, 'agentId' | 'maxMetaSteps'>): MetaCognitiveOutput {
    this.state.stepCount++;

    // Step 1: Compute confidence
    const confidenceContext: MetaReasoningContext = {
      taskDescription: input.task.description,
      currentPlan: input.currentPlan,
      completedSteps: input.completedSteps,
      pendingQuestions: input.pendingQuestions,
      lastToolResult: input.lastToolResult,
      confidenceReport: null, // will be computed
      profile: this.state.profileBuilder.build(),
      maxSteps: this.state.maxMetaSteps,
      currentStep: this.state.stepCount,
    };

    const confidence = this.state.metaReasoner.computeConfidence(confidenceContext);

    // Step 2: Meta-decide
    const decision = this.state.metaReasoner.decide(confidenceContext);

    // Step 3: Update profile with recent result
    if (input.lastToolResult) {
      const resultQuality = this.state.metaReasoner.estimateResultQuality(input.lastToolResult);
      this.state.metaReasoner.updateProfile(
        this.state.profileBuilder,
        input.task.taskType,
        resultQuality,
        input.toolUsed,
      );
    }

    // Step 4: Build output
    const profile = this.state.profileBuilder.build();
    const output: MetaCognitiveOutput = {
      decision,
      confidence,
      strategy: this.state.currentStrategy!,
      profileSummary: {
        topDimensions: profile.getTopDimensions(3).map(d => ({ label: d.label, strength: d.strength })),
        topTools: profile.getTopTools(3).map(t => ({ toolName: t.toolName, avgScore: t.avgScore })),
        topFailures: profile.getTopFailureModes(3).map(f => ({ pattern: f.pattern, count: f.count })),
      },
      metaStep: this.state.stepCount,
    };

    return output;
  }

  /**
   * Check if the meta-cognitive loop should terminate.
   */
  shouldTerminate(output: MetaCognitiveOutput): boolean {
    // Terminate if decision is 'stop' with high confidence
    if (output.decision.action === 'stop' && output.decision.confidence >= 0.85) {
      return true;
    }

    // Terminate if we've reached max steps
    if (this.state.stepCount >= this.state.maxMetaSteps) {
      return true;
    }

    // Terminate if decision is 'ask_human' (escalated)
    if (output.decision.action === 'ask_human') {
      return true;
    }

    return false;
  }

  /**
   * Get the current state snapshot.
   */
  getStateSnapshot(): {
    stepCount: number;
    strategy: StrategyConfig | null;
    profile: CognitiveProfile;
  } {
    return {
      stepCount: this.state.stepCount,
      strategy: this.state.currentStrategy,
      profile: this.state.profileBuilder.build(),
    };
  }
}
