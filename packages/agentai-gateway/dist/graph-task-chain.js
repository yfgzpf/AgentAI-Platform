import { EventEmitter } from 'events';
import crypto from 'crypto';
export class MemoryCheckpointStore {
    s = new Map();
    async save(k, v) { this.s.set(k, JSON.parse(JSON.stringify(v))); }
    async load(k) { return this.s.get(k); }
}
export class PostgresCheckpointStore {
    query;
    constructor(query) {
        this.query = query;
    }
    async save(threadId, state) {
        await this.query('INSERT INTO checkpoints (thread_id, state, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (thread_id) DO UPDATE SET state = $2, updated_at = NOW()', [threadId, JSON.stringify(state)]);
    }
    async load(threadId) {
        const r = await this.query('SELECT state FROM checkpoints WHERE thread_id = $1', [threadId]);
        if (r.rows?.[0]?.state)
            return typeof r.rows[0].state === 'string' ? JSON.parse(r.rows[0].state) : r.rows[0].state;
        return undefined;
    }
}
const DEFAULT_GRAPH = [
    { id: 'plan', stage: 'plan', next: { default: ['solve'] } },
    { id: 'solve', stage: 'solve', next: { default: ['verify'] } },
    { id: 'verify', stage: 'verify', next: { pass: ['report'], fail: ['fix'], skip: ['report'] } },
    { id: 'fix', stage: 'fix', next: { default: ['verify'] } },
    { id: 'report', stage: 'report', next: { default: ['done'] } },
];
export class GraphTaskChain extends EventEmitter {
    state;
    graphDef;
    store;
    auditWriter;
    chainId;
    constructor(config, auditWriter, store) {
        super();
        this.chainId = `gchain-${crypto.randomUUID().slice(0, 8)}-${Date.now()}`;
        this.auditWriter = auditWriter;
        this.store = store || new MemoryCheckpointStore();
        this.graphDef = DEFAULT_GRAPH.map(n => ({ ...n }));
        this.state = {
            chainId: this.chainId, goal: config.goal, userId: config.userId, workspace: config.workspace,
            currentStage: 'plan', steps: [], createdAt: Date.now(), updatedAt: Date.now(),
            fixIterations: 0, resumable: false, error: undefined,
            chainType: 'graph', currentNode: 'plan', nodeHistory: [],
            checkpoint: { threadId: this.chainId, persistedAt: Date.now() },
            graphDef: this.graphDef,
        };
    }
    get currentStage() { return this.state.currentStage; }
    getState() { return JSON.parse(JSON.stringify(this.state)); }
    setGraph(graph) { this.graphDef = graph.map(n => ({ ...n })); this.state.graphDef = this.graphDef; }
    async advance(stage, output) {
        const node = this.graphDef.find(n => n.stage === stage);
        if (!node)
            throw new Error(`Stage ${stage} not found`);
        this.state.steps.push({ stage, status: 'success', startedAt: Date.now(), finishedAt: Date.now(), output });
        this.state.nodeHistory.push({ nodeId: node.id, stage, status: 'success', startedAt: Date.now(), finishedAt: Date.now(), output, routeTaken: 'advance' });
        this.state.currentStage = stage;
        this.state.currentNode = node.id;
        this.state.updatedAt = Date.now();
        this.auditWriter?.({ chainId: this.chainId, stage, status: 'success', userId: this.state.userId, workspace: this.state.workspace, detail: output?.slice(0, 200) });
        this.emit('stage:changed', { stage, state: this.getState() });
        return this.getState();
    }
    async interrupt(reason) {
        this.state.resumable = true;
        this.state.checkpoint.resumeId = crypto.randomUUID();
        this.state.updatedAt = Date.now();
        await this.store.save(this.state.checkpoint.threadId, this.state);
        this.emit('interrupted', { node: this.state.currentNode, reason, resumeId: this.state.checkpoint.resumeId, state: this.getState() });
    }
    async resume() {
        if (!this.state.resumable)
            throw new Error('Not resumable');
        this.state.resumable = false;
        this.state.checkpoint.resumeId = undefined;
        this.state.updatedAt = Date.now();
        this.emit('resumed', { state: this.getState() });
        return this.getState();
    }
    async report(output) {
        if (this.state.currentStage !== 'report')
            await this.advance('report', output);
        this.state.currentStage = 'done';
        this.state.currentNode = 'done';
        this.state.updatedAt = Date.now();
        this.state.resumable = false;
        this.auditWriter?.({ chainId: this.chainId, stage: 'report', status: 'done', userId: this.state.userId, workspace: this.state.workspace, detail: output?.slice(0, 500) });
        this.emit('done', { state: this.getState() });
        return this.getState();
    }
    toJSON() { return this.getState(); }
    static fromJSON(state, auditWriter, store) {
        const chain = new GraphTaskChain({ goal: state.goal, userId: state.userId, workspace: state.workspace }, auditWriter, store);
        chain.state = JSON.parse(JSON.stringify(state));
        return chain;
    }
}
