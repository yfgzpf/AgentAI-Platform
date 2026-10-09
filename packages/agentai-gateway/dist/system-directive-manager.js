/**
 * 系统指令管理器 v2 (智能延迟注入) — 从 agentai-loop.ts 提取
 *
 * 解决: 多个模块同时注入 [SYSTEM] 指令 → 弱模型迷失
 * 策略:
 *   1. 即时队列 (pending): 错误反应类指令, 每轮取优先级最高的 1 条注入
 *   2. 延迟队列 (deferred): 质量管控类指令, 执行中缓冲, 任务完成后处理
 * 优先级: critical(安全/错误) > high(任务推进) > medium(风格建议) > low(杂项)
 *
 * 原位置: agentai-loop.ts 行 ~176-263
 * 提取理由: 自包含类，仅被 this.directives 引用，置信度 92%
 */
export class SystemDirectiveManager {
    pending = [];
    deferred = [];
    /** 可延迟的指令来源 — 质量管控类, 不阻塞任务执行 */
    static DEFERRABLE_SOURCES = new Set([
        'meta_ask', 'meta_pua', // 元认知决策
        'boundary_check', 'boundary_p0', // 知识边界/认知自检
        'low_conf_search', // 低置信度搜索 (不阻塞, 可后续补)
        'op_awareness', // 操作感知
        // 'ambiguity' 移除 — 歧义检测必须在首轮立即注入, 否则 AI 不会追问用户
        // 'low_conf_clarify' 移除 — 低置信度追问必须即时注入, 否则 AI 不会调用 ask_user
    ]);
    /** 添加一条指令 */
    add(source, content, priority) {
        // 可延迟来源 → 进入延迟缓冲, 不在执行中注入
        if (SystemDirectiveManager.DEFERRABLE_SOURCES.has(source)) {
            // 同来源去重: 只保留最后一条
            this.deferred = this.deferred.filter(d => d.source !== source);
            this.deferred.push({ source, content, priority });
            return;
        }
        // 即时指令: critical 始终加入; 其他如果已有 critical 则跳过
        if (this.pending.some(d => d.priority === 'critical') && priority !== 'critical')
            return;
        this.pending.push({ source, content, priority });
    }
    /** 刷新即时队列: 取优先级最高的 1 条, 返回消息内容 (或 null) */
    flush() {
        if (this.pending.length === 0)
            return null;
        const order = { critical: 0, high: 1, medium: 2, low: 3 };
        this.pending.sort((a, b) => order[a.priority] - order[b.priority]);
        const top = this.pending[0];
        this.pending = [];
        return top.content;
    }
    /**
     * 刷新即时队列，返回全部 critical + high 指令（按优先级排序）
     * ────────────────────────────────────────────────────────────────────
     * 2026-10-06 新增。原 `flush()` 只返回 1 条、其余 `pending = []` 静默丢弃，
     * 而 loop 每轮都会 `add('task_progress', 工作摘要, 'high')`，
     * 竞争对手是同一轮 add 的 fail_strategy / auto_fix_* / dup_fail 等 20+ 个 high。
     *
     * 后果（用户实机反馈「工作摘要看不见、一直重复读文件」）：
     *   工作摘要绝大多数轮次**根本没进 messages**，AI 每轮都像第一次见到任务。
     *
     * 现在返回全部 critical + high；medium/low 仍不参与每轮注入（避免噪音）。
     * maxChars 兜底防止指令刷屏撑爆上下文。
     */
    flushAll(maxChars = 1600) {
        if (this.pending.length === 0)
            return [];
        const order = { critical: 0, high: 1, medium: 2, low: 3 };
        // 同 source 只保留最新一条（add() 只对 deferred 队列去重，即时队列会堆积同源指令）
        const latest = new Map();
        for (const d of this.pending) {
            if (d.priority === 'critical' || d.priority === 'high')
                latest.set(d.source, d);
        }
        const picked = [...latest.values()].sort((a, b) => order[a.priority] - order[b.priority]);
        this.pending = [];
        const out = [];
        let used = 0;
        for (const d of picked) {
            const room = maxChars - used;
            if (room <= 40) {
                out.push('(指令预算已满，其余高优先级指令本轮延后)');
                break;
            }
            const text = d.content.length > room ? d.content.slice(0, room) + '…(截断)' : d.content;
            out.push(text);
            used += text.length;
        }
        return out;
    }
    /** v3.2 修复: 按 source 读取最新一条指令 (含延迟队列) */
    get(source) {
        const inPending = this.pending.find(d => d.source === source);
        if (inPending)
            return inPending.content;
        const inDeferred = this.deferred.find(d => d.source === source);
        return inDeferred?.content || null;
    }
    /** 刷新延迟队列: 返回所有缓冲指令 (任务完成后调用) */
    flushDeferred() {
        const result = [...this.deferred];
        this.deferred = [];
        return result;
    }
    /** 延迟队列中是否有高优先级指令 (需要补一轮) */
    hasCriticalDeferred() {
        return this.deferred.some(d => d.priority === 'high');
    }
    /** 检查是否有待处理即时指令 */
    hasPending() {
        return this.pending.length > 0;
    }
    /** 清空即时队列 (每轮循环开始时调用) */
    clear() {
        this.pending = [];
    }
    /** 清空所有队列 */
    clearAll() {
        this.pending = [];
        this.deferred = [];
    }
}
