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

/**
 * CognitiveProfile — a cognitive fingerprint for an agent.
 *
 * Implemented as a class so that the same instance exposes both the raw
 * data fields (dimensions/toolPatterns/failureModes) and the derived
 * `getTop*` query helpers. Callers throughout the meta-cognitive system
 * rely on `.getTopTools()`, `.getTopDimensions()`, `.getTopFailureModes()`
 * being available on the profile object itself (not only on the builder).
 */
export class CognitiveProfile {
  agentId: string;
  personasUsed: string[];        // which personas this agent has tried
  dimensions: CognitiveDimension[];
  toolPatterns: ToolUsagePattern[];
  failureModes: FailureMode[];
  createdAt: string;
  updatedAt: string;

  constructor(data: {
    agentId: string;
    personasUsed: string[];
    dimensions: CognitiveDimension[];
    toolPatterns: ToolUsagePattern[];
    failureModes: FailureMode[];
    createdAt: string;
    updatedAt: string;
  }) {
    this.agentId = data.agentId;
    this.personasUsed = data.personasUsed;
    this.dimensions = data.dimensions;
    this.toolPatterns = data.toolPatterns;
    this.failureModes = data.failureModes;
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
  }

  /** Top-N strongest cognitive dimensions (by descending strength). */
  getTopDimensions(n = 3): CognitiveDimension[] {
    return [...this.dimensions].sort((a, b) => b.strength - a.strength).slice(0, n);
  }

  /** Top-N best-performing tools (by descending average score). */
  getTopTools(n = 3): ToolUsagePattern[] {
    return [...this.toolPatterns].sort((a, b) => b.avgScore - a.avgScore).slice(0, n);
  }

  /** Top-N most frequent failure modes (by descending count). */
  getTopFailureModes(n = 3): FailureMode[] {
    return [...this.failureModes].sort((a, b) => b.count - a.count).slice(0, n);
  }
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

  private constructor(data: ConstructorParameters<typeof CognitiveProfile>[0]) {
    this.profile = new CognitiveProfile(data);
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
    // Return a real CognitiveProfile instance so callers get the `getTop*`
    // query helpers along with the data fields.
    return new CognitiveProfile({ ...this.profile, dimensions: [...this.profile.dimensions], toolPatterns: [...this.profile.toolPatterns], failureModes: [...this.profile.failureModes], personasUsed: [...this.profile.personasUsed] });
  }

  /** Delegate to the built profile so existing builder-based callers keep working. */
  getTopDimensions(n = 3): CognitiveDimension[] {
    return this.build().getTopDimensions(n);
  }

  getTopTools(n = 3): ToolUsagePattern[] {
    return this.build().getTopTools(n);
  }

  getTopFailureModes(n = 3): FailureMode[] {
    return this.build().getTopFailureModes(n);
  }
}
