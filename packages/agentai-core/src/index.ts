/**
 * AgentAI Core 占位
 * 阶段 2 落地
 */
export const VERSION = '0.1.0-alpha.1';

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  soul: string; // SOUL.md 内容
  tools: string[];
}

export class AgentCore {
  private agents = new Map<string, AgentConfig>();

  register(agent: AgentConfig): void {
    this.agents.set(agent.id, agent);
    console.info(`[Core] Agent registered: ${agent.id}`);
  }

  get(id: string): AgentConfig | undefined {
    return this.agents.get(id);
  }

  list(): AgentConfig[] {
    return Array.from(this.agents.values());
  }
}

export const core = new AgentCore();
