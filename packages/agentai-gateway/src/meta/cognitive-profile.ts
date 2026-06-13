/**
 * Cognitive Profile — each Agent's cognitive fingerprint.
 * Records strengths, weak spots, common tool-call patterns, and failure modes.
 */

export interface CognitiveDimension {
  label: string;       // e.g. "reasoning", "code_generation", "web_research"
  strength: number;    // 0–1
  trialCount: number;  // how many trials fed this estimate
}

export interface ToolUsagePattern {
  toolName: string;
  callCount: number;
  avgScore: number;    // average judge score when this tool was used
  avgLatencyMs: number;
}

export interface FailureMode {
  pattern: string;      // e.g. "misses edge_cases_in_math", "hallucinates_urls"
  count: number;
  lastSeen: string;     // ISO timestamp
}

export interface CognitiveProfile {
  agentId: string;
  personasUsed: string[];        // which personas this agent has tried
  dimensions: CognitiveDimension[];
  toolPatterns: ToolUsagePattern[];
  failureModes: FailureMode[];
  createdAt: string;
  updatedAt: string;
}

export class CognitiveProfileBuilder {
  private profile: CognitiveProfile;

  static empty(agentId: string): CognitiveProfileBuilder {
    const now = new Date().toISOString();
    return new CognitiveProfileBuilder({
      agentId,
      personasUsed: [],
      dimensions: [],
      toolPatterns: [],
      failureModes: [],
      createdAt: now,
      updatedAt: now,
    });
  }

  private constructor(profile: CognitiveProfile) {
    this.profile = profile;
  }

  /** Update a dimension's strength using exponential moving average. */
  updateDimension(label: string, score: number): this {
    const existing = this.profile.dimensions.find(d => d.label === label);
    if (existing) {
      const alpha = 1 / (existing.trialCount + 1);
      existing.strength = existing.strength * (1 - alpha) + score * alpha;
      existing.trialCount++;
    } else {
      this.profile.dimensions.push({ label, strength: score, trialCount: 1 });
    }
    this.profile.updatedAt = new Date().toISOString();
    return this;
  }

  /** Record a tool usage event. */
  recordToolUsage(pattern: ToolUsagePattern): this {
    const existing = this.profile.toolPatterns.find(p => p.toolName === pattern.toolName);
    if (existing) {
      existing.callCount += pattern.callCount;
      // weighted average for score and latency
      const total = existing.callCount;
      existing.avgScore = (existing.avgScore * (total - pattern.callCount) + pattern.avgScore * pattern.callCount) / total;
      existing.avgLatencyMs = (existing.avgLatencyMs * (total - pattern.callCount) + pattern.avgLatencyMs * pattern.callCount) / total;
    } else {
      this.profile.toolPatterns.push(pattern);
    }
    this.profile.updatedAt = new Date().toISOString();
    return this;
  }

  /** Log a failure mode. */
  logFailureMode(pattern: string): this {
    const existing = this.profile.failureModes.find(f => f.pattern === pattern);
    if (existing) {
      existing.count++;
      existing.lastSeen = new Date().toISOString();
    } else {
      this.profile.failureModes.push({ pattern, count: 1, lastSeen: new Date().toISOString() });
    }
    this.profile.updatedAt = new Date().toISOString();
    return this;
  }

  /** Register a persona that was used. */
  registerPersona(persona: string): this {
    if (!this.profile.personasUsed.includes(persona)) {
      this.profile.personasUsed.push(persona);
      this.profile.updatedAt = new Date().toISOString();
    }
    return this;
  }

  build(): CognitiveProfile {
    return { ...this.profile };
  }

  getTopDimensions(n = 3): CognitiveDimension[] {
    return [...this.profile.dimensions]
      .sort((a, b) => b.strength - a.strength)
      .slice(0, n);
  }

  getTopTools(n = 3): ToolUsagePattern[] {
    return [...this.profile.toolPatterns]
      .sort((a, b) => b.avgScore - a.avgScore)
      .slice(0, n);
  }

  getTopFailureModes(n = 3): FailureMode[] {
    return [...this.profile.failureModes]
      .sort((a, b) => b.count - a.count)
      .slice(0, n);
  }
}
