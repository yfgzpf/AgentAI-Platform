import { describe, it, expect } from 'vitest';
import { TaskChain } from './task-chain.js';

describe('TaskChain', () => {
  it('starts at plan stage', () => {
    const c = new TaskChain({ goal: 'test', userId: 'u', workspace: 'w' });
    expect(c.currentStage).toBe('plan');
  });
  it('advances through stages', async () => {
    const c = new TaskChain({ goal: 'test', userId: 'u', workspace: 'w' });
    await c.advance('solve');
    expect(c.currentStage).toBe('solve');
    await c.advance('verify');
    expect(c.currentStage).toBe('verify');
  });
  it('rejects invalid transition', async () => {
    const c = new TaskChain({ goal: 'test', userId: 'u', workspace: 'w' });
    await expect(c.advance('verify')).rejects.toThrow();
  });
  it('report marks as done', async () => {
    const c = new TaskChain({ goal: 'test', userId: 'u', workspace: 'w' });
    await c.advance('solve');
    await c.advance('verify');
    await c.advance('report');
    const s = await c.report();
    expect(s.currentStage).toBe('done');
  });
  it('serializes to JSON', () => {
    const c = new TaskChain({ goal: 'test', userId: 'u', workspace: 'w' });
    const j = c.toJSON();
    expect(j.chainId).toBeTruthy();
    expect(j.goal).toBe('test');
  });
  it('restores from JSON', () => {
    const c = new TaskChain({ goal: 'test', userId: 'u', workspace: 'w' });
    const j = c.toJSON();
    const r = TaskChain.fromJSON(j);
    expect(r.chainId).toBeTruthy();
    expect(r.currentStage).toBe('plan');
    expect(r.toJSON().goal).toBe('test');
  });
});
