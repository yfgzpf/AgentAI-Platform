// @ts-nocheck
/**
 * Sandbox 单例
 *
 * 职责:
 *   - 启动时加载 ~/.agentai/sandbox-rules.json
 *   - 提供 check() / getRules() / setRules()
 *   - 监听文件变更, 1s 内热重载
 *   - 记录审计日志
 */
import * as fsp from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceManager } from '../workspace-manager.js';
import { load, save, validate, defaultRules } from './rules.js';
import { check } from './checker.js';
export class Sandbox {
    rules;
    rulesPath;
    audit;
    reloadMs;
    reloadTimer;
    /**
     * 热重载判变状态（2026-10-06 修正）
     *
     * 设计: 快路径用 stat 元数据（mtimeMs + size），慢路径每秒一次内容指纹兜底。
     *这样既覆盖 Windows 上 mtime 精度不足（同一窗口内两次写入 mtime 相同），
     * 又不会在高频轮询（reloadIntervalMs=50）下反复 readFileSync 拖慢事件循环。
     */
    lastFingerprint = '';
    lastStat = null;
    lastFingerprintAt = 0;
    lastSource = 'default';
    lastErrors = [];
    enabled;
    constructor(cfg = {}) {
        this.rulesPath = cfg.rulesPath || WorkspaceManager.getInstance().sandboxRulesPath;
        this.audit = cfg.audit || (() => { });
        this.reloadMs = cfg.reloadIntervalMs ?? 1000;
        this.enabled = cfg.enabled ?? false; // opt-in: 默认禁用, 需显式启用
        // disabled 时规则为空, enabled 时使用 defaultRules() 防 start() 未执行时 check() 使用不安全规则
        this.rules = this.enabled ? defaultRules() : { allow: [], deny: [], prompt: [] };
    }
    /**
     * 启动: 仅在 enabled 时才加载 + 启热重载
     */
    async start() {
        if (!this.enabled) {
            await this.audit({ type: 'load', verdict: 'disabled', reason: 'sandbox is disabled' });
            return;
        }
        const r = await load(this.rulesPath);
        this.rules = r.rules;
        this.lastSource = r.source;
        this.lastErrors = r.errors || [];
        await this.audit({ type: 'load', verdict: r.source, reason: `source=${r.source}` });
        this.updateFingerprint();
        // 启动热重载
        this.reloadTimer = setInterval(() => this.maybeReload(), this.reloadMs);
    }
    /**
     * 运行时切换 enabled
     * - 启用: 加载规则 + 启热重载
     * - 关闭: 取消热重载, check() 返 allow
     */
    async setEnabled(on) {
        if (this.enabled === on)
            return;
        this.enabled = on;
        if (on) {
            // 启用: 启动 (如果还没启)
            if (!this.reloadTimer) {
                const r = await load(this.rulesPath);
                this.rules = r.rules;
                this.lastSource = r.source;
                this.lastErrors = r.errors || [];
                this.updateFingerprint();
                this.reloadTimer = setInterval(() => this.maybeReload(), this.reloadMs);
            }
        }
        else {
            // 关闭: 停热重载
            this.stop();
        }
        await this.audit({ type: 'set', verdict: on ? 'enabled' : 'disabled' });
    }
    /**
     * 取启用状态
     */
    isEnabled() {
        return this.enabled;
    }
    /**
     * 停止: 取消热重载
     */
    stop() {
        if (this.reloadTimer) {
            clearInterval(this.reloadTimer);
            this.reloadTimer = undefined;
        }
    }
    /**
     * 记录当前规则文件指纹（用于热重载判变）
     *
     * 2026-10-05 修复的原始问题: 只记 mtimeMs 且用 `m > lastMtime` 判变。
     * **Windows 上同一时间戳精度内连续两次写入，mtimeMs 完全相同**（实测差值 = 0）
     * → 用户在设置页改规则后，若上一次写入落在同一窗口内，
     *   热重载会**静默忽略**这次修改（没有报错，规则不生效）。
     *
     * 2026-10-06 修正: 第一版修法改成"每轮读全文算哈希"，虽然解决了精度问题，
     *   但引入了新问题 —— reloadIntervalMs 可配到50ms（测试里就是），
     *   等于每 50ms 同步 readFileSync 一次；多实例时把事件循环占满，
     *   vitest 收集阶段直接超时（实测 sandbox/index.test.ts 间歇性 10s 超时）。
     *
     * 现在用 mtime + size 双条件（statSync 是元数据读取，比读全文便宜两个数量级），
     * 并在「mtime 没变但距上次检查超过 1s」时做一次内容指纹兜底 ——
     * 这样既覆盖了 Windows 精度问题，又把全量读取摊到低频路径上。
     */
    updateFingerprint() {
        this.lastStat = this.readStat();
        this.lastFingerprintAt = Date.now();
    }
    /** 读元数据（mtimeMs + size），读不到返回 null */
    readStat() {
        try {
            const st = fs.statSync(this.rulesPath);
            return { m: st.mtimeMs, s: st.size };
        }
        catch {
            return null;
        }
    }
    /** 读文件并计算轻量指纹；读不到返回空串 */
    readFingerprint() {
        try {
            const text = fs.readFileSync(this.rulesPath, 'utf-8');
            // FNV-1a 32bit：够用且无需引入 crypto
            let h = 0x811c9dc5;
            for (let i = 0; i < text.length; i++) {
                h ^= text.charCodeAt(i);
                h = Math.imul(h, 0x01000193);
            }
            return `${text.length}:${(h >>> 0).toString(36)}`;
        }
        catch {
            return '';
        }
    }
    /** 兜底全量指纹的最小间隔（ms）—— 避免高频轮询时反复读全文 */
    static FP_FALLBACK_MS = 1000;
    async maybeReload() {
        try {
            // 快路径: mtime 或 size 变了 → 立刻重载
            const st = this.readStat();
            const statChanged = !!st && (!this.lastStat || st.m !== this.lastStat.m || st.s !== this.lastStat.s);
            // 慢路径兜底: mtime 因Windows 精度没变，但已超过 1s 未做内容校验
            const needFp = !statChanged && (Date.now() - this.lastFingerprintAt) >= Sandbox.FP_FALLBACK_MS;
            if (!statChanged && !needFp)
                return;
            if (statChanged) {
                this.lastStat = st;
            }
            else {
                const fp = this.readFingerprint();
                this.lastFingerprintAt = Date.now();
                if (!fp || fp === this.lastFingerprint)
                    return;
                this.lastFingerprint = fp;
            }
            {
                const r = await load(this.rulesPath);
                this.rules = r.rules;
                this.lastSource = r.source;
                this.lastErrors = r.errors || [];
                await this.audit({
                    type: 'reload',
                    verdict: r.source,
                    reason: `file changed, source=${r.source}`,
                    ruleVersion: r.rules.version,
                });
            }
        }
        catch {
            /* 文件不存在或不可读, 保持当前 */
        }
    }
    /**
     * 取当前规则
     */
    getRules() {
        return this.rules;
    }
    /**
     * 取状态 (给 GET /v1/sandbox/rules 用)
     */
    getStatus() {
        return {
            rules: this.rules,
            source: this.lastSource,
            valid: this.lastSource === 'file',
            errors: this.lastErrors.length > 0 ? this.lastErrors : undefined,
            enabled: this.enabled,
        };
    }
    /**
     * 设置规则 (调 PUT /v1/sandbox/rules)
     * - 校验
     * - 写盘
     * - 立即生效 (热重载下次扫描时也生效)
     */
    async setRules(rules) {
        const v = validate(rules);
        if (!v.ok) {
            await this.audit({ type: 'set', verdict: 'invalid', reason: v.errors.join('; ') });
            return { ok: false, errors: v.errors };
        }
        const s = await save(this.rulesPath, rules);
        if (!s.ok) {
            await this.audit({ type: 'set', verdict: 'invalid', reason: (s.errors || []).join('; ') });
            return s;
        }
        // 立即覆盖
        const r = await load(this.rulesPath);
        this.rules = r.rules;
        this.lastSource = r.source;
        this.lastErrors = [];
        this.updateFingerprint();
        await this.audit({ type: 'set', verdict: 'ok', ruleVersion: r.rules.version });
        return { ok: true };
    }
    /**
     * 检查路径是否允许操作
     * - 未启用时永远返 allow, 不审计
     * - v3.2: 默认放行, 仅 deny 规则拦截 (系统路径/凭证)
     */
    async check(req) {
        if (!this.enabled) {
            return {
                verdict: 'allow',
                reason: 'sandbox disabled (bypass mode)',
                source: 'disabled',
            };
        }
        const r = check(req, this.rules);
        if (r.verdict === 'deny' || r.verdict === 'prompt') {
            await this.audit({
                type: r.verdict,
                path: req.path,
                op: req.op,
                verdict: r.verdict,
                reason: r.reason,
            });
        }
        return r;
    }
    /**
     * 取文件路径 (供外部测试)
     */
    getRulesPath() {
        return this.rulesPath;
    }
}
/** 全局单例 (可选, 主入口使用) */
let globalSandbox = null;
export function getGlobalSandbox() {
    return globalSandbox;
}
/**
 * 状态文件 (持久化 enabled 标志, 与规则文件分开)
 * 默认 ~/.agentai/sandbox-state.json
 */
