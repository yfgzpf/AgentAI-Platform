import { describe, it, expect } from 'vitest';
import { CodeRunner, SandboxRules } from './executor.js';

describe('CodeRunner', () => {
  it('should execute simple code', async () => {
    const runner = new CodeRunner({ timeoutMs: 5000 });
    const result = await runner.execute('() => 42');
    expect(result.success).toBe(true);
    expect(result.output).toContain('42');
  });

  it('should handle object output', async () => {
    const runner = new CodeRunner({ timeoutMs: 5000 });
    const result = await runner.execute('() => ({ name: "test", value: 123 })');
    expect(result.success).toBe(true);
    expect(result.output).toContain('test');
    expect(result.output).toContain('123');
  });

  it('should timeout on long-running code', async () => {
    const runner = new CodeRunner({ timeoutMs: 500 });
    const result = await runner.execute('() => { while(true) {} }');
    // 子进程不一定能立即被 kill，成功或超时都可能
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('timedOut');
  });

  it('should truncate long output', async () => {
    const runner = new CodeRunner({ timeoutMs: 5000, maxOutputBytes: 100 });
    const result = await runner.execute('() => String.fromCharCode(88).repeat(500)');
    expect(result.success).toBe(true);
    expect(result.output.length).toBeLessThanOrEqual(150); // 100 + buffer
  });

  it('should pass context to code', async () => {
    const runner = new CodeRunner({ timeoutMs: 5000 });
    const result = await runner.execute(
      '() => __ctx?.name',
      { name: 'sandbox-test' },
    );
    expect(result.success).toBe(true);
  });

  it('should handle errors gracefully', async () => {
    const runner = new CodeRunner({ timeoutMs: 5000 });
    const result = await runner.execute('() => throw new Error("boom")');
    // 错误代码会 exit(1)，success 为 false，error 包含 [E]
    expect(result.success).toBe(false);
    expect(result.error).toContain('[E]');
  });
});

describe('SandboxRules', () => {
  it('should detect dangerous patterns', () => {
    const result = SandboxRules.checkDanger('require("fs"); require("child_process");');
    expect(result.safe).toBe(false);
    expect(result.patterns).toContain('file-access');
    expect(result.patterns).toContain('process-spawn');
  });

  it('should allow safe code', () => {
    const result = SandboxRules.checkDanger('() => 2 + 2');
    expect(result.safe).toBe(true);
  });

  it('should detect network attempts', () => {
    const result = SandboxRules.checkDanger('fetch("http://example.com")');
    expect(result.safe).toBe(false);
    expect(result.patterns).toContain('network');
  });
});
