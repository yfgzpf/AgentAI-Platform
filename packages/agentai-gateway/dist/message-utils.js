/**
 * 消息处理工具函数 — 从 agentai-loop.ts 提取
 *
 * 包含:
 *   - consolidateSystemInjections: 合并连续 [SYSTEM] 注入消息
 *   - sanitizeToolMessages: 清洗工具消息确保 OpenAI 协议合规
 *
 * 原位置: agentai-loop.ts 行 ~131-174, 270-302
 * 提取理由: 纯函数，无 this 依赖，置信度 95%+
 */
/**
 * P0-1.3: 合并连续的 [SYSTEM] 注入消息
 * 多个模块可能在一轮中各推一条 [SYSTEM] 指令, 弱模型容易迷失
 * 此函数将连续的 [SYSTEM] 消息合并为一条, 保留最关键信息
 */
export function consolidateSystemInjections(messages) {
    if (messages.length <= 1)
        return messages;
    const result = [];
    let pendingSystem = [];
    const flushPending = () => {
        if (pendingSystem.length === 0)
            return;
        if (pendingSystem.length === 1) {
            result.push({ role: 'user', content: pendingSystem[0] });
        }
        else {
            // 多条合并: 保留含 [CRITICAL]/[P0] 标记的安全指令, 其余只保留最后一条
            const critical = pendingSystem.filter(s => /\[CRITICAL\]|\[P0\]/i.test(s));
            const latest = pendingSystem[pendingSystem.length - 1];
            if (critical.length > 0 && !critical.includes(latest)) {
                const merged = critical.join('\n---\n') + '\n---\n' + latest;
                result.push({ role: 'user', content: merged.slice(0, 3000) });
            }
            else if (critical.length > 0) {
                result.push({ role: 'user', content: critical.join('\n---\n').slice(0, 3000) });
            }
            else {
                result.push({ role: 'user', content: latest });
            }
        }
        pendingSystem = [];
    };
    for (const msg of messages) {
        const content = typeof msg.content === 'string' ? msg.content : '';
        const isSystemInjection = msg.role === 'user' && content.startsWith('[SYSTEM]');
        if (isSystemInjection) {
            pendingSystem.push(content);
        }
        else {
            flushPending();
            result.push(msg);
        }
    }
    flushPending();
    return result;
}
/**
 * 消毒消息数组: 确保每个 role='tool' 消息前面都有对应的 assistant(tool_calls) 消息
 * OpenAI 协议要求: tool 消息必须跟在 assistant 的 tool_calls 后面, 否则 400 错误
 * 此函数在发送给 LLM 前清理, 防止上下文压缩或 pre-read 注入导致的协议违规
 */
export function sanitizeToolMessages(messages) {
    const result = [];
    const knownToolCallIds = new Set();
    for (const msg of messages) {
        const anyMsg = msg;
        if (msg.role === 'assistant' && anyMsg.tool_calls) {
            for (const tc of anyMsg.tool_calls) {
                if (tc.id)
                    knownToolCallIds.add(tc.id);
            }
            result.push(msg);
        }
        else if (msg.role === 'tool') {
            if (msg.tool_call_id && knownToolCallIds.has(msg.tool_call_id)) {
                result.push(msg); // 合法, 保留
            }
            else {
                // 孤立的 tool 消息 → 降级为 system 消息, 避免协议违规
                const toolName = msg.name || 'unknown';
                const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
                result.push({
                    role: 'system',
                    content: `[tool-result:${toolName}] ${content}`,
                });
            }
        }
        else {
            result.push(msg);
        }
    }
    return result;
}
