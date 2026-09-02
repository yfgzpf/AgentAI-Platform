/**
 * 工具意图过滤 + 模型上下文窗口 — 从 agentai-loop.ts 提取
 * 
 * 包含:
 *   - filterToolsByIntent: 根据消息意图过滤可用工具集
 *   - getModelContextWindow: 获取模型上下文窗口大小
 * 
 * 原位置: agentai-loop.ts 行 ~5100-5107, 5113-5279
 * 提取理由: 输入输出清晰，少量 this 访问已参数化，置信度 90%
 */

import type { ChatMessage } from './llm-router.js';

/** 工具定义结构 */
export interface ToolDefinition {
  name: string;
  description?: string;
  parameters?: Record<string, any>;
  [key: string]: any;
}

/**
 * 获取当前模型的上下文窗口大小
 * 优先级: opts.contextWindow > 模型默认值 > 回退值
 */
export function getModelContextWindow(
  contextWindow?: number,
  modelConfig?: { baseURL?: string; modelName?: string; provider?: string },
): number {
  if (contextWindow && contextWindow > 0) return contextWindow;

  // 常见模型上下文窗口映射
  const knownWindows: Record<string, number> = {
    'gpt-4o': 128000,
    'gpt-4o-mini': 128000,
    'gpt-4-turbo': 128000,
    'gpt-4': 8192,
    'gpt-3.5-turbo': 16385,
    'claude-3-opus': 200000,
    'claude-3-sonnet': 200000,
    'claude-3-haiku': 200000,
    'deepseek-chat': 64000,
    'deepseek-reasoner': 64000,
    'deepseek-coder': 64000,
  };

  if (modelConfig?.modelName && knownWindows[modelConfig.modelName]) {
    return knownWindows[modelConfig.modelName];
  }

  // 回退到安全的默认值
  return 128000;
}

/**
 * 根据消息意图过滤可用工具集
 * 
 * 策略:
 *   1. 编码任务: 优先保留文件操作/搜索/执行类工具
 *   2. 研究任务: 保留搜索/抓取/知识库类工具
 *   3. 媒体任务: 保留图片/视频生成类工具
 *   4. 通用: 返回全部工具
 * 
 * 同时处理:
 *   - 用户主动选择模型时保留全部工具 (userPickedModel=true)
 *   - 强制技能模式时只保留该技能的工具 (_forceSkill)
 *   - 移除被禁用的工具 (disabledTools)
 */
export function filterToolsByIntent(
  message: string,
  allTools: ToolDefinition[],
  options?: {
    taskType?: 'coding' | 'research' | 'media' | 'industry' | 'general';
    userPickedModel?: boolean;
    forceSkill?: string | null;
    disabledTools?: Set<string>;
    capabilityTier?: 'autonomous' | 'guided' | 'supervised';
  },
): ToolDefinition[] {
  let tools = [...allTools];

  // 如果用户主动选了模型或强制技能，不过滤
  if (options?.userPickedModel || options?.forceSkill) {
    if (options?.forceSkill) {
      tools = tools.filter(t => t.name === options.forceSkill || t.name.startsWith(`${options.forceSkill}/`));
    }
    return tools;
  }

  const msgLower = message.toLowerCase();
  const taskType = options?.taskType || 'general';

  // === 意图关键词检测 ===
  const intentScores = new Map<string, number>();

  for (const tool of allTools) {
    let score = 1.0; // 基础分
    const desc = (tool.description || '').toLowerCase();
    const name = tool.name.toLowerCase();

    // 编码意图关键词
    if (/写|改|修|编|重构|debug|fix|create|edit|refactor|code|文件|file|function|class/.test(msgLower)) {
      if (/write_file|read_file|edit_file|search_files|glob|bash|execute/.test(name)) score += 2;
      else if (/search|find|grep|list/.test(name)) score += 1;
    }

    // 搜索意图关键词
    if (/搜|查|找|研究|research|search|find|look.up|what.is|who.is/.test(msgLower)) {
      if (/web_search|fetch|knowledge|memory|read_file/.test(name)) score += 2;
    }

    // 图片/媒体意图
    if (/画|图|image|picture|draw|generate.*img|截图|screenshot/.test(msgLower)) {
      if (/image_gen|screenshot|canvas|visualize/.test(name)) score += 3;
    }

    // 浏览器相关
    if (/网页|浏览器|browser|打开|open.*url|navigate|click/.test(msgLower)) {
      if (/browser|navigate|click|snapshot/.test(name)) score += 2;
    }

    // Git 相关
    if (/git|commit|push|pull|分支|branch|merge|diff/.test(msgLower)) {
      if (/git_/.test(name)) score += 3;
    }

    intentScores.set(tool.name, score);
  }

  // 按得分排序，截断到合理数量
  const maxTools = taskType === 'coding' ? 40 : taskType === 'media' ? 25 : 35;
  tools.sort((a, b) => (intentScores.get(b.name) || 1) - (intentScores.get(a.name) || 1));
  tools = tools.slice(0, maxTools);

  // 移除被禁用的工具
  if (options?.disabledTools && options.disabledTools.size > 0) {
    tools = tools.filter(t => !options.disabledTools!.has(t.name));
  }

  // supervised 模式下移除危险工具
  if (options?.capabilityTier === 'supervised') {
    const dangerous = new Set(['bash', 'execute_command', 'delete_file']);
    tools = tools.filter(t => !dangerous.has(t.name));
  }

  return tools;
}
