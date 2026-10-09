/**
 * Model Classifier — 任务复杂度 + 5 维评分路由
 * ----------------------------------------------------
 * 安全设计:
 *   1. 无 eval / no dynamic code - 所有评分是纯数学公式
 *   2. 无用户输入直接控制路由 - 分类结果不可被注入覆盖
 *   3. 成本上限是硬锁, 不是软阈值
 *   4. 所有正则匹配结果仅用于分类, 不用于执行
 *
 * 评分模型:
 *   score = w1*complexityMatch + w2*contextFit + w3*costScore + w4*successRate + w5*latencyScore
 *
 * @see docs/MIGRATION.md 第 3 节
 */
// ===== 安全: 路由结果不可被用户消息注入覆盖 =====
// `classify()` 的输出是纯计算, 消息内容只用于正则匹配, 不用于控制流
// ===== 已知模型注册表 =====
export const MODELS = [
    // --- AgentAI (主模型, 免费+付费混合) ---
    {
        id: 'agentai:agnes-2.0-flash',
        label: 'Agnes AI Flash',
        provider: 'agentai',
        subModel: 'agnes-2.0-flash',
        complexityRange: ['ultraSimple', 'hard'],
        maxContext: 256_000,
        costPer1kInput: 0,
        costPer1kOutput: 0,
        isFree: true,
        supportsTools: true,
        supportsImages: true,
        priority: 3,
        reasoningLevel: 'advanced',
        speedTier: 'fast',
        maxOutputTokens: 8192,
        supportsStreaming: true,
        supportsThinking: true,
        supportsJsonMode: true,
    },
    // (2026-09-04 已删: agentai:agnes-v4 实为 agnes-2.0-flash 的重复别名且虚标 1M 窗口,
    //  造成"免费+大窗口"模型在评分中恒定胜出, 深度任务也被派给轻模型; 保留单一真实条目)
    // --- DeepSeek (付费, 强力推理) ---
    // ═══ 2026-09-05 校准 (官方 api-docs.deepseek.com) ═══
    // V4-Flash/Pro 官方均 1M 上下文; 8/16 起 peak/off-peak 计价。
    // 成本 = off-peak cache-miss USD/1K (flash 0.00022/0.00066, pro 0.00066/0.00198)。
    // 同步改动: model-capabilities.ts / routes/chat.ts / GUI modelStore.ts
    {
        id: 'deepseek:v4-flash',
        label: 'DS Flash',
        provider: 'deepseek',
        subModel: 'deepseek-v4-flash',
        complexityRange: ['ultraSimple', 'complex'],
        maxContext: 1_000_000,
        costPer1kInput: 0.00022,
        costPer1kOutput: 0.00066,
        isFree: false,
        supportsTools: true,
        supportsImages: false, // 实测: HTTP 400, 不支持多模态 (2026-07-13 run-vision-test.ts)
        priority: 5,
        reasoningLevel: 'enhanced',
        speedTier: 'fast',
        maxOutputTokens: 8192,
        supportsStreaming: true,
        supportsThinking: true,
        supportsJsonMode: true,
    },
    {
        id: 'deepseek:v4-pro',
        label: 'DS Pro',
        provider: 'deepseek',
        subModel: 'deepseek-v4-pro',
        complexityRange: ['complex', 'hard'],
        maxContext: 1_000_000,
        costPer1kInput: 0.00066,
        costPer1kOutput: 0.00198,
        isFree: false,
        supportsTools: true,
        supportsImages: true,
        priority: 4,
        reasoningLevel: 'advanced',
        speedTier: 'thorough',
        maxOutputTokens: 16384,
        supportsStreaming: true,
        supportsThinking: true,
        supportsJsonMode: true,
    },
    // --- OpenAI (付费兜底) ---
    {
        id: 'openai:gpt-4o-mini',
        label: 'GPT-4o mini',
        provider: 'openai',
        subModel: 'gpt-4o-mini',
        complexityRange: ['medium', 'hard'],
        maxContext: 128_000,
        costPer1kInput: 0.00015,
        costPer1kOutput: 0.0006,
        isFree: false,
        supportsTools: true,
        supportsImages: true,
        priority: 5,
        reasoningLevel: 'advanced',
        speedTier: 'balanced',
        maxOutputTokens: 16384,
        supportsStreaming: true,
        supportsThinking: false,
        supportsJsonMode: true,
    },
    // (2026-09-04 已删: 下方曾重复一份完全相同的 openai:gpt-4o-mini 条目, 保留上方唯一项)
    // --- 通义千问 Qwen (付费, DashScope) ---
    {
        id: 'qwen:qwen-max',
        label: 'Qwen-Max',
        provider: 'qwen',
        subModel: 'qwen-max',
        complexityRange: ['medium', 'hard'],
        maxContext: 32_768,
        costPer1kInput: 0.00034,
        costPer1kOutput: 0.00137,
        isFree: false,
        supportsTools: true,
        supportsImages: true,
        priority: 4,
        reasoningLevel: 'enhanced',
        speedTier: 'balanced',
        maxOutputTokens: 8192,
        supportsStreaming: true,
        supportsThinking: true,
    },
    // --- 月之暗面 Kimi/Moonshot (付费) ---
    {
        id: 'moonshot:kimi-k2.5',
        label: 'Kimi K2.5',
        provider: 'moonshot',
        subModel: 'kimi-k2.5',
        complexityRange: ['simple', 'complex'],
        maxContext: 262_144,
        costPer1kInput: 0.0006,
        costPer1kOutput: 0.003,
        isFree: false,
        supportsTools: true,
        supportsImages: true,
        priority: 4,
        reasoningLevel: 'enhanced',
        speedTier: 'balanced',
        maxOutputTokens: 8192,
        supportsStreaming: true,
        supportsThinking: true,
    },
    // --- Anthropic Claude (付费) ---
    {
        id: 'anthropic:claude-sonnet-4-5',
        label: 'Claude Sonnet 4.5',
        provider: 'anthropic',
        subModel: 'claude-sonnet-4-5-20250929',
        complexityRange: ['complex', 'hard'],
        maxContext: 200_000,
        costPer1kInput: 0.003,
        costPer1kOutput: 0.015,
        isFree: false,
        supportsTools: true,
        supportsImages: true,
        priority: 3,
        reasoningLevel: 'advanced',
        speedTier: 'balanced',
        maxOutputTokens: 8192,
        supportsStreaming: true,
        supportsThinking: true,
    },
    // --- MiniMax (付费) ---
    {
        id: 'minimax:M3',
        label: 'MiniMax M3',
        provider: 'minimax',
        subModel: 'MiniMax-M3',
        complexityRange: ['simple', 'complex'],
        maxContext: 128_000,
        costPer1kInput: 0,
        costPer1kOutput: 0,
        isFree: false,
        supportsTools: true,
        supportsImages: true,
        priority: 4,
        reasoningLevel: 'enhanced',
        speedTier: 'balanced',
        maxOutputTokens: 8192,
        supportsStreaming: true,
        supportsThinking: true,
    },
    // --- 豆包/火山引擎 Doubao (付费) ---
    {
        id: 'doubao:seed-2.0-pro',
        label: '豆包 Seed 2.0 Pro',
        provider: 'doubao',
        subModel: 'doubao-seed-2.0-pro-250728',
        complexityRange: ['simple', 'complex'],
        maxContext: 128_000,
        costPer1kInput: 0,
        costPer1kOutput: 0,
        isFree: false,
        supportsTools: true,
        supportsImages: true,
        priority: 4,
        reasoningLevel: 'enhanced',
        speedTier: 'fast',
        maxOutputTokens: 8192,
        supportsStreaming: true,
        supportsThinking: false,
    },
    // --- 智谱 GLM-4.7-Flash (免费, 支持工具调用+thinking) ---
    {
        id: 'zhipu:glm-4.7-flash',
        label: 'GLM-4.7 Flash (免费)',
        provider: 'zhipu',
        subModel: 'glm-4.7-flash',
        complexityRange: ['ultraSimple', 'complex'],
        maxContext: 200_000,
        costPer1kInput: 0,
        costPer1kOutput: 0,
        isFree: true,
        supportsTools: true,
        supportsImages: false,
        priority: 1,
        reasoningLevel: 'basic',
        speedTier: 'fast',
        maxOutputTokens: 8192,
        supportsStreaming: true,
        supportsThinking: false,
    },
    // --- 智谱 GLM-4.6V-Flash (免费视觉模型, 同API Key, 支持图像+视频+工具调用) ---
    // 实测 (run-vision-test.ts 2026-07-13): 497ms, 真 vision 工作中, 比 agnes 快 18 倍
    {
        id: 'zhipu:glm-4.6v-flash',
        label: 'GLM-4.6V Flash (免费视觉)',
        provider: 'zhipu',
        subModel: 'glm-4.6v-flash',
        complexityRange: ['ultraSimple', 'complex'],
        maxContext: 128_000,
        costPer1kInput: 0,
        costPer1kOutput: 0,
        isFree: true,
        supportsTools: true,
        supportsImages: true,
        priority: 4, // 视觉任务优先路由 (实测可用, 速度最优)
    },
    // --- ALRC 聚合平台 (https://alro.huazhiweilai.com/v1) ---
    // 实际可用模型 (2026-08-15 从服务端 /v1/models 查询同步)
    // 注: 服务端按令牌分组分配模型, 当前密钥分配的是"国内模型"分组
    {
        id: 'alrc:deepseek-v4-flash', label: 'DeepSeek V4 Flash', provider: 'alrc', subModel: 'deepseek-v4-flash',
        complexityRange: ['simple', 'complex'], maxContext: 64_000,
        costPer1kInput: 0.0000345, costPer1kOutput: 0.000104, isFree: false,
        supportsTools: true, supportsImages: false, priority: 5,
        reasoningLevel: 'enhanced', speedTier: 'fast', maxOutputTokens: 8192,
    },
    {
        id: 'alrc:deepseek-v4-pro', label: 'DeepSeek V4 Pro', provider: 'alrc', subModel: 'deepseek-v4-pro',
        complexityRange: ['medium', 'hard'], maxContext: 64_000,
        costPer1kInput: 0.0001035, costPer1kOutput: 0.000311, isFree: false,
        supportsTools: true, supportsImages: false, priority: 4,
        reasoningLevel: 'advanced', speedTier: 'balanced', maxOutputTokens: 8192,
    },
    // 智谱 GLM
    {
        id: 'alrc:glm-4.7', label: 'GLM 4.7', provider: 'alrc', subModel: 'glm-4.7',
        complexityRange: ['simple', 'complex'], maxContext: 128_000,
        costPer1kInput: 0.0000103, costPer1kOutput: 0.000031, isFree: false,
        supportsTools: true, supportsImages: true, priority: 4,
        reasoningLevel: 'enhanced', speedTier: 'balanced', maxOutputTokens: 8192,
    },
    {
        id: 'alrc:glm-5', label: 'GLM 5', provider: 'alrc', subModel: 'glm-5',
        complexityRange: ['medium', 'hard'], maxContext: 128_000,
        costPer1kInput: 0.0000207, costPer1kOutput: 0.000062, isFree: false,
        supportsTools: true, supportsImages: true, priority: 3,
        reasoningLevel: 'advanced', speedTier: 'balanced', maxOutputTokens: 8192,
    },
    {
        id: 'alrc:glm-5.1', label: 'GLM 5.1', provider: 'alrc', subModel: 'glm-5.1',
        complexityRange: ['medium', 'hard'], maxContext: 128_000,
        costPer1kInput: 0.0000207, costPer1kOutput: 0.000062, isFree: false,
        supportsTools: true, supportsImages: true, priority: 3,
        reasoningLevel: 'advanced', speedTier: 'balanced', maxOutputTokens: 8192,
    },
    {
        id: 'alrc:glm-5.2', label: 'GLM 5.2', provider: 'alrc', subModel: 'glm-5.2',
        complexityRange: ['medium', 'hard'], maxContext: 128_000,
        costPer1kInput: 0.0000207, costPer1kOutput: 0.000062, isFree: false,
        supportsTools: true, supportsImages: true, priority: 3,
        reasoningLevel: 'advanced', speedTier: 'balanced', maxOutputTokens: 8192,
    },
    // Kimi
    {
        id: 'alrc:kimi-k2.5', label: 'Kimi K2.5', provider: 'alrc', subModel: 'kimi-k2.5',
        complexityRange: ['simple', 'complex'], maxContext: 256_000,
        costPer1kInput: 0.0000138, costPer1kOutput: 0.000041, isFree: false,
        supportsTools: true, supportsImages: true, priority: 4,
        reasoningLevel: 'enhanced', speedTier: 'fast', maxOutputTokens: 8192,
    },
    {
        id: 'alrc:kimi-k2.6', label: 'Kimi K2.6', provider: 'alrc', subModel: 'kimi-k2.6',
        complexityRange: ['medium', 'complex'], maxContext: 256_000,
        costPer1kInput: 0.0000207, costPer1kOutput: 0.000062, isFree: false,
        supportsTools: true, supportsImages: true, priority: 4,
        reasoningLevel: 'enhanced', speedTier: 'balanced', maxOutputTokens: 8192,
    },
    {
        id: 'alrc:kimi-k2.7-code', label: 'Kimi K2.7 Code', provider: 'alrc', subModel: 'kimi-k2.7-code',
        complexityRange: ['medium', 'hard'], maxContext: 256_000,
        costPer1kInput: 0.0000207, costPer1kOutput: 0.000062, isFree: false,
        supportsTools: true, supportsImages: false, priority: 4,
        reasoningLevel: 'advanced', speedTier: 'balanced', maxOutputTokens: 16384,
    },
    {
        id: 'alrc:kimi-k3', label: 'Kimi K3', provider: 'alrc', subModel: 'kimi-k3',
        complexityRange: ['complex', 'hard'], maxContext: 256_000,
        costPer1kInput: 0.0000345, costPer1kOutput: 0.000104, isFree: false,
        supportsTools: true, supportsImages: true, priority: 3,
        reasoningLevel: 'advanced', speedTier: 'balanced', maxOutputTokens: 8192,
    },
    // MiniMax
    {
        id: 'alrc:MiniMax-M2.5', label: 'MiniMax M2.5', provider: 'alrc', subModel: 'MiniMax-M2.5',
        complexityRange: ['simple', 'complex'], maxContext: 128_000,
        costPer1kInput: 0.0000103, costPer1kOutput: 0.000031, isFree: false,
        supportsTools: true, supportsImages: true, priority: 4,
        reasoningLevel: 'enhanced', speedTier: 'fast', maxOutputTokens: 8192,
    },
    {
        id: 'alrc:MiniMax-M2.7', label: 'MiniMax M2.7', provider: 'alrc', subModel: 'MiniMax-M2.7',
        complexityRange: ['medium', 'complex'], maxContext: 128_000,
        costPer1kInput: 0.0000207, costPer1kOutput: 0.000062, isFree: false,
        supportsTools: true, supportsImages: true, priority: 4,
        reasoningLevel: 'enhanced', speedTier: 'balanced', maxOutputTokens: 8192,
    },
    {
        id: 'alrc:MiniMax-M3', label: 'MiniMax M3', provider: 'alrc', subModel: 'MiniMax/MiniMax-M3',
        complexityRange: ['complex', 'hard'], maxContext: 128_000,
        costPer1kInput: 0.0000345, costPer1kOutput: 0.000104, isFree: false,
        supportsTools: true, supportsImages: true, priority: 3,
        reasoningLevel: 'advanced', speedTier: 'balanced', maxOutputTokens: 8192,
    },
    // 其他
    {
        id: 'alrc:hy3', label: 'HY3', provider: 'alrc', subModel: 'hy3',
        complexityRange: ['simple', 'complex'], maxContext: 128_000,
        costPer1kInput: 0.0000103, costPer1kOutput: 0.000031, isFree: false,
        supportsTools: true, supportsImages: false, priority: 4,
        reasoningLevel: 'enhanced', speedTier: 'fast', maxOutputTokens: 8192,
    },
    // --- NVIDIA NIM 模型已移除 (2026-07-25): 需自建 GPU Docker + 端点不稳定 + 中国大陆不可达 ---
];
// ===== 复杂度权重 =====
const COMPLEXITY_WEIGHTS = {
    ultraSimple: [1.0, 0.8, 0.4, 0.2, 0.0],
    simple: [0.8, 1.0, 0.8, 0.4, 0.2],
    medium: [0.4, 0.8, 1.0, 0.8, 0.4],
    complex: [0.2, 0.4, 0.8, 1.0, 0.8],
    hard: [0.0, 0.2, 0.4, 0.8, 1.0],
};
const LEVEL_ORDER = ['ultraSimple', 'simple', 'medium', 'complex', 'hard'];
// ===== 任务复杂度分类器 (纯静态规则, 无状态) =====
/**
 * 分析消息文本, 输出复杂度级别
 * 安全设计:
 *   - 只读操作, 无副作用
 *   - 输入仅用于正则匹配, 结果不可被注入覆盖
 */
