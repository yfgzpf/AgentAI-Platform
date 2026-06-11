/**
 * Agent Spawner — 智能体技能调度器
 * ----------------------------------------------------
 * 混合方案 B: 复杂技能 (多步推理/多工具编排) → 独立 agent
 *
 * 与 subagent.ts 的区别:
 *   - subagent.ts: 固定类型 (explore/research/review), 硬编码工具集
 *   - spawner.ts: 动态技能 → 从 SkillLoader 读取 → 自动构建受限工具集
 *
 * 核心能力:
 *   1. 读取 SkillLoader 注册的技能
 *   2. 根据用户消息自动匹配技能
 *   3. 为每个技能构建受限的 ToolRegistry
 *   4. 注入技能专属系统提示
 *   5. 支持超时和资源限制
 */

import { AgentAILoop } from '../agentai-loop.js';
import { AgentAIRouter } from '../llm-router.js';
import { ToolRegistry } from '../tool-registry.js';
import { matchSkills, getSkillSystemPrompt, getSkill, getAllSkills } from './loader.js';
import type { SkillMeta } from './loader.js';
import { SUBAGENT_TIMEOUT_MS, SUBAGENT_MAX_ITERATIONS } from '../resource-limits.js';

/** 技能执行结果 */
export interface SkillResult {
  skillName: string;
  success: boolean;
  output: string;
  durationMs: number;
  iterations: number;
  error?: string;
}

/** 技能执行选项 */
export interface SkillOptions {
  /** 指定技能名称 (不指定则自动匹配) */
  skillName?: string;
  /** 用户消息 */
  message: string;
  /** 最大迭代次数 */
  maxIterations?: number;
  /** 超时时间 (ms) */
  timeoutMs?: number;
  /** 用户 ID */
  userId?: string;
  /** 工作空间 */
  workspace?: string;
}

/**
 * 执行技能
 * 1. 匹配技能 (如果未指定)
 * 2. 构建受限工具集
 * 3. 注入技能系统提示
 * 4. 启动 AgentAILoop
 */
export async function executeSkill(
  opts: SkillOptions,
  router: AgentAIRouter,
  registry: ToolRegistry,
): Promise<SkillResult> {
  const t0 = Date.now();
  const userId = opts.userId || 'default';
  const workspace = opts.workspace || process.cwd();
  const maxIterations = opts.maxIterations || SUBAGENT_MAX_ITERATIONS;
  const timeoutMs = opts.timeoutMs || SUBAGENT_TIMEOUT_MS;

  try {
    // 1. 匹配技能
    let skill: SkillMeta | undefined;
    if (opts.skillName) {
      const { getSkill } = await import('./loader.js');
      skill = getSkill(opts.skillName);
    } else {
      const matched = matchSkills(opts.message, 1);
      skill = matched[0];
    }

    if (!skill) {
      return {
        skillName: opts.skillName || '(auto)',
        success: false,
        output: 'No matching skill found',
        durationMs: Date.now() - t0,
        iterations: 0,
      };
    }

    // 2. 构建受限工具集
    const allTools = registry.list();
    const allowedTools = skill.tools.length > 0
      ? skill.tools
      : ['read_file', 'list_directory', 'search_files']; // 默认工具集
    const filtered = allTools.filter(t => allowedTools.includes(t.name));
    const subRegistry = new ToolRegistry();
    for (const t of filtered) subRegistry.register(t);

    // 3. 注入技能系统提示
    const skillPrompt = buildSkillPrompt(skill);
    const messages = [
      { role: 'system' as const, content: skillPrompt },
    ];

    // 4. 启动 AgentAILoop (带超时)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const loop = new AgentAILoop(router, subRegistry, messages, {
      maxIterations,
      userId,
      workspace,
      abortSignal: controller.signal,
    });

    const response = await loop.run(opts.message);
    clearTimeout(timeoutId);

    return {
      skillName: skill.name,
      success: true,
      output: response.content || '(no output)',
      durationMs: Date.now() - t0,
      iterations: response.iterations || 0,
    };
  } catch (e: any) {
    return {
      skillName: opts.skillName || '(auto)',
      success: false,
      output: '',
      durationMs: Date.now() - t0,
      iterations: 0,
      error: e.message || String(e),
    };
  }
}

/**
 * 并发执行多个技能
 */
export async function executeSkillsConcurrently(
  skills: SkillMeta[],
  message: string,
  router: AgentAIRouter,
  registry: ToolRegistry,
  opts?: { userId?: string; workspace?: string },
): Promise<SkillResult[]> {
  const promises = skills.map(skill =>
    executeSkill(
      { skillName: skill.name, message, userId: opts?.userId, workspace: opts?.workspace },
      router,
      registry,
    ),
  );

  const results = await Promise.allSettled(promises);
  return results.map((r, i) => {
    if (r.status === 'fulfilled') {
      return r.value;
    }
    return {
      skillName: skills[i]?.name || '(unknown)',
      success: false,
      output: '',
      durationMs: 0,
      iterations: 0,
      error: String(r.reason?.message || r.reason),
    };
  });
}

/**
 * 构建技能专属系统提示
 */
function buildSkillPrompt(skill: SkillMeta): string {
  const lines: string[] = [
    `# Skill: ${skill.name}`,
    '',
    skill.description,
    '',
  ];

  if (skill.tools.length > 0) {
    lines.push('## 授权工具');
    lines.push('你只能使用以下工具:');
    for (const tool of skill.tools) {
      lines.push(`- ${tool}`);
    }
    lines.push('');
  }

  lines.push(
    '## 执行规则',
    '1. 专注于完成技能描述中的任务',
    '2. 不要做超出授权范围的操作',
    '3. 完成后给出简洁的结果摘要',
    '4. 如果缺少必要信息，主动使用工具获取',
  );

  return lines.join('\n');
}

/**
 * 自动发现并推荐技能
 * 依赖启动时的 scanProjectSkills() 填充的内存注册表, 避免重复扫描文件系统
 */
export function discoverAndRecommend(message: string): SkillMeta[] {
  // matchSkills 内部调用 getAllSkills() 从内存 skillRegistry 获取
  const matched = matchSkills(message, 5);
  return matched;
}

/**
 * 获取技能列表 (给前端用)
 * 从内存 skillRegistry 获取, 不重复扫描文件系统
 */
export function listAvailableSkills(): Array<{
  name: string;
  description: string;
  category: string;
  tools: string[];
  triggers: string[];
}> {
  const allSkills = getAllSkills();

  // 去重
  const seen = new Set<string>();
  return allSkills
    .filter(s => {
      if (seen.has(s.name)) return false;
      seen.add(s.name);
      return true;
    })
    .map(s => ({
      name: s.name,
      description: s.description,
      category: s.category,
      tools: s.tools,
      triggers: s.triggers,
    }));
}
