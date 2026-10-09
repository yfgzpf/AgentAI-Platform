/**
 * Discipline — 验收断言器单元测试
 * 这是纪律层自己的安全网：纪律没被测试过 = 纪律不可信
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  verifyAssert,
  verifyStage,
  formatGateResult,
  fromLegacyCriteria,
  normalizeAcceptance,
  type StageGate,
} from './assertions.js';

const TMP = path.join(os.tmpdir(), 'discipline-test-' + process.pid);

describe('assertions · 命令断言', () => {
  it('exit0 期望：成功的命令通过', async () => {
    const r = await verifyAssert({
      kind: 'command',
      cmd: 'git --version',
      expect: 'exit0',
    });
    expect(r.passed).toBe(true);
  });

  it('exit0 期望：失败的命令不通过并给出退出码', async () => {
    const r = await verifyAssert({
      kind: 'command',
      cmd: 'git rev-parse --verify refs/heads/不存在的分支xyz',
      expect: 'exit0',
    });
    expect(r.passed).toBe(false);
    expect(r.reason).toContain('退出码');
  });

  it('白名单外的命令被拒绝执行（安全策略）', async () => {
    const r = await verifyAssert({
      kind: 'command',
      cmd: 'rm -rf /',
      expect: 'exit0',
    });
    expect(r.passed).toBe(false);
    expect(r.reason).toContain('白名单');
  });

  it('contains 期望：输出包含指定串则通过', async () => {
    const r = await verifyAssert({
      kind: 'command',
      cmd: 'git --version',
      expect: 'contains',
      output: 'git version',
    });
    expect(r.passed).toBe(true);
  });

  it('notContains 期望：输出含指定串则不通过', async () => {
    const r = await verifyAssert({
      kind: 'command',
      cmd: 'git --version',
      expect: 'notContains',
      output: 'git version',
    });
    expect(r.passed).toBe(false);
  });
});

describe('assertions · 文件断言', () => {
  it('fileExists：存在的文件通过', async () => {
    const r = await verifyAssert({ kind: 'fileExists', path: __filename });
    expect(r.passed).toBe(true);
  });

  it('fileExists：不存在的文件不通过', async () => {
    const r = await verifyAssert({ kind: 'fileExists', path: '/绝对不存在的文件xyz' });
    expect(r.passed).toBe(false);
  });

  it('fileAbsent：不存在的文件通过', async () => {
    const r = await verifyAssert({ kind: 'fileAbsent', path: '/绝对不存在的文件xyz' });
    expect(r.passed).toBe(true);
  });
});

describe('assertions · grep 断言', () => {
  beforeEachish();

  it('found：命中则通过', async () => {
    const f = path.join(TMP, 'sample.txt');
    fs.writeFileSync(f, 'hello world\nfoo bar\n');
    const r = await verifyAssert({ kind: 'grep', pattern: 'foo', path: f, expect: 'found' });
    expect(r.passed).toBe(true);
  });

  it('absent：命中则不通过（这是删文件前的核心纪律）', async () => {
    const f = path.join(TMP, 'sample2.txt');
    fs.writeFileSync(f, 'nothing here');
    const r = await verifyAssert({ kind: 'grep', pattern: 'forbidden', path: f, expect: 'absent' });
    expect(r.passed).toBe(true);

    const f2 = path.join(TMP, 'sample3.txt');
    fs.writeFileSync(f2, 'contains forbidden text');
    const r2 = await verifyAssert({ kind: 'grep', pattern: 'forbidden', path: f2, expect: 'absent' });
    expect(r2.passed).toBe(false);
  });

  it('minCount：命中次数不足则不通过', async () => {
    const f = path.join(TMP, 'sample4.txt');
    fs.writeFileSync(f, 'once');
    const r = await verifyAssert({ kind: 'grep', pattern: 'once', path: f, expect: 'found', minCount: 3 });
    expect(r.passed).toBe(false);
  });

  it('regex=false 时按字面量匹配（正则元字符不生效）', async () => {
    const f = path.join(TMP, 'sample5.txt');
    // 字面量 "a.b" 只在 "a.b" 处命中；"axb" 不是字面量匹配
    fs.writeFileSync(f, 'a.b and axb');
    const literal = await verifyAssert({ kind: 'grep', pattern: 'a.b', path: f, expect: 'found', regex: false });
    expect(literal.observed).toContain('命中 1 次');

    // 默认走正则，. 匹配任意字符，故 "a.b" 同时匹配 "axb" → 2 次
    const asRegex = await verifyAssert({ kind: 'grep', pattern: 'a.b', path: f, expect: 'found' });
    expect(asRegex.observed).toContain('命中 2 次');
  });

  it('非法正则降级为字面量而不抛错', async () => {
    const f = path.join(TMP, 'sample6.txt');
    // "[" 开启的字符类未闭合，正则引擎会抛 SyntaxError，必须降级为字面量
    fs.writeFileSync(f, 'has unclosed [ bracket');
    const r = await verifyAssert({ kind: 'grep', pattern: '[unclosed', path: f, expect: 'found' });
    expect(r.passed).toBe(false); // 字面量 "[unclosed" 确实不在文件里
    expect(r.reason).not.toContain('SyntaxError');
  });
});

describe('assertions · 行数断言', () => {
  it('lte：超出上限则不通过（防代码量膨胀）', async () => {
    const f = path.join(TMP, 'lines.txt');
    fs.writeFileSync(f, 'a\nb\nc\nd\ne');
    const r = await verifyAssert({ kind: 'lineCount', path: f, mode: 'lte', value: 3 });
    expect(r.passed).toBe(false);
    expect(r.observed).toContain('5 行');
  });

  it('gte：低于下限则不通过', async () => {
    const f = path.join(TMP, 'lines2.txt');
    fs.writeFileSync(f, 'a\nb');
    const r = await verifyAssert({ kind: 'lineCount', path: f, mode: 'gte', value: 10 });
    expect(r.passed).toBe(false);
  });

  it('文件不存在时不通过', async () => {
    const r = await verifyAssert({ kind: 'lineCount', path: '/不存在xyz', mode: 'lte', value: 100 });
    expect(r.passed).toBe(false);
  });
});

describe('assertions · 绿区洁净断言', () => {
  it('dirClean：干净目录通过', async () => {
    const r = await verifyAssert({
      kind: 'dirClean',
      path: 'packages/agentai-gateway/src/soul',
      since: 'HEAD',
    });
    // HEAD 是干净的提交状态（本次仅新增文件），所以应通过
    expect(r.passed).toBe(true);
  });

  it('dirClean：不存在的目录标记为跳过而非失败', async () => {
    const r = await verifyAssert({ kind: 'dirClean', path: '/绝对不存在的目录xyz' });
    expect(r.passed).toBe(true);
    expect(r.skipped).toBe(true);
  });
});

describe('assertions · LLM 判定', () => {
  it('未注入判定器时跳过而非阻塞流程', async () => {
    const r = await verifyAssert({ kind: 'llmJudge', rubric: '是否是有效 JSON' });
    expect(r.passed).toBe(true);
    expect(r.skipped).toBe(true);
  });

  it('注入判定器后按分数判定', async () => {
    const r = await verifyAssert(
      { kind: 'llmJudge', rubric: '质量', threshold: 0.8 },
      { llmJudge: async () => ({ pass: false, score: 0.3, reason: '质量不达标' }) },
    );
    expect(r.passed).toBe(false);
    expect(r.reason).toBe('质量不达标');
  });
});

describe('verifyStage · 批量验证', () => {
  it('全部通过时 passed=true', async () => {
    const gate: StageGate = {
      stageKey: 'test-stage',
      asserts: [
        { kind: 'fileExists', path: __filename },
        { kind: 'command', cmd: 'git --version', expect: 'exit0' },
      ],
    };
    const r = await verifyStage(gate);
    expect(r.passed).toBe(true);
    expect(r.failedCount).toBe(0);
  });

  it('任一失败则 passed=false 且 failedCount 正确', async () => {
    const gate: StageGate = {
      stageKey: 'fail-stage',
      asserts: [
        { kind: 'fileExists', path: __filename },
        { kind: 'fileExists', path: '/不存在xyz' },
      ],
    };
    const r = await verifyStage(gate);
    expect(r.passed).toBe(false);
    expect(r.failedCount).toBe(1);
  });

  it('空断言列表视为通过', async () => {
    const r = await verifyStage({ stageKey: 'empty', asserts: [] });
    expect(r.passed).toBe(true);
  });
});

describe('formatGateResult · 报告生成', () => {
  it('生成可读报告并标注 PASS/FAIL', async () => {
    const r = await verifyStage({
      stageKey: 'report',
      asserts: [
        { kind: 'fileExists', path: __filename, description: '自身存在' },
        { kind: 'fileExists', path: '/不存在xyz', description: '不存在的路径' },
      ],
    });
    const text = formatGateResult(r);
    expect(text).toContain('机器验收');
    expect(text).toContain('PASS');
    expect(text).toContain('FAIL');
    expect(text).toContain('自身存在');
  });

  it('空报告有兜底文案', () => {
    expect(formatGateResult({ passed: true, results: [], failedCount: 0, skippedCount: 0, totalMs: 0 }))
      .toContain('无机器断言');
  });
});

describe('向后兼容 · 字符串降级', () => {
  it('字符串转为 llmJudge 断言', () => {
    const a = fromLegacyCriteria('tsc 零错误');
    expect(a.kind).toBe('llmJudge');
    if (a.kind === 'llmJudge') {
      expect(a.rubric).toBe('tsc 零错误');
      expect(a.threshold).toBe(0.7);
    }
  });

  it('数组原样返回', () => {
    const arr = [{ kind: 'fileExists' as const, path: '/x' }];
    expect(normalizeAcceptance(arr)).toBe(arr);
  });

  it('字符串走降级路径', () => {
    const out = normalizeAcceptance('验收标准');
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('llmJudge');
  });
});

// 测试夹具：创建临时目录
function beforeEachish() {
  if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });
}

describe('cleanup', () => {
  it('清理临时目录', () => {
    if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true, force: true });
    expect(fs.existsSync(TMP)).toBe(false);
  });
});