import { EventEmitter } from 'events';
import crypto from 'crypto';
import type { ChainStage, ChainConfig, ChainState, AuditWriter } from './task-chain.js';

export type StepStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped' | 'interrupted';
export interface GraphNodeDef { id: string; stage: ChainStage; next: Record<string, string[]>; interruptBefore?: boolean; }
export interface NodeStepResult { nodeId: string; stage: ChainStage; status: StepStatus; startedAt: number; finishedAt?: number; output?: string; error?: string; routeTaken?: string; }
export interface GraphChainState extends ChainState { chainType: 'graph'; currentNode: string | null; nodeHistory: NodeStepResult[]; checkpoint: { threadId: string; persistedAt: number; resumeId?: string; }; graphDef: GraphNodeDef[]; }
export interface CheckpointStore { save(threadId: string, state: any): Promise<void>; load(threadId: string): Promise<any | undefined>; }
export class MemoryCheckpointStore implements CheckpointStore { private s = new Map<string, any>(); async save(k: string, v: any) { this.s.set(k, JSON.parse(JSON.stringify(v))); } async load(k: string) { return this.s.get(k); } }

const DEFAULT_GRAPH: GraphNodeDef[] = [
  { id: 'plan', stage: 'plan', next: { default: ['solve'] } },
  { id: 'solve', stage: 'solve', next: { default: ['verify'] } },
  { id: 'verify', stage: 'verify', next: { pass: ['report'], fail: ['fix'], skip: ['report'] } },
  { id: 'fix', stage: 'fix', next: { default: ['verify'] } },
  { id: 'report', stage: 'report', next: { default: ['done'] } },
];

export class GraphTaskChain extends EventEmitter {
  private state: GraphChainState;
  private graphDef: GraphNodeDef[];
  private store: CheckpointStore;
  private auditWriter?: AuditWriter;
  public readonly chainId: string;

  constructor(config: ChainConfig, auditWriter?: AuditWriter, store?: CheckpointStore) {
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
  getState(): GraphChainState { return JSON.parse(JSON.stringify(this.state)); }

  setGraph(graph: GraphNodeDef[]) { this.graphDef = graph.map(n => ({ ...n })); this.state.graphDef = this.graphDef; }

  async advance(stage: any, output?: string): Promise<any> {
    const node = this.graphDef.find(n => n.stage === stage);
    if (!node) throw new Error(`Stage ${stage} not found`);
    this.state.steps.push({ stage, status: 'success', startedAt: Date.now(), finishedAt: Date.now(), output });
    this.state.nodeHistory.push({ nodeId: node.id, stage, status: 'success', startedAt: Date.now(), finishedAt: Date.now(), output, routeTaken: 'advance' });
    this.state.currentStage = stage; this.state.currentNode = node.id; this.state.updatedAt = Date.now();
    this.auditWriter?.({ chainId: this.chainId, stage, status: 'success', userId: this.state.userId, workspace: this.state.workspace, detail: output?.slice(0, 200) } as any);
    this.emit('stage:changed', { stage, state: this.getState() });
    return this.getState();
  }

  async interrupt(reason: string): Promise<void> {
    this.state.resumable = true; this.state.checkpoint.resumeId = crypto.randomUUID(); this.state.updatedAt = Date.now();
    await this.store.save(this.state.checkpoint.threadId, this.state);
    this.emit('interrupted', { node: this.state.currentNode, reason, resumeId: this.state.checkpoint.resumeId, state: this.getState() });
  }

  async resume(): Promise<any> {
    if (!this.state.resumable) throw new Error('Not resumable');
    this.state.resumable = false; this.state.checkpoint.resumeId = undefined; this.state.updatedAt = Date.now();
    this.emit('resumed', { state: this.getState() });
    return this.getState();
  }

  async report(output?: string): Promise<any> {
    if (this.state.currentStage !== 'report') await this.advance('report', output);
    this.state.currentStage = 'done'; this.state.currentNode = 'done'; this.state.updatedAt = Date.now(); this.state.resumable = false;
    this.auditWriter?.({ chainId: this.chainId, stage: 'report', status: 'done', userId: this.state.userId, workspace: this.state.workspace, detail: output?.slice(0, 500) } as any);
    this.emit('done', { state: this.getState() });
    return this.getState();
  }

  toJSON(): any { return this.getState(); }

  static fromJSON(state: any, auditWriter?: AuditWriter, store?: CheckpointStore): GraphTaskChain {
    const chain = new GraphTaskChain({ goal: state.goal, userId: state.userId, workspace: state.workspace }, auditWriter, store);
    chain.state = JSON.parse(JSON.stringify(state));
    return chain;
  }
}
