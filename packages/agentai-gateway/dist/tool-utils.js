/**
 * 工具结果格式化 + 文件安全检查 — 从 agentai-loop.ts 提取
 *
 * 包含:
 *   - formatToolResult: 将工具返回值标准化为字符串 (供 LLM 消费)
 *   - isSafeFileModification: 判断文件操作是否安全 (自动审批/需人工确认)
 *
 * 原位置: agentai-loop.ts 行 ~5578-5632, 5643-5700
 * 提取理由: 纯逻辑函数，置信度 88%+
 */
import * as fs from 'fs';
/**
 * 将工具返回值标准化为字符串 (供 LLM 消费)
 * 规则:
 *   1. 字符串 → 直接返回
 *   2. 对象 → JSON.stringify (缩进2格, 截断20000字符)
 *   3. null/undefined → "[无返回内容]"
 *   4. Error → 提取 message + stack
 */
export function formatToolResult(r, call) {
    if (typeof r === 'string')
        return r;
    if (r === null || r === undefined)
        return '[无返回内容]';
    if (r instanceof Error) {
        const msg = r.message || String(r);
        return `[Error] ${msg}${r.stack ? `\n${r.stack}` : ''}`;
    }
    // 对象类型 → JSON 序列化
    try {
        const s = JSON.stringify(r, null, 2);
        return s.length > 20000 ? s.slice(0, 20000) + '\n... [截断]' : s;
    }
    catch {
        return `[无法序列化的返回值] ${String(r)}`;
    }
}
/**
 * 判断文件操作是否安全 (用于自动审批 vs 需人工确认)
 *
 * 安全规则:
 *   1. 删除操作: 只允许临时/缓存/测试文件
 *   2. 创建新文件: 自动通过 (非删除操作)
 *   3. 修改非核心文件: 测试/配置/文档/临时/GUI包 → 自动通过
 *   4. 修改 gateway 自身代码: 需要严格审批
 *   5. 默认保守: 需要审批
 *
 * @param toolName 工具名称 (如 write_file / delete_file)
 * @param filePath 目标文件路径
 * @returns true = 可自动执行, false = 需要用户确认
 */
export function isSafeFileModification(toolName, filePath) {
    // 1. 删除操作：更严格检查
    if (toolName === 'delete_file') {
        const safeDeletePatterns = [
            /\/tmp\//, /\/temp\//, /\/cache\//, /\/\.cache\//,
            /\/test\//, /\/tests\//, /\/__tests__\//,
            /\.test\./, /\.spec\./, /\.tmp$/, /\.bak$/,
        ];
        return safeDeletePatterns.some(p => p.test(filePath));
    }
    // 2. 创建新文件：自动通过（非删除）
    if (toolName === 'write_file') {
        try {
            if (!fs.existsSync(filePath)) {
                console.log(`[智能决策] 创建新文件，自动批准: ${filePath}`);
                return true;
            }
        }
        catch {
            return false;
        }
    }
    // 3. 修改非核心文件：自动通过
    const safeModifyPatterns = [
        // 测试文件
        /\/test\//, /\/tests\//, /\/__tests__\//, /\.test\./, /\.spec\./,
        // 配置文件
        /\.json$/, /\.yaml$/, /\.yml$/, /\.toml$/, /\.ini$/, /\.env\.example$/,
        // 文档文件
        /\.md$/, /\.txt$/, /\.rst$/, /\.adoc$/,
        // 临时文件
        /\/tmp\//, /\/temp\//, /\.tmp$/, /\.log$/,
        // 用户工作空间文件（非gateway自身）
        /^f:\\agentai-platform\\packages\\agentai-gui\//,
        /^f:\\agentai-platform\\packages\\agentai-desktop\//,
        /^f:\\agentai-platform\\packages\\agentai-qqbot\//,
        /^f:\\agentai-platform\\packages\\agentai-skills\//,
    ];
    if (safeModifyPatterns.some(p => p.test(filePath))) {
        console.log(`[智能决策] 修改非核心文件，自动批准: ${filePath}`);
        return true;
    }
    // 4. 检查是否修改gateway自身代码（需要严格审批）
    if (filePath.includes('agentai-gateway/src')) {
        console.log(`[智能决策] 修改gateway核心代码，需要审批: ${filePath}`);
        return false;
    }
    // 5. 默认：保守处理，需要审批
    return false;
}