export function classifyComplexity(message, contextLength) {
    const msg = message.slice(0, 500); // 安全截断, 只用前 500 字
    // Hard: 1M 上下文 or 关键架构/安全词汇
    if (contextLength > 500_000)
        return 'hard';
    const hardKeywords = /架构|设计模式|性能优化|并发|安全|漏洞|内存泄漏|重构|复杂|体系|设计|security|vulnerability|memory leak|race|deadlock|分布式|微服务/i;
    if (hardKeywords.test(msg))
        return 'hard';
    // Complex: 分析/审查/修改代码
    const complexKeywords = /分析|审查|重构|改|修|实现|implement|refactor|review|analyze|优化|优化|测试|debug/i;
    if (complexKeywords.test(msg) && msg.length > 50)
        return 'complex';
    // medium: 中等长度 + 代码相关
    const mediumKeywords = /代码|写|创建|生成|create|generate|函数|类|组件|page|路由配置/i;
    if (mediumKeywords.test(msg) || msg.length > 100)
        return 'medium';
    // simple: 短问题
    if (msg.length > 20)
        return 'simple';
    // ultraSimple: 闲聊/翻译/简单计算
    return 'ultraSimple';
}
/**
 * 预估上下文长度 (token 数, 粗略估计)
 */
export function estimateContextLength(messages) {
    let total = 0;
    for (const m of messages) {
        if (typeof m.content === 'string') {
            total += m.content.length;
        }
        else if (Array.isArray(m.content)) {
            for (const part of m.content) {
                if (part.type === 'text')
                    total += part.text.length;
                else if (part.type === 'image_url')
                    total += 1000; // 一张图 ≈ 1000 token
            }
        }
        // system prompt ≈ 200 token
        if (m.role === 'system')
            total += 200;
    }
    return Math.ceil(total * 1.3); // 中文字符: 1.3x
}
// ===== 评分权重 =====
const W_COMPLEXITY = 0.30;
const W_CONTEXT = 0.15;
const W_COST = 0.20;
const W_SUCCESS = 0.25;
const W_LATENCY = 0.10;
/**
 * 路由主入口: 对已知模型排序
 * 安全护栏:
 *   1. `forceProvider` 绕过评分, 但受 cost guard 约束
 *   2. 免费模型不受 cost guard 影响
 *   3. 所有评分是纯数学公式, 不受消息内容直接控制
 */
