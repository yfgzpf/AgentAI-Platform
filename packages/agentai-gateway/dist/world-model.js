/**
 * WorldModel - 世界模型因果知识图谱
 * ==========================================
 * 2026-08-03 修复: 此前文件存在但从未被集成 (名实不符)
 *   - 添加持久化 (JSONL, 与 memory.ts 一致)
 *   - 构造函数自动从文件加载历史知识
 *   - 每次 extractKnowledge 后原子追加到磁盘
 *   - 生产代码在 agentai-loop.ts 中按需调用
 *
 * 创新理念：跨任务沉淀结构化知识(实体+关系+因果)
 * 所有后续任务可查询推理
 * 从单任务上下文 → 跨任务共享经验库
 */
import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
// ═══════════════════════════════════════════════════════════
// 世界模型核心类
// ═══════════════════════════════════════════════════════════
export class WorldModel extends EventEmitter {
    entities = new Map();
    relations = new Map();
    causalRules = new Map();
    experiences = new Map();
    llmRouter;
    storeDir;
    /** 2026-09-04: 历史知识异步加载的完成信号; 读取方查询前 await whenReady() 避免漏读 */
    readyPromise;
    constructor(llmRouter, workspace) {
        super();
        this.llmRouter = llmRouter;
        this.storeDir = workspace
            ? path.join(workspace, '.agentai', 'world-model')
            : path.join(process.cwd(), '.agentai', 'world-model');
        // 异步加载历史知识, 不阻塞构造
        this.readyPromise = this.loadFromStorage().catch(() => { });
    }
    // ══════════════════════════════════════════════════════
    // 持久化 (JSONL 原子写入)
    // ══════════════════════════════════════════════════════
    getStorePath(type) {
        return path.join(this.storeDir, `${type}.jsonl`);
    }
    async loadFromStorage() {
        try {
            await fs.mkdir(this.storeDir, { recursive: true });
            // 加载实体
            try {
                const entRaw = await fs.readFile(this.getStorePath('entities'), 'utf-8');
                for (const line of entRaw.split('\n')) {
                    if (!line.trim())
                        continue;
                    try {
                        const e = JSON.parse(line);
                        this.entities.set(e.id, e);
                    }
                    catch { /* 跳过坏行 */ }
                }
            }
            catch { /* 文件不存在正常 */ }
            // 加载关系
            try {
                const relRaw = await fs.readFile(this.getStorePath('relations'), 'utf-8');
                for (const line of relRaw.split('\n')) {
                    if (!line.trim())
                        continue;
                    try {
                        const r = JSON.parse(line);
                        this.relations.set(r.id, r);
                    }
                    catch { /* 跳过坏行 */ }
                }
            }
            catch { /* 文件不存在正常 */ }
            // 加载因果规则
            try {
                const ruleRaw = await fs.readFile(this.getStorePath('rules'), 'utf-8');
                for (const line of ruleRaw.split('\n')) {
                    if (!line.trim())
                        continue;
                    try {
                        const cr = JSON.parse(line);
                        this.causalRules.set(cr.id, cr);
                    }
                    catch { /* 跳过坏行 */ }
                }
            }
            catch { /* 文件不存在正常 */ }
            // 加载经验
            try {
                const expRaw = await fs.readFile(this.getStorePath('experiences'), 'utf-8');
                for (const line of expRaw.split('\n')) {
                    if (!line.trim())
                        continue;
                    try {
                        const exp = JSON.parse(line);
                        this.experiences.set(exp.id, exp);
                    }
                    catch { /* 跳过坏行 */ }
                }
            }
            catch { /* 文件不存在正常 */ }
        }
        catch {
            // 静默失败
        }
    }
    async atomicAppend(filePath, line) {
        try {
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.appendFile(filePath, line + '\n', 'utf-8');
        }
        catch {
            try {
                // 回退: 临时文件 + rename
                const tmp = `${filePath}.${crypto.randomBytes(4).toString('hex')}.tmp`;
                const existing = await fs.readFile(filePath, 'utf-8').catch(() => '');
                await fs.writeFile(tmp, existing + line + '\n', 'utf-8');
                await fs.rename(tmp, filePath);
            }
            catch { /* 最终失败静默 */ }
        }
    }
    async persistEntity(e) {
        await this.atomicAppend(this.getStorePath('entities'), JSON.stringify(e));
    }
    async persistRelation(r) {
        await this.atomicAppend(this.getStorePath('relations'), JSON.stringify(r));
    }
    async persistRule(cr) {
        await this.atomicAppend(this.getStorePath('rules'), JSON.stringify(cr));
    }
    async persistExperience(exp) {
        await this.atomicAppend(this.getStorePath('experiences'), JSON.stringify(exp));
    }
    /**
     * 从任务执行中提取知识
     */
    async extractKnowledge(task) {
        const prompt = `分析以下任务执行过程，提取结构化知识：

任务类型: ${task.type}
输入: ${task.input}
输出: ${task.output}
执行步骤:
${task.steps.map((s, i) => `${i + 1}. ${s.action} → ${s.result}`).join('\n')}

请提取：
1. 涉及的实体（概念、对象、过程）
2. 实体之间的关系
3. 因果规则（如果X则Y）

输出JSON格式：
{
  "entities": [{"name": "", "type": "", "properties": {}}],
  "relations": [{"source": "", "target": "", "type": "", "strength": 0.8}],
  "causalRules": [{"cause": "", "effect": "", "conditions": [], "probability": 0.9}]
}`;
        try {
            const response = await this.llmRouter.chat({
                model: 'agentai',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.3,
            });
            const content = typeof response.content === 'string'
                ? response.content
                : JSON.stringify(response.content);
            // 提取JSON
            const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) || content.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                return { entities: [], relations: [], rules: [] };
            }
            const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
            // 创建实体 (2026-09-04 P0: 同名+同类型实体去重复用, 不再逐任务生成新 id → 图谱/JSONL 不再膨胀)
            const now = Date.now();
            const entities = []; // 本次涉及实体 (含复用的既有实体, 供关系关联与返回)
            const newEntities = []; // 真正新建实体 (仅这些需要落盘)
            const entityByName = new Map();
            for (const ent of this.entities.values()) {
                const ek = String(ent.name || '').toLowerCase();
                if (ek && !entityByName.has(ek))
                    entityByName.set(ek, ent);
            }
            for (const e of parsed.entities || []) {
                const name = String(e.name || '').trim();
                const key = name.toLowerCase();
                const existing = key ? entityByName.get(key) : undefined;
                if (existing && (!e.type || existing.type === e.type)) {
                    // 复用: 合并新属性 + 刷新时间, 不重复写盘
                    if (e.properties && typeof e.properties === 'object')
                        Object.assign(existing.properties, e.properties);
                    existing.updatedAt = now;
                    entities.push(existing);
                }
                else {
                    const entity = {
                        id: `ent-${now}-${Math.random().toString(36).slice(2, 8)}`,
                        name,
                        type: e.type || 'concept',
                        properties: e.properties || {},
                        confidence: 0.7,
                        source: task.id,
                        createdAt: now,
                        updatedAt: now,
                    };
                    this.entities.set(entity.id, entity);
                    entityByName.set(name.toLowerCase(), entity);
                    entities.push(entity);
                    newEntities.push(entity);
                }
            }
            // 创建关系 (仅当两端实体已知; 相同 源|目标|类型 三元组不重复入库)
            const relations = [];
            const newRelations = [];
            const relKey = (sId, tId, type) => `${sId}||${tId}||${type}`;
            const existingRelKeys = new Set(Array.from(this.relations.values()).map(r => relKey(r.sourceId, r.targetId, r.type)));
            for (const r of parsed.relations || []) {
                const sourceEnt = entities.find(e => e.name.toLowerCase() === String(r.source || '').toLowerCase());
                const targetEnt = entities.find(e => e.name.toLowerCase() === String(r.target || '').toLowerCase());
                if (sourceEnt && targetEnt) {
                    const key = relKey(sourceEnt.id, targetEnt.id, r.type || 'depends-on');
                    if (existingRelKeys.has(key))
                        continue;
                    existingRelKeys.add(key);
                    const relation = {
                        id: `rel-${now}-${Math.random().toString(36).slice(2, 8)}`,
                        sourceId: sourceEnt.id,
                        targetId: targetEnt.id,
                        type: r.type || 'depends-on',
                        strength: r.strength || 0.5,
                        evidence: [task.id],
                        confidence: 0.6,
                        createdAt: now,
                    };
                    this.relations.set(relation.id, relation);
                    relations.push(relation);
                    newRelations.push(relation);
                }
            }
            // 创建因果规则 (cause+effect 相同视为同一规则, 不再重复入库)
            const rules = [];
            const newRules = [];
            const ruleKey = (cause, effect) => `${String(cause || '').toLowerCase()}||${String(effect || '').toLowerCase()}`;
            const existingRuleKeys = new Set(Array.from(this.causalRules.values()).map(r => ruleKey(r.cause, r.effect)));
            for (const cr of parsed.causalRules || []) {
                const key = ruleKey(cr.cause, cr.effect);
                if (existingRuleKeys.has(key))
                    continue;
                existingRuleKeys.add(key);
                const rule = {
                    id: `rule-${now}-${Math.random().toString(36).slice(2, 8)}`,
                    cause: cr.cause,
                    effect: cr.effect,
                    conditions: cr.conditions || [],
                    probability: cr.probability || 0.5,
                    exceptions: cr.exceptions || [],
                    sourceTasks: [task.id],
                    verified: false,
                    createdAt: now,
                };
                this.causalRules.set(rule.id, rule);
                rules.push(rule);
                newRules.push(rule);
            }
            // 创建经验记录
            const experience = {
                id: `exp-${now}-${Math.random().toString(36).slice(2, 6)}`,
                taskType: task.type,
                situation: task.input,
                action: task.steps.map(s => s.action).join(' → '),
                outcome: task.output,
                entities: entities.map(e => e.id),
                lessons: this.extractLessons(task),
                createdAt: now,
            };
            this.experiences.set(experience.id, experience);
            this.emit('knowledge:extracted', { task: task.id, entities, relations, rules });
            // 异步持久化, 不阻塞返回 (只写真正新增的条目, 已复用/已存在的不再追加到 JSONL)
            (async () => {
                try {
                    for (const e of newEntities)
                        await this.persistEntity(e);
                    for (const r of newRelations)
                        await this.persistRelation(r);
                    for (const cr of newRules)
                        await this.persistRule(cr);
                    await this.persistExperience(experience);
                }
                catch { /* 静默失败 */ }
            })();
            return { entities, relations, rules };
        }
        catch (error) {
            console.error('[WorldModel] 知识提取失败:', error);
            return { entities: [], relations: [], rules: [] };
        }
    }
    /**
     * 查询知识图谱
     */
    query(query) {
        const result = {
            entities: [],
            relations: [],
            causalRules: [],
            inferences: [],
        };
        // 实体查询
        if (query.entityName) {
            const matched = Array.from(this.entities.values()).filter(e => e.name.toLowerCase().includes(query.entityName.toLowerCase()));
            result.entities.push(...matched);
        }
        if (query.entityType) {
            const matched = Array.from(this.entities.values()).filter(e => e.type === query.entityType);
            result.entities.push(...matched);
        }
        // 去重
        result.entities = [...new Map(result.entities.map(e => [e.id, e])).values()];
        // 关系查询
        if (query.relationType) {
            const entityIds = new Set(result.entities.map(e => e.id));
            const matched = Array.from(this.relations.values()).filter(r => r.type === query.relationType &&
                (entityIds.has(r.sourceId) || entityIds.has(r.targetId)));
            result.relations.push(...matched);
        }
        // 因果查询
        if (query.causalQuery) {
            const rules = this.queryCausal(query.causalQuery);
            result.causalRules.push(...rules);
            // 生成推理结论
            for (const rule of rules) {
                result.inferences.push(`${rule.cause} 导致 ${rule.effect} (概率: ${Math.round(rule.probability * 100)}%)`);
            }
        }
        // 相似性查询
        if (query.similarTo) {
            const similar = this.findSimilar(query.similarTo);
            result.entities.push(...similar);
        }
        // 限制数量
        if (query.limit) {
            result.entities = result.entities.slice(0, query.limit);
            result.relations = result.relations.slice(0, query.limit);
            result.causalRules = result.causalRules.slice(0, query.limit);
        }
        return result;
    }
    /**
     * 因果推理
     */
    causalInference(cause, effect) {
        // 直接规则匹配
        const directRules = Array.from(this.causalRules.values()).filter(r => r.cause.includes(cause) && r.effect.includes(effect));
        if (directRules.length > 0) {
            const bestRule = directRules.reduce((best, r) => r.probability > best.probability ? r : best);
            return {
                possible: true,
                probability: bestRule.probability,
                paths: [[cause, effect]],
                explanation: `直接因果规则: ${bestRule.cause} → ${bestRule.effect}`,
            };
        }
        // 间接路径推理
        const paths = this.findCausalPaths(cause, effect);
        if (paths.length > 0) {
            // 计算路径概率
            const pathProbabilities = paths.map(path => {
                let prob = 1;
                for (let i = 0; i < path.length - 1; i++) {
                    const rule = this.findRule(path[i], path[i + 1]);
                    if (rule) {
                        prob *= rule.probability;
                    }
                    else {
                        prob *= 0.5; // 未知关系默认0.5
                    }
                }
                return prob;
            });
            const maxProb = Math.max(...pathProbabilities);
            const bestPath = paths[pathProbabilities.indexOf(maxProb)];
            return {
                possible: true,
                probability: maxProb,
                paths,
                explanation: `间接因果路径: ${bestPath.join(' → ')}`,
            };
        }
        return {
            possible: false,
            probability: 0,
            paths: [],
            explanation: '未找到因果关系',
        };
    }
    /**
     * 预测可能的结果
     */
    predictOutcomes(action) {
        const predictions = [];
        // 查找相关因果规则
        const relevantRules = Array.from(this.causalRules.values()).filter(r => r.cause.includes(action) || action.includes(r.cause));
        for (const rule of relevantRules) {
            predictions.push({
                outcome: rule.effect,
                probability: rule.probability,
                confidence: rule.verified ? 0.9 : 0.5,
                supportingEvidence: rule.sourceTasks,
            });
        }
        // 查找相似经验
        const similarExps = Array.from(this.experiences.values()).filter(exp => exp.action.includes(action) || action.includes(exp.action));
        for (const exp of similarExps) {
            predictions.push({
                outcome: exp.outcome,
                probability: 0.7,
                confidence: 0.6,
                supportingEvidence: [exp.id],
            });
        }
        // 按概率排序
        return predictions.sort((a, b) => b.probability - a.probability).slice(0, 5);
    }
    /**
     * 获取统计信息
     */
    getStats() {
        const entityTypes = {};
        for (const e of this.entities.values()) {
            entityTypes[e.type] = (entityTypes[e.type] || 0) + 1;
        }
        const relationTypes = {};
        for (const r of this.relations.values()) {
            relationTypes[r.type] = (relationTypes[r.type] || 0) + 1;
        }
        return {
            entityCount: this.entities.size,
            relationCount: this.relations.size,
            causalRuleCount: this.causalRules.size,
            experienceCount: this.experiences.size,
            entityTypes,
            relationTypes,
            verifiedRules: Array.from(this.causalRules.values()).filter(r => r.verified).length,
        };
    }
    /**
     * 等待历史知识加载完成 (读取方在查询前调用, 避免刚构造就查询漏读磁盘数据)
     */
    async whenReady() {
        await this.readyPromise;
    }
    /**
     * 用任务关键词召回与当前任务相关的实体/因果规则, 格式化后供注入 system prompt。
     * 2026-09-04: 世界模型"只写不读"问题的读回入口 — 完成 写入→召回→影响决策 闭环。
     * @returns 格式化文本; 无匹配返回 ''
     */
    buildWorldContext(keywords, limit = 6) {
        const kws = (keywords || [])
            .map(k => String(k).toLowerCase().trim())
            .filter(k => k.length >= 2);
        if (kws.length === 0)
            return '';
        const entityHits = [];
        for (const ent of this.entities.values()) {
            const text = `${ent.name} ${ent.type} ${Object.values(ent.properties || {}).join(' ')}`.toLowerCase();
            const hits = kws.filter(k => text.includes(k)).length;
            if (hits > 0)
                entityHits.push({ item: ent, hits });
        }
        entityHits.sort((a, b) => b.hits - a.hits);
        // 因果规则命中
        const ruleHits = [];
        for (const rule of this.causalRules.values()) {
            const text = `${rule.cause} ${rule.effect} ${(rule.conditions || []).join(' ')}`.toLowerCase();
            const hits = kws.filter(k => text.includes(k)).length;
            if (hits > 0)
                ruleHits.push({ item: rule, hits });
        }
        ruleHits.sort((a, b) => b.hits - a.hits);
        if (entityHits.length === 0 && ruleHits.length === 0)
            return '';
        const lines = ['# World Memory (跨任务结构化经验, 仅与当前任务相关的 Top 召回)'];
        let budget = 1400; // 字符预算, 防止拖垮上下文
        for (const { item: ent } of entityHits.slice(0, limit)) {
            const props = Object.entries(ent.properties || {}).slice(0, 3)
                .map(([k, v]) => `${k}=${v}`).join(', ');
            const line = `- [实体:${ent.type}] ${String(ent.name).slice(0, 60)}${props ? ` (${props.slice(0, 120)})` : ''}`;
            if (budget - line.length < 0)
                break;
            budget -= line.length;
            lines.push(line);
        }
        for (const { item: rule } of ruleHits.slice(0, limit)) {
            const prob = Math.round((rule.probability || 0) * 100);
            const line = `- [经验] ${String(rule.cause).slice(0, 80)} → ${String(rule.effect).slice(0, 80)}${rule.conditions?.length ? ` (条件: ${rule.conditions.join(', ').slice(0, 100)})` : ''} [概率${prob}%${rule.verified ? ', 已验证' : ''}]`;
            if (budget - line.length < 0)
                break;
            budget -= line.length;
            lines.push(line);
        }
        return lines.join('\n');
    }
    // ═══════════════════════════════════════════════════════════
    // 私有方法
    // ═══════════════════════════════════════════════════════════
    extractLessons(task) {
        const lessons = [];
        // 从步骤结果中提取教训
        for (const step of task.steps) {
            if (step.result.includes('error') || step.result.includes('失败')) {
                lessons.push(`${step.action} 需要注意: ${step.result}`);
            }
        }
        return lessons;
    }
    queryCausal(query) {
        // 关键词匹配: 支持中文按字符 n-gram + 空白分隔英文
        const q = query.toLowerCase().trim();
        if (!q)
            return [];
        // 候选拆分: 英文按空格分词 + 中文/日文等非ASCII字提取 2-gram
        const tokens = [];
        // 1. 英文/数字空白分词
        const spaceTokens = q.split(/\s+/).filter(t => t.length > 0);
        for (const tok of spaceTokens) {
            if (/^[\x00-\x7F]+$/.test(tok) && tok.length > 0) {
                tokens.push(tok); // ASCII 词
            }
            else {
                // 非ASCII (中文等): 2-gram 滑动窗口
                for (let i = 0; i < tok.length - 1; i++) {
                    tokens.push(tok.slice(i, i + 2));
                }
                // 单字符兜底 (1-gram)
                if (tok.length === 1)
                    tokens.push(tok);
            }
        }
        // 2. 去除长度<2 的纯ASCII短词 (噪音)
        const keywords = tokens.filter(t => t.length >= 2 || /[\u4e00-\u9fa5]/.test(t));
        if (keywords.length === 0) {
            // 退化: 用原字符串包含做回退
            return Array.from(this.causalRules.values()).filter(rule => {
                const ruleText = `${rule.cause} ${rule.effect}`.toLowerCase();
                return ruleText.includes(q) || q.includes(rule.cause.toLowerCase()) || q.includes(rule.effect.toLowerCase());
            });
        }
        return Array.from(this.causalRules.values()).filter(rule => {
            const ruleText = `${rule.cause} ${rule.effect}`.toLowerCase();
            // OR: 任一关键词命中
            return keywords.some(kw => ruleText.includes(kw))
                // 额外: 因果任一包含在 query 中 (中文字面)
                || q.includes(rule.cause.toLowerCase())
                || q.includes(rule.effect.toLowerCase());
        });
    }
    findSimilar(entityName) {
        const target = Array.from(this.entities.values()).find(e => e.name.toLowerCase() === entityName.toLowerCase());
        if (!target)
            return [];
        // 找相似实体（共享关系）
        const relatedIds = new Set();
        for (const rel of this.relations.values()) {
            if (rel.sourceId === target.id) {
                relatedIds.add(rel.targetId);
            }
            else if (rel.targetId === target.id) {
                relatedIds.add(rel.sourceId);
            }
        }
        return Array.from(this.entities.values()).filter(e => e.id !== target.id && relatedIds.has(e.id));
    }
    findCausalPaths(start, end, maxDepth = 3) {
        const paths = [];
        const visited = new Set();
        const dfs = (current, path, depth) => {
            if (depth > maxDepth)
                return;
            if (current.includes(end) || end.includes(current)) {
                paths.push([...path, end]);
                return;
            }
            visited.add(current);
            // 找下一个可能的节点
            for (const rule of this.causalRules.values()) {
                if (rule.cause.includes(current) || current.includes(rule.cause)) {
                    if (!visited.has(rule.effect)) {
                        dfs(rule.effect, [...path, rule.effect], depth + 1);
                    }
                }
            }
            visited.delete(current);
        };
        dfs(start, [start], 0);
        return paths;
    }
    findRule(cause, effect) {
        return Array.from(this.causalRules.values()).find(r => (r.cause.includes(cause) || cause.includes(r.cause)) &&
            (r.effect.includes(effect) || effect.includes(r.effect)));
    }
}
// 单例导出 (每个 workspace 独立实例)
const worldModelInstances = new Map();
export function getWorldModel(llmRouter, workspace) {
    const key = workspace || '__default__';
    if (!worldModelInstances.has(key)) {
        worldModelInstances.set(key, new WorldModel(llmRouter, workspace));
    }
    return worldModelInstances.get(key);
}
