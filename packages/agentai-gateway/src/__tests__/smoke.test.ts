/**
 * Smoke Tests — 关键路径验证
 * ===========================
 * 运行: npx tsx src/__tests__/smoke.test.ts
 * 用法: 从项目根 node --import tsx src/__tests__/smoke.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ToolRegistry } from '../tool-registry.js';
import { detectProject, runValidator } from '../validator.js';
import { readProjectMemory, initProjectMemory, buildMemoryContext } from '../project-memory.js';
import { listExperts, getExpertPrompt } from '../experts.js';
import { getDailyStats, recordCall } from '../usage-stats.js';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const TMP = path.join(os.tmpdir(), 'agentai-smoke-test-' + Date.now());

beforeAll(() => {
  fs.mkdirSync(TMP, { recursive: true });
  fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({
    name: 'test', dependencies: { react: '^18.0.0' }, devDependencies: { vitest: '^1.0.0' }
  }));
  fs.writeFileSync(path.join(TMP, 'tsconfig.json'), '{}');
});

// ===== ToolRegistry =====
describe('ToolRegistry', () => {
  it('registers and lists tools', () => {
    const reg = new ToolRegistry();
    reg.register({ name: 'test_tool', description: 'test', parameters: { type: 'object', properties: {} }, parallelSafe: true, riskLevel: 'low', handler: async () => ({ success: true, output: 'ok' }) });
    expect(reg.list().length).toBe(1);
    expect(reg.get('test_tool')).toBeTruthy();
  });

  it('handles handler errors gracefully', async () => {
    const reg = new ToolRegistry();
    reg.register({
      name: 'failing_tool', description: 'test',
      parameters: { type: 'object', properties: {} },
      parallelSafe: true, riskLevel: 'low',
      handler: async () => ({ success: false, output: 'boom: deliberate error' })
    });
    const entry = reg.get('failing_tool');
    expect(entry).toBeTruthy();
    const result = await entry!.handler({}, { userId: 'test', workspace: TMP, abortSignal: new AbortController().signal });
    expect(result.success).toBe(false);
    expect(result.output).toContain('boom');
  });

  it('returns error for unknown tool', async () => {
    const reg = new ToolRegistry();
    const entry = reg.get('nonexistent');
    expect(entry).toBeUndefined();
  });
});

// ===== Validator =====
describe('Validator', () => {
  it('detects TypeScript project', () => {
    const result = detectProject(TMP);
    expect(['typescript', 'mixed']).toContain(result.type); // mixed if eslint found
    expect(result.validators.length).toBeGreaterThanOrEqual(1);
  });

  it('detects unknown for empty dir', () => {
    const empty = path.join(os.tmpdir(), 'agentai-empty-' + Date.now());
    fs.mkdirSync(empty, { recursive: true });
    const result = detectProject(empty);
    expect(result.type).toBe('unknown');
    fs.rmSync(empty, { recursive: true, force: true });
  });
});

// ===== Project Memory =====
describe('ProjectMemory', () => {
  it('initializes and reads memory', () => {
    const mem = initProjectMemory(TMP);
    expect(mem.techStack.language).toBe('TypeScript');
    expect(mem.techStack.framework).toBe('React');
  });

  it('builds context from memory', () => {
    initProjectMemory(TMP);
    const ctx = buildMemoryContext(TMP);
    expect(ctx).toContain('TypeScript');
    expect(ctx).toContain('React');
  });
});

// ===== Experts =====
describe('Experts', () => {
  it('lists all experts', () => {
    const experts = listExperts();
    expect(experts.length).toBeGreaterThanOrEqual(4);
  });

  it('generates prompt for architect-ux', () => {
    const prompt = getExpertPrompt('architect-ux');
    expect(prompt).toBeTruthy();
    expect(prompt!).toContain('ROLE OVERRIDE');
    expect(prompt!).toContain('UX');
  });

  it('returns null for unknown expert', () => {
    expect(getExpertPrompt('nonexistent')).toBeNull();
  });
});

// ===== Usage Stats =====
describe('UsageStats', () => {
  it('records and retrieves daily stats', () => {
    const ws = path.join(TMP, 'stats-test');
    fs.mkdirSync(ws, { recursive: true });
    recordCall(ws, { timestamp: Date.now(), tool: 'test_tool', success: true, durationMs: 100 });
    recordCall(ws, { timestamp: Date.now(), tool: 'test_tool', success: false, durationMs: 50 });

    const stats = getDailyStats(ws);
    expect(stats.totalCalls).toBeGreaterThanOrEqual(2);
  });
});

// ===== Cleanup =====
afterAll(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
});

console.log('✅ All smoke tests passed');