export function routeByScore(input) {
    const complexity = classifyComplexity(input.message, estimateContextLength(input.messages));
    const levelIdx = LEVEL_ORDER.indexOf(complexity);
    console.log(`[model-classifier] 任务复杂度: ${complexity}, 消息长度: ${input.message.length}`);
    const scored = [];
    for (const model of MODELS) {
        // 跳过用户强制指定之外的模型
        if (input.forceProvider && model.provider !== input.forceProvider)
            continue;
        // 跳过熔断的 provider
        const stats = input.providerStats.get(model.provider);
        if (stats?.tripped)
            continue;
        // 跳过付费模型 (如果每日成本已超过上限)
        if (!model.isFree && input.dailyCostUsed >= input.dailyCostLimit)
            continue;
        // 需要视觉 → 只选 supportsImages 的模型
        if (input.needsVision && !model.supportsImages)
            continue;
        // preferFree → 只选免费模型
        if (input.preferFree && !model.isFree)
            continue;
        const breakdown = computeScore(model, complexity, levelIdx, stats || null);
        const total = breakdown.complexityMatch + breakdown.contextFit + breakdown.costScore + breakdown.successRate + breakdown.latencyScore;
        scored.push({ model, score: total });
    }
    // 按分数降序
    scored.sort((a, b) => b.score - a.score);
    // 如果开启了 preferFree, 将免费模型优先排序 (同分免费优先)
    if (input.preferFree) {
        scored.sort((a, b) => {
            const scoreDiff = b.score - a.score;
            if (Math.abs(scoreDiff) > 0.05)
                return scoreDiff;
            // 同分情况: 免费优先
            if (a.model.isFree && !b.model.isFree)
                return -1;
            if (!a.model.isFree && b.model.isFree)
                return 1;
            return 0;
        });
    }
    const result = scored.map(s => s.model);
    console.log(`[model-classifier] 推荐模型: ${result.slice(0, 3).map(m => m.id).join(', ')}`);
    return result;
}
/**
 * 计算某个模型的 5 维得分
 * 纯数学: 无分支判断, 无副作用, 无 I/O
 */
