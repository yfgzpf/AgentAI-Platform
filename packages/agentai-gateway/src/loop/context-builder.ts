/**
 * 上下文构建器
 * 从 agentai-loop.ts 提取 buildImmutablePrefix 方法的核心结构
 * 
 * 注意: 这是一个重构版本，将原方法拆分为多个小函数
 * 原方法约 1500 行，这里采用更清晰的模块化设计
 */

import { ChatMessage } from '../llm-router.js';
import { ContextBuildOptions, TaskType } from './types.js';

/**
 * 构建不可变前缀上下文
 * 这是主入口函数，替代原 buildImmutablePrefix 方法
 */
export async function buildImmutablePrefix(
  messages: ChatMessage[],
  options: ContextBuildOptions
): Promise<ChatMessage[]> {
  const systemMsgs: ChatMessage[] = [];
  
  // 1. 检测任务类型
  const taskInfo = detectTaskInfo(messages, options);
  
  // 2. 构建系统身份提示
  const identityPrompt = buildIdentityPrompt(options, taskInfo);
  systemMsgs.push({ role: 'system', content: identityPrompt });
  
  // 3. 构建工具定义提示
  const toolsPrompt = buildToolsPrompt(options);
  if (toolsPrompt) {
    systemMsgs.push({ role: 'system', content: toolsPrompt });
  }
  
  // 4. 构建用户上下文提示
  const userContextPrompt = buildUserContextPrompt(options, taskInfo);
  if (userContextPrompt) {
    systemMsgs.push({ role: 'system', content: userContextPrompt });
  }
  
  // 5. 构建工作区上下文
  const workspacePrompt = await buildWorkspacePrompt(options);
  if (workspacePrompt) {
    systemMsgs.push({ role: 'system', content: workspacePrompt });
  }
  
  // 6. 添加用户传入的额外 system messages
  const userSystemMsgs = messages.filter(m => m.role === 'system');
  systemMsgs.push(...userSystemMsgs);
  
  // 7. 模式专用提示
  const modePrompt = buildModeSpecificPrompt(options);
  if (modePrompt) {
    systemMsgs.push({ role: 'system', content: modePrompt });
  }
  
  return systemMsgs;
}

/**
 * 检测任务信息
 */
function detectTaskInfo(
  messages: ChatMessage[],
  options: ContextBuildOptions
): { taskType: TaskType; userIndustry: string; keywords: string[] } {
  const userMessage = messages.filter(m => m.role === 'user').pop()?.content || '';
  const text = typeof userMessage === 'string' ? userMessage : '';
  
  // 简化的任务类型检测
  let taskType: TaskType = 'general';
  if (/代码|编程|函数|类|接口|bug|修复|重构|code|program|function|class/i.test(text)) {
    taskType = 'coding';
  } else if (/研究|调研|搜索|分析|research|investigate|analyze/i.test(text)) {
    taskType = 'research';
  } else if (options.opts.workspace?.includes('industry') || /行业|业务|商业|industry|business/i.test(text)) {
    taskType = 'industry';
  }
  
  // 提取关键词
  const keywords = extractKeywords(text);
  
  return {
    taskType,
    userIndustry: 'general',
    keywords
  };
}

/**
 * 提取关键词
 */
function extractKeywords(text: string): string[] {
  // 简单的关键词提取
  const words = text
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2)
    .filter(w => !STOP_WORDS.has(w));
  
  // 去重并取前 10 个
  return [...new Set(words)].slice(0, 10);
}

/** 停用词 */
const STOP_WORDS = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '那', '这些', '那些', '这个', '那个',
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'and', 'but', 'if', 'or', 'because', 'until', 'while', 'this', 'that'
]);

/**
 * 构建身份提示
 */
function buildIdentityPrompt(
  options: ContextBuildOptions,
  taskInfo: { taskType: TaskType }
): string {
  const { opts } = options;
  const mode = opts.mode || 'auto';
  
  let prompt = `# AI 身份\n你是 AgentAI，一个智能编程助手。`;
  
  if (mode === 'review') {
    prompt += `\n当前处于审查模式，你只能读取和分析代码，不能修改文件。`;
  } else if (mode === 'planning') {
    prompt += `\n当前处于规划模式，你先制定执行计划，等待用户确认后再执行。`;
  } else if (mode === 'readonly') {
    prompt += `\n当前处于只读模式，你只能回答问题，不能调用工具。`;
  }
  
  prompt += `\n\n任务类型: ${taskInfo.taskType}`;
  prompt += `\n工作区: ${opts.workspace || '当前目录'}`;
  
  return prompt;
}

