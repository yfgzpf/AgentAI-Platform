/**
 * tool-description-compressor — 工具描述压缩器
 * ----------------------------------------------------
 * 为 guided/supervised 模型提供精简的工具描述，减少 token 消耗。
 * 不影响工具功能，只改 description 字段。
 * 
 * autonomous 模型仍然使用完整的工具描述。
 * 
 * 学自: Reasonix 工具描述压缩策略
 */

/** 短描述映射: 工具名 → ≤15 字描述 */
const SHORT_DESC: Record<string, string> = {
  // === 文件操作 ===
  'read_file': '读取文件',
  'write_file': '写入文件: path+content, 自动备份+diff验证',
  'edit_file': '查找替换编辑 (path+search+replace)',
  'multi_edit': '批量多文件编辑: edits数组[{path, search, replace}], 自动备份',
  'create_directory': '创建目录',
  'delete_file': '删除文件',
  'delete_directory': '删除目录',
  'copy_file': '复制文件/目录',
  'move_file': '移动/重命名',
  'get_file_info': '查看文件信息',
  'search_files': '按名搜索文件',
  'search_content': '搜索文件内容',
  'glob': '文件模式匹配',
  'directory_tree': '目录树结构',
  'list_directory': '列出目录',

  // === 代码 ===
  'run_code': '执行代码片段',
  'run_command': '执行Shell命令',
  'run_background': '后台启动进程',
  'get_symbols': '文件符号列表',
  'find_references': '查找符号引用',
  'get_outline': '文件大纲',
  'analyze_code': '代码分析',

  // === 网络 ===
  'web_search': '搜索互联网',
  'web_fetch': '下载URL内容',

  // === 媒体 ===
  'generate_image': 'AI文生图',
  'generate_video': 'AI文生视频',
  'query_video': '查询视频任务',

  // === 系统 ===
  'control_music': '控制音乐播放',
  'set_volume': '设置音量',
  'capture_screen': '截取屏幕',
  'capture_and_read': '截图+OCR',
  'lock_screen': '锁定屏幕',

  // === 浏览器 ===
  'browser_navigate': '导航到URL',
  'browser_click': '点击元素',
  'browser_type': '输入文字',
  'browser_screenshot': '浏览器截图',
  'browser_extract': '提取页面内容',

  // === 桌面 ===
  'desktop_automate': '桌面自动化',
  'open_application': '打开应用',

  // === 决策 ===
  'ask_user': '向用户提问',
  'plan_task': '规划任务步骤',
  'update_plan': '更新任务进度',
  'approve_file_change': '审批文件修改',

  // === 元能力 ===
  'remember': '保存记忆',
  'recall_memory': '读取记忆',
  'forget': '删除记忆',
  'evolve_prompt': '自我改进规则',
  'create_tool': '创建新工具',
  'discover_or_create_skill': '发现/创建技能',
  'spawn_subagent': '启动子Agent',

  // === 自动化 (新) ===
  'create_cron_job': '创建定时任务',
  'list_cron_jobs': '查看定时任务',
  'delete_cron_job': '删除定时任务',
  'create_automation_rule': '创建自动规则',
  'list_automation_rules': '查看自动规则',
  'toggle_automation': '暂停/恢复规则',

  // === MCP (新) ===
  'create_mcp_server': '连接MCP服务器',
  'list_mcp_servers': '查看MCP服务器',
  'remove_mcp_server': '断开MCP服务器',

  // === Git ===
  'git_status': '查看仓库状态',
  'git_diff': '查看文件差异',
  'git_log': '查看提交历史',
  'git_commit': '创建提交',
  'git_branch': '管理分支',
  'git_smart_commit': '智能提交',

  // === LLM 路由 ===
  'select_model': '切换AI模型',
  'save_api_key': '保存API密钥',

  // === 行业 ===
  'industry_insight': '行业洞察分析',

  // === 测试 ===
  'run_tests': '运行测试',
  'run_linter': '运行代码检查',

  // === 其他 ===
  'schedule_task': '延迟执行任务',
  'workflow_run': '运行业务流程',
  'send_notification': '发送通知',
  'generate_diagram': '生成图表',
  'ocr_image': '图片文字识别',
  'self_diagnose': '系统自检',
  'webhook_trigger': '触发Webhook',
  'calculate': '执行计算',
  'encode_content': '编码内容',
  'decode_content': '解码内容',
  'set_volumn': '设置音量',
  'list_windows': '列出窗口',
  'window_control': '控制窗口',
  'activate_expert': '激活专家模式',
  'explore_project': '探索项目',
  'ask_followup': '追问用户',
  'examine': '详细检查',
  'officecli': 'Office文档处理',
  'evaulation': '评估结果',
  'search_experts': '搜索专家',
  'execute_command': '执行命令',
  'apply_patch': '应用补丁',
  'str_replace_editor': '字符串替换编辑',
  'write': '写入内容',
  'Bash': '执行Bash命令',
  'PowerShell': '执行PowerShell',
  'execute_bash': '执行Bash命令',
  'execute_powershell': '执行PowerShell',
  'set_env': '设置环境变量',
  'get_env': '获取环境变量',
  'render_react_component': '渲染React组件',
  'render_html': '渲染HTML',
  'preview_site': '预览网站',
  'read_notifications': '读取通知',
  'search_codebase': '搜索代码库',
  'cad_control': 'CAD控制',
  'wechat_bot': '微信Bot',
  'connect_qq_bot': '连接QQ Bot',
  'visual_gui_agent': '视觉GUI代理',
  'worktree_create': '创建Worktree',
  'worktree_list': '列出Worktree',
  'worktree_remove': '删除Worktree',
  'focus_on_file': '聚焦文件',
  'codelens': '代码透镜',
};

/**
 * 压缩工具描述列表
 * @param tools 原始工具列表 (from toLLMTools())
 * @param mode 'compact' (default) 或 'full'
 * @returns 压缩后的工具列表 (只改 description 字段)
 */
export function compressToolDescriptions(
  tools: Array<{ name: string; description: string; parameters?: any }>,
  mode: 'compact' | 'full' = 'compact',
): Array<{ name: string; description: string; parameters?: any }> {
  if (mode === 'full') return tools;

  return tools.map(t => {
    const shortDesc = SHORT_DESC[t.name];
    if (shortDesc) {
      return { ...t, description: shortDesc };
    }
    // 未映射的工具: 保留原描述但截断至前 40 字
    if (t.description && t.description.length > 40) {
      return { ...t, description: t.description.slice(0, 40) + '...' };
    }
    return t;
  });
}

/**
 * 统计压缩前后 token 节省量
 */
export function estimateTokenSaving(
  tools: Array<{ name: string; description: string }>,
): { before: number; after: number; saved: number; pct: string } {
  const before = tools.reduce((s, t) => s + t.description.length, 0);
  const compressed = compressToolDescriptions(tools);
  const after = compressed.reduce((s, t) => s + t.description.length, 0);
  const saved = before - after;
  return {
    before,
    after,
    saved,
    pct: before > 0 ? ((saved / before) * 100).toFixed(1) + '%' : '0%',
  };
}
