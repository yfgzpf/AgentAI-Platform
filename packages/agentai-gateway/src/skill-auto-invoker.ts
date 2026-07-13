/**
 * Skill Auto Invoker - 技能自动调用器
 * 
 * 解决AI不会主动调用技能的问题：
 * 1. 意图识别 - 分析用户消息，匹配最佳技能
 * 2. 自动注入 - 在system prompt中注入技能调用建议
 * 3. 强制触发 - 高置信度时直接触发技能执行
 * 
 * 使用方式：
 * - 在AgentAILoop启动时，分析用户意图
 * - 匹配到高置信度技能时，强制注入调用指令
 * - AI收到指令后，会主动调用技能工具
 */

import { EventEmitter } from 'events';
import { getSkillOrchestrator } from './skill-orchestrator.js';

interface IntentMatch {
  skillName: string;
  confidence: number;
  params: Record<string, any>;
  reason: string;
}

interface SkillTrigger {
  keywords: string[];
  skillName: string;
  paramExtractors?: Record<string, (msg: string) => any>;
}

// 预定义的技能触发规则
const SKILL_TRIGGERS: SkillTrigger[] = [
  {
    keywords: ['小红书', '文案', '配图', '发帖', '笔记'],
    skillName: 'xiaohongshu-content-creator',
  },
  {
    keywords: ['抖音', '视频', '脚本', '短视频'],
    skillName: 'douyin-script-generator',
  },
  {
    keywords: ['装修', '报价', '预算', '设计'],
    skillName: 'decoration-quotation',
  },
  {
    keywords: ['获客', '引流', '客户', '营销'],
    skillName: 'lead-generation-system',
  },
  {
    keywords: ['CAD', '图纸', '设计图', '建模'],
    skillName: 'cad-ai-designer',
  },
  {
    keywords: ['RPA', '自动化', '录制', '回放'],
    skillName: 'browser-automation',
  },
  {
    keywords: ['微信', '公众号', '朋友圈', '私域'],
    skillName: 'wechat-acquisition',
  },
  {
    keywords: ['SEO', '关键词', '排名', '优化'],
    skillName: 'seo-optimizer',
  },
];

export class SkillAutoInvoker extends EventEmitter {
  private triggers: SkillTrigger[] = [...SKILL_TRIGGERS];

  /**
   * 分析用户意图，匹配技能
   */
  analyzeIntent(userMessage: string): IntentMatch | null {
    const msg = userMessage.toLowerCase();
    let bestMatch: IntentMatch | null = null;
    let highestScore = 0;

    for (const trigger of this.triggers) {
      const matchedKeywords = trigger.keywords.filter(kw => msg.includes(kw.toLowerCase()));
      if (matchedKeywords.length === 0) continue;

      // 计算匹配分数
      const score = matchedKeywords.length / trigger.keywords.length;
      
      if (score > highestScore && score >= 0.5) {
        highestScore = score;
        
        // 提取参数
        const params: Record<string, any> = {};
        if (trigger.paramExtractors) {
          for (const [key, extractor] of Object.entries(trigger.paramExtractors)) {
            try {
              params[key] = extractor(userMessage);
            } catch {
              // 忽略提取失败
            }
          }
        }

        bestMatch = {
          skillName: trigger.skillName,
          confidence: score,
          params,
          reason: `匹配关键词: ${matchedKeywords.join(', ')}`,
        };
      }
    }

    return bestMatch;
  }

  /**
   * 生成技能调用指令
   */
  generateInvocationPrompt(match: IntentMatch): string {
    const orchestrator = getSkillOrchestrator();
    const skill = orchestrator.getSkill(match.skillName);
    
    if (!skill) {
      return `【检测到技能匹配】\n建议创建技能: ${match.skillName}\n原因: ${match.reason}\n\n**立即执行**: 调用 discover_or_create_skill 创建并执行此技能。`;
    }

    return `【检测到技能匹配】\n技能: ${skill.name}\n描述: ${skill.description}\n匹配度: ${(match.confidence * 100).toFixed(0)}%\n原因: ${match.reason}\n\n**立即执行**: 调用技能工具 '${match.skillName}' 完成任务，参数: ${JSON.stringify(match.params)}\n\n禁止在内部反复思考"是否调用技能"，立即执行!`;
  }

  /**
   * 检查是否应该强制触发技能
   */
  shouldForceTrigger(match: IntentMatch): boolean {
    // 置信度超过80%时强制触发
    return match.confidence >= 0.8;
  }

  /**
   * 注册自定义触发规则
   */
  registerTrigger(trigger: SkillTrigger): void {
    this.triggers.push(trigger);
  }

  /**
   * 获取所有可用技能列表（用于prompt注入）
   */
  getAvailableSkillsPrompt(): string {
    const orchestrator = getSkillOrchestrator();
    const skills = orchestrator.listSkills();
    
    if (skills.length === 0) {
      return '';
    }

    const skillList = skills.map(s => `- ${s.name}: ${s.description}`).join('\n');
    
    return `【可用技能】\n${skillList}\n\n**重要**: 当用户需求匹配某个技能时，立即调用该技能工具完成，不要自己从零实现!`;
  }
}

// 单例导出
export const skillAutoInvoker = new SkillAutoInvoker();
