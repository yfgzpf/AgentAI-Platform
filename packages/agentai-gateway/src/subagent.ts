import { AgentAILoop } from './agentai-loop.js';
import { AgentAIRouter } from './llm-router.js';
import { ToolRegistry } from './tool-registry.js';

const SUBAGENT_PROMPTS: Record<string, string> = {
  explore: `You are a codebase exploration agent. Read files, list directories, search content.
Report your findings with file:line citations. Be thorough but concise.`,
  research: `You are a research agent. Use web_search + web_fetch to find information.
Cite sources (URLs). Synthesize findings into a structured answer.`,
  review: `You are a code review agent. Read changed files and flag correctness, security, and
edge cases. Tag issues by severity.`,
  'security-review': `You are a security review agent. Focus on:
- SQL injection, XSS, CSRF vulnerabilities
- Authentication/authorization flaws
- Data exposure and privacy issues
- Input validation gaps
- Dependency vulnerabilities
Report findings with severity (critical/high/medium/low) and remediation steps.`,
};

const SUBAGENT_TOOLS: Record<string, string[]> = {
  explore: ['list_directory', 'read_file', 'search_files', 'search_content', 'get_file_info', 'get_symbols'],
  research: ['web_search', 'web_fetch'],
  review: ['read_file', 'search_content', 'get_symbols', 'list_directory'],
  'security-review': ['read_file', 'search_content', 'get_symbols', 'list_directory', 'search_files'],
};

export async function runSubagent(
  type: string,
  task: string,
  router: AgentAIRouter,
  registry: ToolRegistry,
  userId: string,
  workspace: string,
): Promise<string> {
  if (!SUBAGENT_PROMPTS[type]) return `Unknown subagent type: ${type}`;
  const allowed = SUBAGENT_TOOLS[type] || [];
  const allTools = registry.list();
  const filtered = allTools.filter(t => allowed.includes(t.name));
  const subRegistry = new ToolRegistry();
  for (const t of filtered) subRegistry.register(t);

  const loop = new AgentAILoop(router, subRegistry, [], {
    maxIterations: 10,
    userId,
    workspace,
  });

  const response = await loop.run(task);
  return response.content || '(no output)';
}
