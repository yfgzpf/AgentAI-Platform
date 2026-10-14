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
  // ⚠️ 2026-10-15 降级: 这类是"低确定性"不是"必须追问"。单条模糊动词不足以阻断任务,
  // severity 由 high→low, 避免"帮我搞一下 X"就弹窗打断 (用户核心痛点)。
  vagueVerbs: [
    /(?:帮我|请|能).{0,5}(搞一下|弄一下|处理一下|看一下|弄一下|改一下|优化一下|调整一下)/i,
    /(?:做|处理|弄|搞|整).{0,3}(?:个|一下|下)/i,
  ],

  // 指代不明: "这个文件""那个功能" — 真指向某文件/功能/对象时才歧义
  // ⚠️ 2026-10-15 收紧: 旧版 `(?:这个|那个|它|这|那)(?:文件|代码|页面|功能|地方|东西)?` 有两个坑:
  //   ① 无词边界 + 后缀可选 → 单字"这/那"命中"这次/这个月/这样/这些"(时间词/程度副词)
  //   ② "它"命中"它们/其他"(泛指, 非指代)
  // 现在: 指代词必须**紧跟具体名词**(文件/代码/页面/功能/地方/东西)才匹配, 且不匹配时间/程度词。
  unclearReferences: [
    /这个(?:文件|代码|页面|功能|地方|东西)/i,
    /那个(?:文件|代码|页面|功能|地方|东西)/i,
    /该(?:文件|代码|页面|功能|地方|东西)/i,   // "该文件"才是指代, "该"单独不算
    /(?:当前|现在)(?:打开的|编辑的)?\s*(?:文件|代码|页面)/i,  // "当前打开的文件"(可被 openFiles 消解)
  ],

  // 未决选择: A 还是 B，用户没选
  // ⚠️ 2026-10-15 降级: "用 X 还是 Y" 经常是用户在**陈述**对比(想让我们判断), 不是真没选,
  // severity 由 high→low, 多数情况 AI 直接给建议即可, 不必弹窗。
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
    
    // L1: 模糊动词 — 2026-10-15 降级: 单条模糊动词是"低确定性", 不足以阻断任务
    // (用户核心痛点: 一出现"帮我搞一下"就弹窗追问, 非常不智能)。
    // 只有 L2 真指代 (severity high) 才触发 needsClarification, 模糊动词仅记录供参考。
    for (const pattern of AMBIGUITY_PATTERNS.vagueVerbs) {
      const match = input.match(pattern);
      if (match) {
        ambiguities.push({
          type: 'vague_verb',
          text: match[0],
          position: [match.index!, match.index! + match[0].length],
          severity: 'low',
          suggestedQuestions: [
            `您说的"${match[0]}"具体是指什么操作？`,
            '您希望达成什么目标？',
          ],
        });
      }
    }
    
    // L2: 指代不明 (2026-10-15 收紧: 只有"这个文件/那个功能"等真指代才命中,
    // 时间词/程度副词/泛指"它们"不再误报; 严重度 high 保留, 但范围大幅收窄)
    for (const pattern of AMBIGUITY_PATTERNS.unclearReferences) {
      const match = input.match(pattern);
      if (match) {
        // 检查上下文能否解析 (openFiles=1 / lastMentionedFile / 当前项目指代)
        const canResolve = this.tryResolveReference(match[0], context);
        // workspace 已设置时, "这个项目/这个平台/当前打开的文件" 可自动消解, 不算歧义
        if (!canResolve && context?.workspace) {
          const projectRefs = /这个系统|这个项目|这个平台|本系统|本项目|这套代码|当前打开的|当前文件|当前页面/i;
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

    // L3: 未决选择 — 2026-10-15 降级: "用 X 还是 Y" 多是用户在陈述对比想让 AI 判断,
    // 不是真没选。severity high→medium (needsClarification 只认 high, 故不再阻断任务)。
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
    // 2026-10-15: 指代消解 — "这个文件/当前打开的文件"在 openFiles 唯一时可锁定,
    // "它"在 lastMentionedFile 有值时可锁定
    if (/这个|当前|打开/.test(ref) && context?.openFiles?.length === 1) return true;
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
