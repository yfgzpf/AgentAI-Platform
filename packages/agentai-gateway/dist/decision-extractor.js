/**
 * 决策抽取（Decision Extraction）
 * ========================================================================
 * 从 AI 的回复文本里提取"已经做出的决定 / 达成的结论 / 说明的约定"，
 * 写入任务台账，使这些判断在上下文压缩后依然可回溯。
 *
 * 为什么用规则而非模型调用:
 *   为记台账再调一次 LLM 会多烧一轮 token，而且会把主链路延迟翻倍。
 *   决策句式在中文技术回答里高度模式化，规则足够覆盖。
 *
 * 为什么这个值得做:
 *   长任务里 AI 常在第 3轮就定下方案（"用 A 方案，因为 B 有坑"），
 *   但压缩后它会忘记，于是第 8 轮又推翻重议 —— 用户看到的是
 *   "翻来覆去、原地打转"。台账里有了已定决策，就能明确告诉它别重议。
 */
/** 决策线索词：命中即认为这句是决策 */
const DECISION_MARKERS = [
    '决定', '采用', '选用', '选择', '改用', '换成', '定为', '确定为',
    '方案', '策略', '结论是', '因此采用', '所以用', '统一用',
    '接下来', '下一步用', '后续用', '不再', '保留', '废弃', '移除',
    '应该', '需要', '必须', '计划', '步骤',
];
/** 明确不是决策的句子（寒暄/确认/过程叙述） */
const NON_DECISION = [
    '让我', '我来', '正在', '稍等', '首先读取', '已读取', '读取了',
    '思考中', '分析中', '抱歉', '对不起',
];
/**
 * 从回复中抽取决策条目
 * @param text AI 回复文本
 * @returns 决策短句数组（已去重、限长、限量）
 */
export function extractDecisions(text) {
    if (typeof text !== 'string' || !text.trim())
        return [];
    // 去掉代码块（里面全是 "决定" 字样的注释，不是决策）
    const cleaned = text
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`[^`]*`/g, ' ');
    const out = [];
    // 按中英文句末标点切句
    const sentences = cleaned.split(/[。；;\n!！?？]+/);
    for (const raw of sentences) {
        const s = raw.trim();
        // 下限5 字："决定采用A。" 这类短句虽短但信息完整；
        // 低于 5 字的（"好。"/"决定"）才是真的无信息量。
        if (s.length < 5 || s.length > 200)
            continue; // 太短无信息，太长是叙述
        if (NON_DECISION.some((k) => s.includes(k)))
            continue;
        if (!DECISION_MARKERS.some((k) => s.includes(k)))
            continue;
        out.push(s);
        if (out.length >= 5)
            break; // 每轮最多记 5 条
    }
    return out;
}
