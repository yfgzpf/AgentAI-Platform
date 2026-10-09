import { EventEmitter } from 'events';
import crypto from 'crypto';
const ALLOWED_NEXT = {
    plan: ['solve', 'failed'],
    solve: ['verify', 'failed'],
    verify: ['fix', 'report', 'failed'],
    fix: ['verify', 'report', 'failed'],
    report: ['done'],
    done: [],
    failed: [],
};
export class TaskChain extends EventEmitter {
    state;
    maxFixIterations;
    requireVerifyPass;
    auditWriter;
    chainId;
    constructor(config, auditWriter) {
        super();
        this.chainId = `chain-${crypto.randomUUID().slice(0, 8)}-${Date.now()}`;
        this.auditWriter = auditWriter;
        this.maxFixIterations = config.maxFixIterations ?? 3;
        this.requireVerifyPass = config.requireVerifyPass ?? true;
        this.state = {
            chainId: this.chainId, goal: config.goal, userId: config.userId, workspace: config.workspace,
            currentStage: 'plan', steps: [], createdAt: Date.now(), updatedAt: Date.now(),
            fixIterations: 0, resumable: false,
        };
    }
    get currentStage() { return this.state.currentStage; }
    getState() { return JSON.parse(JSON.stringify(this.state)); }
    async advance(stage, output) {
        if (this.state.currentStage === 'done' || this.state.currentStage === 'failed')
            throw new Error(`Chain finished: ${this.state.currentStage}`);
        const allowed = ALLOWED_NEXT[this.state.currentStage];
        if (!allowed?.includes(stage))
            throw new Error(`Invalid transition: ${this.state.currentStage} → ${stage}`);
        this.state.steps.push({ stage, status: 'success', startedAt: Date.now(), finishedAt: Date.now(), output });
        this.state.currentStage = stage;
        this.state.updatedAt = Date.now();
        this.auditWriter?.({ chainId: this.chainId, stage, status: 'success', userId: this.state.userId, workspace: this.state.workspace, detail: output?.slice(0, 200) });
        this.emit('stage:changed', { stage, state: this.getState() });
        return this.getState();
    }
    async failCurrent(error) {
        const stage = this.state.currentStage;
        const step = this.state.steps.find(s => s.stage === stage && !s.finishedAt);
        if (step) {
            step.status = 'failed';
            step.error = error;
            step.finishedAt = Date.now();
        }
        this.state.error = error;
        this.state.updatedAt = Date.now();
        if (stage === 'fix') {
            this.state.fixIterations++;
            if (this.state.fixIterations >= this.maxFixIterations) {
                this.state.currentStage = 'failed';
                this.emit('stage:failed', { stage, error, state: this.getState() });
                return this.getState();
            }
        }
        const next = ALLOWED_NEXT[stage]?.find(s => s !== stage && s !== 'done' && s !== 'failed');
        this.state.currentStage = next || 'failed';
        this.auditWriter?.({ chainId: this.chainId, stage, status: 'failed', userId: this.state.userId, workspace: this.state.workspace, detail: error?.slice(0, 200) });
        this.emit('stage:failed', { stage, error, state: this.getState() });
        return this.getState();
    }
    async report(output) {
        if (this.state.currentStage !== 'report')
            await this.advance('report', output);
        this.state.currentStage = 'done';
        this.state.updatedAt = Date.now();
        this.state.resumable = false;
        this.auditWriter?.({ chainId: this.chainId, stage: 'report', status: 'done', userId: this.state.userId, workspace: this.state.workspace, detail: output?.slice(0, 500) });
        this.emit('done', { state: this.getState() });
        return this.getState();
    }
    toJSON() { return this.getState(); }
    static fromJSON(state, auditWriter) {
        const cfg = { goal: state.goal, userId: state.userId, workspace: state.workspace };
        const chain = new TaskChain(cfg, auditWriter);
        chain.state = JSON.parse(JSON.stringify(state));
        return chain;
    }
}
