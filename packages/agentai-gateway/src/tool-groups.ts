/**
 * 工具分组机制 — 按需加载工具，减少上下文负担
 * ----------------------------------------------------
 * 设计理念：
 * - 工具按功能分组（文件操作、网络操作、系统操作、行业操作）
 * - 根据任务类型动态加载相关工具
 * - 根据行业角色加载行业特定工具
 * 
 * 安全守护：
 * - 高风险工具需要审批
 * - 工具名黑名单检查
 */

import { ToolRegistry, ToolEntry } from './tool-registry.js';

/**
 * 工具分组定义
 */
export const TOOL_GROUPS: Record<string, string[]> = {
    // 文件操作组
    file_ops: [
        'read_file',
        'write_file',
        'multi_edit',
        'search_content',
        'glob',
        'list_directory',
        'directory_tree',
        'find_references',
        'undo_edit'
    ],

    // 网络操作组
    web_ops: [
        'web_search',
        'web_fetch',
        'run_code',
        'browser_navigate',
        'browser_click',
        'browser_type',
        'browser_screenshot',
        'browser_extract',
        'browser_submit',
        'browser_select',
        'browser_hover',
        'browser_press_key',
        'browser_scroll',
        'browser_scroll_to',
        'browser_wait',
        'browser_scan',
        'browser_get_attribute',
        'browser_record',
        'browser_replay',
        'browser_status',
        'browser_auto',
    ],

    // 系统操作组
    system_ops: [
        'plan_task',
        'update_plan',
        'ask_user',
        'evolve_prompt',
        'remember',
        'recall_memory',
        'forget',
        'spawn_subagent',
        'create_tool'
    ],

    // Git/CI/CD操作组
    git_ops: [
        'git_status',
        'git_diff',
        'git_log',
        'git_commit',
        'git_push',
        'run_tests',
        'typecheck',
        'npm_install',
        'run_background',
        'job_output'
    ],

    // 生成操作组
    generate_ops: [
        'generate_image',
        'generate_video',
        'generate_diagram',
        'discover_or_create_skill',
        'skill_forge',
        'officecli'
    ],

    // 音乐控制组
    music_ops: [
        'control_music'
    ],

    // 行业操作组（装修）
    decoration_ops: [
        'decoration_quote',
        'decoration_proposal',
        'decoration_schedule',
        'decoration_material'
    ],

    // 行业操作组（房地产）
    real_estate_ops: [
        'real_estate_analysis',
        'property_search',
        'market_report'
    ],

    // 行业操作组（建筑施工）
    construction_ops: [
        'construction_plan',
        'safety_check',
        'material_calc'
    ]
};

/**
 * 行业工具映射
 */
export const INDUSTRY_TOOL_MAP: Record<string, string[]> = {
    decoration: TOOL_GROUPS.decoration_ops ?? [],
    real_estate: TOOL_GROUPS.real_estate_ops ?? [],
    construction: TOOL_GROUPS.construction_ops ?? [],
    software: [...(TOOL_GROUPS.file_ops ?? []), ...(TOOL_GROUPS.git_ops ?? []), ...(TOOL_GROUPS.generate_ops ?? [])],
    general: [] // 通用不加载行业特定工具
};

/**
 * 任务类型工具映射
 */
export const TASK_TYPE_TOOL_MAP: Record<string, string[]> = {
    coding: [...(TOOL_GROUPS.file_ops ?? []), ...(TOOL_GROUPS.git_ops ?? []), ...(TOOL_GROUPS.system_ops ?? []), ...(TOOL_GROUPS.generate_ops ?? [])],
    research: [...(TOOL_GROUPS.web_ops ?? []), ...(TOOL_GROUPS.system_ops ?? []), ...(TOOL_GROUPS.generate_ops ?? [])],
    general: [...(TOOL_GROUPS.file_ops ?? []), ...(TOOL_GROUPS.web_ops ?? []), ...(TOOL_GROUPS.system_ops ?? []), ...(TOOL_GROUPS.generate_ops ?? [])],
    industry: [...(TOOL_GROUPS.file_ops ?? []), ...(TOOL_GROUPS.generate_ops ?? []), ...(TOOL_GROUPS.system_ops ?? [])]
};

/**
 * 根据任务类型和行业获取相关工具列表
 */
export function getRelevantTools(
    taskType: 'coding' | 'research' | 'general' | 'industry',
    industry?: string,
    registry?: ToolRegistry
): string[] {
    // 1. 获取任务类型基础工具
    const baseTools = TASK_TYPE_TOOL_MAP[taskType] || TASK_TYPE_TOOL_MAP.general || [];

    // 2. 获取行业特定工具
    const industryTools = industry ? INDUSTRY_TOOL_MAP[industry] || [] : [];

    // 3. 合并工具列表
    const allTools = [...baseTools, ...industryTools];

    // 4. 如果有registry，检查工具是否真实存在
    if (registry) {
        const registeredTools = registry.list().map(t => t.name);
        return allTools.filter(t => registeredTools.includes(t));
    }

    return allTools;
}

/**
 * 构建工具定义片段（用于注入到system prompt）
 */
export function buildToolsFragment(toolNames: string[], registry?: ToolRegistry): string {
    if (!registry) {
        return `\n## 可用工具\n${toolNames.join(', ')}`;
    }

    const tools = registry.list().filter(t => toolNames.includes(t.name));
    const toolDescriptions = tools.map(t => `- **${t.name}**: ${t.description}`).join('\n');

    return `\n## 可用工具（按需加载）\n${toolDescriptions}`;
}

/**
 * 工具风险等级检查
 */
export function checkToolRisk(toolName: string, registry?: ToolRegistry): 'low' | 'medium' | 'high' | 'critical' {
    if (!registry) return 'medium';

    const tool = registry.get(toolName);
    if (!tool) return 'medium';

    return tool.riskLevel;
}

/**
 * 高风险工具需要审批
 */
export function needsApproval(toolName: string, args: Record<string, any>): boolean {
    // 1. 检查工具风险等级
    const riskLevel = checkToolRisk(toolName);
    if (riskLevel === 'critical') return true;

    // 2. 检查参数是否包含危险路径
    const dangerousPaths = ['/etc', '/usr', '/bin', '/sbin', 'C:\\Windows', 'C:\\Program Files'];
    for (const key of Object.keys(args)) {
        const value = String(args[key]);
        if (dangerousPaths.some(p => value.includes(p))) {
            return true;
        }
    }

    // 3. 检查是否在信任白名单中（由agentai-loop.ts管理）
    // 这里只做基础检查，白名单检查在主循环中完成

    return false;
}