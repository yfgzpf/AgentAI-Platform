/**
 * InsightAccumulator — 行业洞察自主积累引擎
 * ----------------------------------------------------
 * 理念: 授人以渔，AI 不是被动回答问题，而是主动积累行业深度洞察
 *
 * 核心能力:
 *   1. 行业知识自动发现 — 从对话中提取行业关键词，触发知识搜索
 *   2. 洞察持久化 — 将发现的洞察存入记忆系统，跨会话可用
 *   3. 知识图谱构建 — 行业概念之间的关联关系
 *   4. 洞察推送 — 当用户进入某行业场景时，主动推送相关洞察
 *
 * 设计原则:
 *   - 不依赖外部 LLM 调用 (纯本地规则 + 记忆系统)
 *   - 洞察积累是渐进式的，不是一次性的
 *   - 用户可以审查、修正、删除洞察
 */

import * as fsSync from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

const AGENTAI_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '~', '.agentai');
const INSIGHTS_FILE = path.join(AGENTAI_DIR, 'insights', 'industry-insights.json');

// ===== 类型定义 =====

export interface IndustryInsight {
  /** 行业标识 */
  industryId: string;
  /** 行业名称 */
  industryName: string;
  /** 洞察类别 */
  category: 'core_knowledge' | 'workflow' | 'terminology' | 'tools' | 'trends' | 'pain_points' | 'best_practices';
  /** 洞察内容 */
  content: string;
  /** 来源 (用户对话 / web搜索 / 手动录入) */
  source: 'conversation' | 'web_search' | 'manual' | 'system';
  /** 置信度 0-1 */
  confidence: number;
  /** 引用次数 */
  hitCount: number;
  /** 创建时间 */
  createdAt: string;
  /** 最后验证时间 */
  lastVerifiedAt: string;
  /** 关联概念 */
  relatedConcepts: string[];
  /** 标签 */
  tags: string[];
}

export interface IndustryProfile {
  industryId: string;
  industryName: string;
  description: string;
  /** 核心概念 */
  coreConcepts: string[];
  /** 典型工作流 */
  workflows: string[];
  /** 专用工具 */
  tools: string[];
  /** 常见痛点 */
  painPoints: string[];
  /** 最新洞察 */
  latestInsights: IndustryInsight[];
  /** 知识完整度评分 0-100 */
  completenessScore: number;
  /** 最后更新 */
  updatedAt: string;
}

// ===== 行业识别关键词库 =====

