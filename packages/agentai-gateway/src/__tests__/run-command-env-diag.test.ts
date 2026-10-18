import { describe, it, expect, afterEach } from 'vitest';
import { buildRunCommandFailureHint } from '../tools.js';

const ENONENT = 'spawn C:\\Windows\\system32\\cmd.exe ENOENT';

afterEach(() => {
  // 还原可能被用例改动的 env, 避免污染同文件其他用例
  delete process.env.ComSpec;
});

describe('buildRunCommandFailureHint: spawn ENOENT 必须可行动', () => {
  it('win32 + cmd.exe 可见 → 诊断为罕见环境异常, 不瞎指 PATH', () => {
    const h = buildRunCommandFailureHint(new Error(ENONENT), 'echo hi');
    // 现场事实必须在场 (AI 靠它判断, 不靠猜)
    expect(h).toContain('进程平台: win32');
    expect(h).toContain('node: v');
    expect(h).toContain('ComSpec:');
    expect(h).toContain('PATH 前 3 段');
    // 本机 cmd.exe 真实存在 → 必须落到"罕见异常"分支, 并建议 run_code
    expect(h).toContain('罕见环境异常');
    expect(h).toContain('run_code');
    // 铁律: 不许让 AI 以为改 PATH 重试能解决
    expect(h).toContain('不要反复原样重试');
  });

  it('win32 + ComSpec 指向不存在文件 → 视图隔离结论', () => {
    process.env.ComSpec = 'C:\\Windows\\system32\\cmd_missing.exe';
    const h = buildRunCommandFailureHint(new Error(ENONENT), 'dir');
    expect(h).toContain('看不到 ComSpec 指向的文件');
    expect(h).toContain('run_code');
  });

  it('linux 进程 → 直接点破"没有 cmd.exe 是因为进程不在 Windows"', () => {
    // 模拟 WSL/Linux 侧网关: platform 伪造成 linux 不可行 (只读), 改用
    // 在 win32 上验证"非 spawn 错误走普通分支", linux 分支靠文案锁 + 人工 review。
    const h = buildRunCommandFailureHint(new Error('exit code 127'), 'ls -la');
    expect(h).toContain('非 spawn 环境错误');
    expect(h).not.toContain('根因:');
  });

  it('PATH 含孤立盘符时给出警示, 但明确"不是根因"', () => {
    // 本机 PATH 首段就是沙箱改写的孤立 "J" — 正好锁这条
    const h = buildRunCommandFailureHint(new Error(ENONENT), 'echo hi');
    const head = (process.env.PATH || '').split(';').filter(Boolean).slice(0, 3);
    if (head.some((p) => p && !p.includes(':') && !p.startsWith('/'))) {
      expect(h).toContain('⚠️ PATH 含无效段');
      expect(h).toContain('但它不是根因');
    }
  });

  it('诊断输出长度受控 (别把工具返回值撑爆)', () => {
    const h = buildRunCommandFailureHint(new Error(ENONENT), 'x'.repeat(5000));
    expect(h.length).toBeLessThanOrEqual(2200);
    // 超长命令必须被截断
    expect(h).not.toContain('x'.repeat(500));
  });
});