function statePath(rulesPath) {
    const dir = path.dirname(rulesPath);
    return path.join(dir, 'sandbox-state.json');
}
export async function initGlobalSandbox(cfg = {}) {
    if (globalSandbox)
        return globalSandbox;
    // 沙箱 opt-in: 默认禁用, index.ts 启动时显式传 enabled: true
    let enabled = cfg.enabled ?? false;
    if (cfg.enabled === undefined) {
        try {
            const text = await fsp.readFile(statePath(cfg.rulesPath || WorkspaceManager.getInstance().sandboxRulesPath), 'utf-8');
            const j = JSON.parse(text);
            if (typeof j.enabled === 'boolean')
                enabled = j.enabled;
        }
        catch { /* 文件不存在, 用默认 false */ }
    }
    globalSandbox = new Sandbox({ ...cfg, enabled });
    await globalSandbox.start();
    return globalSandbox;
}
/**
 * 持久化 enabled 状态
 */
export async function persistSandboxState(sandbox) {
    const sp = statePath(sandbox.getRulesPath());
    await fsp.mkdir(path.dirname(sp), { recursive: true });
    await fsp.writeFile(sp, JSON.stringify({ enabled: sandbox.isEnabled(), updatedAt: Date.now() }, null, 2), 'utf-8');
}