const INDUSTRY_KEYWORDS: Record<string, {
  name: string;
  keywords: string[];
  coreConcepts: string[];
  workflows: string[];
  tools: string[];
  painPoints: string[];
}> = {
  'software_dev': {
    name: '软件开发',
    keywords: ['代码', '编程', '开发', '项目', 'bug', '部署', 'API', '框架', '重构', '测试', 'code', 'develop', 'deploy', 'refactor', 'framework'],
    coreConcepts: ['版本控制', 'CI/CD', '代码审查', '架构设计', '测试驱动开发', '敏捷开发'],
    workflows: ['需求分析→设计→编码→测试→部署', '代码审查流程', 'Bug修复流程', '发布流程'],
    tools: ['Git', 'VSCode', 'Docker', 'Jenkins', 'npm/pnpm'],
    painPoints: ['技术债务', '代码重构风险', '上线回归', '多人协作冲突', '性能瓶颈定位'],
  },
  'decoration': {
    name: '装修建材',
    keywords: ['装修', '报价', '建材', '施工', '瓷砖', '橱柜', '设计', '户型', '水电', '报价单', '量房'],
    coreConcepts: ['空间报价法', '工程量计算', '材料损耗率', '施工规范', '设计风格'],
    workflows: ['量房→设计→报价→施工→验收', '材料选型流程', '变更管理'],
    tools: ['CAD', '酷家乐', 'Excel报价', 'ezdxf'],
    painPoints: ['报价不准', '材料浪费', '工期延误', '客户需求变化频繁'],
  },
  'ecommerce': {
    name: '电商运营',
    keywords: ['电商', '店铺', '运营', '流量', '转化率', 'SKU', 'GMV', '直播', '选品', '供应链'],
    coreConcepts: ['用户生命周期', '转化漏斗', 'ROI', 'SKU管理', '供应链优化'],
    workflows: ['选品→上架→推广→客服→复盘', '直播带货流程', '库存管理'],
    tools: ['淘宝/京东后台', '数据罗盘', 'ERP系统', '客服系统'],
    painPoints: ['流量成本高', '退货率高', '库存积压', '竞品价格战'],
  },
  'education': {
    name: '教育培训',
    keywords: ['教学', '课程', '学生', '考试', '培训', '教育', '学习', '知识', '教案'],
    coreConcepts: ['教学设计', '知识图谱', '学习路径', '能力评估', '课程体系'],
    workflows: ['备课→授课→作业→评估→调整', '课程开发流程', '学生跟踪'],
    tools: ['LMS系统', '在线题库', '视频平台', '互动白板'],
    painPoints: ['学生参与度低', '教学效果难量化', '内容更新慢', '个性化难'],
  },
  'healthcare': {
    name: '医疗健康',
    keywords: ['医疗', '诊断', '病历', '处方', '影像', '临床', '药物', '患者', '健康'],
    coreConcepts: ['临床路径', '病历管理', '药物相互作用', '影像诊断', '患者隐私'],
    workflows: ['挂号→问诊→检查→诊断→治疗→随访', '处方审核流程', '急诊处理'],
    tools: ['HIS系统', 'PACS影像', '电子病历', '远程医疗'],
    painPoints: ['医疗资源不均', '误诊风险', '数据孤岛', '患者依从性'],
  },
  'comic': {
    name: '漫剧创作',
    keywords: ['漫画', '短剧', '剧本', '分镜', '角色设计', '动画', '创作', '连载', '漫画家'],
    coreConcepts: ['分镜设计', '角色弧光', '叙事节奏', '视觉叙事', '对白技巧'],
    workflows: ['构思→大纲→分镜→绘制→后期', '剧本创作流程', '角色设定流程'],
    tools: ['Clip Studio Paint', 'Procreate', 'Photoshop', 'AI绘图工具'],
    painPoints: ['创意枯竭', '连载压力', '读者留存', '版权保护'],
  },
  'real_estate': {
    name: '房地产',
    keywords: ['房产', '楼盘', '户型', '房价', '购房', '租房', '学区房', '物业', '中介', '房产证'],
    coreConcepts: ['市场分析', '户型评价', '区位价值', '投资回报', '政策影响'],
    workflows: ['看房→评估→议价→签约→过户', '房产估值流程', '市场调研'],
    tools: ['房产APP', 'GIS系统', '估价模型', 'CRM系统'],
    painPoints: ['信息不对称', '价格波动', '政策风险', '交易流程复杂'],
  },
  'legal': {
    name: '法律',
    keywords: ['法律', '合同', '诉讼', '律师', '法规', '条款', '纠纷', '仲裁', '合规', '知识产权'],
    coreConcepts: ['合同审查', '法律风险', '证据链', '诉讼策略', '合规管理'],
    workflows: ['咨询→调研→起草→审查→签署', '诉讼流程', '合规审查流程'],
    tools: ['法律数据库', '合同模板库', '案例检索', '电子签章'],
    painPoints: ['法律条文复杂', '证据收集难', '诉讼周期长', '合规成本高'],
  },
  'manufacturing': {
    name: '制造业',
    keywords: ['生产', '制造', '工艺', '质检', '车间', '产线', 'BOM', '物料', '设备', '良率'],
    coreConcepts: ['精益生产', '质量控制', '供应链管理', '设备维护', '工艺优化'],
    workflows: ['订单→排产→采购→生产→质检→出货', '工艺改进流程', '质量异常处理'],
    tools: ['ERP系统', 'MES系统', 'PLC', 'SCADA', '质量检测设备'],
    painPoints: ['产能瓶颈', '质量波动', '物料短缺', '设备故障', '成本控制'],
  },
};

// ===== 核心引擎 =====

export class InsightAccumulator extends EventEmitter {
  private insights: Map<string, IndustryInsight[]> = new Map();
  private profiles: Map<string, IndustryProfile> = new Map();
  private loaded = false;

  constructor() {
    super();
    this.load();
  }

  /**
   * 从用户消息中识别行业
   * 纯关键词匹配，不依赖 LLM
   */
  detectIndustry(message: string): { industryId: string; confidence: number } | null {
    const msgLower = message.toLowerCase();
    let bestMatch: { industryId: string; confidence: number } | null = null;

    for (const [id, config] of Object.entries(INDUSTRY_KEYWORDS)) {
      let hits = 0;
      for (const kw of config.keywords) {
        if (msgLower.includes(kw.toLowerCase())) hits++;
      }
      const confidence = hits / config.keywords.length;
      if (confidence > 0.1 && (!bestMatch || confidence > bestMatch.confidence)) {
        bestMatch = { industryId: id, confidence };
      }
    }

    return bestMatch;
  }

