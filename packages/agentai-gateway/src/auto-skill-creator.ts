/**
 * Auto Skill Creator — 复杂任务完成后自动生成 SKILL.md
 * ----------------------------------------------------
 * 对标 WorkBuddy: 检测多步复杂任务(8+工具调用)后,
 * 自动提取工作流模式 → 生成可复用的 SKILL.md
 *
 * 2026-06-27: 新增, 消除"AI不会自动创建技能"差距
 */

import fs from 'fs';
import path from 'path';

/** 工具调用记录 (从 loop appendOnlyLog 提取) */
export interface ToolCallEntry {
  name: string;
  args: string;
  result: string;
  success: boolean;
}

/** 工作流描述 */
export interface WorkflowPattern {
  title: string;
  description: string;
  category: 'coding' | 'research' | 'design' | 'fix' | 'refactor';
  toolSequence: string[];        // 工具调用顺序
  filesTouched: string[];        // 涉及的文件
  stepCount: number;
  summary: string;
}

// ─────────────────────────────────────────────
// 主入口: 从 loop 后置处理器调用
// ─────────────────────────────────────────────

/**
 * 分析工作流模式 — 从工具调用记录中提取可复用的工作流
 */
export function extractWorkflow(toolCalls: ToolCallEntry[], filesTouched: string[]): WorkflowPattern | null {
  if (toolCalls.length < 8) return null; // 少于 8 步不算复杂任务

  const toolNames = toolCalls.map(t => t.name);
  const uniqueTools = [...new Set(toolNames)];
  if (uniqueTools.length < 3) return null; // 只有 1-2 种工具不算工作流

  // 判断类型: 是编码/修复/搜索/设计?
  const category = detectCategory(toolNames, filesTouched);

  // 生成摘要: 前 5 个工具的去重序列
  const sequence = toolNames.slice(0, 10);

  const summary = buildSummary(category, toolNames, filesTouched);

  return {
    title: summary.slice(0, 60),
    description: summary,
    category,
    toolSequence: sequence,
    filesTouched: [...new Set(filesTouched)].slice(0, 10),
    stepCount: toolCalls.length,
    summary,
  };
}

/**
 * 自动生成 SKILL.md — 写入工作区技能目录
 * 返回创建的文件路径, 或 null
 */
export async function createSkillFromWorkflow(
  workspace: string,
  pattern: WorkflowPattern,
): Promise<string | null> {
  try {
    // 1. 确定技能名 (用 category + 序号)
    const skillsDir = path.join(workspace, '.agentai', 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });

    // 用 category 生成技能名
    const baseName = pattern.category === 'coding' ? '编码'
      : pattern.category === 'refactor' ? '重构'
      : pattern.category === 'fix' ? '修复'
      : pattern.category === 'research' ? '研究'
      : '设计';

    // 找唯一名
    let index = 1;
    let skillName = `${baseName}-工作流`;
    while (fs.existsSync(path.join(skillsDir, skillName, 'SKILL.md'))) {
      index++;
      skillName = `${baseName}-工作流-${index}`;
    }

    const skillDir = path.join(skillsDir, skillName);
    fs.mkdirSync(skillDir, { recursive: true });

    // 2. 提取步骤序列
    const uniqueSequence = [...new Set(pattern.toolSequence)];
    const toolStepsMd = uniqueSequence.map((t, i) =>
      `  ${i + 1}. 使用 \`${t}\` — 见工具说明`
    ).join('\n');

    // 3. 写 SKILL.md
    const skillContent = `---
name: ${skillName}
description: ${pattern.summary.slice(0, 150)}
category: ${pattern.category}
agent_created: true
created_at: ${new Date().toISOString()}
step_count: ${pattern.stepCount}
---

# ${skillName}

自动从复杂任务中提取的工作流模式。

## 触发条件

- 任务类型: ${pattern.category}
- 工具步骤数: ${pattern.stepCount}
- 涉及工具: ${pattern.toolSequence.slice(0, 5).join(', ')}

## 工作流步骤

经分析，该类型任务通常包含以下步骤:

${toolStepsMd}

## 涉及文件类型

${pattern.filesTouched.length > 0
    ? pattern.filesTouched.map(f => `- \`${f}\``).join('\n')
    : '- 无特定文件类型'}

