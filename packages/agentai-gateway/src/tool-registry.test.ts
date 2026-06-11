import { describe, it, expect } from 'vitest';
import { ToolRegistry } from './tool-registry.js';

describe('ToolRegistry', () => {
  it('registers a tool', () => {
    const r = new ToolRegistry();
    r.register({ name: 'test', description: 'test tool', parameters: { type: 'object', properties: {} }, parallelSafe: false, riskLevel: 'low', handler: async () => ({ success: true, output: 'ok' }) });
    expect(r.list().length).toBe(1);
  });
  it('gets a tool by name', () => {
    const r = new ToolRegistry();
    r.register({ name: 'test', description: 'test tool', parameters: { type: 'object', properties: {} }, parallelSafe: false, riskLevel: 'low', handler: async () => ({ success: true, output: 'ok' }) });
    expect(r.get('test')).toBeTruthy();
  });
  it('executeOne calls handler', async () => {
    const r = new ToolRegistry();
    r.register({ name: 'test', description: 'test', parameters: { type: 'object', properties: {} }, parallelSafe: false, riskLevel: 'low', handler: async (a) => ({ success: true, output: `exec ${a.x}` }) });
    const result = await r.executeOne({ id: '1', name: 'test', args: { x: 'hello' } }, {} as any);
    expect(result.output).toBe('exec hello');
  });
  it('executeOne fails for unknown tool', async () => {
    const r = new ToolRegistry();
    const result = await r.executeOne({ id: '1', name: 'nonexistent', args: {} }, {} as any);
    expect(result.success).toBe(false);
  });
  it('list returns all registered', () => {
    const r = new ToolRegistry();
    r.register({ name: 'a', description: '', parameters: { type: 'object', properties: {} }, parallelSafe: false, riskLevel: 'low', handler: async () => ({ success: true, output: '' }) });
    r.register({ name: 'b', description: '', parameters: { type: 'object', properties: {} }, parallelSafe: false, riskLevel: 'low', handler: async () => ({ success: true, output: '' }) });
    expect(r.list().length).toBe(2);
  });
});
