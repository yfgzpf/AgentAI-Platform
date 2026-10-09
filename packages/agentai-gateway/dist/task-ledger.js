/**
 * ════════════════════════════════════════════════════════════════════════
 * 任务台账 (Task Ledger) — 2026-10-06
 * ════════════════════════════════════════════════════════════════════════
 * 立项原因: 用户实机反馈「AI 失忆严重，工作摘要及上回做了什么看不见，
 *           一直重复读取文件」。
 *
 * 已定位的三层原因（本文件只解决第3 层，前两层在别处修）:
 *
 * 【层1】指令队列挤占
 *   SystemDirectiveManager.flush() 只返回优先级最高的 **1 条**，
 *   其余静默丢弃。而 task_progress（工作摘要）与20+ 个 high 级指令
 *   （fail_strategy / auto_fix_* / dup_fail...）同优先级竞争
 *   → 工作摘要绝大多数轮次根本没进messages。
 *
 * 【层2】摘要本身在压缩时被连带删除
 *   已修（保留 '# 对话历史摘要' 前缀的 system 消息）。
 *
 * 【层3】★ 本文件解决 ★
 *   即使摘要成功注入，它是由 appendOnlyLog 的内容**推导**出来的
 *   —— 而 appendOnlyLog 会被裁剪 / 压缩 / 跨轮清空。
 *   一旦裁剪，"已读过哪些文件"这个事实本身就消失了，
 *   AI 只能重新 read_file。
 *
 *   → 状态必须是**独立于对话历史**的一等公民。
 *   本文件提供 per-session 台账，随 session 存活，不受压缩影响。
 *
 * 设计要点:
 *   1. per-session 隔离（与 soul/workspace-scope 同理，避免跨任务串味）
 *   2. 记录**动作**而非仅计数：读过什么、写过什么、跑过什么命令
 *   3. 注入到**每轮** prompt，而非靠指令队列竞争
 *   4. LRU 上限，防止长任务无界增长
 */
