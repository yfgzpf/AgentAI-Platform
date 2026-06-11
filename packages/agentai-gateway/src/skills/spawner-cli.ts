// @ts-nocheck
/**
 * Skill Spawner CLI - 独立运行技能执行
 * 用法: npx tsx skills/spawner-cli.ts <skill-name> [message] [target-file]
 */
import { executeSkill } from './spawner.js';
import { AgentAIRouter } from '../llm-router.js';
import { ToolRegistry } from '../tool-registry.js';

export async function runCLI() {
  const skillName = process.argv[2];
  const message = process.argv[3] || '帮我实现';
  const targetFile = process.argv[4];

  if (!skillName) {
    console.error('Usage: npx tsx skills/spawner-cli.ts <skill-name> [message] [target-file]');
    process.exit(1);
  }

  const router = new AgentAIRouter();
  const registry = new ToolRegistry();

  // 注册 EXTRA_TOOLS (python, bash, read, write, list_dir, etc.)
  const { EXTRA_TOOLS, EXTRA_HANDLERS } = await import('../tools.js');
  for (const spec of EXTRA_TOOLS) {
    registry.register({
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters,
      parallelSafe: spec.parallelSafe,
      riskLevel: spec.riskLevel,
      handler: EXTRA_HANDLERS[spec.name],
    });
  }

  try {
    const result = await executeSkill({
      skillName,
      message,
      targetFile,
      router,
      registry,
      userId: 'cli',
      workspace: process.cwd(),
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  } catch (e: any) {
    console.error(`[spawner-cli] Error: ${e.message}`);
    process.exit(1);
  }
}

// 独立运行检测
if (process.argv[1]?.includes('spawner-cli')) {
  runCLI();
}