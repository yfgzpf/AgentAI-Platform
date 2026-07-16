/**
 * IntentClarifier — 意图澄清机制
 * =================================
 * 解决"元认知给自信没给智慧"问题:
 *   - 检测用户输入中的歧义/缺失
 *   - 生成追问问题
 *   - 确认后自动执行
 */

export interface Ambiguity {
  type: 'vague_verb' | 'unclear_reference' | 'unresolved_choice' | 'missing_param' | 'conflict';
  text: string;           // 原文片段
  position: [number, number]; // 在输入中的位置
  severity: 'low' | 'medium' | 'high'; // 严重程度
  suggestedQuestions: string[]; // 建议追问
}

export interface Clarification {
  id: string;
  question: string;
  options?: string[];     // 可选答案(选择题)
  allowFreeText?: boolean; // 是否允许自由输入
  context?: string;       // 追问的上下文说明
}

export interface ResolvedIntent {
  originalInput: string;
  clarifications: Record<string, string>; // questionId -> answer
  resolvedParams: Record<string, unknown>;
  confidence: number;     // 澄清后的置信度
}

/** 歧义模式库 */
const AMBIGUITY_PATTERNS = {
  // 模糊动词: 用户说"处理一下"但没说怎么处理
  vagueVerbs: [
    /(?:帮我|请|能).{0,5}(搞一下|弄一下|处理一下|看一下|弄一下|改一下|优化一下|调整一下)/i,
    /(?:做|处理|弄|搞|整).{0,3}(?:个|一下|下)/i,
  ],
  
  // 指代不明: "这个""那个""它"
  unclearReferences: [
    /(?:这个|那个|它|这|那)(?:文件|代码|页面|功能|地方|东西)?/i,
    /(?:这里|那里|这边|那边)/i,
  ],
  
  // 未决选择: A 还是 B，用户没选
  unresolvedChoices: [
    /(?:用|选|采用|使用).{0,10}(?:还是|或者|或|versus|vs)/i,
    /(?:A|方案一|第一种).{0,5}(?:B|方案二|第二种)/i,
  ],
  
  // 缺少关键参数
  missingParams: {
    filePath: /(?:打开|编辑|修改|删除|读取|保存).{0,5}(?:文件|文档)/i,
    modelName: /(?:用|切换|换|使用).{0,5}(?:模型|model)/i,
    url: /(?:访问|打开|抓取|浏览).{0,5}(?:网页|网站|页面|url)/i,
  },
};

export class IntentClarifier {
  private history: ResolvedIntent[] = [];
  
  /**
   * 检测用户输入中的歧义
   */
  detectAmbiguities(input: string, context?: {
    openFiles?: string[];
    currentModel?: string;
    lastMentionedFile?: string;
    workspace?: string;
  }): Ambiguity[] {
    const ambiguities: Ambiguity[] = [];
    
    // L1: 模糊动词
    for (const pattern of AMBIGUITY_PATTERNS.vagueVerbs) {
      const match = input.match(pattern);
      if (match) {
        ambiguities.push({
          type: 'vague_verb',
          text: match[0],
          position: [match.index!, match.index! + match[0].length],
          severity: 'high',
          suggestedQuestions: [
            `您说的"${match[0]}"具体是指什么操作？`,
            '您希望达成什么目标？',
          ],
        });
      }
    }
    
    // L2: 指代不明
    for (const pattern of AMBIGUITY_PATTERNS.unclearReferences) {
      const match = input.match(pattern);
      if (match) {
        // 检查上下文能否解析
        const canResolve = this.tryResolveReference(match[0], context);
        // workspace 已设置时, "这个系统/这个项目/这个平台" 可自动消解
        if (!canResolve && context?.workspace) {
          const projectRefs = /这个系统|这个项目|这个平台|本系统|本项目|这套代码/i;
          if (projectRefs.test(input)) {
            continue; // 可自动消解, 不算歧义
          }
        }
        if (!canResolve) {
          ambiguities.push({
            type: 'unclear_reference',
            text: match[0],
            position: [match.index!, match.index! + match[0].length],
            severity: 'high',
            suggestedQuestions: [
              `您指的"${match[0]}"是哪个文件或功能？`,
              ...(context?.openFiles?.map(f => `是 ${f} 吗？`) || []),
            ],
          });
        }
      }
    }
    
    // L3: 未决选择
    for (const pattern of AMBIGUITY_PATTERNS.unresolvedChoices) {
      const match = input.match(pattern);
      if (match) {
        ambiguities.push({
          type: 'unresolved_choice',
          text: match[0],
          position: [match.index!, match.index! + match[0].length],
          severity: 'medium',
          suggestedQuestions: [
            '您倾向于选择哪一个？',
            '能告诉我选择的理由吗，我可以帮您判断哪个更合适',
          ],
        });
      }
    }
    
    return ambiguities;
  }
  