import { EventEmitter } from 'events';
/** 台账最大动作条目（超出后丢最旧的，但文件清单单独保留上限） */
const MAX_ACTIONS = 400;
const MAX_FILE_LIST = 60;
export class TaskLedger extends EventEmitter {
    actions = [];
    reads = new Map();
    writes = new Map();
    commands = [];
    failures = [];
    decisions = [];
    goal = '';
    iter = 0;
    sessionId;
    constructor(sessionId = 'default') {
        super();
        this.setMaxListeners(20);
        this.sessionId = sessionId;
    }
    // ── 记录 ────────────────────────────────────────────────────────────
    /**
     * 记录一次工具动作
     * @returns 该目标此前已被执行过几次（0 = 首次）
     */
    record(tool, target, kind = 'other') {
        const t = normalize(target);
        if (!t)
            return 0;
        let nth = 0;
        if (kind === 'read') {
            nth = this.reads.get(t) || 0;
            this.reads.set(t, nth + 1);
        }
        else if (kind === 'write') {
            nth = this.writes.get(t) || 0;
            this.writes.set(t, nth + 1);
        }
        else if (kind === 'exec') {
            nth = this.commands.filter((c) => c === t).length;
            if (nth < 20)
                this.commands.push(t);
        }
        this.actions.push({ tool, kind, target: t, nth: nth + 1, ts: Date.now() });
        if (this.actions.length > MAX_ACTIONS) {
            this.actions.splice(0, this.actions.length - MAX_ACTIONS);
        }
        if (this.reads.size > MAX_FILE_LIST * 2)
            this.trimMap(this.reads);
        if (this.writes.size > MAX_FILE_LIST * 2)
            this.trimMap(this.writes);
        this.emit('action', { tool, kind, target: t, nth: nth + 1 });
        return nth;
    }
    /** 记录一次失败（工具名 + 原因摘要），用于「别再犯同样的错」 */
    recordFailure(tool, reason) {
        const r = `${tool}: ${String(reason || '').slice(0, 120)}`;
        if (this.failures.includes(r))
            return; // 同因不重复记
        this.failures.push(r);
        if (this.failures.length > 20)
            this.failures.shift();
    }
    /** 记录一条决策/结论（AI 自己说的"我决定用X方案"），压缩后仍可回溯 */
    recordDecision(decision, maxLen = 200) {
        const d = String(decision || '').trim().slice(0, maxLen);
        if (!d || this.decisions.includes(d))
            return;
        this.decisions.push(d);
        if (this.decisions.length > 15)
            this.decisions.shift();
    }
    /** 设置当前任务目标（用户诉求，最不能丢的东西） */
    setGoal(goal, maxLen = 400) {
        const g = String(goal || '').trim().slice(0, maxLen);
        if (g && g !== this.goal) {
            this.goal = g;
            this.emit('goal', g);
        }
    }
    setIteration(n) {
        this.iter = n;
    }
    // ── 查询 ────────────────────────────────────────────────────────────
    getGoal() { return this.goal; }
    getIteration() { return this.iter; }
    readCount(target) { return this.reads.get(normalize(target)) || 0; }
    writeCount(target) { return this.writes.get(normalize(target)) || 0; }
    listReads(limit = 30) { return [...this.reads.keys()].slice(-limit); }
    listWrites(limit = 30) { return [...this.writes.keys()].slice(-limit); }
    listCommands(limit = 15) { return this.commands.slice(-limit); }
    listFailures(limit = 10) { return this.failures.slice(-limit); }
    listDecisions(limit = 8) { return this.decisions.slice(-limit); }
    size() { return this.actions.length; }
    /** 最近动作流水（用于诊断：AI 到底在重复什么） */
    recentActions(limit = 20) {
        return this.actions.slice(-limit);
    }
    /** 找出被重复执行的动作（nth > 1），按重复次数降序 */
    topDuplicates(limit = 10) {
        const m = new Map();
        for (const a of this.actions) {
            if (a.nth <= 1)
                continue;
            const key = `${a.kind}:${a.target}`;
            const cur = m.get(key);
            if (cur)
                cur.count = Math.max(cur.count, a.nth);
            else
                m.set(key, { target: a.target, kind: a.kind, count: a.nth });
        }
        return [...m.values()].sort((x, y) => y.count - x.count).slice(0, limit);
    }
    snapshot() {
        return {
            iteration: this.iter,
            userGoal: this.goal,
            readFiles: this.listReads(30),
            writtenFiles: this.listWrites(30),
            commands: this.listCommands(15),
            failures: this.listFailures(10),
            decisions: this.listDecisions(8),
            totalActions: this.actions.length,
        };
    }
    /** 渲染成注入到 prompt 的文本。空台账返回 ''（不浪费 token） */
    render(opts) {
        // 注意: 不能只看 actions —— AI 可能第一句就定了决策而还没调任何工具，
        //   那种情况 decisions 有值、actions 为空，若一并判空就丢掉了最关键的决策。
        const hasContent = this.actions.length > 0 || !!this.goal
            || this.decisions.length > 0 || this.failures.length > 0;
        if (!hasContent)
            return '';
        const maxChars = opts?.maxChars ?? 1400;
        const s = this.snapshot();
        const parts = ['# 🧾 任务台账（事实记录，与对话历史无关，不会因压缩丢失）'];
        if (s.userGoal)
            parts.push(`## 任务目标（用户原话）\n${s.userGoal}`);
        parts.push(`## 进度\n- 当前第 ${s.iteration} 轮，累计动作 ${s.totalActions} 次`);
        if (s.readFiles.length) {
            parts.push(`## 已读文件（${this.reads.size} 个，禁止重复读取）\n${s.readFiles.map((f) => `- ${f}`).join('\n')}`);
        }
        if (s.writtenFiles.length) {
            parts.push(`## 已写入/修改文件（${this.writes.size} 个）\n${s.writtenFiles.map((f) => `- ${f}`).join('\n')}`);
        }
        if (s.decisions.length) {
            parts.push(`## 已定决策（不要重新讨论）\n${s.decisions.map((d) => `- ${d}`).join('\n')}`);
        }
        if (s.failures.length) {
            parts.push(`## 已失败（不要原样重试）\n${s.failures.map((f) => `- ${f}`).join('\n')}`);
        }
        if (s.commands.length) {
            parts.push(`## 已执行命令\n${s.commands.map((c) => `- ${c}`).join('\n')}`);
        }
        let out = parts.join('\n');
        if (out.length > maxChars) {
            // 超长时优先砍命令与失败项（信息密度最低）
            out = out.slice(0, maxChars) + '\n（台账已截断，完整记录见会话状态）';
        }
        return out;
    }
    reset() {
        this.actions = [];
        this.reads.clear();
        this.writes.clear();
        this.commands = [];
        this.failures = [];
        this.decisions = [];
        this.goal = '';
        this.iter = 0;
    }
    trimMap(m) {
        const keys = [...m.keys()];
        const drop = keys.length - MAX_FILE_LIST;
        for (let i = 0; i < drop; i++)
            m.delete(keys[i]);
    }
    get id() { return this.sessionId; }
}
/** 归一化目标：统一分隔符、去掉引号、限制长度 */
function normalize(t) {
    let s = String(t || '').trim();
    if (!s)
        return '';
    s = s.replace(/\\/g, '/').replace(/^["']|["']$/g, '');
    if (s.length > 200)
        s = s.slice(0, 200) + '…';
    return s;
}
// ════════════════════════════════════════════════════════════════════════
// per-session 注册表
// ════════════════════════════════════════════════════════════════════════
const ledgers = new Map();
const MAX_LEDGERS = 64;
export function getLedger(sessionKey) {
    const key = sessionKey || 'default';
    let l = ledgers.get(key);
    if (!l) {
        l = new TaskLedger(key);
        ledgers.set(key, l);
        // LRU 淘汰：Map 保持插入序，删除最旧
        if (ledgers.size > MAX_LEDGERS) {
            const oldest = ledgers.keys().next().value;
            if (oldest !== undefined)
                ledgers.delete(oldest);
        }
    }
    else {
        // 命中则移到末尾（更新 LRU 序）
        ledgers.delete(key);
        ledgers.set(key, l);
    }
    return l;
}
export function dropLedger(sessionKey) {
    ledgers.delete(sessionKey);
}
export function clearLedgers() {
    ledgers.clear();
}
export function ledgerStats() {
    return { count: ledgers.size, keys: [...ledgers.keys()] };
}