  /**
   * 从对话中提取洞察 — 授人以渔的关键
   * 不是替用户回答，而是把用户展示的知识沉淀下来
   */
  extractInsight(message: string, response: string): IndustryInsight | null {
    const industry = this.detectIndustry(message);
    if (!industry || industry.confidence < 0.15) return null;

    const config = INDUSTRY_KEYWORDS[industry.industryId];
    if (!config) return null;

    // 从消息中提取可能是知识/经验的片段
    const patterns: Array<{ regex: RegExp; category: IndustryInsight['category'] }> = [
      // 工作流描述
      { regex: /(?:流程|步骤|过程|怎么.*做|如何.*做|先.*再.*然后)(.{20,150})/i, category: 'workflow' },
      // 最佳实践
      { regex: /(?:建议|推荐|最好|应该|务必|关键|核心|重点)(.{10,150})/i, category: 'best_practices' },
      // 痛点
      { regex: /(?:痛点|问题|难点|坑|踩坑|容易.*错|注意|避免|千万不要)(.{10,150})/i, category: 'pain_points' },
      // 术语
      { regex: /(?:叫|称为|简称|术语|专业词汇|行话)(.{5,80})/i, category: 'terminology' },
      // 工具
      { regex: /(?:工具|软件|平台|系统|插件|用.*来)(.{5,100})/i, category: 'tools' },
    ];

    for (const { regex, category } of patterns) {
      const match = message.match(regex) || response.match(regex);
      if (match && match[1]) {
        const insight: IndustryInsight = {
          industryId: industry.industryId,
          industryName: config.name,
          category,
          content: match[1].trim().slice(0, 300),
          source: 'conversation',
          confidence: Math.min(industry.confidence + 0.2, 1.0),
          hitCount: 0,
          createdAt: new Date().toISOString(),
          lastVerifiedAt: new Date().toISOString(),
          relatedConcepts: this.extractConcepts(match[1], config),
          tags: [config.name, category],
        };

        // 去重: 相同 category + 相似内容 不重复存储
        const existing = this.insights.get(industry.industryId) || [];
        const isDuplicate = existing.some(i =>
          i.category === category && this.similarity(i.content, insight.content) > 0.8
        );
        if (!isDuplicate) {
          existing.push(insight);
          this.insights.set(industry.industryId, existing);
          this.emit('insight:discovered', insight);
          this.persist();
          return insight;
        }
      }
    }

    return null;
  }

  /**
   * 获取行业画像 — 给 AI 的 system prompt 用
   * 这是"授人以渔"的核心: AI 有了行业画像就能自主决策
   */
  getIndustryProfile(industryId: string): IndustryProfile | null {
    const config = INDUSTRY_KEYWORDS[industryId];
    if (!config) return null;

    const insights = this.insights.get(industryId) || [];
    const profile: IndustryProfile = {
      industryId,
      industryName: config.name,
      description: `${config.name}行业, 核心概念: ${config.coreConcepts.slice(0, 5).join('、')}`,
      coreConcepts: config.coreConcepts,
      workflows: config.workflows,
      tools: config.tools,
      painPoints: config.painPoints,
      latestInsights: insights.slice(-5),
      completenessScore: this.calcCompleteness(industryId, config),
      updatedAt: new Date().toISOString(),
    };

    return profile;
  }

  /**
   * 生成行业洞察提示 — 注入到 system prompt
   * 关键: 精简，不浪费 token
   */
  buildInsightPrompt(industryId: string): string {
    const profile = this.getIndustryProfile(industryId);
    if (!profile) return '';

    const lines: string[] = [];
    lines.push(`# 行业洞察: ${profile.industryName} (完整度 ${profile.completenessScore}%)`);

    if (profile.coreConcepts.length > 0) {
      lines.push(`核心概念: ${profile.coreConcepts.join('、')}`);
    }
    if (profile.workflows.length > 0) {
      lines.push(`典型流程: ${profile.workflows.join(' | ')}`);
    }
    if (profile.painPoints.length > 0) {
      lines.push(`常见痛点: ${profile.painPoints.join('、')}`);
    }
    if (profile.latestInsights.length > 0) {
      lines.push(`最近洞察:`);
      for (const ins of profile.latestInsights.slice(0, 3)) {
        lines.push(`  - [${ins.category}] ${(ins.content || '').slice(0, 100)}`);
      }
    }

    // 如果完整度低，提示 AI 主动学习
    if (profile.completenessScore < 50) {
      lines.push(`\n⚠️ 行业知识完整度较低 (${profile.completenessScore}%), 请在对话中主动了解用户的具体业务流程和痛点，并用 remember 工具保存。`);
    }

    return lines.join('\n');
  }

