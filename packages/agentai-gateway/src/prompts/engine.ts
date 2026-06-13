// ===========================================================================
// src/prompts/engine.ts — Prompt 模板引擎 + Persona 路由
// ===========================================================================
/**
 * 职责：
 *   1. 管理 Prompt 模板库（不同 Persona 对应不同的系统提示模板）
 *   2. 根据用户 query 自动路由到最佳 Persona
 *   3. 填充模板变量，生成最终系统提示
 *   4. 支持模板版本管理 + 评分反馈
 */

import { createHash } from 'crypto';

// ===== 类型 =====

export interface PromptTemplate {
  /** 模板 ID */
  id: string;
  /** Persona 名称 */
  persona: string;
  /** 模板内容（支持 {variable} 占位符） */
  template: string;
  /** 模板变量列表 */
  variables: string[];
  /** 版本号 */
  version: string;
  /** 累计评分 */
  totalScore: number;
  /** 使用次数 */
  usageCount: number;
  /** 平均评分 */
  avgScore: number;
  /** 创建时间 */
  createdAt: string;
}

export interface TemplateFillResult {
  /** 填充后的完整 prompt */
  prompt: string;
  /** 使用的模板 ID */
  templateId: string;
  /** 未填充的变量（调试用） */
  unfilledVariables: string[];
}

export interface PersonaRoute {
  /** Persona 名称 */
  persona: string;
  /** 匹配关键词 */
  keywords: string[];
  /** 优先级（越高越优先） */
  priority: number;
}

// ===== 内置 Persona 路由表 =====
const DEFAULT_ROUTES: PersonaRoute[] = [
  { persona: 'financial_analyst', keywords: ['金融', '投资', '股票', '基金', '债券', '理财', 'stock', 'invest', 'finance'], priority: 10 },
  { persona: 'legal_consultant', keywords: ['法律', '合同', '法规', '诉讼', '合规', 'law', 'legal', 'contract'], priority: 10 },
  { persona: 'tech_advisor', keywords: ['代码', '编程', '架构', 'API', 'debug', 'code', 'tech', 'programming', 'refactor'], priority: 8 },
  { persona: 'data_analyst', keywords: ['数据', '分析', '统计', '报表', '提取', 'data', 'analytics', 'statistics'], priority: 7 },
  { persona: 'code_review', keywords: ['审查', 'review', '检查', '安全审计', 'inspect'], priority: 9 },
  { persona: 'general', keywords: ['总结', '翻译', '解释', '帮助', 'summary', 'translate', 'explain'], priority: 1 },
];

// ===== 内置模板库 =====
const DEFAULT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'tpl_general_v1',
    persona: 'general',
    template: `你是一个智能助手。请用清晰、准确的语言回答用户问题。

用户问题：{query}

请提供有帮助的回答。`,
    variables: ['query'],
    version: '1.0',
    totalScore: 0,
    usageCount: 0,
    avgScore: 0,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'tpl_financial_v1',
    persona: 'financial_analyst',
    template: `你是一位专业的金融分析师。请基于事实和数据回答金融相关问题。

关键原则：
- 不提供具体投资建议（免责声明）
- 引用数据时标注来源
- 区分事实与观点

用户问题：{query}

请提供专业的金融分析。`,
    variables: ['query'],
    version: '1.0',
    totalScore: 0,
    usageCount: 0,
    avgScore: 0,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'tpl_legal_v1',
    persona: 'legal_consultant',
    template: `你是一位法律顾问。请根据法律法规回答问题。

关键原则：
- 不构成正式法律意见
- 引用具体法条时标注法律名称和条款号
- 区分不同司法管辖区的差异

用户问题：{query}

请提供法律参考信息。`,
    variables: ['query'],
    version: '1.0',
    totalScore: 0,
    usageCount: 0,
    avgScore: 0,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'tpl_tech_v1',
    persona: 'tech_advisor',
    template: `你是一位高级技术顾问。请提供专业的技术建议。

关键原则：
- 给出具体的代码示例（如适用）
- 解释权衡取舍
- 考虑性能、安全、可维护性

用户问题：{query}

请提供技术方案。`,
    variables: ['query'],
    version: '1.0',
    totalScore: 0,
    usageCount: 0,
    avgScore: 0,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'tpl_data_v1',
    persona: 'data_analyst',
    template: `你是一位数据分析师。请帮助用户进行数据分析。

关键原则：
- 输出结构化 JSON（如适用）
- 标注数据字段含义
- 检查数据一致性

用户问题：{query}

请提供数据分析结果。`,
    variables: ['query'],
    version: '1.0',
    totalScore: 0,
    usageCount: 0,
    avgScore: 0,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'tpl_code_review_v1',
    persona: 'code_review',
    template: `你是一位代码审查专家。请对代码进行专业审查。

审查维度：
- 安全性：是否有注入、泄露等风险
- 性能：是否有明显的性能瓶颈
- 可维护性：代码是否清晰、可读
- 正确性：逻辑是否正确

用户问题：{query}

请提供代码审查意见。`,
    variables: ['query'],
    version: '1.0',
    totalScore: 0,
    usageCount: 0,
    avgScore: 0,
    createdAt: new Date().toISOString(),
  },
];

