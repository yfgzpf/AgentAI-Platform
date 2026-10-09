/**
 * CuriosityEngine — 内在动机系统 (AI 的好奇心引擎)
 * ----------------------------------------------------
 * 让 AI 拥有"想知道"的能力 — 不是用户给的目标, 是自己产生的探索方向
 *
 * 核心理念：Intrinsic Motivation (内在动机)
 *   - 好奇心: "这个函数为什么这样写?"
 *   - 完美主义: "我上次处理得不够好, 有更好的方案吗?"
 *   - 创造欲: "如果我把这两个不相关的模块连接起来?"
 *
 * 三大子系统:
 *   1. 未解问题队列 — 从每次对话中提取"没能完美解决的问题"
 *   2. 依赖链追踪 — 沿 import/require 关系深入探索代码
 *   3. 假设生成器 — 产生"如果A和B连接会怎样"的跨模块联想
 *
 * 与 DreamEngine 的关系:
 *   - DreamEngine 是"梦境的容器" (何时运行、运行多久)
 *   - CuriosityEngine 是"梦境的方向" (想探索什么、为什么)
 *   - 之前: DreamEngine 随机读文件 → 无方向
 *   - 之后: DreamEngine 从 CuriosityEngine 取问题 → 有目的的探索
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventEmitter } from 'events';
import { WorkspaceManager } from '../workspace-manager.js';
import { writeEvolutionAsync } from '../evolution.js';
import { getScoped, resetScoped } from './workspace-scope.js';
// ===== CuriosityEngine =====
export class CuriosityEngine extends EventEmitter {
    questions = [];
    insights = [];
    dataPath;
    maxQuestions = 100;
    maxInsights = 50;
    constructor(workspace) {
        super();
        // 串味修复: 优先用传入的请求级 workspace；未传时才回退全局单例
        const ws = workspace || WorkspaceManager.getInstance().projectDir;
        this.dataPath = path.join(ws, '.agentai', 'curiosity.jsonl');
        this.loadData();
    }
    /**
     * 从对话中提取未解问题
     * 每次对话结束后调用, 把"没能完美解决"的问题加入队列
     */
    extractFromConversation(userMessage, toolsUsed, failureCount, sessionId) {
        const extracted = [];
        // 1. 失败驱动的: "为什么失败了?"
        if (failureCount >= 2) {
            extracted.push(this.createQuestion('why_did_it_fail', `在处理 "${userMessage.slice(0, 80)}" 时连续失败 ${failureCount} 次, 根因是什么?`, { sessionId, userMessage, failureCount }, [], Math.min(failureCount / 5, 1)));
        }
        // 2. 工具使用模式: "为什么要用这么多工具?"
        if (toolsUsed.length > 8) {
            extracted.push(this.createQuestion('can_it_be_simpler', `处理 "${userMessage.slice(0, 60)}" 用了 ${toolsUsed.length} 个工具 (${toolsUsed.slice(0, 5).join(', ')}...), 能否简化?`, { sessionId, userMessage, toolName: toolsUsed[0] }, [], 0.5));
        }
        // 3. 检测重复工具: "为什么反复用同一个工具?"
        const toolCounts = {};
        for (const t of toolsUsed)
            toolCounts[t] = (toolCounts[t] || 0) + 1;
        for (const [tool, count] of Object.entries(toolCounts)) {
            if (count >= 3) {
                extracted.push(this.createQuestion('pattern_anomaly', `工具 "${tool}" 被调用了 ${count} 次, 是否有更高效的方式?`, { sessionId, toolName: tool }, [], 0.6));
            }
        }
        // 4. 用户消息暗示的未解问题
        if (/为什么|why|不对|不工作|又错了|还是不行/i.test(userMessage)) {
            extracted.push(this.createQuestion('why_does_it_work', `用户说 "${userMessage.slice(0, 60)}", 暗示之前的方案有问题, 需要深入根因`, { sessionId, userMessage }, [], 0.8));
        }
        // 添加到队列
        for (const q of extracted) {
            this.addQuestion(q);
        }
        if (extracted.length > 0) {
            console.log(`[curiosity] 🔍 从对话中提取 ${extracted.length} 个未解问题 (队列: ${this.questions.filter(q => q.status === 'pending').length})`);
        }
        return extracted;
    }
    /**
     * 获取下一个应该探索的问题
     * 优先级: 高优先级 + 未探索过 + 最久没探索的
     */
    getNextQuestion() {
        const pending = this.questions.filter(q => q.status === 'pending');
        if (pending.length === 0)
            return null;
        // 按优先级 × 时间衰减 排序
        const now = Date.now();
        const scored = pending.map(q => {
            const ageHours = (now - q.ts) / 3600000;
            const ageBoost = Math.min(ageHours / 24, 0.3); // 越久没探索, 略微加分
            return { question: q, score: q.priority + ageBoost };
        });
        scored.sort((a, b) => b.score - a.score);
        return scored[0]?.question || null;
    }
    /**
     * 探索一个问题 — 沿依赖链追踪代码
     * 这是 DreamEngine 的"方向"提供者
     */
    async exploreQuestion(question, workspace) {
        question.status = 'exploring';
        question.exploreCount++;
        question.lastExploredTs = Date.now();
        this.emit('explore:start', question);
        const findings = [];
        const newHypotheses = [];
        const relatedFiles = [];
        try {
            switch (question.type) {
                case 'why_did_it_fail':
                    // 探索失败相关文件 — 优先用 WorkspaceAgent 依赖图
                    try {
                        const { findExporter, buildWorkspaceContext } = await import('../workspace-agent.js');
                        // 沿依赖链追踪: 找到失败工具的定义文件, 再找它的依赖
                        if (question.origin.toolName) {
                            const defFiles = findExporter(workspace, question.origin.toolName);
                            if (defFiles.length > 0) {
                                relatedFiles.push(...defFiles);
                                findings.push(`工具 ${question.origin.toolName} 定义在 ${defFiles.length} 个文件中`);
                            }
                        }
                    }
                    catch { /* workspace-agent optional */ }
                    // fallback: 原有的文本搜索方式
                    if (relatedFiles.length === 0) {
                        const failFiles = this.findFailureRelatedFiles(workspace, question.origin.toolName);
                        relatedFiles.push(...failFiles);
                    }
                    for (const f of relatedFiles.slice(0, 3)) {
                        const content = this.readFileSnippet(f, 200);
                        if (content) {
                            findings.push(`${path.basename(f)}: ${content.slice(0, 100)}`);
                            newHypotheses.push({
                                id: `hyp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                                text: `${path.basename(f)} 可能缺少对 ${question.origin.toolName} 的错误处理`,
                                questionId: question.id,
                                verified: 'unverified',
                                confidence: 0.4,
                            });
                        }
                    }
                    break;
                case 'can_it_be_simpler':
                    // 探索工具使用模式
                    const toolFiles = this.findToolDefinitions(workspace, question.origin.toolName);
                    relatedFiles.push(...toolFiles);
                    findings.push(`发现 ${toolFiles.length} 个相关文件定义`);
                    if (toolFiles.length > 3) {
                        newHypotheses.push({
                            id: `hyp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                            text: `多个文件定义了类似功能, 可能可以合并为统一接口`,
                            questionId: question.id,
                            verified: 'unverified',
                            confidence: 0.5,
                        });
                    }
                    break;
                case 'what_if_connected':
                    // 跨模块联想: 找两个不相关模块的隐含联系
                    const modules = this.discoverModules(workspace);
                    if (modules.length >= 2) {
                        const [a, b] = this.pickRandomPair(modules);
                        findings.push(`探索 ${a} 和 ${b} 的潜在联系`);
                        const sharedConcepts = this.findSharedConcepts(workspace, a, b);
                        if (sharedConcepts.length > 0) {
                            newHypotheses.push({
                                id: `hyp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                                text: `${a} 和 ${b} 共享概念: ${sharedConcepts.join(', ')}, 可能可以统一`,
                                questionId: question.id,
                                verified: 'unverified',
                                confidence: 0.3,
                            });
                        }
                    }
                    break;
                case 'pattern_anomaly':
                    // 检测不一致的模式
                    const anomalies = this.findPatternAnomalies(workspace);
                    for (const a of anomalies.slice(0, 3)) {
                        findings.push(a);
                    }
                    if (anomalies.length > 0) {
                        newHypotheses.push({
                            id: `hyp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                            text: `代码中存在 ${anomalies.length} 处模式不一致, 可能是技术债`,
                            questionId: question.id,
                            verified: 'unverified',
                            confidence: 0.6,
                        });
                    }
                    break;
                case 'why_does_it_work':
                case 'what_is_missing':
                default:
                    // 通用探索: 读随机文件, 寻找有趣模式
                    const randomFiles = this.pickRandomFiles(workspace, 3);
                    for (const f of randomFiles) {
                        const content = this.readFileSnippet(f, 150);
                        if (content) {
                            findings.push(`${path.basename(f)}: ${content.slice(0, 80)}`);
                            relatedFiles.push(f);
                        }
                    }
                    break;
            }
            // 评估是否已解决
            if (findings.length > 0 && question.exploreCount >= 2) {
                question.status = 'resolved';
                question.resolution = findings[0];
                // 产生洞察
                const insight = {
                    id: `insight-${Date.now()}`,
                    ts: Date.now(),
                    text: findings[0],
                    questionId: question.id,
                    type: question.type === 'why_did_it_fail' ? 'risk' : 'pattern',
                    scope: relatedFiles,
                };
                this.insights.push(insight);
                if (this.insights.length > this.maxInsights)
                    this.insights = this.insights.slice(-this.maxInsights);
                this.emit('insight', insight);
                // 【P2-10】好奇心洞察 → 写入进化记忆
                (async () => {
                    try {
                        await writeEvolutionAsync({
                            type: 'self-eval-insight',
                            content: insight.text.slice(0, 300),
                            taskType: 'general',
                            keywords: ['curiosity', insight.type, question.type],
                            success: true,
                        });
                    }
                    catch { /* 静默 */ }
                })();
            }
            else if (question.exploreCount >= 5) {
                question.status = 'abandoned';
            }
        }
        catch (e) {
            findings.push(`探索失败: ${e?.message}`);
        }
        // 保存假设
        question.hypotheses.push(...newHypotheses);
        this.saveData();
        this.emit('explore:end', { question, findings, newHypotheses });
        return { findings, newHypotheses, relatedFiles, resolution: question.resolution };
    }
    // ===== 问题管理 =====
    createQuestion(type, question, origin, relatedFiles, priority) {
        return {
            id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            ts: Date.now(),
            type,
            question,
            origin,
            relatedFiles,
            priority,
            status: 'pending',
            exploreCount: 0,
            hypotheses: [],
        };
    }
    addQuestion(q) {
        // 去重: 如果已存在类似问题, 合并优先级
        const existing = this.questions.find(eq => eq.type === q.type && eq.question.slice(0, 30) === q.question.slice(0, 30));
        if (existing) {
            existing.priority = Math.max(existing.priority, q.priority);
            return;
        }
        this.questions.push(q);
        if (this.questions.length > this.maxQuestions) {
            this.questions = this.questions.slice(-this.maxQuestions);
        }
        this.emit('question:added', q);
    }
    // ===== 代码探索工具 =====
    findFailureRelatedFiles(ws, toolName) {
        if (!toolName)
            return [];
        const srcDir = path.join(ws, 'packages', 'agentai-gateway', 'src');
        if (!fs.existsSync(srcDir))
            return [];
        const files = [];
        this.walkDir(srcDir, (filePath) => {
            if (filePath.endsWith('.ts') && !filePath.endsWith('.test.ts')) {
                try {
                    const content = fs.readFileSync(filePath, 'utf-8');
                    if (content.includes(toolName) && content.includes('Error') || content.includes('catch')) {
                        files.push(filePath);
                    }
                }
                catch { /* skip */ }
            }
        }, 2);
        return files.slice(0, 5);
    }
    findToolDefinitions(ws, toolName) {
        if (!toolName)
            return [];
        const srcDir = path.join(ws, 'packages', 'agentai-gateway', 'src');
        if (!fs.existsSync(srcDir))
            return [];
        const files = [];
        this.walkDir(srcDir, (filePath) => {
            if (filePath.endsWith('.ts')) {
                try {
                    const content = fs.readFileSync(filePath, 'utf-8');
                    if (content.includes(`name: '${toolName}'`) || content.includes(`name: "${toolName}"`)) {
                        files.push(filePath);
                    }
                }
                catch { /* skip */ }
            }
        }, 2);
        return files;
    }
    discoverModules(ws) {
        const srcDir = path.join(ws, 'packages', 'agentai-gateway', 'src');
        if (!fs.existsSync(srcDir))
            return [];
        const modules = [];
        try {
            const entries = fs.readdirSync(srcDir, { withFileTypes: true });
            for (const e of entries) {
                if (e.isDirectory() && !e.name.startsWith('.'))
                    modules.push(e.name);
            }
        }
        catch { /* skip */ }
        return modules;
    }
    findSharedConcepts(ws, moduleA, moduleB) {
        const concepts = [];
        const dirA = path.join(ws, 'packages', 'agentai-gateway', 'src', moduleA);
        const dirB = path.join(ws, 'packages', 'agentai-gateway', 'src', moduleB);
        if (!fs.existsSync(dirA) || !fs.existsSync(dirB))
            return concepts;
        // 找两个模块共享的关键词
        const wordsA = this.extractKeywordsFromDir(dirA);
        const wordsB = this.extractKeywordsFromDir(dirB);
        for (const w of wordsA) {
            if (wordsB.has(w))
                concepts.push(w);
        }
        return concepts.slice(0, 5);
    }
    extractKeywordsFromDir(dir) {
        const words = new Set();
        this.walkDir(dir, (filePath) => {
            if (!filePath.endsWith('.ts'))
                return;
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                // 提取导出的函数/类名
                const matches = content.match(/export\s+(?:async\s+)?(?:function|class|const)\s+(\w+)/g) || [];
                for (const m of matches) {
                    const name = m.replace(/export\s+(?:async\s+)?(?:function|class|const)\s+/, '');
                    if (name.length > 3)
                        words.add(name.toLowerCase());
                }
            }
            catch { /* skip */ }
        }, 1);
        return words;
    }
    findPatternAnomalies(ws) {
        const anomalies = [];
        const srcDir = path.join(ws, 'packages', 'agentai-gateway', 'src');
        if (!fs.existsSync(srcDir))
            return anomalies;
        // 检测: 同一功能不同写法 (如 some vs filter vs find)
        const patterns = {};
        this.walkDir(srcDir, (filePath) => {
            if (!filePath.endsWith('.ts'))
                return;
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                // 检测 console.log vs logger.info 不一致
                if (content.includes('console.log') && content.includes('logger.info')) {
                    anomalies.push(`${path.relative(ws, filePath)}: 同时使用 console.log 和 logger.info, 不一致`);
                }
                // 检测 try-catch vs .catch() 不一致
                if (content.includes('try {') && content.includes('.catch(')) {
                    // 这是正常的, 不报
                }
            }
            catch { /* skip */ }
        }, 2);
        return anomalies.slice(0, 5);
    }
    pickRandomFiles(ws, count) {
        const srcDir = path.join(ws, 'packages', 'agentai-gateway', 'src');
        if (!fs.existsSync(srcDir))
            return [];
        const files = [];
        this.walkDir(srcDir, (filePath) => {
            if (filePath.endsWith('.ts') && !filePath.endsWith('.test.ts'))
                files.push(filePath);
        }, 2);
        return this.shuffle(files).slice(0, count);
    }
    pickRandomPair(arr) {
        const shuffled = this.shuffle([...arr]);
        return [shuffled[0], shuffled[1]];
    }
    // ===== 工具方法 =====
    readFileSnippet(filePath, maxLen) {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            // 提取有趣部分: 函数定义/注释/TODO
            const interesting = content.match(/\/\/.*(?:TODO|FIXME|NOTE|修复|P[0-9]).*/gi)
                || content.match(/export\s+(?:async\s+)?function\s+\w+[\s\S]{0,100}/)
                || [content.split('\n').slice(0, 3).join('\n')];
            return (interesting[0] || '').slice(0, maxLen);
        }
        catch {
            return null;
        }
    }
    walkDir(dir, fn, maxDepth = 3, currentDepth = 0) {
        if (currentDepth > maxDepth)
            return;
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist')
                    continue;
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    this.walkDir(fullPath, fn, maxDepth, currentDepth + 1);
                }
                else {
                    fn(fullPath);
                }
            }
        }
        catch { /* skip */ }
    }
    shuffle(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }
    // ===== 数据持久化 =====
    loadData() {
        try {
            if (fs.existsSync(this.dataPath)) {
                const raw = fs.readFileSync(this.dataPath, 'utf-8');
                const lines = raw.trim().split('\n').filter(Boolean);
                for (const line of lines) {
                    try {
                        const obj = JSON.parse(line);
                        if (obj.kind === 'question')
                            this.questions.push(obj);
                        if (obj.kind === 'insight')
                            this.insights.push(obj);
                    }
                    catch { /* skip */ }
                }
            }
        }
        catch { /* start fresh */ }
    }
    saveData() {
        try {
            const dir = path.dirname(this.dataPath);
            if (!fs.existsSync(dir))
                fs.mkdirSync(dir, { recursive: true });
            const lines = [];
            for (const q of this.questions)
                lines.push(JSON.stringify({ kind: 'question', ...q }));
            for (const i of this.insights)
                lines.push(JSON.stringify({ kind: 'insight', ...i }));
            fs.writeFileSync(this.dataPath, lines.join('\n') + '\n', 'utf-8');
        }
        catch { /* best-effort */ }
    }
    // ===== 查询接口 =====
    /** 获取好奇心上下文 (注入 system prompt) */
    getCuriosityContext() {
        const pending = this.questions.filter(q => q.status === 'pending');
        if (pending.length === 0 && this.insights.length === 0)
            return '';
        const lines = ['<curiosity>'];
        if (this.insights.length > 0) {
            lines.push('  🔍 近期洞察:');
            for (const i of this.insights.slice(-3)) {
                lines.push(`    ${i.text.slice(0, 100)}`);
            }
        }
        if (pending.length > 0) {
            lines.push(`  ❓ 待探索问题: ${pending.length} 个`);
            const top = pending.sort((a, b) => b.priority - a.priority).slice(0, 2);
            for (const q of top) {
                lines.push(`    [${q.type}] ${q.question.slice(0, 80)}`);
            }
        }
        lines.push('</curiosity>');
        return lines.join('\n');
    }
    /** 获取统计 */
    getStats() {
        return {
            totalQuestions: this.questions.length,
            pending: this.questions.filter(q => q.status === 'pending').length,
            resolved: this.questions.filter(q => q.status === 'resolved').length,
            insights: this.insights.length,
        };
    }
    /** 获取待解决问题列表 */
    getPendingQuestions() {
        return this.questions.filter(q => q.status === 'pending');
    }
    /** 获取洞察列表 */
    getInsights() {
        return this.insights;
    }
}
// ===== 单例 =====
// ===== workspace 作用域单例 =====
// 串味修复: 原为进程级单例 + 构造时固化全局 projectDir。
/** 按 workspace 返回 CuriosityEngine 实例（传请求级 workspace） */
export function getCuriosityEngine(workspace) {
    return getScoped('curiosity', workspace, () => new CuriosityEngine(workspace));
}
/** 重置指定 workspace 的实例；不传则重置全部 */
export function resetCuriosityEngine(workspace) {
    resetScoped('curiosity', workspace);
}
