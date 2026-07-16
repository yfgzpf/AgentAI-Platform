/**
 * SkillManager — 技能自动检测 + 强制调用管理器
 * ==================================================
 * 包装 SkillOrchestrator, 提供给 agentai-loop 使用的高级接口
 *
 * 与 SkillOrchestrator 的区别:
 *   - SkillOrchestrator: 技能注册表 + 调度执行 (低层)
 *   - SkillManager: 意图匹配 + 强制调用注入 (高层, 给 LLM 看)
 *
 * 修复 2026-07-16: 此文件之前不存在, agentai-loop.ts 引用却 try/catch 静默吞掉,
 * 导致技能自动检测失效. 本文件用 SkillOrchestrator 的实例填充.
 */
import { skillOrchestrator, type SkillDescriptor } from './skill-orchestrator.js';

export interface SkillMatch {
  skill: SkillDescriptor;
  confidence: number;
  matchedTriggers: string[];
  matchedKeywords: string[];
}

class SkillManager {
  /**
   * 匹配用户消息 → 最可能调用的技能
   * 返回 confidence 0-1, >=0.6 视为可强制调用
   */
  matchIntent(userMessage: string): SkillMatch | null {
    if (!userMessage || userMessage.length < 3) return null;
    const matches = skillOrchestrator.smartDispatch(userMessage, 1);
    if (matches.length === 0) return null;

    const top = matches[0]!;
    const skill = skillOrchestrator.get(top.name);
    if (!skill) return null;

    // smartDispatch 返回的 score 是累积分 (最高 30+), 归一化到 0-1
    const confidence = Math.min(1, top.score / 30);

    return {
      skill,
      confidence,
      matchedTriggers: top.triggers || [],
      matchedKeywords: [],
    };
  }

  /**
   * 生成给 LLM 看的"技能调用提示"文本
   * 当 confidence >= 0.8 时, LLM 应直接调用该技能
   */
  generateInvocationPrompt(match: SkillMatch): string {
    return `
【检测到匹配的技能: ${match.skill.name}】
置信度: ${(match.confidence * 100).toFixed(0)}%
描述: ${match.skill.description}
匹配的触发词: ${match.matchedTriggers.join(', ') || '(无)'}

**指引**: 请立即调用该技能完成用户需求. 调用方式:
- 如果 LLM 工具可用, 通过 \`execute_skill\` 工具调用
- 否则, 通过 \`fetch('/v1/skills/${match.skill.name}/execute', ...)\` 调用
`;
  }

  /** 获取所有技能 */
  list(): SkillDescriptor[] {
    return skillOrchestrator.list();
  }

  /** 统计 */
  getStats(): { total: number; byCategory: Record<string, number> } {
    const all = skillOrchestrator.list();
    const byCategory: Record<string, number> = {};
    for (const s of all) {
      byCategory[s.category] = (byCategory[s.category] || 0) + 1;
    }
    return { total: all.length, byCategory };
  }

  /** 扫描目录并注册技能 (转发到 orchestrator) */
  scanDirectory(dir: string): number {
    return skillOrchestrator.scanDirectory(dir);
  }
}

export const skillManager = new SkillManager();
