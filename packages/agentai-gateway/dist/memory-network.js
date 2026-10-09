/**
 * memory-network.ts — AI 记忆网络
 * ============================================================
 * 跨会话、跨用户的知识共享网络。
 *
 * 核心原则:
 *   - 只共享"模式"，不共享"数据"
 *   - 用户A解决了某类问题 → 提取模式 → 用户B遇到类似问题 → 自动推荐
 *   - 隐私保护：不存储用户原始消息，只存储抽象后的工作模式
 *
 * 存储位置: ~/.agentai/memory-network/
 *   patterns.jsonl  — 工作模式 (追加写)
 *   solutions.jsonl — 问题解决方案 (追加写)
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
const NETWORK_DIR = path.join(os.homedir(), '.agentai', 'memory-network');
// ===== 存储 =====
function ensureDir() {
    if (!fs.existsSync(NETWORK_DIR)) {
        fs.mkdirSync(NETWORK_DIR, { recursive: true });
    }
}
function loadPatterns() {
    ensureDir();
    try {
        const file = path.join(NETWORK_DIR, 'patterns.jsonl');
        if (!fs.existsSync(file))
            return [];
        return fs.readFileSync(file, 'utf-8')
            .split('\n')
            .filter(l => l.trim())
            .map(l => JSON.parse(l));
    }
    catch {
        return [];
    }
}
function loadSolutions() {
    ensureDir();
    try {
        const file = path.join(NETWORK_DIR, 'solutions.jsonl');
        if (!fs.existsSync(file))
            return [];
        return fs.readFileSync(file, 'utf-8')
            .split('\n')
            .filter(l => l.trim())
            .map(l => JSON.parse(l));
    }
    catch {
        return [];
    }
}
function appendPattern(pattern) {
    ensureDir();
    try {
        const file = path.join(NETWORK_DIR, 'patterns.jsonl');
        fs.appendFileSync(file, JSON.stringify(pattern) + '\n');
    }
    catch (e) {
        console.warn('[memory-network] append pattern failed:', e?.message);
    }
}
function appendSolution(solution) {
    ensureDir();
    try {
        const file = path.join(NETWORK_DIR, 'solutions.jsonl');
        fs.appendFileSync(file, JSON.stringify(solution) + '\n');
    }
    catch (e) {
        console.warn('[memory-network] append solution failed:', e?.message);
    }
}
// ===== 模式提取 (隐私保护) =====
/**
 * 从工作流中提取抽象模式 — 去除所有具体信息
 * 隐私保护: 不存储文件路径、用户名、项目名、代码内容
 */