/**
 * 构建工具定义提示
 */
function buildToolsPrompt(options: ContextBuildOptions): string | null {
  const { opts } = options;
  
  // 只读模式不显示工具
  if (opts.mode === 'readonly') {
    return null;
  }
  
  // planning/review 模式显示只读工具说明
  if (opts.mode === 'planning' || opts.mode === 'review') {
    return `# 可用工具 (只读模式)\n你只能使用以下工具:\n- read_file: 读取文件内容\n- list_directory: 列出目录\n- directory_tree: 目录树\n- search_codebase: 搜索代码\n- web_fetch: 获取网页\n- ask_user: 询问用户`;
  }
  
  // auto 模式显示完整工具说明
  return `# 可用工具\n你可以使用各种工具完成任务，包括:\n- 文件操作: read_file, write_file, list_directory, directory_tree\n- 代码编辑: multi_edit, create_directory, copy_file, move_file, delete_file\n- 搜索: search_content, search_codebase, web_search, web_fetch\n- 任务规划: plan_task, update_plan, spawn_subagent\n- 记忆: remember, recall_memory\n- Git: git_status, git_diff\n- 生成: generate_image, generate_video, generate_diagram`;
}

/**
 * 构建用户上下文提示
 */
function buildUserContextPrompt(
  options: ContextBuildOptions,
  taskInfo: { taskType: TaskType; keywords: string[] }
): string | null {
  const { opts, emotionHistory } = options;
  
  let prompt = '';
  
  // 用户情绪历史
  if (emotionHistory.length > 0) {
    const recentEmotions = emotionHistory.slice(-3);
    prompt += `\n# 用户情绪历史\n`;
    recentEmotions.forEach(e => {
      prompt += `- ${e.emotion} (强度: ${e.intensity})\n`;
    });
  }
  
  // 关键词
  if (taskInfo.keywords.length > 0) {
    prompt += `\n# 任务关键词\n${taskInfo.keywords.join(', ')}`;
  }
  
  // 当前打开的文件
  if (opts.activeFile) {
    prompt += `\n\n# 当前编辑文件\n${opts.activeFile}`;
  }
  
  return prompt || null;
}

/**
 * 构建工作区上下文提示
 */
async function buildWorkspacePrompt(
  options: ContextBuildOptions
): Promise<string | null> {
  const { opts } = options;
  const workspace = opts.workspace;
  
  if (!workspace) return null;
  
  // 这里简化处理，实际应该调用 list_directory 获取目录结构
  return `# 工作区\n路径: ${workspace}\n\n你可以使用 list_directory 和 directory_tree 工具探索项目结构。`;
}

/**
 * 构建模式专用提示
 */
function buildModeSpecificPrompt(options: ContextBuildOptions): string | null {
  const { opts } = options;
  
  if (opts.mode === 'review') {
    return `# 审查模式 (Review Mode)\n你是一名资深代码审查专家。请对用户指定的代码/文件/项目进行全面审查，按以下结构输出审查报告：\n\n## 审查报告模板\n### 1. 🔒 安全风险\n- 检查硬编码密钥、SQL注入、XSS、路径遍历、不安全的依赖等\n\n### 2. ⚡ 性能问题\n- 检查不必要的循环、内存泄漏、N+1查询、阻塞操作等\n\n### 3. 🎨 代码质量\n- 检查命名规范、代码重复、复杂度过高的函数、缺失错误处理等\n\n### 4. 📋 最佳实践\n- 检查是否遵循语言/框架的最佳实践、设计模式是否合理\n\n**重要**: 审查模式下你只能读取文件，不能修改任何代码！`;
  }
  
  if (opts.mode === 'planning') {
    return `# 规划模式 (Planning Mode)\n请先制定详细的执行计划，包括:\n1. 任务分解步骤\n2. 每步需要的工具\n3. 预计完成时间\n4. 可能的风险\n\n等待用户确认计划后再开始执行。`;
  }
  
  return null;
}

/**
 * 获取指令内容
 */
export function getDirectivesContent(options: ContextBuildOptions): string {
  return options.directives.getAllForPrompt();
}