function computeScore(model, complexity, levelIdx, stats) {
    const rangeFrom = LEVEL_ORDER.indexOf(model.complexityRange[0]);
    const rangeTo = LEVEL_ORDER.indexOf(model.complexityRange[1]);
    // 1. 复杂度匹配: 如果复杂度在模型擅长范围内, 得分高
    const inRange = levelIdx >= rangeFrom && levelIdx <= rangeTo;
    const complexityMatch = inRange ? 1.0 * W_COMPLEXITY : 0.3 * W_COMPLEXITY;
    // 2. 上下文适配: 模型上下文越大, 对长上下文场景得分越高
    // 标准化: max 1M token → score 1.0
    const contextFit = Math.min(model.maxContext / 1_000_000, 1.0) * W_CONTEXT;
    // 3. 成本分数: 免费的 1.0, 付费的按比例
    // 2026-09-04 修复: 部分付费模型 (qwen/kimi/anthropic/minimax/doubao) cost 字段未填 = 0,
    //   原公式会让它们 costScore 与免费模型同拿满分 → "付费当免费"参与竞争。改为: 未配置价格的
    //   付费模型给中性分 (0.5), 不再假装免费。
    const avgCost = (model.costPer1kInput + model.costPer1kOutput) / 2;
    let costScore;
    if (model.isFree)
        costScore = 1.0 * W_COST;
    else if (avgCost <= 0)
        costScore = 0.5 * W_COST; // 未定价付费模型: 中性
    else
        costScore = (1.0 - Math.min(avgCost * 200, 1.0)) * W_COST;
    // 4. 历史成功率
    let successRate = 0.5 * W_SUCCESS; // 默认 0.5
    if (stats && stats.totalCalls > 0) {
        const rate = stats.successCount / stats.totalCalls;
        successRate = rate * W_SUCCESS;
    }
    // 5. 延迟分数
    let latencyScore = 0.5 * W_LATENCY; // 默认 0.5
    if (stats && stats.recentLatencyMs.length > 0) {
        const avgLat = stats.recentLatencyMs.reduce((a, b) => a + b, 0) / stats.recentLatencyMs.length;
        // 延迟越低分数越高: 200ms → 1.0, 2000ms → 0.5, 10000ms → 0.1
        latencyScore = (1.0 - Math.min(avgLat / 10_000, 0.9)) * W_LATENCY;
    }
    return { complexityMatch, contextFit, costScore, successRate, latencyScore };
}
// ===== 工具函数 =====
/**
 * 根据 model id 获取子模型名 (传给 provider)
 */
