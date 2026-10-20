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
        'undo_edit',
        'create_workspace'
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

    // ═══ 2026-10-17 渗透测试操作组 (security_ops) ═══
    // 背景: 这 9 个工具此前**一个都没进任何工具组** —— 而 TASK_TYPE_TOOL_MAP 按组发工具,
    //   于是无论什么任务类型, AI 都看不到渗透工具, "进不了挖洞上下文"是必然的。
    //   再叠加 security 键缺失(静默回退 general), 挖洞任务实际拿到的是通用文件+浏览器工具。
    // ⚠️ 安全边界不因此放宽: 所有攻击类工具仍各自过 scope_guard 授权闸门
    //   (pentest-scope-guard.ts 默认拒绝, 无 scope.json 一律拒), 本组只是让工具"可见可用"。
    security_ops: [
        'wsl_scan',             // Kali 扫描器驱动 (nmap/nuclei/sqlmap/ffuf/... 8 个白名单)
        'wsl_exec',             // WSL 数组化执行 (绕开 cmd.exe, 修四层嵌套的引号破坏)
        'enum_subdomains',      // 证书透明度/子域枚举
        'extract_js_endpoints', // JS 端点提取
        'http_replay',          // Burp Repeater 式请求重放
        'diff_replay',          // 双身份响应差异对比 (越权/未授权判定核心)
        'fingerprint_target',   // 技术栈指纹 → 定向攻击面
        'identity_manage',      // 多身份凭证池 (双账号 BOLA 前提)
        'request_mutator',      // 请求变异引擎 (网关/框架差异绕过)
        'recheck_finding',      // 提交后状态复核 (修复证据)
        'historical_assets',    // Wayback/Common Crawl 历史资产
        'js_deep_scan',         // JS 深挖: 端点/source map/密钥/内网
        'duplicate_check',      // 提交前查重
        'batch_pentest',        // 批量挖洞
        'pentest_pipeline',     // 四角色串链编排 (planner→recon→exploit→validator)
        'scope_guard',          // 授权范围校验 (AI 动手前必调)
        'grant_scope',          // 授权管理
        'list_scope',           // 查看当前授权范围
        'report_vulnerability', // 漏洞上报落盘
        'save_evidence',        // 证据固化 (截图/文本)
        'save_and_hash_evidence', // 防篡改证据包 (SHA-256, 赏金提交硬通货)
        // ── 2026-10-19: 经验/漏洞库三件套 (此前只有四角色子智能体有, 主对话挖洞时"失忆") ──
        // 事故: searchExperience/formatExperienceBrief 实现完整但**零调用方**, 经验只写不读;
        //   而主对话的 security_ops 组又没带这 3 个工具 → 主对话挖洞永远从零开始,
        //   重复踩别人/自己踩过的坑。开工前查一次历史, 收尾记一条, 才能形成复利。
        'search_pentest_experience', // 召回历史成功/失败手法
        'search_vulns',               // 召回同类资产历史漏洞
        'record_pentest_experience',  // 收尾固化本轮经验
        'bounty_report',              // engagement 级报告聚合 (断头路的终点)
        'oob_register',              // OOB 盲测回连注册
        'oob_check',                 // OOB 回连查询 (盲测确认)
        'save_target_state',        // 长周期目标状态记忆 (跨会话继承进度)
        'load_target_state',        // 目标状态读回
        'classify_response',        // 响应识别 WAF/限流/验证码
        'impact_proof',             // 影响证明链 (决定报告能不能过审)
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
    ],

    // 行业操作组（医疗/中医）(2026-08-07)
    medical_ops: [
        'analyze_symptom',
        'generate_health_report',
        'query_drug_info',
        'tcm_diagnose',           // 中医辨证
        'tcm_classic_search',     // 古籍检索
        'tcm_case_match',         // 医案匹配
        'tcm_herb_query',         // 药材查询
        'tcm_wellness_plan'       // 养生调理
    ]
};

/**
 * 行业工具映射
 */
export const INDUSTRY_TOOL_MAP: Record<string, string[]> = {
    decoration: TOOL_GROUPS.decoration_ops ?? [],
    real_estate: TOOL_GROUPS.real_estate_ops ?? [],
    construction: TOOL_GROUPS.construction_ops ?? [],
    medical: TOOL_GROUPS.medical_ops ?? [],  // ★ 医疗/中医 (2026-08-07)
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
    industry: [...(TOOL_GROUPS.file_ops ?? []), ...(TOOL_GROUPS.generate_ops ?? []), ...(TOOL_GROUPS.system_ops ?? [])],
    // ═══ 2026-10-17 新增 security (渗透/漏洞挖掘) ═══
    // 修硬 bug: 此前此键**缺失**, detectTaskType 返回 'security' 时被 `|| general` 静默兜底
    //   → 挖洞任务只拿到通用文件+浏览器工具, 9 个渗透工具一个都不见。
    // 组合: 渗透专用 + 浏览器 (Web 类挖洞要用) + 文件 (读写 PoC/报告) + 系统 (规划/记忆/子智能体)
    // 有意不含 generate_ops —— 挖洞不需要生图/视频, 塞进来只会稀释注意力
    security: [
        ...(TOOL_GROUPS.security_ops ?? []),
        ...(TOOL_GROUPS.web_ops ?? []),
        ...(TOOL_GROUPS.file_ops ?? []),
        ...(TOOL_GROUPS.system_ops ?? []),
    ],
};

/**
 * 根据任务类型和行业获取相关工具列表
 */
export function getRelevantTools(
    taskType: 'coding' | 'research' | 'media' | 'industry' | 'security' | 'general',
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