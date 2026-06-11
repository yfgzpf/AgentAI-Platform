/**
 * Sandbox 单例
 *
 * 职责:
 *   - 启动时加载 ~/.agentai/sandbox-rules.json
 *   - 提供 check() / getRules() / setRules()
 *   - 监听文件变更, 1s 内热重载
 *   - 记录审计日志
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { load, save, validate } from './rules.js';
import { check } from './checker.js';
import type { SandboxCheckRequest, SandboxCheckResult, SandboxRules, SandboxRulesResponse } from './types.js';

export interface SandboxAuditEvent {
    ts: number;
    type: 'check' | 'set' | 'load' | 'reload' | 'deny' | 'prompt';
    path?: string;
    op?: string;
    verdict?: string;
    reason?: string;
    ruleVersion?: number;
}

export interface SandboxConfig {
    /** 规则文件路径, 默认 ~/.agentai/sandbox-rules.json */
    rulesPath?: string;
    /** 审计日志回调 */
    audit?: (e: SandboxAuditEvent) => void | Promise<void>;
    /** 热重载间隔 ms, 默认 1000 */
    reloadIntervalMs?: number;
    /** 启用沙箱 (false 时 check() 永远返 allow, 不加载文件) */
    enabled?: boolean;
}

export class Sandbox {
    private rules: SandboxRules;
    private rulesPath: string;
    private audit: (e: SandboxAuditEvent) => void | Promise<void>;
    private reloadMs: number;
    private reloadTimer?: NodeJS.Timeout;
    private lastMtime: number = 0;
    private lastSource: 'file' | 'default' | 'invalid' = 'default';
    private lastErrors: string[] = [];
    private enabled: boolean;

    constructor(cfg: SandboxConfig = {}) {
        this.rulesPath = cfg.rulesPath || path.join(os.homedir(), '.agentai', 'sandbox-rules.json');
        this.audit = cfg.audit || (() => {});
        this.reloadMs = cfg.reloadIntervalMs ?? 1000;
        this.enabled = cfg.enabled ?? false; // 默认关闭, 用户需显式启用
        // 初始占位, 启动时覆盖
        this.rules = { allow: [], deny: [], prompt: [] };
    }

    /**
     * 启动: 仅在 enabled 时才加载 + 启热重载
     */
    async start(): Promise<void> {
        if (!this.enabled) {
            await this.audit({ type: 'load', verdict: 'disabled', reason: 'sandbox is disabled' });
            return;
        }
        const r = await load(this.rulesPath);
        this.rules = r.rules;
        this.lastSource = r.source;
        this.lastErrors = r.errors || [];
        await this.audit({ type: 'load', verdict: r.source, reason: `source=${r.source}` });
        this.updateMtime();
        // 启动热重载
        this.reloadTimer = setInterval(() => this.maybeReload(), this.reloadMs);
    }

    /**
     * 运行时切换 enabled
     * - 启用: 加载规则 + 启热重载
     * - 关闭: 取消热重载, check() 返 allow
     */
    async setEnabled(on: boolean): Promise<void> {
        if (this.enabled === on) return;
        this.enabled = on;
        if (on) {
            // 启用: 启动 (如果还没启)
            if (!this.reloadTimer) {
                const r = await load(this.rulesPath);
                this.rules = r.rules;
                this.lastSource = r.source;
                this.lastErrors = r.errors || [];
                this.updateMtime();
                this.reloadTimer = setInterval(() => this.maybeReload(), this.reloadMs);
            }
        } else {
            // 关闭: 停热重载
            this.stop();
        }
        await this.audit({ type: 'set', verdict: on ? 'enabled' : 'disabled' });
    }

    /**
     * 取启用状态
     */
    isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * 停止: 取消热重载
     */
    stop(): void {
        if (this.reloadTimer) {
            clearInterval(this.reloadTimer);
            this.reloadTimer = undefined;
        }
    }

    private updateMtime(): void {
        try {
            this.lastMtime = fs.statSync(this.rulesPath).mtimeMs;
        } catch {
            this.lastMtime = 0;
        }
    }

    private async maybeReload(): Promise<void> {
        try {
            const m = fs.statSync(this.rulesPath).mtimeMs;
            if (m > this.lastMtime) {
                this.lastMtime = m;
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
        } catch {
            /* 文件不存在或不可读, 保持当前 */
        }
    }

    /**
     * 取当前规则
     */
    getRules(): SandboxRules {
        return this.rules;
    }

    /**
     * 取状态 (给 GET /v1/sandbox/rules 用)
     */
    getStatus(): SandboxRulesResponse & { enabled: boolean } {
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
    async setRules(rules: SandboxRules): Promise<{ ok: boolean; errors?: string[] }> {
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
        this.updateMtime();
        await this.audit({ type: 'set', verdict: 'ok', ruleVersion: r.rules.version });
        return { ok: true };
    }

    /**
     * 检查路径是否允许操作
     * - 未启用时永远返 allow, 不审计
     */
    async check(req: SandboxCheckRequest): Promise<SandboxCheckResult> {
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
    getRulesPath(): string {
        return this.rulesPath;
    }
}

/** 全局单例 (可选, 主入口使用) */
let globalSandbox: Sandbox | null = null;

export function getGlobalSandbox(): Sandbox | null {
    return globalSandbox;
}

/**
 * 状态文件 (持久化 enabled 标志, 与规则文件分开)
 * 默认 ~/.agentai/sandbox-state.json
 */
function statePath(rulesPath: string): string {
    const dir = path.dirname(rulesPath);
    return path.join(dir, 'sandbox-state.json');
}

export async function initGlobalSandbox(cfg: SandboxConfig = {}): Promise<Sandbox> {
    if (globalSandbox) return globalSandbox;
    // 尝试从 state 文件读 enabled
    let enabled = cfg.enabled ?? false;
    if (cfg.enabled === undefined) {
        try {
            const text = await fsp.readFile(statePath(cfg.rulesPath || path.join(os.homedir(), '.agentai', 'sandbox-rules.json')), 'utf-8');
            const j = JSON.parse(text);
            if (typeof j.enabled === 'boolean') enabled = j.enabled;
        } catch { /* 文件不存在, 用默认 false */ }
    }
    globalSandbox = new Sandbox({ ...cfg, enabled });
    await globalSandbox.start();
    return globalSandbox;
}

/**
 * 持久化 enabled 状态
 */
export async function persistSandboxState(sandbox: Sandbox): Promise<void> {
    const sp = statePath(sandbox.getRulesPath());
    await fsp.mkdir(path.dirname(sp), { recursive: true });
    await fsp.writeFile(sp, JSON.stringify({ enabled: sandbox.isEnabled(), updatedAt: Date.now() }, null, 2), 'utf-8');
}