export function getSubModel(modelId) {
    const m = MODELS.find(x => x.id === modelId);
    return m?.subModel;
}
/** 推理深度权重表 */
const REASONING_SCORE = {
    basic: 0.3,
    enhanced: 0.6,
    advanced: 0.95,
};
/** 速度档位评分表 */
const SPEED_SCORE = {
    fast: 0.9,
    balanced: 0.6,
    thorough: 0.35,
};
/** 能力维度权重 (用于计算综合分) */
const CAP_WEIGHTS = {
    reasoning: 0.35, // 推理能力是最重要的区分维度
    context: 0.10, // 上下文窗口影响长任务但不决定能力
    speed: 0.10, // 速度影响体验但不决定能力
    vision: 0.05, // 视觉是专项能力
    toolCall: 0.25, // 工具调用质量对 Agent 至关重要
    costScore: 0.15, // 成本影响路由但不影响能力
};
/**
 * 计算 6 维能力评分
 * 纯函数: 无副作用, 无 I/O, 仅依赖 ModelMeta
 */
export function computeCapabilities(meta) {
    if (!meta) {
        // 未知模型默认 guided (而非 supervised): 不在注册表中的模型
        // 大多是 256K+ 上下文的好模型 (sensenova/longcat/dxnt/alrc 等),
        // 只是尚未录入注册表, 不应被当作弱模型
        return {
            reasoning: 0.5, context: 0.8, speed: 0.6, vision: 0,
            toolCall: 0.5, costScore: 0.8, overall: 0.5, tier: 'guided',
        };
    }
    // 1. 推理深度: 优先用 reasoningLevel, 否则从 complexityRange 推断
    let reasoning;
    if (meta.reasoningLevel) {
        reasoning = REASONING_SCORE[meta.reasoningLevel] ?? 0.3;
    }
    else {
        // 从 complexityRange 上限推断
        const upper = meta.complexityRange?.[1];
        reasoning = upper === 'hard' ? 0.85 : upper === 'complex' ? 0.55 : 0.3;
    }
    // 2. 上下文窗口: 归一化到 0-1 (1M = 1.0, 128K = 0.4, 4K = 0.02)
    const context = Math.min(Math.log10(meta.maxContext || 4096) / Math.log10(1_000_000), 1.0);
    // 3. 速度: 优先用 speedTier, 否则从模型名推断
    let speed;
    if (meta.speedTier) {
        speed = SPEED_SCORE[meta.speedTier] ?? 0.5;
    }
    else {
        const name = (meta.subModel || meta.id).toLowerCase();
        speed = name.includes('flash') || name.includes('lite') || name.includes('mini') ? 0.85
            : name.includes('pro') || name.includes('max') ? 0.4
                : 0.6;
    }
    // 4. 多模态
    const vision = meta.supportsImages ? 1.0 : 0.0;
    // 5. 工具调用质量: supportsTools + reasoningLevel + supportsJsonMode
    let toolCall = 0;
    if (meta.supportsTools) {
        toolCall = 0.5; // 基础分
        if (meta.reasoningLevel === 'advanced')
            toolCall += 0.3;
        else if (meta.reasoningLevel === 'enhanced')
            toolCall += 0.15;
        if (meta.supportsJsonMode)
            toolCall += 0.2;
        toolCall = Math.min(toolCall, 1.0);
    }
    // 6. 成本效率: 免费=1, 付费按价格反比
    let costScore;
    if (meta.isFree) {
        costScore = 1.0;
    }
    else {
        const avgCost = (meta.costPer1kInput + meta.costPer1kOutput) / 2;
        costScore = Math.max(0, 1.0 - Math.min(avgCost * 100, 0.95));
    }
    // 综合得分 (加权平均)
    const overall = reasoning * CAP_WEIGHTS.reasoning +
        context * CAP_WEIGHTS.context +
        speed * CAP_WEIGHTS.speed +
        vision * CAP_WEIGHTS.vision +
        toolCall * CAP_WEIGHTS.toolCall +
        costScore * CAP_WEIGHTS.costScore;
    // 能力等级: 综合分 ≥ 0.65 → autonomous, ≥ 0.40 → guided, < 0.40 → supervised
    let tier;
    if (overall >= 0.65 && reasoning >= 0.55 && meta.supportsTools) {
        tier = 'autonomous';
    }
    else if (overall >= 0.40 && meta.supportsTools) {
        tier = 'guided';
    }
    else {
        tier = 'supervised';
    }
    return { reasoning, context, speed, vision, toolCall, costScore, overall, tier };
}
/**
 * 兼容旧 API: 返回能力等级
 */
