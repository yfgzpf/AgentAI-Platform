/**
 * 反思模块
 * 从 agentai-loop.ts 提取 reflectSession 相关逻辑
 */

import { AgentAIRouter } from '../llm-router.js';
import { ReflectionOptions } from './types.js';

/**
 * 执行会话反思
 * 在任务完成后分析执行过程，提取经验教训
 */
export async function reflectSession(
  router: AgentAIRouter,
  options: ReflectionOptions
): Promise<void> {
  const {
    userMessage,
    finalResponse,
    toolCalls,
    iterations,
    success,
    reflectEvery,
    userId,
    workspace,
    taskType,
    industry,
    keywords
  } = options;

  // 检查是否需要反思
  if (iterations % reflectEvery !== 0 && iterations < reflectEvery) {
    return;
  }

  console.log(`[reflection] 🧠 执行会话反思 (iterations=${iterations})`);

  try {
    // 动态导入 reflector 模块
    const { reflect } = await import('../reflector.js');
    const { detectTaskType, extractKeywords } = await import('../system-prompt-lite.js');
    const { userModel } = await import('../user-model.js');

    const reflectTaskType = detectTaskType(userMessage);
    const reflectIndustry = userModel.get(userId).identity.industry || 'general';
    const reflectKeywords = extractKeywords(userMessage);

    await reflect(router, {
      userMessage,
      finalResponse,
      toolCalls,
      iterations,
      success,
    }, {
      reflectEvery,
      userId,
      workspace,
      taskType: reflectTaskType,
      industry: reflectIndustry,
      keywords: reflectKeywords,
    });

    // 系统管控员: 记录 Reflector 诊断结果到动态能力矩阵
    try {
      const { getTracker } = await import('../governor/runtime-capability-tracker.js');
      const { readEvolution } = await import('../evolution.js');
      
      const recent = readEvolution(1);
      const lastEntry = recent[recent.length - 1];
      
      if (lastEntry?.diagnosisType) {
        // 这里简化处理，实际应该传入 modelId
        // getTracker().recordReflectorDiagnosis(modelId, taskType, lastEntry.diagnosisType);
      }
    } catch { /* tracker 容错 */ }

  } catch (e) {
    console.warn('[reflection] import/exec failed:', (e as Error).message);
  }
}

/**
 * 简化的反思记录
 * 用于快速记录执行摘要，不调用 LLM
 */
export function recordSessionSummary(
  userId: string,
  workspace: string,
  summary: {
    userGoal: string;
    files: string[];
    toolsUsed: string[];
    iterations: number;
    success: boolean;
  }
): void {
  try {
    // 写入项目记忆
    const { writeProjectMemory } = require('../project-memory.js');
    writeProjectMemory(workspace, {
      type: 'session_summary',
      userId,
      ...summary,
      timestamp: Date.now(),
    });
  } catch {
    // 记忆写入失败不影响主流程
  }
}

/**
 * 提取工具调用中的文件修改
 */
export function extractModifiedFiles(toolResults: Array<{ content?: string }>): string[] {
  const files = new Set<string>();
  
  for (const result of toolResults) {
    const content = typeof result.content === 'string' ? result.content : '';
    
    // 匹配文件路径模式
    const patterns = [
      /(?:wrote|created|modified|edited|Written|Created)\s+([\w./\\-]+\.\w+)/gi,
      /(?:file_path|path|文件)['":\s]*([A-Za-z]:[\\\/][^\s'"),]+|[^\s'"),]+\.\w{1,5})/gi,
    ];
    
    for (const pattern of patterns) {
      const matches = content.matchAll(pattern);
      for (const match of matches) {
        if (match[1]) {
          files.add(match[1].replace(/^(?:wrote|created|modified|edited|Written|Created)\s+/i, ''));
        }
      }
    }
  }
  
  return [...files].slice(0, 10); // 最多返回 10 个文件
}

/**
 * 提取工具调用中的错误
 */
export function extractErrors(toolResults: Array<{ content?: string; ok?: boolean }>): string[] {
  return toolResults
    .filter(r => r.ok === false || (typeof r.content === 'string' && r.content.startsWith('[ERROR]')))
    .map(r => {
      const content = typeof r.content === 'string' ? r.content : '';
      return content.slice(0, 100); // 截取前 100 字符
    })
    .slice(0, 5); // 最多返回 5 个错误
}