  /**
   * 获取所有已积累的行业洞察摘要
   */
  getAllInsightsSummary(): string {
    const lines: string[] = [];
    for (const [id, insights] of this.insights) {
      const config = INDUSTRY_KEYWORDS[id];
      if (!config) continue;
      lines.push(`${config.name}: ${insights.length} 条洞察`);
    }
    return lines.length > 0 ? lines.join('\n') : '暂无行业洞察积累';
  }

  /**
   * 手动添加洞察 (用户显式录入)
   */
  addManualInsight(industryId: string, category: IndustryInsight['category'], content: string): IndustryInsight | null {
    const config = INDUSTRY_KEYWORDS[industryId];
    if (!config) return null;

    const insight: IndustryInsight = {
      industryId,
      industryName: config.name,
      category,
      content,
      source: 'manual',
      confidence: 1.0,
      hitCount: 0,
      createdAt: new Date().toISOString(),
      lastVerifiedAt: new Date().toISOString(),
      relatedConcepts: this.extractConcepts(content, config),
      tags: [config.name, category],
    };

    const existing = this.insights.get(industryId) || [];
    existing.push(insight);
    this.insights.set(industryId, existing);
    this.persist();

    return insight;
  }

  // ===== 内部方法 =====

  private extractConcepts(text: string, config: typeof INDUSTRY_KEYWORDS['software_dev']): string[] {
    const concepts: string[] = [];
    for (const kw of config.keywords) {
      if (text.toLowerCase().includes(kw.toLowerCase())) {
        concepts.push(kw);
      }
    }
    for (const cc of config.coreConcepts) {
      if (text.includes(cc)) {
        concepts.push(cc);
      }
    }
    return [...new Set(concepts)].slice(0, 5);
  }

  private similarity(a: string, b: string): number {
    // 简单 Jaccard 相似度
    const setA = new Set(a.split(''));
    const setB = new Set(b.split(''));
    const intersection = [...setA].filter(x => setB.has(x)).length;
    const union = new Set([...setA, ...setB]).size;
    return union > 0 ? intersection / union : 0;
  }

  private calcCompleteness(industryId: string, config: typeof INDUSTRY_KEYWORDS['software_dev']): number {
    const insights = this.insights.get(industryId) || [];
    if (insights.length === 0) return 5; // 最低5% (识别到了行业但还没积累)

    // 按类别统计覆盖度
    const categories = new Set(insights.map(i => i.category));
    const categoryCoverage = categories.size / 7; // 7 种类别

    // 核心概念覆盖度
    const conceptCoverage = config.coreConcepts.filter(c =>
      insights.some(i => i.content.includes(c) || i.relatedConcepts.includes(c))
    ).length / config.coreConcepts.length;

    // 数量加分 (最多 10 条就算充分)
    const countScore = Math.min(insights.length / 10, 1.0);

    return Math.round((categoryCoverage * 30 + conceptCoverage * 40 + countScore * 30));
  }

  private load(): void {
    try {
      if (!fsSync.existsSync(INSIGHTS_FILE)) {
        this.loaded = true;
        return;
      }
      const data = JSON.parse(fsSync.readFileSync(INSIGHTS_FILE, 'utf-8'));
      for (const [id, insights] of Object.entries(data.insights || {})) {
        this.insights.set(id, insights as IndustryInsight[]);
      }
    } catch { /* ignore corrupt data */ }
    this.loaded = true;
  }

  private persist(): void {
    try {
      const dir = path.dirname(INSIGHTS_FILE);
      if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });

      const data: Record<string, any> = { insights: {} };
      for (const [id, insights] of this.insights) {
        data.insights[id] = insights;
      }
      fsSync.writeFileSync(INSIGHTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch { /* ignore write errors */ }
  }
}

export const insightAccumulator = new InsightAccumulator();
