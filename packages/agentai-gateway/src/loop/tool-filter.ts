/**
 * 工具过滤逻辑
 * 从 agentai-loop.ts 提取
 */

import { ToolFilterOptions, RunMode, CapabilityTier } from './types.js';

/** 核心工具: 永远包含 — 这些是 AI 的"基本感官" */
export const CORE_TOOLS = new Set([
  // 文件操作 (基本感官)
  'read_file', 'write_file', 'list_directory', 'search_content', 'directory_tree',
  // 交互 (基本感官)
  'ask_user', 'run_code',
  // 编辑 (高频)
  'multi_edit',
  // 搜索 (高频)
  'web_search', 'web_fetch', 'search_codebase',
  // 任务规划 (高频)
  'plan_task', 'update_plan', 'spawn_subagent',
  // 记忆 (高频)
  'remember', 'recall_memory',
  // 项目探索 (高频)
  'explore_project',
  // Git (开发者基本需求)
  'git_status', 'git_diff',
  // 依赖管理 (自主修复需要)
  'npm_install',
  // Office (高频业务需求)
  'officecli',
  // 后台进程 (长任务需要)
  'run_background', 'job_output',
  // 生成能力 (通用能力)
  'generate_image', 'generate_video', 'query_video', 'generate_diagram',
  // 技能发现/创建/锻造
  'discover_or_create_skill', 'skill_forge', 'evolve_prompt', 'create_tool',
]);

/** 只读工具子集 (planning / review 模式共用) */
export const READONLY_TOOLS = [
  'read_file', 'list_directory', 'directory_tree', 'search_codebase', 'web_fetch', 'ask_user'
];

/** 意图→工具组映射 */
export const INTENT_TOOLS: Array<{ pattern: RegExp; tools: string[] }> = [
  // 文件编辑
  { pattern: /编辑|修改|改|重构|替换|edit|modify|refactor/i, tools: ['multi_edit', 'create_directory', 'copy_file', 'move_file', 'delete_file', 'get_file_info', 'find_references', 'get_outline', 'run_tests', 'diff_preview', 'undo_edit'] },
  // 搜索
  { pattern: /搜索|查找|查|找|search|find|grep/i, tools: ['search_content', 'search_codebase', 'web_search', 'web_fetch', 'find_references', 'glob'] },
  // 网络
  { pattern: /网|链接|url|http|搜|百度|google|网页/i, tools: ['web_search', 'web_fetch'] },
  // 图片生成
  { pattern: /图|画|图片|image|picture|海报|效果图|插画/i, tools: ['generate_image'] },
  // 视频生成
  { pattern: /视频|video|动画|短片/i, tools: ['generate_video', 'query_video'] },
  // 图表
  { pattern: /图表|流程|架构|diagram|chart/i, tools: ['generate_diagram'] },
  // 屏幕视觉
  { pattern: /截屏|截图|看屏幕|屏幕上|看到|screen.*shot|capture/i, tools: ['capture_screen', 'capture_and_read', 'ocr_image'] },
  // 窗口控制
  { pattern: /窗口|最小化|最大化|置顶|window/i, tools: ['list_windows', 'window_control'] },
  // 记忆
  { pattern: /记忆|记住|remember|recall|偏好/i, tools: ['remember', 'recall_memory', 'forget'] },
  // 浏览器
  { pattern: /浏览器|打开|访问|跳转|browse|navigate|click|fill|submit|scroll/i, tools: ['browser_navigate', 'browser_click', 'browser_fill', 'browser_submit', 'browser_scroll', 'browser_screenshot', 'browser_evaluate'] },
  // 桌面自动化
  { pattern: /桌面|点击|输入|自动化|desktop|click|type|automation|rpa/i, tools: ['desktop_automate', 'desktop_click', 'desktop_type', 'desktop_screenshot', 'desktop_find_image', 'desktop_wait'] },
  // CAD/设计
  { pattern: /CAD|图纸|设计|建模|cad|drawing|design|model/i, tools: ['cad_command', 'cad_query', 'cad_export'] },
  // 代码审查
  { pattern: /审查|review|检查|分析|audit|inspect/i, tools: ['read_file', 'search_codebase', 'get_outline', 'find_references', 'run_tests', 'diff_preview'] },
  // Worktree
  { pattern: /worktree|分支|branch|切换|checkout/i, tools: ['git_worktree', 'git_branch', 'git_checkout'] },
  // 数据库
  { pattern: /数据库|sql|查询|db|database|query/i, tools: ['database_query', 'database_schema', 'database_execute'] },
  // 测试
  { pattern: /测试|test|jest|pytest|unittest/i, tools: ['run_tests', 'discover_tests', 'debug_test'] },
  // 调试
  { pattern: /调试|debug|断点|breakpoint/i, tools: ['debug_start', 'debug_step', 'debug_continue', 'debug_evaluate'] },
];

/**
 * 检查工具是否为只读工具
 */
function isReadonlyTool(tool: any): boolean {
  const name = tool.name || tool.function?.name || '';
  return READONLY_TOOLS.includes(name);
}

/**
 * 智能工具过滤 v2
 * 根据消息意图和运行模式智能过滤工具
 * @param message 用户消息
 * @param allTools 所有可用工具
 * @param options 过滤选项
 * @returns 过滤后的工具列表
 */
export function filterToolsByIntent(
  message: string,
  allTools: any[],
  options: ToolFilterOptions
): any[] {
  const { mode, capabilityTier } = options;
  const msg = message.toLowerCase();

  // 只读模式: 不给任何工具
  if (mode === 'readonly') {
    return [];
  }

  // planning / review 模式: 只给只读工具
  if (mode === 'planning' || mode === 'review') {
    return allTools.filter(isReadonlyTool);
  }

  // 自主模型: 给全部工具
  if (capabilityTier === 'autonomous') {
    return allTools;
  }

  // 智能过滤: 根据意图匹配工具组
  const matchedToolNames = new Set<string>();

  // 1. 始终包含核心工具
  CORE_TOOLS.forEach(name => matchedToolNames.add(name));

  // 2. 根据意图匹配工具组
  for (const intent of INTENT_TOOLS) {
    if (intent.pattern.test(msg)) {
      intent.tools.forEach(name => matchedToolNames.add(name));
    }
  }

  // 3. 过滤工具列表
  return allTools.filter(tool => {
    const name = tool.name || tool.function?.name || '';
    return matchedToolNames.has(name);
  });
}

/**
 * 获取工具名称
 */
export function getToolName(tool: any): string {
  return tool.name || tool.function?.name || '';
}
