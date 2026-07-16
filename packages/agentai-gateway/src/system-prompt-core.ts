/**
 * System Prompt Core - 分层System Prompt架构
 * 
 * 将原有的200+行system prompt拆分为3层：
 * L0: 核心（永远发送，~50行）
 * L1: 按需工具（根据意图匹配，~10-15个工具）
 * L2: 场景上下文（记忆/进化/IDE/git等）
 * 
 * 目标：从~8000 token降到~2000 token
 */

// ═══════════════════════════════════════════════════════════
// L0: 核心层（永远发送）
// ═══════════════════════════════════════════════════════════

export const L0_CORE_IDENTITY = `你是 PulseFlow，一个融合中医"望闻问切"辨证思维的 AI 智能体。

核心原则：
1. **先诊断，后治疗** —— 先理解系统状态，再交付结果
2. **说和做必须一体** —— 绝不空口计划而不执行
3. **用户要的是结果，不是计划** —— 立即调用工具，不要解释

安全红线：
- 绝不执行 rm -rf / 等危险命令
- 绝不泄露系统密钥
- 涉及删除操作必须二次确认

输出格式：
- 代码任务：先输出代码，后简要说明
- 完成时标记：[DONE]
- 需要用户确认时标记：[NEEDS_CONFIRM]`;

// ═══════════════════════════════════════════════════════════
// L1: 工具层（按需加载）
// ═══════════════════════════════════════════════════════════

export interface ToolDefinition {
  name: string;
  description: string;
  keywords: string[];
  required?: boolean;
}

export const L1_TOOLS: ToolDefinition[] = [
  // 代码操作（代码相关任务）
  {
    name: 'read_file',
    description: '读取文件内容',
    keywords: ['看看', '读', '查看', '内容', '文件', 'code', 'read', 'view'],
  },
  {
    name: 'write_file',
    description: '创建或覆盖文件',
    keywords: ['创建', '写', '生成', '保存', 'write', 'create', 'save'],
  },
  {
    name: 'multi_edit',
    description: '批量编辑文件',
    keywords: ['修改', '更新', '批量', 'edit', 'update', 'modify'],
  },
  {
    name: 'search_codebase',
    description: '搜索代码库',
    keywords: ['搜索', '查找', '在哪里', 'search', 'find', 'locate'],
  },
  
  // 命令执行（需要运行命令）
  {
    name: 'run_terminal_cmd',
    description: '执行终端命令',
    keywords: ['运行', '执行', '命令', 'cmd', 'run', 'execute', 'terminal'],
  },
  
  // 网络搜索（需要外部信息）
  {
    name: 'web_search',
    description: '网络搜索',
    keywords: ['搜索', '查资料', '最新', 'search', 'google', '查询'],
  },
  {
    name: 'web_fetch',
    description: '获取网页内容',
    keywords: ['打开', '获取', '网页', 'fetch', '访问'],
  },
  
  // 多媒体生成（创意任务）
  {
    name: 'generate_image',
    description: '生成图片',
    keywords: ['生成图片', '画图', 'image', 'picture', 'photo'],
  },
  {
    name: 'generate_video',
    description: '生成视频',
    keywords: ['生成视频', 'video', '视频'],
  },
  
  // 技能系统（复杂任务）
  {
    name: 'discover_or_create_skill',
    description: '发现或创建技能',
    keywords: ['技能', '自动化', 'workflow', 'skill', '自动化'],
  },
  
  // 用户交互（需要确认）
  {
    name: 'ask_user',
    description: '向用户提问',
    keywords: ['问', '确认', '可以吗', '?', 'ask', 'confirm'],
  },
];

/**
 * 根据用户消息选择相关工具
 */
export function selectToolsByIntent(message: string): ToolDefinition[] {
  const msg = message.toLowerCase();
  const selected: ToolDefinition[] = [];
  
  for (const tool of L1_TOOLS) {
    const matched = tool.keywords.some(kw => msg.includes(kw.toLowerCase()));
    if (matched) {
      selected.push(tool);
    }
  }
  
  // 默认至少包含读文件和搜索
  if (selected.length === 0) {
    return [
      L1_TOOLS.find(t => t.name === 'read_file')!,
      L1_TOOLS.find(t => t.name === 'search_codebase')!,
    ];
  }
  
  // 限制数量，避免过多
  return selected.slice(0, 8);
}

/**
 * 生成工具提示
 */
export function generateToolsPrompt(tools: ToolDefinition[]): string {
  if (tools.length === 0) return '';
  
  const toolList = tools.map(t => `- ${t.name}: ${t.description}`).join('\n');
  
  return `
【可用工具】
${toolList}

工具使用规则：
- 需要时立即调用，不要解释
- 一次可调用多个工具
- 工具结果会返回给你`;
}