export function getCapabilityTier(meta) {
    return computeCapabilities(meta).tier;
}
/**
 * 通过 provider + subModel 查找模型元数据并返回能力等级
 */
export function getCapabilityTierById(provider, subModel) {
    const modelId = subModel ? `${provider}:${subModel}` : provider;
    const meta = MODELS.find(m => m.id === modelId || (m.provider === provider && (!subModel || m.subModel === subModel)));
    return getCapabilityTier(meta);
}
/**
 * 通过 provider + subModel 查找模型元数据并返回完整能力评分
 */
export function getCapabilitiesById(provider, subModel) {
    const modelId = subModel ? `${provider}:${subModel}` : provider;
    const meta = MODELS.find(m => m.id === modelId || (m.provider === provider && (!subModel || m.subModel === subModel)));
    return computeCapabilities(meta);
}
/**
 * 根据模型能力评分计算运行时参数
 * 核心逻辑:
 *   - 推理强 → 更多迭代, 开 thinking, 更大输出预算
 *   - 速度快 → 更多迭代 (每轮成本低)
 *   - 上下文大 → 更高压缩阈值 (不急着压缩)
 *   - 工具调用好 → 信任它自主选工具
 */
export function getRuntimeParams(cap, meta) {
    // 基础值
    let maxIterations = 50;
    let thinking = false;
    let thinkingBudget = 0;
    let maxTokens = meta?.maxOutputTokens ?? 4096;
    let temperature = 0.7;
    let contextCompressThreshold = 50_000;
    // 自主模型: 更多迭代, 允许更低温度 (精确任务), 更大压缩阈值
    if (cap.tier === 'autonomous') {
        maxIterations = 80;
        temperature = 0.6; // 自主模型偏低温, 更稳定
        contextCompressThreshold = 80_000; // 大上下文不急着压缩
    }
    // 引导模型: 中等
    if (cap.tier === 'guided') {
        maxIterations = 60;
        temperature = 0.7;
        contextCompressThreshold = 50_000;
    }
    // 监督模型: 少迭代, 高温 (更有创造力补偿), 早早压缩
    if (cap.tier === 'supervised') {
        maxIterations = 40;
        temperature = 0.8;
        contextCompressThreshold = 30_000;
    }
    // 速度微调: 快模型加迭代, 慢模型减迭代
    if (cap.speed > 0.7)
        maxIterations += 10;
    else if (cap.speed < 0.4)
        maxIterations -= 10;
    // 推理微调: 强推理开 thinking
    if (cap.reasoning >= 0.55 && meta?.supportsThinking) {
        thinking = true;
        thinkingBudget = cap.reasoning >= 0.9 ? 4096 : 2048;
    }
    // 上下文窗口微调压缩阈值
    if (meta?.maxContext) {
        // 压缩阈值 = 上下文窗口的 40%, 但不超过 100K
        contextCompressThreshold = Math.min(Math.floor(meta.maxContext * 0.4), 100_000);
    }
    // 工具调用质量影响 maxTokens (高质量 → 更大输出, 因为模型能更好地组织长输出)
    if (cap.toolCall >= 0.8)
        maxTokens = Math.max(maxTokens, 8192);
    return { maxIterations, thinking, thinkingBudget, maxTokens, temperature, contextCompressThreshold };
}
/**
 * 便捷函数: 通过 provider + subModel 直接获取运行时参数
 */
