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

// ═══════════════════════════════════════════════════════════════
// 安全闸门豁免惰性内容工具 (2026-10-20 误报修复)
// 事故: AI 写 PoC 取证脚本 dev27.js (const fs = require('fs')) 被危险正则连废 6 次,
//   报错不说是哪个模式命中 + classifyToolError 无 blocked 分支 → UNKNOWN → 死循环。
// 判据: 网关不执行参数的工具 (写文件/打字/存档/待分析源码) 一律豁免;
//       执行类工具 (run_command/run_background) 保留扫描, 安全边界不撤。
// ═══════════════════════════════════════════════════════════════
describe('ToolRegistry — 危险代码扫描豁免惰性内容工具', () => {
  const mkTool = (name: string) => ({
    name, description: '', parameters: { type: 'object', properties: {} },
    parallelSafe: false, riskLevel: 'low' as const,
    handler: async () => ({ success: true, output: `${name}-ran` }),
  });

  it('write_file 的 content 含 require(\'fs\') 不被拦 (PoC 取证脚本实锤场景)', async () => {
    const r = new ToolRegistry();
    r.register(mkTool('write_file'));
    const result = await r.executeOne({ id: '1', name: 'write_file', args: {
      file_path: 'dev27.js',
      content: '"use strict";\nconst fs = require("fs");\nconst https = require("https");\nconst path = require("path");',
    } }, {} as any);
    expect(result.success).toBe(true);
    expect(result.output).toBe('write_file-ran');
  });

  it('write_file 的 content 含 eval( / child_process 不被拦', async () => {
    const r = new ToolRegistry();
    r.register(mkTool('write_file'));
    const result = await r.executeOne({ id: '1', name: 'write_file', args: {
      file_path: 'a.js', content: 'eval("1+1"); const cp = require("child_process");',
    } }, {} as any);
    expect(result.success).toBe(true);
  });

  it('save_evidence 的 saveText 含 require(\'fs\') 不被拦 (证据存档)', async () => {
    const r = new ToolRegistry();
    r.register(mkTool('save_evidence'));
    const result = await r.executeOne({ id: '1', name: 'save_evidence', args: {
      title: 'poc', saveText: "const fs = require('fs'); fs.writeFileSync('x', 'y');",
    } }, {} as any);
    expect(result.success).toBe(true);
  });

  it('执行类工具仍被拦: run_command 含 child_process 照旧拒绝 (安全边界不撤)', async () => {
    const r = new ToolRegistry();
    r.register(mkTool('run_command'));
    const result = await r.executeOne({ id: '1', name: 'run_command', args: {
      command: 'node -e "require(\'child_process\').exec(\'ls\')"',
    } }, {} as any);
    expect(result.success).toBe(false);
    expect(result.error).toContain('dangerous code pattern');
  });

  it('拦截报错带上匹配到的模式 (可诊断性: AI 能归因才不会原样重试)', async () => {
    const r = new ToolRegistry();
    r.register(mkTool('run_command'));
    const result = await r.executeOne({ id: '1', name: 'run_command', args: {
      command: 'echo hi', extra: "require('fs')",
    } }, {} as any);
    expect(result.error).toMatch(/命中 \/require/);
  });
});