// ═══════════════════════════════════════════════════════════
// L2: 场景上下文层（按需注入）
// ═══════════════════════════════════════════════════════════

export interface ContextLayer {
  memories?: string[];        // 相关记忆
  evolutionInsights?: string[]; // 进化经验
  ideState?: {                // IDE状态
    openFiles?: string[];
    activeFile?: string;
    cursorPosition?: { line: number; column: number };
  };
  gitState?: {                // Git状态
    branch?: string;
    modifiedFiles?: string[];
    lastCommit?: string;
  };
  projectRules?: string[];    // 项目规则
}

/**
 * 生成上下文提示
 */
export function generateContextPrompt(ctx: ContextLayer): string {
  const sections: string[] = [];
  
  // 记忆
  if (ctx.memories && ctx.memories.length > 0) {
    sections.push(`【相关记忆】\n${ctx.memories.slice(0, 5).map(m => `- ${m}`).join('\n')}`);
  }
  
  // 进化经验
  if (ctx.evolutionInsights && ctx.evolutionInsights.length > 0) {
    sections.push(`【进化经验】\n${ctx.evolutionInsights.slice(0, 3).map(i => `- ${i}`).join('\n')}`);
  }
  
  // IDE状态
  if (ctx.ideState) {
    const ideInfo: string[] = [];
    if (ctx.ideState.activeFile) {
      ideInfo.push(`当前文件: ${ctx.ideState.activeFile}`);
    }
    if (ctx.ideState.openFiles && ctx.ideState.openFiles.length > 0) {
      ideInfo.push(`打开文件: ${ctx.ideState.openFiles.join(', ')}`);
    }
    if (ideInfo.length > 0) {
      sections.push(`【IDE状态】\n${ideInfo.join('\n')}`);
    }
  }
  
  // Git状态
  if (ctx.gitState) {
    const gitInfo: string[] = [];
    if (ctx.gitState.branch) {
      gitInfo.push(`分支: ${ctx.gitState.branch}`);
    }
    if (ctx.gitState.modifiedFiles && ctx.gitState.modifiedFiles.length > 0) {
      gitInfo.push(`修改中: ${ctx.gitState.modifiedFiles.join(', ')}`);
    }
    if (gitInfo.length > 0) {
      sections.push(`【Git状态】\n${gitInfo.join('\n')}`);
    }
  }
  
  // 项目规则
  if (ctx.projectRules && ctx.projectRules.length > 0) {
    sections.push(`【项目规则】\n${ctx.projectRules.slice(0, 3).join('\n')}`);
  }
  
  return sections.join('\n\n');
}

// ═══════════════════════════════════════════════════════════
// 主函数：构建完整System Prompt
// ═══════════════════════════════════════════════════════════

export interface BuildPromptOptions {
  userMessage: string;
  context?: ContextLayer;
  includeTools?: boolean;
  includeContext?: boolean;
}

/**
 * 构建分层System Prompt
 */
export function buildLayeredSystemPrompt(options: BuildPromptOptions): string {
  const parts: string[] = [];
  
  // L0: 核心（永远包含）
  parts.push(L0_CORE_IDENTITY);
  
  // L1: 工具（根据意图选择）
  if (options.includeTools !== false) {
    const tools = selectToolsByIntent(options.userMessage);
    const toolsPrompt = generateToolsPrompt(tools);
    if (toolsPrompt) {
      parts.push(toolsPrompt);
    }
  }
  
  // L2: 上下文（按需注入）
  if (options.includeContext !== false && options.context) {
    const contextPrompt = generateContextPrompt(options.context);
    if (contextPrompt) {
      parts.push(contextPrompt);
    }
  }
  
  return parts.join('\n\n');
}

// ═══════════════════════════════════════════════════════════
// 统计和优化
// ═══════════════════════════════════════════════════════════

export function estimateTokenCount(text: string): number {
  // 粗略估算：英文约4字符/token，中文约1.5字符/token
  const englishChars = (text.match(/[a-zA-Z]/g) || []).length;
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherChars = text.length - englishChars - chineseChars;
  
  return Math.ceil(englishChars / 4 + chineseChars / 1.5 + otherChars / 3);
}

export function analyzePromptEfficiency(prompt: string): {
  totalTokens: number;
  l0Tokens: number;
  l1Tokens: number;
  l2Tokens: number;
  savings: string;
} {
  const totalTokens = estimateTokenCount(prompt);
  const l0Tokens = estimateTokenCount(L0_CORE_IDENTITY);
  
  // 估算原始prompt的token数（约8000）
  const originalEstimate = 8000;
  const savings = ((1 - totalTokens / originalEstimate) * 100).toFixed(1);
  
  return {
    totalTokens,
    l0Tokens,
    l1Tokens: totalTokens - l0Tokens, // 近似
    l2Tokens: 0, // 需要实际计算
    savings: `${savings}%`,
  };
}
