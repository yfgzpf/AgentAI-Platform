import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { RevertBridge } from './revert-bridge.js';

function tmpWorkspace(): string {
  const d = path.join(process.cwd(), '.agentai-test-' + Date.now());
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
  return d;
}

describe('RevertBridge', () => {
  const b = new RevertBridge();
  let ws: string;

  beforeEach(() => { ws = tmpWorkspace(); });

  it('learns indent preference', () => {
    const r = b.learn(ws, 'f.ts', '  const x = 1;', '    const x = 1;');
    expect(r.learned).toBe(true);
    expect(r.insight).toContain('缩进');
  });

  it('generates system prompt from preferences', () => {
    b.learn(ws, 'f.ts', '  const x = 1;', '    const x = 1;');
    const p = b.toSystemPrompt(ws);
    expect(p).toContain('用户偏好');
  });

  it('returns empty prompt when no preferences', () => {
    expect(b.toSystemPrompt(ws)).toBe('');
  });

  it('snapshot shows learned count', () => {
    b.learn(ws, 'f.ts', '  const x = 1;', '    const x = 1;');
    const s = b.snapshot(ws);
    expect(s.learned).toBeGreaterThanOrEqual(1);
  });

  it('reset clears preferences', () => {
    b.learn(ws, 'f.ts', '  const x = 1;', '    const x = 1;');
    b.reset(ws);
    expect(b.toSystemPrompt(ws)).toBe('');
  });
});