export function getRuntimeParamsById(provider, subModel) {
    const cap = getCapabilitiesById(provider, subModel);
    const modelId = subModel ? `${provider}:${subModel}` : provider;
    const meta = MODELS.find(m => m.id === modelId || (m.provider === provider && (!subModel || m.subModel === subModel)));
    return getRuntimeParams(cap, meta);
}
export function getModelsByProvider() {
    const map = new Map();
    for (const m of MODELS) {
        const list = map.get(m.provider) || [];
        list.push(m);
        map.set(m.provider, list);
    }
    return map;
}
/**
 * 获取所有免费模型
 */
export function getFreeModels() {
    return MODELS.filter(m => m.isFree);
}
/**
 * 是否为免费模型
 */
export function isFreeModel(modelId) {
    const m = MODELS.find(x => x.id === modelId);
    return m?.isFree ?? false;
}
/**
 * 获取免费模型中最推荐的模型 (按优先级排序)
 */
export function getBestFreeModel(forTools, forImages) {
    const candidates = MODELS.filter(m => {
        if (m.isFree !== true)
            return false;
        if (forTools && !m.supportsTools)
            return false;
        if (forImages && !m.supportsImages)
            return false;
        return true;
    });
    if (candidates.length === 0)
        return undefined;
    candidates.sort((a, b) => a.priority - b.priority);
    return candidates[0].id;
}
// ===== 智能模型推荐: 复杂任务建议切换强模型 =====
/** 需要强模型的关键词模式 */
const PRO_MODEL_PATTERNS = [
    {
        pattern: /审查.*代码|代码.*审查|code\s*review|安全.*审查|漏洞.*扫描/i,
        label: '代码审查',
        recommended: 'deepseek:v4-pro',
    },
    {
        pattern: /架构.*设计|系统.*设计|design.*architecture|重构.*方案|性能.*优化/i,
        label: '架构/性能优化',
        recommended: 'deepseek:v4-pro',
    },
    {
        pattern: /安全.*分析|漏洞.*分析|security.*analy|渗透.*测试/i,
        label: '安全分析',
        recommended: 'deepseek:v4-pro',
    },
    {
        pattern: /复杂.*bug|疑难.*问题|深度.*调试|complex.*bug/i,
        label: '复杂Bug调试',
        recommended: 'deepseek:v4-pro',
    },
];
/**
 * 分析用户消息, 判断是否需要推荐切换到强模型
 * 核心逻辑: 复杂任务(审查/架构/安全)用强模型, 简单任务用免费模型
 */
