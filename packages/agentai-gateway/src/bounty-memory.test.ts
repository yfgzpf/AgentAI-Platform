/**
 * 赏金跨会话记忆 — 行为级回归 (2026-10-21, 富哥拍板)
 * --------------------------------------------------------------------------
 * 富哥原话: 「你要每次做这个赏金任务都不会再重复犯错的」
 *   + 「如果用户不用继续就不要回顾这个是不对的」。
 *
 * 旧跨会话注入块两宗罪:
 *   ① 非"继续"开头只注入 1 行摘要 + "不要回顾上次" → 主动命令 AI 丢弃上下文;
 *   ② 60 分钟新鲜度门对赏金过紧 (中午会话晚上就断忆)。
 * 本模块把"继承上次进度"变成**无条件注入** (赏金工作区)。
 *
 * 测试覆盖:
 *   T1 空输入 → 返回 '' (不注入空块)
 *   T2 目标状态落盘 → buildBountyTargetStateBlock 读出快照
 *   T3 跨会话记忆 → buildBountyCrossSessionMemory 汇总 请求/发现/错误/目标状态
 *   T4 fail-safe → 坏输入不抛错
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildBountyCrossSessionMemory,
  buildBountyTargetStateBlock,
} from './bounty-memory.js';

let tmp: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bounty-mem-'));
  const dir = path.join(tmp, '.agentai', 'pentest', 'target-state');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'jxnu.json'),
    JSON.stringify(
      {
        target: 'jxnu',
        discoveredSubdomains: ['any.jxnu.edu.cn'],
        testedEndpoints: ['/api/v1/login'],
        excludedItems: ['/health'],
        attackSurface: ['/api/v1/export'],
        findings: ['AnyShare 未授权文件列表'],
        lastUpdated: Date.now(),
      },
      null,
      2,
    ),
  );
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('T1 空输入不注入', () => {
  it('无消息且无目标状态 → 返回空串', () => {
    const emptyWs = fs.mkdtempSync(path.join(os.tmpdir(), 'bounty-empty-'));
    try {
      expect(buildBountyCrossSessionMemory(emptyWs, [])).toBe('');
      expect(buildBountyTargetStateBlock(emptyWs)).toBe('');
    } finally {
      fs.rmSync(emptyWs, { recursive: true, force: true });
    }
  });
});

describe('T2 目标状态落盘读出', () => {
  it('buildBountyTargetStateBlock 含快照与关键字段', () => {
    const block = buildBountyTargetStateBlock(tmp);
    expect(block).toContain('目标状态快照');
    expect(block).toContain('jxnu');
    expect(block).toContain('/api/v1/export'); // attackSurface
    expect(block).toContain('any.jxnu.edu.cn'); // subdomain
  });
});

describe('T3 跨会话记忆汇总', () => {
  const msgs = [
    { role: 'user', content: '接着挖 jxnu 的 AnyShare 未授权接口' },
    { role: 'assistant', content: 'AnyShare 接口 /api/v1/file/list 未授权可列出全量文件，已确认该漏洞存在，需进一步测试越权下载路径。' },
    {
      role: 'tool',
      toolName: 'wsl_exec',
      content: 'probe6.sh 执行失败: wget returned error 403 Forbidden on endpoint /api/v1/export',
    },
  ];

  it('含标题 + 上次请求 + 已确认发现 + 已犯错误 + 目标状态', () => {
    const block = buildBountyCrossSessionMemory(tmp, msgs as any);
    expect(block).toContain('赏金任务跨会话记忆');
    expect(block).toContain('接着挖 jxnu'); // 上次请求
    expect(block).toContain('未授权'); // 已确认发现
    expect(block).toContain('wsl_exec'); // 已犯错误 (工具名)
    expect(block).toContain('目标状态快照'); // 目标状态
    // 措辞翻转为"直接继承", 不再说"不要回顾上次"
    expect(block).not.toContain('不要回顾上次');
  });
});

describe('T4 fail-safe', () => {
  it('坏消息形态不抛错', () => {
    expect(() => buildBountyCrossSessionMemory(tmp, [{ role: 'user' } as any])).not.toThrow();
    expect(() => buildBountyCrossSessionMemory(tmp, undefined)).not.toThrow();
  });
});