// ===== Prompt 模板引擎 =====
export class PromptEngine {
  private templates: Map<string, PromptTemplate>;
  private routes: PersonaRoute[];

  constructor(
    templates?: PromptTemplate[],
    routes?: PersonaRoute[],
  ) {
    this.templates = new Map();
    this.routes = routes ?? DEFAULT_ROUTES;

    // 加载模板
    const tpls = templates ?? DEFAULT_TEMPLATES;
    for (const tpl of tpls) {
      this.templates.set(tpl.id, tpl);
    }
  }

  /**
   * 根据用户 query 自动路由到最佳 Persona
   */
  routePersona(query: string): string {
    let bestPersona = 'general';
    let bestScore = 0;

    for (const route of this.routes) {
      let score = 0;
      for (const keyword of route.keywords) {
        if (query.toLowerCase().includes(keyword.toLowerCase())) {
          score += route.priority;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestPersona = route.persona;
      }
    }

    return bestPersona;
  }

  /**
   * 根据 Persona 选择最佳模板（按 avgScore 排序）
   */
  selectTemplate(persona: string): PromptTemplate | null {
    const candidates = Array.from(this.templates.values())
      .filter(t => t.persona === persona)
      .sort((a, b) => b.avgScore - a.avgScore);

    return candidates[0] ?? null;
  }

  /**
   * 填充模板变量
   */
  fillTemplate(templateId: string, variables: Record<string, string>): TemplateFillResult {
    const tpl = this.templates.get(templateId);
    if (!tpl) {
      return {
        prompt: '',
        templateId: '',
        unfilledVariables: ['TEMPLATE_NOT_FOUND'],
      };
    }

    let prompt = tpl.template;
    const unfilled: string[] = [];

    for (const varName of tpl.variables) {
      const placeholder = `{${varName}}`;
      if (variables[varName] !== undefined) {
        prompt = prompt.replaceAll(placeholder, variables[varName]!);
      } else {
        unfilled.push(varName);
      }
    }

    return {
      prompt,
      templateId,
      unfilledVariables: unfilled,
    };
  }

  /**
   * 一站式方法：路由 Persona → 选模板 → 填充变量
   */
  buildPrompt(query: string, extraVariables?: Record<string, string>): TemplateFillResult {
    const persona = this.routePersona(query);
    const tpl = this.selectTemplate(persona);

    if (!tpl) {
      // 回退到 general
      const generalTpl = this.selectTemplate('general');
      if (!generalTpl) {
        return {
          prompt: query,
          templateId: 'fallback',
          unfilledVariables: [],
        };
      }
      return this.fillTemplate(generalTpl.id, { query, ...extraVariables });
    }

    return this.fillTemplate(tpl.id, { query, ...extraVariables });
  }

  /**
   * 记录模板评分反馈（用于后续自动优化排序）
   */
  recordFeedback(templateId: string, score: number): void {
    const tpl = this.templates.get(templateId);
    if (!tpl) return;

    tpl.totalScore += score;
    tpl.usageCount += 1;
    tpl.avgScore = tpl.totalScore / tpl.usageCount;
  }

  /**
   * 注册新模板
   */
  registerTemplate(tpl: PromptTemplate): void {
    this.templates.set(tpl.id, tpl);
  }

  /**
   * 列出所有模板
   */
  listTemplates(): PromptTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * 按 Persona 列出模板
   */
  listByPersona(persona: string): PromptTemplate[] {
    return Array.from(this.templates.values()).filter(t => t.persona === persona);
  }
}

// ===== 便捷函数 =====
let _engine: PromptEngine | null = null;

export function getPromptEngine(): PromptEngine {
  if (!_engine) {
    _engine = new PromptEngine();
  }
  return _engine;
}

export function buildPrompt(query: string, extraVariables?: Record<string, string>): TemplateFillResult {
  return getPromptEngine().buildPrompt(query, extraVariables);
}