export function recommendModel(message, currentModelId) {
    const current = MODELS.find(m => m.id === currentModelId);
    const currentIsFree = current?.isFree ?? true;
    for (const { pattern, label, recommended } of PRO_MODEL_PATTERNS) {
        if (pattern.test(message)) {
            const rec = MODELS.find(m => m.id === recommended);
            // 如果当前已经是推荐的强模型, 不需要推荐
            if (currentModelId === recommended) {
                return { needsPro: false, reason: '', recommendedModel: recommended, recommendedLabel: rec?.label || '', currentIsFree };
            }
            return {
                needsPro: true,
                reason: `当前任务「${label}」需要更强的推理能力`,
                recommendedModel: recommended,
                recommendedLabel: rec?.label || 'DeepSeek V4 Pro',
                currentIsFree,
            };
        }
    }
    return { needsPro: false, reason: '', recommendedModel: currentModelId, recommendedLabel: '', currentIsFree };
}
/**
 * 获取推荐的强模型及其所需 API Key 信息
 */
export function getProModelKeyInfo(modelId) {
    const info = {
        'deepseek:v4-pro': { envVar: 'DEEPSEEK_API_KEY', provider: 'deepseek', signupUrl: 'https://platform.deepseek.com' },
    };
    return info[modelId] || null;
}
export const COMMERCIAL_MODEL_TEMPLATES = [
    {
        id: 'deepseek',
        label: 'DeepSeek',
        baseURL: 'https://api.deepseek.com/v1',
        models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
        docsUrl: 'https://platform.deepseek.com/api-keys',
        color: '#10B981',
    },
    {
        id: 'openai',
        label: 'OpenAI',
        baseURL: 'https://api.openai.com/v1',
        models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
        docsUrl: 'https://platform.openai.com/api-keys',
        color: '#F59E0B',
    },
    {
        id: 'qwen',
        label: '通义千问 (阿里云)',
        baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        models: ['qwen-turbo', 'qwen-plus', 'qwen-max'],
        docsUrl: 'https://help.aliyun.com/zh/dashscope',
        color: '#FF6A00',
    },
    {
        id: 'moonshot',
        label: '月之暗面 Moonshot',
        baseURL: 'https://api.moonshot.cn/v1',
        models: ['kimi-k2.5', 'kimi-k2.6', 'kimi-k3'],
        docsUrl: 'https://platform.moonshot.cn/console/api-keys',
        color: '#6466F1',
    },
    {
        id: 'yi',
        label: '零一万物 Yi',
        baseURL: 'https://api.lingyiwanwu.com/v1',
        models: ['yi-lightning', 'yi-medium', 'yi-large'],
        docsUrl: 'https://platform.lingyiwanwu.com',
        color: '#8B5CF6',
    },
    {
        id: 'baichuan',
        label: '百川智能',
        baseURL: 'https://api.baichuan-ai.com/v1',
        models: ['Baichuan4', 'Baichuan3-Turbo'],
        docsUrl: 'https://platform.baichuan-ai.com',
        color: '#EC4899',
    },
    {
        id: 'minimax',
        label: 'MiniMax',
        baseURL: 'https://api.minimax.chat/v1',
        models: ['MiniMax-M3'],
        docsUrl: 'https://platform.minimaxi.com',
        color: '#06B6D4',
    },
    {
        id: 'anthropic',
        label: 'Anthropic Claude',
        baseURL: 'https://api.anthropic.com/v1',
        models: ['claude-sonnet-4-5-20250929', 'claude-opus-4-1-20250805', 'claude-haiku-3-5-20241022'],
        docsUrl: 'https://console.anthropic.com/',
        color: '#D97706',
    },
    {
        id: 'longcat',
        label: '美团 LongCat (免费额度)',
        baseURL: 'https://api.longcat.chat/openai',
        models: ['LongCat-2.0'],
        docsUrl: 'https://longcat.chat',
        color: '#FFD700',
    },
    // NVIDIA NIM 已移除 (2026-07-25): NIM 不可用
];
