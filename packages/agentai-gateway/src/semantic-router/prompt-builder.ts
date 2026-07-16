/**
 * PromptBuilder: 构造语义路由 prompt
 * 从 LLM 获取最佳技能匹配的意图分析结果
 *
 * 输入: 用户消息 + 技能描述列表 (含 KB snippet)
 * 输出: 结构化的 JSON prompt
 */

import { SkillDescriptor } from '../skill-orchestrator';

// 每个 skill 的描述限 500 字，防止 prompt 过长
const MAX_SKILL_DESC_LENGTH = 500;

export interface RoutingPromptData {
  userInput: string;
  skillsContext: string;     // 所有技能描述的拼接
  instructions: string;      // 分析指令
}

export class PromptBuilder {
  /**
   * 构建语义路由 prompt 所需的上下文数据
   */
  static buildContext(skills: SkillDescriptor[]): {
    skillsJson: string;
    skillsSummary: string;
    instructions: string;
  } {
    // 截取每个 skill 的描述，不超过 MAX_SKILL_DESC_LENGTH
    const enrichedSkills = skills.map(s => ({
      name: s.name,
      category: s.category,
      tags: s.tags,
      // trunc 描述，去掉 markdown 格式的多余空行
      description: this.truncateDescription(s.description || '', MAX_SKILL_DESC_LENGTH),
    }));

    const skillsJson = JSON.stringify(enrichedSkills, null, 2);
    const skillsSummary = `${enrichedSkills.length} 个技能:\n` +
      enrichedSkills.map(s => `  - [${s.category}] ${s.name}: ${s.description.slice(0, 80)}...`).join('\n');

    const instructions = `你是一个意图路由器，负责分析用户的自然语言请求并匹配最相关的 AI 技能。

## 技能列表
${skillsSummary}

## 分析规则
1. 仔细阅读用户输入，理解其真实意图
2. 从上面的技能列表中选择一个最匹配的技能名称
3. 给出匹配信心度 (0.0-1.0)
4. 简短说明匹配理由

## 输出格式
必须返回如下 JSON 格式（不要包含任何其他文本）:
{
  "skill": "<技能名称>",
  "confidence": <0.0-1.0 之间的浮点数>,
  "reason": "<简短匹配理由>"
}

## 注意事项
- 如果用户意图不明确或没有匹配的技能，返回 {"skill": "", "confidence": 0.0, "reason": "无匹配"}
- 对于模糊意图，优先匹配覆盖面最广的技能
- 技能描述中包含 KB snippet 说明该技能涉及专业知识库`;

    return { skillsJson, skillsSummary, instructions };
  }

  /**
   * 构造完整的 prompt 字符串
   */
  static buildPrompt(userInput: string, skills: SkillDescriptor[]): string {
    const { skillsSummary, instructions } = this.buildContext(skills);
    return `用户消息: "${userInput}"\n\n${instructions}`;
  }

  /**
   * 截断技能描述，保持语义完整性
   */
  private static truncateDescription(desc: string, maxLength: number): string {
    if (desc.length <= maxLength) return desc;
    // 尝试在句子边界截断
    const truncated = desc.substring(0, maxLength);
    const lastPeriod = truncated.lastIndexOf('。');
    const lastNewline = truncated.lastIndexOf('\n');
    const boundaryIdx = Math.max(lastPeriod, lastNewline, maxLength - 20);
    return desc.substring(0, boundaryIdx) + '...';
  }
}
