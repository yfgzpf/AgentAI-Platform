import { AgentAILoop } from './agentai-loop.js';
import { AgentAIRouter } from './llm-router.js';
import { ToolRegistry } from './tool-registry.js';

/** 免费模型列表 — 这些模型不支持子智能体并行 (配额有限, 并发易熔断)
 *  与 llm-router.ts 的 FREE_POOL 保持同步 */
const FREE_PROVIDERS = new Set(['agentai', 'zhipu', 'dxnt', 'sensenova', 'longcat', 'nvidia']);

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
  parentModel?: string,
): Promise<string> {
  if (!SUBAGENT_PROMPTS[type]) return `Unknown subagent type: ${type}`;
  const allowed = SUBAGENT_TOOLS[type] || [];
  const allTools = registry.list();
  const filtered = allTools.filter(t => allowed.includes(t.name));
  const subRegistry = new ToolRegistry();
  for (const t of filtered) subRegistry.register(t);

  // 子智能体模型策略: 免费模型禁用子智能体并行, 商业模型以本体为主
  let subModel = parentModel || 'agentai';
  if (parentModel && FREE_PROVIDERS.has(parentModel)) {
    // 免费模型: 子智能体也用免费模型 (串行执行, 不并发)
    // 但如果主Agent已经熔断, 按优先级尝试切换
    const providerStats = (router as any)?.providers?.get(parentModel);
    if (providerStats?.tripped) {
      // 按优先级尝试所有免费模型 (排除已熔断的)
      const freePriority = ['agentai', 'zhipu', 'dxnt', 'sensenova', 'longcat', 'nvidia'];
      const keyMap: Record<string, string> = {
        agentai: 'AGENTAI_API_KEY', zhipu: 'ZHIPU_API_KEY',
        dxnt: 'DXNT_API_KEY', sensenova: 'SENSENOVA_API_KEY',
        longcat: 'LONGCAT_API_KEY', nvidia: 'NVIDIA_API_KEY',
      };
      let switched = false;
      for (const alt of freePriority) {
        if (alt === parentModel) continue;
        const altStats = (router as any)?.providers?.get(alt);
        const envKey = keyMap[alt];
        if (altStats && !altStats.tripped && envKey && process.env[envKey]) {
          subModel = alt;
          console.log(`[subagent] parent model ${parentModel} tripped, switching subagent to ${alt}`);
          switched = true;
          break;
        }
      }
      if (!switched) {
        // 所有免费模型都熔断, 尝试商业模型
        const commercialOrder = ['deepseek', 'superapi', 'openai'];
        for (const cp of commercialOrder) {
          const cpStats = (router as any)?.providers?.get(cp);
          const cpKey = cp === 'superapi' ? 'SUPERAPI_API_KEY' : `${cp.toUpperCase()}_API_KEY`;
          if (cpStats && !cpStats.tripped && process.env[cpKey]) {
            subModel = cp;
            console.log(`[subagent] all free models tripped, switching subagent to commercial ${cp}`);
            break;
          }
        }
      }
    }
  }

  const loop = new AgentAILoop(router, subRegistry, [], {
    maxIterations: 10,
    userId,
    workspace,
    model: subModel,
    modelName: subModel === parentModel ? (parentModel === 'sensenova' ? 'sensenova-6.7-flash-lite' : '') : '',
  });

  const response = await loop.run(task);
  return response.content || '(no output)';
}