  /**
   * 生成澄清问题
   */
  generateClarifications(
    input: string, 
    ambiguities: Ambiguity[],
    toolSchema?: { name: string; requiredParams: string[] }[]
  ): Clarification[] {
    const clarifications: Clarification[] = [];
    
    for (const amb of ambiguities) {
      const id = `clarify-${amb.type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      
      switch (amb.type) {
        case 'vague_verb':
          clarifications.push({
            id,
            question: amb.suggestedQuestions[0] || '请详细说明您的需求',
            allowFreeText: true,
            context: '我需要更具体的指令才能准确执行',
          });
          break;
          
        case 'unclear_reference':
          clarifications.push({
            id,
            question: amb.suggestedQuestions[0] || '请确认您指的是什么？',
            options: amb.suggestedQuestions.slice(1).filter(q => q.endsWith('吗？')),
            allowFreeText: true,
            context: '有多个可能的选项，需要您确认',
          });
          break;
          
        case 'unresolved_choice':
          clarifications.push({
            id,
            question: '您希望选择哪一个方案？',
            options: this.extractChoices(amb.text),
            allowFreeText: true,
            context: '不同的选择会导致不同的执行路径',
          });
          break;
      }
    }
    
    return clarifications;
  }
  
  /**
   * 确认澄清后，解析最终意图
   */
  resolveIntent(
    originalInput: string,
    clarifications: Record<string, string>,
    context?: Record<string, unknown>
  ): ResolvedIntent {
    let resolvedParams: Record<string, unknown> = {};
    
    // 根据澄清答案填充参数
    for (const [qid, answer] of Object.entries(clarifications)) {
      if (qid.includes('file') || answer.match(/\.(tsx?|jsx?|py|md|json)$/i)) {
        resolvedParams.filePath = answer;
      }
      if (qid.includes('model') || ['agentai', 'zhipu', 'deepseek', 'sensenova'].includes(answer)) {
        resolvedParams.model = answer;
      }
      if (qid.includes('url') || answer.match(/^https?:\/\//)) {
        resolvedParams.url = answer;
      }
    }
    
    // 合并上下文
    resolvedParams = { ...context, ...resolvedParams };
    
    // 计算置信度
    const confidence = this.calculateConfidence(originalInput, clarifications, resolvedParams);
    
    const resolved: ResolvedIntent = {
      originalInput,
      clarifications,
      resolvedParams,
      confidence,
    };
    
    this.history.push(resolved);
    return resolved;
  }
  
  /**
   * 快速检查: 是否需要澄清
   */
  needsClarification(input: string, context?: Record<string, unknown>): boolean {
    const ambiguities = this.detectAmbiguities(input, context as any);
    return ambiguities.some(a => a.severity === 'high');
  }
  
  // ===== 私有方法 =====
  
  private tryResolveReference(ref: string, context?: { openFiles?: string[]; lastMentionedFile?: string }): boolean {
    if (ref.match(/这个|这/) && context?.openFiles?.length === 1) return true;
    if (ref.match(/它/) && context?.lastMentionedFile) return true;
    return false;
  }
  
  private extractChoices(text: string): string[] {
    // 简单提取 "A 还是 B" 中的选项
    const match = text.match(/(.{1,20})(?:还是|或者|或|vs|versus)(.{1,20})/i);
    if (match) {
      return [match[1]!.trim(), match[2]!.trim()];
    }
    return [];
  }
  
  private calculateConfidence(
    input: string, 
    clarifications: Record<string, string>,
    resolvedParams: Record<string, unknown>
  ): number {
    let score = 0.5; // 基础分
    
    // 有澄清答案 +0.3
    if (Object.keys(clarifications).length > 0) score += 0.3;
    
    // 关键参数齐全 +0.2
    const hasFile = resolvedParams.filePath || resolvedParams.file;
    const hasModel = resolvedParams.model;
    const hasUrl = resolvedParams.url;
    if (hasFile || hasModel || hasUrl) score += 0.2;
    
    return Math.min(0.95, score);
  }
}

// 单例导出
let _instance: IntentClarifier | null = null;
export function getIntentClarifier(): IntentClarifier {
  if (!_instance) _instance = new IntentClarifier();
  return _instance;
}
