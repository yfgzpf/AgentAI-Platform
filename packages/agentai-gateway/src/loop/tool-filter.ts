/**
 * 工具过滤逻辑
 * 从 agentai-loop.ts 提取
 *
 * 【分层工具加载优化】
 * - CORE_TOOLS: 永远包含 (~35 个核心工具)
 * - TASK_GROUP_TOOLS: 按任务类型分组 (coding/research/media/industry/system)
 * - INTENT_TOOLS: 意图关键词触发额外工具
 *
 * 总工具 141 → 每次实际发送 40-60 个，节省 40-60% token
 */

import { ToolFilterOptions, RunMode, CapabilityTier, TaskType } from './types.js';

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
  'remember', 'recall_memory', 'forget',
  // 项目探索 (高频)
  'explore_project',
  // Git (开发者基本需求)
  'git_status', 'git_diff', 'git_log',
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
  // 代码智能工具
  'find_references', 'get_outline', 'run_tests', 'typecheck',
]);

/** 工具分组 — 按任务类型分层加载 */
export const TASK_GROUP_TOOLS: Record<TaskType, string[]> = {
  // 编码任务: 代码相关工具
  coding: [
    'create_directory', 'copy_file', 'move_file', 'delete_file',
    'get_file_info', 'diff_preview', 'undo_edit',
    'git_branch', 'git_commit', 'git_push', 'git_pull', 'git_clone',
    'git_smart_commit', 'git_worktree',
  ],
  // 研究任务: 搜索和分析工具
  research: [
    'glob', 'find_references', 'get_outline',
    'validate_and_fix', 'remember_project', 'recall_project',
    'industry_insight', 'self_diagnose',
  ],
  // 创意媒体任务: 生成和创作工具
  media: [
    'render_widget', 'generate_novel', 'generate_comic_script',
    'generate_drama_script', 'export_content',
    'publish_wechat_article', 'publish_douyin_video', 'publish_xiaohongshu_note',
    'multi_platform_publish', 'adapt_content_for_platform',
    'control_music',
  ],
  // 行业任务: 垂直领域工具
  industry: [
    'knowledge_import', 'parse_cad_drawing', 'generate_quotation',
    'generate_45_degree_view', 'generate_quotation_cover', 'generate_quotation_ppt',
    'cad_control', 'calcGroutMeters',
    'follow_up_customer', 'customer_search',
  ],
  // 系统管理任务: 自动化和运维工具
  general: [
    'send_notification', 'notification_history',
    'schedule_task', 'list_schedules',
    'workflow_run', 'workflow_list_templates', 'workflow_create',
    'workflow_history', 'workflow_generate', 'workflow_export', 'workflow_import',
    'automation_create', 'automation_list', 'automation_update', 'automation_delete',
    'chain_advance', 'chain_mark', 'submit_report',
    'visual_gui_agent', 'self_modify',
  ],
};

/** 只读工具子集 (planning / review 模式共用) */
export const READONLY_TOOLS = [
  'read_file', 'list_directory', 'directory_tree', 'search_codebase', 'web_fetch', 'ask_user'
];