export function extractPattern(taskDescription, toolsUsed, filesTouched, success) {
    if (toolsUsed.length < 2)
        return null;
    // 抽象化任务描述 — 去除具体信息
    let abstractPattern = taskDescription
        .replace(/F:\\[^\\]*\\[^\\]*/g, '<path>') // Windows 路径
        .replace(/\/home\/[^/]*\/[^/]*/g, '<path>') // Unix 路径
        .replace(/[\w.-]+@[\w.-]+\.\w+/g, '<email>') // 邮箱
        .replace(/\b\d{4,}\b/g, '<num>') // 长数字
        .slice(0, 100);
    // 任务类型分类
    let taskType = 'general';
    const desc = taskDescription.toLowerCase();
    if (desc.match(/修复|fix|bug|error/))
        taskType = 'bugfix';
    else if (desc.match(/创建|create|新建|生成/))
        taskType = 'create';
    else if (desc.match(/重构|refactor|优化/))
        taskType = 'refactor';
    else if (desc.match(/审查|review|检查/))
        taskType = 'review';
    else if (desc.match(/部署|deploy|发布/))
        taskType = 'deploy';
    else if (desc.match(/搜索|search|查找/))
        taskType = 'search';
    else if (desc.match(/分析|analyze|诊断/))
        taskType = 'analyze';
    // 关键词提取 (从任务描述中)
    const keywords = taskDescription
        .split(/[\s,，。.!！?？:：;；]+/)
        .filter(w => w.length >= 2 && w.length <= 15)
        .filter(w => !w.match(/^[a-z]$/i)) // 过滤单字母
        .slice(0, 5);
    return {
        id: `pattern-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        taskType,
        pattern: abstractPattern,
        toolChain: [...new Set(toolsUsed)].slice(0, 8),
        approach: `工具链: ${[...new Set(toolsUsed)].slice(0, 5).join(' → ')}, 涉及 ${filesTouched} 个文件`,
        keywords,
        引用次数: 1,
        successRate: success ? 1.0 : 0.0,
        lastUsed: Date.now(),
        createdAt: Date.now(),
    };
}
/**
 * 从错误修复中提取解决方案
 */
export function extractSolution(errorMsg, fixDescription, fixSteps, errorType) {
    if (!errorMsg || !fixDescription)
        return null;
    // 抽象化错误信息
    const abstractError = errorMsg
        .replace(/F:\\[^\\]*\\[^\\]*/g, '<path>')
        .replace(/\/home\/[^/]*\/[^/]*/g, '<path>')
        .replace(/[\w.-]+@[\w.-]+\.\w+/g, '<email>')
        .slice(0, 150);
    const keywords = errorMsg
        .split(/[\s:：;；,，.]+/)
        .filter(w => w.length >= 3 && w.length <= 20)
        .slice(0, 5);
    return {
        problemPattern: abstractError,
        solution: fixDescription.slice(0, 200),
        steps: fixSteps.slice(0, 5),
        errorType,
        keywords,
        verifiedCount: 1,
        lastVerified: Date.now(),
    };
}
// ===== 模式匹配 =====
/**
 * 查找匹配的工作模式
 */
export function findMatchingPatterns(message, limit = 3) {
    const patterns = loadPatterns();
    if (patterns.length === 0)
        return [];
    const now = Date.now();
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;
    const msg = message.toLowerCase();
    const scored = patterns.map(p => {
        let score = 0;
        // 关键词匹配
        for (const kw of p.keywords) {
            if (msg.includes(kw.toLowerCase()))
                score += 3;
        }
        // 任务类型匹配
        if (msg.match(/修复|fix|bug/) && p.taskType === 'bugfix')
            score += 2;
        if (msg.match(/创建|create|新建/) && p.taskType === 'create')
            score += 2;
        if (msg.match(/重构|refactor/) && p.taskType === 'refactor')
            score += 2;
        if (msg.match(/审查|review/) && p.taskType === 'review')
            score += 2;
        // 引用次数加权 (被验证过多次的模式更可信)
        score += Math.min(p.引用次数 * 0.5, 5);
        // 成功率加权
        score *= p.successRate;
        // LRU 时间衰减: 30天内不衰减, 30-90天衰减50%, 90天以上衰减80%
        const age = now - (p.lastUsed || p.createdAt);
        if (age > NINETY_DAYS)
            score *= 0.2;
        else if (age > THIRTY_DAYS)
            score *= 0.5;
        return { pattern: p, score };
    });
    return scored
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(s => s.pattern);
}
/**
 * 查找匹配的问题解决方案
 */
export function findMatchingSolutions(errorMsg, limit = 3) {
    const solutions = loadSolutions();
    if (solutions.length === 0)
        return [];
    const now = Date.now();
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;
    const err = errorMsg.toLowerCase();
    const scored = solutions.map(s => {
        let score = 0;
        // 错误类型匹配
        if (s.errorType && err.includes(s.errorType.toLowerCase()))
            score += 5;
        // 关键词匹配
        for (const kw of s.keywords) {
            if (err.includes(kw.toLowerCase()))
                score += 3;
        }
        // 问题模式匹配
        const overlap = s.problemPattern
            .split(/\s+/)
            .filter(word => word.length > 3 && err.includes(word.toLowerCase()));
        score += overlap.length * 2;
        // 验证次数加权
        score += Math.min(s.verifiedCount * 0.5, 5);
        // LRU 时间衰减
        const age = now - (s.lastVerified || 0);
        if (age > NINETY_DAYS)
            score *= 0.2;
        else if (age > THIRTY_DAYS)
            score *= 0.5;
        return { solution: s, score };
    });
    return scored
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(s => s.solution);
}
// ===== 注入构建 =====
/**
 * 构建记忆网络上下文 — 注入到 AI
 */
export function buildMemoryNetworkContext(message) {
    const parts = [];
    // 匹配的工作模式
    const patterns = findMatchingPatterns(message, 3);
    if (patterns.length > 0) {
        parts.push('[记忆网络] 相似任务的成功模式:');
        for (const p of patterns) {
            parts.push(`  ✅ ${p.taskType}: ${p.toolChain.join(' → ')} (成功率 ${(p.successRate * 100).toFixed(0)}%, ${p.引用次数}次验证)`);
        }
    }
    return parts.length > 0 ? parts.join('\n') : '';
}
/**
 * 构建错误解决方案注入
 */
export function buildSolutionContext(errorMsg) {
    const solutions = findMatchingSolutions(errorMsg, 2);
    if (solutions.length === 0)
        return '';
    const parts = ['[记忆网络] 相似错误的解决方案:'];
    for (const s of solutions) {
        parts.push(`  🔧 ${s.solution} (${s.verifiedCount}次验证)`);
        if (s.steps.length > 0) {
            parts.push(`     步骤: ${s.steps.join(' → ')}`);
        }
    }
    return parts.join('\n');
}
// ===== 记录 =====
/**
 * 记录一次工作模式 (任务完成后调用)
 */
export function recordWorkPattern(taskDescription, toolsUsed, filesTouched, success) {
    const pattern = extractPattern(taskDescription, toolsUsed, filesTouched, success);
    if (pattern) {
        // 检查是否已有相似模式
        const existing = loadPatterns();
        const similar = existing.find(p => p.taskType === pattern.taskType &&
            p.toolChain.join(',') === pattern.toolChain.join(','));
        if (similar) {
            // 更新已有模式 (增加引用次数, 更新成功率)
            similar.引用次数++;
            similar.successRate = (similar.successRate * (similar.引用次数 - 1) + (success ? 1 : 0)) / similar.引用次数;
            similar.lastUsed = Date.now();
            // 重写文件 (简单实现: 过滤旧的 + 追加新的)
            const others = existing.filter(p => p.id !== similar.id);
            ensureDir();
            fs.writeFileSync(path.join(NETWORK_DIR, 'patterns.jsonl'), [...others, similar].map(p => JSON.stringify(p)).join('\n') + '\n');
        }
        else {
            appendPattern(pattern);
        }
    }
}
/**
 * 记录一次错误解决方案
 */
export function recordProblemSolution(errorMsg, fixDescription, fixSteps, errorType) {
    const solution = extractSolution(errorMsg, fixDescription, fixSteps, errorType);
    if (solution) {
        const existing = loadSolutions();
        const similar = existing.find(s => s.errorType === solution.errorType &&
            s.keywords.some(k => solution.keywords.includes(k)));
        if (similar) {
            similar.verifiedCount++;
            similar.lastVerified = Date.now();
            const others = existing.filter(s => s !== similar);
            ensureDir();
            fs.writeFileSync(path.join(NETWORK_DIR, 'solutions.jsonl'), [...others, similar].map(s => JSON.stringify(s)).join('\n') + '\n');
        }
        else {
            appendSolution(solution);
        }
    }
}
