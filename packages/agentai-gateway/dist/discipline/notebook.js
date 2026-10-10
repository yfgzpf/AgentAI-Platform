/**
 * Discipline — 执行记事本 (Run Notebook)
 * ----------------------------------------------------
 * 察其所由：把「为什么这么做」落盘，让执行可跨会话、可审计、可恢复。
 *
 * 核心问题（2026-10-09 实测）：
 *   goal-runner 的 GoalProgress 只存在于内存，进程重启即丢。
 *   task-scheduler / task-ledger 在，但缺「谁在第几步、卡在哪、为何卡、
 *   上次验证结果」的持久视图。
 *   → 中断后只能靠模型自己回忆，条理性就丢了。
 *
 * 本模块同时解决审计发现的 P0 缺口「处方-执行断链」：
 *   GoalPlan（处方）  ←→  RunNotebook（执行）
 *   两者用 runId 关联，形成「望闻问切 → 辨证论治 → 用药施治 → 随访」完整链路。
 *
 * 设计要点：
 *   - 每次落盘即完成一次 checkIn（append-only 语义，避免并发覆盖丢记录）
 *   - 决策留痕含证据（decision + evidence），这是「可审计」的核心
 *   - resumeFrom 生成恢复计划，明确「从哪继续、还剩什么、为什么卡」
 */