/** 意图→工具组映射 — 关键词触发额外工具 */
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
  { pattern: /视频|video|动画|短片/i, tools: ['generate_video', 'query_video', 'query_seedance_task', 'wait_for_seedance_video'] },
  // 图表
  { pattern: /图表|流程|架构|diagram|chart/i, tools: ['generate_diagram'] },
  // 屏幕视觉
  { pattern: /截屏|截图|看屏幕|屏幕上|看到|screen.*shot|capture/i, tools: ['capture_screen', 'capture_and_read', 'ocr_image'] },
  // 窗口控制
  { pattern: /窗口|最小化|最大化|置顶|window/i, tools: ['list_windows', 'window_control'] },
  // 浏览器
  { pattern: /浏览器|打开|访问|跳转|browse|navigate|click|fill|submit|scroll/i, tools: ['browser_navigate', 'browser_click', 'browser_fill', 'browser_submit', 'browser_scroll', 'browser_screenshot', 'browser_evaluate', 'browser_extract', 'browser_submit', 'browser_upload', 'browser_tabs', 'browser_set_cookies', 'browser_wait_for', 'browser_select', 'browser_hover', 'browser_press_key', 'browser_scroll_to', 'browser_get_attribute', 'browser_scan', 'browser_snapshot', 'browser_click_by_index', 'browser_close', 'browser_type_by_index', 'browser_record', 'browser_replay'] },
  // 桌面自动化
  { pattern: /桌面|点击|输入|自动化|desktop|click|type|automation|rpa/i, tools: ['desktop_automate', 'desktop_click', 'desktop_type', 'desktop_screenshot', 'desktop_find_image', 'desktop_wait', 'visual_gui_agent'] },
  // CAD/设计
  { pattern: /CAD|图纸|设计|建模|cad|drawing|design|model/i, tools: ['cad_command', 'cad_query', 'cad_export', 'parse_cad_drawing'] },
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
  // 渗透测试
  { pattern: /漏洞|渗透|poc|generate_poc|security|scan/i, tools: ['generate_poc'] },
  // 3D 建筑
  { pattern: /pascal|建筑|3d|建模|墙体|门窗|屋顶/i, tools: ['pascal_start', 'pascal_stop', 'pascal_create_wall', 'pascal_place_opening', 'pascal_generate_roof', 'pascal_create_floor', 'pascal_export_model', 'pascal_import_ifc'] },
  // 远程开发
  { pattern: /远程|server|deploy/i, tools: ['read_file_remote', 'write_file_remote', 'list_directory_remote', 'run_shell_command_remote', 'search_content_remote', 'get_remote_environment_info'] },
];

/**
 * 获取任务类型分组工具
 * @param taskType 任务类型
 * @returns 分组工具名称集合
 */
export function getTaskGroupTools(taskType: TaskType): Set<string> {
  const result = new Set<string>();

  // 核心工具永远包含
  CORE_TOOLS.forEach(name => result.add(name));

  // 添加任务类型分组工具
  const groupTools = TASK_GROUP_TOOLS[taskType] || [];
  groupTools.forEach(name => result.add(name));

  return result;
}

/**
 * 检查工具是否为只读工具
 */
function isReadonlyTool(tool: any): boolean {
  const name = tool.name || tool.function?.name || '';
  return READONLY_TOOLS.includes(name);
}

/**
 * 智能工具过滤 v3 — 分层加载优化
 *
 * 分层策略:
 * 1. 核心工具永远包含
 * 2. 根据任务类型添加对应分组工具
 * 3. 根据意图关键词添加额外工具
 * 4. capabilityTier=autonomous → 全量返回
 *
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
  const { mode, capabilityTier, taskType } = options;
  const msg = message.toLowerCase();

  // 只读模式: 不给任何工具
  if (mode === 'readonly') {
    return [];
  }

  // planning / review 模式: 只给只读工具
  if (mode === 'planning' || mode === 'review') {
    return allTools.filter(isReadonlyTool);
  }

  // 自主模型: 给全部工具（自主模型需要完整能力）
  if (capabilityTier === 'autonomous') {
    return allTools;
  }

  // 智能过滤: 分层匹配工具
  const matchedToolNames = getTaskGroupTools(taskType);

  // 根据意图匹配额外工具组
  for (const intent of INTENT_TOOLS) {
    if (intent.pattern.test(msg)) {
      intent.tools.forEach(name => matchedToolNames.add(name));
    }
  }

  // 过滤工具列表
  return allTools.filter(tool => {
    const name = tool.name || tool.function?.name || '';
    return matchedToolNames.has(name);
  });
}

/**
 * 统计过滤后的工具数量
 * 用于性能分析和优化监控
 */
export function countFilteredTools(
  message: string,
  allTools: any[],
  options: ToolFilterOptions
): { total: number; filtered: number; matched: string[] } {
  const filtered = filterToolsByIntent(message, allTools, options);
  const matched = filtered.map(t => t.name || t.function?.name || '');
  return {
    total: allTools.length,
    filtered: filtered.length,
    matched,
  };
}

/**
 * 获取工具名称
 */
export function getToolName(tool: any): string {
  return tool.name || tool.function?.name || '';
}