## 摘要

${pattern.summary}
`;

    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillContent, 'utf-8');

    console.log(`[auto-skill] ✅ 自动创建技能: ${skillName} (${pattern.stepCount} 步)`);
    return path.join(skillDir, 'SKILL.md');
  } catch (e) {
    console.warn('[auto-skill] 创建失败:', (e as Error).message);
    return null;
  }
}

// ─────────────────────────────────────────────
// 内部工具
// ─────────────────────────────────────────────

function detectCategory(toolNames: string[], files: string[]): WorkflowPattern['category'] {
  const nameSet = new Set(toolNames);

  // 修复类
  if (nameSet.has('fix_error') || nameSet.has('debug') || nameSet.has('run_test') || nameSet.has('run_code')) {
    return 'fix';
  }
  // 编码类
  if (nameSet.has('write_file') || nameSet.has('edit_file') || nameSet.has('create_file') || nameSet.has('generate')) {
    return 'coding';
  }
  // 研究类
  if (nameSet.has('web_search') || nameSet.has('web_fetch') || nameSet.has('read_file')) {
    return 'research';
  }
  // 重构类
  if (nameSet.has('refactor') || (nameSet.has('rename') && nameSet.has('edit_file'))) {
    return 'refactor';
  }
  // 默认
  return 'coding';
}

function buildSummary(
  category: WorkflowPattern['category'],
  toolNames: string[],
  files: string[],
): string {
  const toolSummary = [...new Set(toolNames)].slice(0, 5).join('、');
  const fileSummary = files.length > 0 ? `，涉及 ${[...new Set(files)].length} 个文件` : '';
  const catLabel: Record<string, string> = {
    coding: '编码', refactor: '重构', fix: '修复',
    research: '研究', design: '设计',
  };
  return `[${catLabel[category] || '通用'}] ${toolSummary} 等 ${toolNames.length} 步工具调用${fileSummary}`;
}

/**
 * 检查并触发技能创建 — 供 loop run() 末尾调用
 */
export async function autoCreateSkillOnComplexTask(
  workspace: string,
  toolCalls: ToolCallEntry[],
  filesTouched: string[],
): Promise<string | null> {
  const pattern = extractWorkflow(toolCalls, filesTouched);
  if (!pattern) return null;

  // 检查是否已有类似技能 (避免重复)
  const skillsDir = path.join(workspace, '.agentai', 'skills');
  if (fs.existsSync(skillsDir)) {
    const existing = fs.readdirSync(skillsDir).filter(d => {
      const skillFile = path.join(skillsDir, d, 'SKILL.md');
      if (!fs.existsSync(skillFile)) return false;
      const content = fs.readFileSync(skillFile, 'utf-8');
      // 如果已有同类别 + 相近工具序列的 skill, 跳过
      return content.includes(pattern.category) &&
             pattern.toolSequence.some(t => content.includes(t));
    });
    if (existing.length > 0) {
      console.log(`[auto-skill] 已有相似技能: ${existing[0]}, 跳过创建`);
      return null;
    }
  }

  return await createSkillFromWorkflow(workspace, pattern);
}

/**
 * 从 appendOnlyLog 提取工具调用记录
 */
export function extractToolCallsFromLog(
  appendOnlyLog: Array<{ role: string; content: any; name?: string }>,
): { toolCalls: ToolCallEntry[]; filesTouched: string[] } {
  const toolCalls: ToolCallEntry[] = [];
  const filesSet = new Set<string>();

  for (const msg of appendOnlyLog) {
    if (msg.role === 'tool' && msg.name) {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      toolCalls.push({
        name: msg.name,
        args: '',
        result: content.slice(0, 200),
        success: true,
      });
      // 从工具结果中提取文件名
      const fileMatches = content.match(/(?:wrote|created|modified|edited|read|deleted)\s+([\w./\\-]+\.\w+)/gi);
      if (fileMatches) {
        fileMatches.forEach(m => {
          const f = m.replace(/^(?:wrote|created|modified|edited|read|deleted)\s+/i, '').trim();
          if (f && f.length < 200) filesSet.add(f);
        });
      }
    }
  }

  return { toolCalls, filesTouched: [...filesSet] };
}