import * as fs from 'fs';
import * as path from 'path';
// ===== 路径管理 =====
function getNotebookDir() {
    // 优先用项目内 .workbuddy/runs，回退到用户目录
    const projectDir = path.resolve(process.cwd(), '.workbuddy/runs');
    try {
        fs.mkdirSync(projectDir, { recursive: true });
        return projectDir;
    }
    catch {
        const fallback = path.join(require('os').homedir(), '.agentai', 'runs');
        fs.mkdirSync(fallback, { recursive: true });
        return fallback;
    }
}
function notebookPath(runId) {
    const safeId = runId.replace(/[^\w-]/g, '_');
    return path.join(getNotebookDir(), `${safeId}.json`);
}
// ===== 创建 =====
export function newRunId(prefix = 'run') {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
/**
 * 创建新记事本
 */
export function createNotebook(goal, runId) {
    const now = Date.now();
    return {
        runId: runId || newRunId(),
        goal,
        createdAt: now,
        updatedAt: now,
        status: 'planning',
        decisionLog: [],
        stages: [],
        anchors: [],
        gateDenials: [],
        humanDecisions: [],
    };
}
// ===== 落盘 =====
/**
 * 保存记事本。写入采用「临时文件 + 原子重命名」，避免中途崩溃产生半截文件。
 */
export function saveNotebook(nb) {
    try {
        nb.updatedAt = Date.now();
        const p = notebookPath(nb.runId);
        const tmp = `${p}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(nb, null, 2), 'utf8');
        fs.renameSync(tmp, p);
        return { ok: true, path: p };
    }
    catch (e) {
        return { ok: false, path: '', error: e?.message || String(e) };
    }
}
export function loadNotebook(runId) {
    try {
        const p = notebookPath(runId);
        if (!fs.existsSync(p))
            return null;
        return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
    catch {
        return null;
    }
}
/**
 * 列出最近的记事本
 */
export function listNotebooks(limit = 10) {
    try {
        const dir = getNotebookDir();
        const files = fs.readdirSync(dir)
            .filter(f => f.endsWith('.json') && !f.endsWith('.tmp'))
            .map(f => {
            try {
                const nb = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
                return { runId: nb.runId, goal: nb.goal, status: nb.status, updatedAt: nb.updatedAt, stageCount: nb.stages.length };
            }
            catch {
                return null;
            }
        })
            .filter(Boolean);
        return files.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
    }
    catch {
        return [];
    }
}
// ===== 阶段管理 =====
/**
 * 登记阶段（幂等：已存在则更新）
 */
export function upsertStage(nb, stage) {
    const idx = nb.stages.findIndex(s => s.key === stage.key);
    if (idx >= 0) {
        nb.stages[idx] = { ...nb.stages[idx], ...stage };
    }
    else {
        nb.stages.push(stage);
    }
    return nb;
}
export function getStage(nb, key) {
    return nb.stages.find(s => s.key === key);
}
/**
 * 阶段开始
 */
export function startStage(nb, key, label) {
    upsertStage(nb, { key, label, status: 'running', startedAt: Date.now() });
    nb.status = 'running';
    return nb;
}
/**
 * 阶段完成（带机器验收结果）
 */
export function finishStage(nb, key, passed, opts = {}) {
    upsertStage(nb, {
        key,
        label: getStage(nb, key)?.label || key,
        status: passed ? 'passed' : 'failed',
        endedAt: Date.now(),
        gateResult: opts.gateResult,
        summary: opts.summary,
        failureReason: opts.failureReason,
        retries: opts.retries,
    });
    if (!passed)
        nb.status = 'failed';
    return nb;
}
/**
 * 阶段阻塞（等待人工审批）
 */
export function blockStage(nb, key, reason) {
    upsertStage(nb, {
        key,
        label: getStage(nb, key)?.label || key,
        status: 'blocked',
        failureReason: reason,
    });
    nb.status = 'paused';
    return nb;
}
// ===== 留痕 =====
/**
 * 记录决策。这是「可审计」的核心。
 */
export function recordDecision(nb, decision, opts = {}) {
    nb.decisionLog.push({
        at: Date.now(),
        decision,
        evidence: opts.evidence,
        reversible: opts.reversible,
        stageKey: opts.stageKey,
    });
    return nb;
}
/**
 * 登记锚点
 */
export function addAnchor(nb, anchor) {
    nb.anchors.push(anchor);
    return nb;
}
/**
 * 记录闸门拒绝（审计用：哪些动作被拦下来了）
 */
export function recordGateDenial(nb, reasons) {
    if (reasons.length === 0)
        return nb;
    nb.gateDenials.push({ at: Date.now(), reasons });
    return nb;
}
/**
 * 记录人工决策
 */
export function recordHumanDecision(nb, decision, by) {
    nb.humanDecisions.push({ at: Date.now(), decision, by });
    return nb;
}
/**
 * 关联处方（打通处方-执行断链）
 */
export function linkPrescription(nb, prescription) {
    nb.prescription = { ...prescription, createdAt: Date.now() };
    return nb;
}
// ===== 恢复 =====
/**
 * 从记事本生成恢复计划。
 * 这是「连续状态监控」的核心：断了能自己接上。
 */
export function resumeFrom(nb) {
    const skipStages = nb.stages.filter(s => s.status === 'passed' || s.status === 'skipped').map(s => s.key);
    const retryStages = nb.stages.filter(s => s.status === 'failed').map(s => s.key);
    const blockedStages = nb.stages.filter(s => s.status === 'blocked').map(s => s.key);
    const pendingStages = nb.stages.filter(s => s.status === 'pending').map(s => s.key);
    const runningStages = nb.stages.filter(s => s.status === 'running').map(s => s.key);
    const lines = [];
    lines.push(`## 执行恢复上下文 (runId: ${nb.runId})`);
    lines.push(`**原目标**: ${nb.goal}`);
    lines.push(`**当前状态**: ${nb.status}`);
    lines.push(`**最后更新**: ${new Date(nb.updatedAt).toLocaleString('zh-CN')}`);
    lines.push('');
    lines.push('### 阶段进度');
    for (const s of nb.stages) {
        const icon = { passed: 'OK', failed: 'FAIL', blocked: 'BLOCK', running: 'RUN', pending: 'TODO', skipped: 'SKIP' }[s.status];
        lines.push(`- [${icon}] ${s.label || s.key}${s.failureReason ? ` — ${s.failureReason}` : ''}`);
        if (s.gateResult) {
            lines.push(`      机器验收: ${s.gateResult.passed ? '通过' : '未通过'} (${s.gateResult.results.length - s.gateResult.failedCount}/${s.gateResult.results.length})`);
            for (const r of s.gateResult.results.filter(r => !r.passed)) {
                lines.push(`      - FAIL: ${r.label}${r.reason ? ` (${r.reason})` : ''}`);
            }
        }
    }
    lines.push('');
    if (nb.decisionLog.length > 0) {
        lines.push('### 关键决策留痕（不要重复已做过的判断）');
        for (const d of nb.decisionLog.slice(-10)) {
            lines.push(`- [${d.reversible === false ? '不可逆' : '可逆'}] ${d.decision}`);
            if (d.evidence?.length)
                lines.push(`      证据: ${d.evidence.join('; ')}`);
        }
        lines.push('');
    }
    if (nb.gateDenials.length > 0) {
        lines.push('### 被闸门拦下的动作（这些前置条件未满足）');
        for (const g of nb.gateDenials.slice(-5)) {
            for (const r of g.reasons)
                lines.push(`- ${r}`);
        }
        lines.push('');
    }
    if (nb.humanDecisions.length > 0) {
        lines.push('### 人工决策记录');
        for (const h of nb.humanDecisions) {
            lines.push(`- ${h.decision}${h.by ? ` (by ${h.by})` : ''}`);
        }
        lines.push('');
    }
    if (nb.anchors.length > 0) {
        lines.push('### 回滚锚点（可回到任一状态）');
        for (const a of nb.anchors) {
            lines.push(`- ${a.ref} — ${a.description}`);
        }
        lines.push('');
    }
    lines.push('### 恢复指令');
    if (skipStages.length > 0)
        lines.push(`- 跳过已完成阶段: ${skipStages.join(', ')}`);
    if (retryStages.length > 0)
        lines.push(`- 重试失败阶段: ${retryStages.join(', ')}`);
    if (blockedStages.length > 0)
        lines.push(`- 阻塞待人工: ${blockedStages.join(', ')}`);
    if (pendingStages.length > 0)
        lines.push(`- 待执行: ${pendingStages.join(', ')}`);
    if (runningStages.length > 0)
        lines.push(`- 中断时正在跑（需重新执行）: ${runningStages.join(', ')}`);
    return {
        runId: nb.runId,
        skipStages,
        retryStages,
        blockedStages,
        context: lines.join('\n'),
        resumable: blockedStages.length === 0,
    };
}
// ===== 便捷封装 =====
/**
 * 高层执行上下文：把记事本 + 阶段执行 + 断言 + 闸门串起来。
 *
 * 用法：
 *   const ex = new DisciplineRun('重构前端');
 *   ex.recordDecision('先建锚点', { evidence: ['工作区 335 改动'] });
 *   await ex.runStage('cleanup', '清除死代码', async () => {
 *     // 实际执行
 *   }, { asserts: postDeleteStandard() });
 */
export class DisciplineRun {
    nb;
    cwd;
    constructor(goal, opts = {}) {
        this.nb = createNotebook(goal, opts.runId);
        this.cwd = opts.cwd || process.cwd();
    }
    get notebook() { return this.nb; }
    get runId() { return this.nb.runId; }
    /** 关联处方 */
    linkPrescription(stageKeys) {
        linkPrescription(this.nb, { goal: this.nb.goal, stageKeys });
        this.flush();
    }
    /** 记录决策 */
    recordDecision(decision, opts = {}) {
        recordDecision(this.nb, decision, opts);
        this.flush();
    }
    /** 登记锚点 */
    addAnchor(anchor) {
        addAnchor(this.nb, anchor);
        this.flush();
    }
    /** 落盘 */
    flush() {
        saveNotebook(this.nb);
    }
    /** 标记阶段开始（只登记状态，不执行） */
    markStageStart(key, label) {
        startStage(this.nb, key, label);
        this.flush();
    }
    /** 标记阶段完成（只登记结果，不执行） */
    markStageEnd(key, passed, opts = {}) {
        finishStage(this.nb, key, passed, opts);
        this.flush();
    }
    /**
     * 执行一个带纪律的阶段。
     * 流程：登记开始 → 执行 → 机器验收 → 记录结果 → 落盘
     */
    async runStage(key, label, executor, opts = {}) {
        startStage(this.nb, key, label);
        this.flush();
        const maxRetries = opts.maxRetries ?? 0;
        let lastSummary = '';
        let lastGate;
        let retries = 0;
        while (retries <= maxRetries) {
            try {
                lastSummary = await executor();
            }
            catch (e) {
                lastSummary = `执行异常: ${e?.message || e}`;
            }
            if (opts.asserts && opts.asserts.length > 0) {
                const { verifyStage } = await import('./assertions.js');
                lastGate = await verifyStage({ stageKey: key, asserts: opts.asserts }, { cwd: this.cwd, judgeContent: opts.judgeContent ?? lastSummary, llmJudge: opts.llmJudge });
                if (lastGate.passed)
                    break;
                retries++;
            }
            else {
                break;
            }
        }
        const passed = lastGate ? lastGate.passed : true;
        finishStage(this.nb, key, passed, {
            gateResult: lastGate,
            summary: lastSummary.slice(0, 1000),
            failureReason: passed ? undefined : `${lastGate?.failedCount} 项机器断言未通过`,
            retries,
        });
        this.flush();
        return { passed, summary: lastSummary, gateResult: lastGate };
    }
    /** 标记阻塞（等人工） */
    block(key, reason) {
        blockStage(this.nb, key, reason);
        this.flush();
    }
    /** 记录闸门拒绝 */
    recordDenial(reasons) {
        recordGateDenial(this.nb, reasons);
        this.flush();
    }
    /** 记录人工决策 */
    recordHuman(decision, by) {
        recordHumanDecision(this.nb, decision, by);
        this.flush();
    }
    /** 完成 */
    complete() {
        this.nb.status = 'completed';
        this.flush();
    }
    /** 中止 */
    abort(reason) {
        this.nb.status = 'aborted';
        recordDecision(this.nb, `中止: ${reason}`, { reversible: true });
        this.flush();
    }
    /** 生成恢复计划 */
    resumePlan() {
        return resumeFrom(this.nb);
    }
}
/**
 * 从已有记事本恢复一个执行上下文
 */
export function resumeRun(runId, opts = {}) {
    const nb = loadNotebook(runId);
    if (!nb)
        return null;
    const run = new DisciplineRun(nb.goal, { runId: nb.runId, cwd: opts.cwd });
    // 用落盘的数据覆盖新建的空记事本
    run.nb = nb;
    return run;
}
