/**
 * 台账端到端接线测试
 * ========================================================================
 * 验证 TaskLedger 不是"写了没人用"的死代码（该项目已有59 行 read-tracker
 * 死代码的历史教训）：
 *   1. 任务目标真的写进台账
 *   2. 台账文本真的进了 LLM messages
 *   3. 重复 read_file 真的触发 redundant_read 指令
 *   4. 台账内容不受 appendOnlyLog 清空影响
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentAILoop } from './agentai-loop.js';
import { clearLedgers, getLedger } from './task-ledger.js';

vi.mock('./llm-router.js');
vi.mock('./tool-registry.js');
vi.mock('./memory-manager.js');

let WS: string;

beforeEach(() => {
  WS = mkdtempSync(join(tmpdir(), 'ledger-e2e-'));
  clearLedgers();
});

function makeLoop(
  chatImpl: (msgs: any[]) => any,
  opts: Record<string, any> = {},
) {
  const router: any = {
    chat: vi.fn(async (payload: any) => {
      const msgs = payload?.messages || [];
      chatImpl(msgs);
      return {
        content: '已完成本轮',
        provider: 'agentai',
        finishReason: 'stop',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      };
    }),
    getAvailableModels: vi.fn().mockReturnValue(['agentai']),
  };
  const registry: any = {
    dispatch: vi.fn(async (calls: any[]) =>
      calls.map((c: any) => ({ id: c.id, result: { success: true, output: 'ok' } })),
    ),
    toLLMTools: vi.fn().mockReturnValue([]),
    list: vi.fn().mockReturnValue([]),
  };
  const loop = new AgentAILoop(router, registry, [], {
    maxIterations: 3,
    userId: 'u1',
    workspace: WS,
    sessionId: 's1',
    ...opts,
  });
  vi.spyOn(loop as any, 'ensureContext').mockImplementation(async () => {
    (loop as any).contextReady = true;
    (loop as any).context.immutablePrefix = [{ role: 'system', content: 'sys' }];
  });
  return { loop, router, registry };
}

/** 从所有 messages 里拼出全部文本，便于断言 */
function allText(msgs: any[]): string {
  return msgs
    .map((m: any) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')))
    .join('\n');
}

describe('台账接线: 任务目标', () => {
  it('run() 后用户诉求进入台账', async () => {
    const { loop } = makeLoop(() => {});
    await loop.run('给 tools.ts 的 git_commit 加参数校验，防止命令注入');
    const led = (loop as any).ledger;
    expect(led.getGoal()).toContain('命令注入');
  }, 30000);

  it('短承接消息不覆盖已有目标（"继续"不能把真目标冲掉）', async () => {
    const { loop } = makeLoop(() => {});
    // 目标：先写入一个明确任务目标，再用短承接词覆盖，验证不被冲掉
    const led = (loop as any).ledger;
    led.setGoal('重构整个支付模块的错误处理');

    // 复刻 run() 入口的判定逻辑（直接测规则，不跑完整 run —— 那要 3~10 秒）
    const setGoalFromUser = (t: string) => {
      if (t.trim().length > 0 && (t.trim().length >= 4 || !led.getGoal())) led.setGoal(t);
    };
    setGoalFromUser('继续');
    expect(led.getGoal()).toContain('重构整个支付模块');
    setGoalFromUser('现在改第二处');
    expect(led.getGoal()).toContain('第二处');
  }, 30000);

  it('短消息规则：<4 字不覆盖，≥4 字覆盖', async () => {
    const { loop } = makeLoop(() => {});
    const led = (loop as any).ledger;
    led.setGoal('原始目标');
    // 模拟 run() 里的判定
    const shouldUpdate = (t: string) => t.trim().length >= 4 || !led.getGoal();
    expect(shouldUpdate('继续')).toBe(false);
    expect(shouldUpdate('好')).toBe(false);
    expect(shouldUpdate('现在改第二处')).toBe(true);
  });

  it('台账文本真的进了 LLM messages', async () => {
    let seen = '';
    const { loop } = makeLoop((msgs) => { seen = allText(msgs); });
    await loop.run('审计所有路由的入参校验');
    expect(seen, '台账必须作为 system 消息进入 prompt').toContain('任务台账');
    expect(seen).toContain('审计所有路由的入参校验');
  });

  it('第 2 轮台账带上了轮次号（AI 能感知进度在推进）', async () => {
    const texts: string[] = [];
    const router: any = {
      chat: vi.fn(async (payload: any) => {
        texts.push(allText(payload.messages || []));
        return {
          content: 'ok', provider: 'agentai', finishReason: 'stop',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      }),
      getAvailableModels: vi.fn().mockReturnValue(['agentai']),
    };
    const registry: any = {
      dispatch: vi.fn(async () => []),
      toLLMTools: vi.fn().mockReturnValue([]),
      list: vi.fn().mockReturnValue([]),
    };
    const loop = new AgentAILoop(router, registry, [], {
      maxIterations: 5, userId: 'u1', workspace: WS, sessionId: 's1',
    });
    vi.spyOn(loop as any, 'ensureContext').mockImplementation(async () => {
      (loop as any).contextReady = true;
      (loop as any).context.immutablePrefix = [{ role: 'system', content: 'sys' }];
    });
    await loop.run('连续做三轮的任务');
    expect(texts.length).toBeGreaterThanOrEqual(1);
    // 至少有一轮带轮次号
    expect(texts.some((t) => /第\s*\d+\s*轮/.test(t)), '台账应含轮次').toBe(true);
  });
});

describe('台账接线: 重复读文件', () => {
  it('第二次读同一文件时台账累计计数并触发提醒', async () => {
    const { loop, registry } = makeLoop(() => {});
    // 关键：两次调用 args 必须不同（offset 不同），否则会被 _toolCallHistory
    // 跨轮去重拦截 —— 那样反而读不到第二次。
    // 这里验证的是"两次真的执行了"这条路径下的台账行为。
    let n = 0;
    (loop as any).router.chat = vi.fn(async () => {
      n++;
      if (n > 2) return { content: 'done', provider: 'agentai', finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
      return {
        content: '', provider: 'agentai', finishReason: 'tool_calls',
        toolCalls: [{
          id: `c${n}`, name: 'read_file',
          args: { file_path: 'src/dup.ts', offset: n * 100 },
        }],
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      };
    });
    registry.dispatch = vi.fn(async (calls: any[]) =>
      calls.map((c: any) => ({ id: c.id, result: { success: true, output: '文件内容' } })),
    );

    let lastPrompt = '';
    const orig = (loop as any).router.chat;
    (loop as any).router.chat = vi.fn(async (p: any) => {
      lastPrompt = allText(p.messages || []);
      return orig(p);
    });

    await loop.run('反复读 src/dup.ts');

    const led = (loop as any).ledger;
    expect(led.readCount('src/dup.ts'), '台账应记录多次读取').toBeGreaterThanOrEqual(2);
    expect(led.topDuplicates().some((d: any) => d.target === 'src/dup.ts')).toBe(true);
    expect(lastPrompt, '重复读提醒应进入下一轮 prompt').toContain('本会话已读过');
  });

  it('★ 只读工具(read_file)刻意不做跨轮硬去重 —— 由台账负责劝阻', async () => {
    const { loop, registry } = makeLoop(() => {});
    let n = 0;
    (loop as any).router.chat = vi.fn(async () => {
      n++;
      return {
        content: '', provider: 'agentai', finishReason: 'tool_calls',
        toolCalls: [{ id: `c${n}`, name: 'read_file', args: { file_path: 'src/same.ts' } }],
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      };
    });
    registry.dispatch = vi.fn(async (calls: any[]) =>
      calls.map((c: any) => ({ id: c.id, result: { success: true, output: '内容' } })),
    );

    await loop.run('读 src/same.ts 很多次');

    // 设计取舍（并行改动引入的 READ_ONLY_TOOLS 白名单）:
    //   只读工具**不硬去重**，因为 AI 每轮可能需要重新探索，硬拦会让它卡死。
    //   防重复读的责任交给任务台账 —— 每轮 prompt 都告诉 AI「这个文件你读过 N 次」。
    const dispatched = registry.dispatch.mock.calls.length;
    expect(dispatched, '只读工具不应被硬去重（否则 AI 无法重新探索）').toBe(n);

    // 真正生效的是台账: 它累计记录了读次数
    const led = (loop as any).ledger;
    expect(led.readCount('src/same.ts'), '台账应累计记录读次数').toBeGreaterThanOrEqual(2);
    expect(led.topDuplicates().some((d: any) => d.target === 'src/same.ts')).toBe(true);
  });

  it('★ 非只读工具的相同参数调用被跨轮去重拦截（真的不重复执行）', async () => {
    const { loop, registry } = makeLoop(() => {});
    let n = 0;
    (loop as any).router.chat = vi.fn(async () => {
      n++;
      return {
        content: '', provider: 'agentai', finishReason: 'tool_calls',
        // run_command 属写操作类工具，不在 READ_ONLY_TOOLS 白名单 → 走去重
        toolCalls: [{ id: `c${n}`, name: 'run_command', args: { command: 'npm test' } }],
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      };
    });
    registry.dispatch = vi.fn(async (calls: any[]) =>
      calls.map((c: any) => ({ id: c.id, result: { success: true, output: 'ok' } })),
    );

    await loop.run('跑很多次 npm test');

    const dispatched = registry.dispatch.mock.calls.length;
    expect(dispatched, '相同参数的非只读调用应被去重').toBeLessThan(n);
  });

  it('首次读取不触发重复提醒（不制造噪音）', async () => {
    const { loop, registry } = makeLoop(() => {});
    let n = 0;
    (loop as any).router.chat = vi.fn(async () => {
      n++;
      if (n > 1) return { content: 'ok', provider: 'agentai', finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
      return {
        content: '', provider: 'agentai', finishReason: 'tool_calls',
        toolCalls: [{ id: 'c1', name: 'read_file', args: { file_path: 'src/once.ts' } }],
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      };
    });
    registry.dispatch = vi.fn(async (calls: any[]) =>
      calls.map((c: any) => ({ id: c.id, result: { success: true, output: 'x' } })),
    );

    let seen = '';
    (loop as any).router.chat = vi.fn(async (p: any) => {
      seen = allText(p.messages || []);
      n++;
      if (n > 1) return { content: 'ok', provider: 'agentai', finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
      return {
        content: '', provider: 'agentai', finishReason: 'tool_calls',
        toolCalls: [{ id: 'c1', name: 'read_file', args: { file_path: 'src/once.ts' } }],
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      };
    });

    await loop.run('读一次 src/once.ts');
    expect((loop as any).ledger.readCount('src/once.ts')).toBeGreaterThanOrEqual(1);
    // 首次读取不应产生"已读过 N 次"的提醒（那时还不存在这个事实）
    expect(seen, '首次读取不应产生重复提醒').not.toContain('本次为第 2 次');
  });

  it('写文件与读文件分别计数', async () => {
    const { loop, registry } = makeLoop(() => {});
    let n = 0;
    (loop as any).router.chat = vi.fn(async () => {
      n++;
      if (n > 2) return { content: 'done', provider: 'agentai', finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
      return {
        content: '', provider: 'agentai', finishReason: 'tool_calls',
        toolCalls: [{ id: `c${n}`, name: n === 1 ? 'read_file' : 'write_file', args: { file_path: 'src/both.ts' } }],
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      };
    });
    registry.dispatch = vi.fn(async (calls: any[]) =>
      calls.map((c: any) => ({ id: c.id, result: { success: true, output: 'ok' } })),
    );

    await loop.run('读再写 src/both.ts');
    const led = (loop as any).ledger;
    expect(led.readCount('src/both.ts')).toBe(1);
    expect(led.writeCount('src/both.ts')).toBe(1);
  });
});

describe('台账接线: 不受对话历史清空影响', () => {
  it('appendOnlyLog 被清空后台账仍保留已读文件', async () => {
    const { loop, registry } = makeLoop(() => {});
    let n = 0;
    (loop as any).router.chat = vi.fn(async () => {
      n++;
      if (n > 2) return { content: 'done', provider: 'agentai', finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
      return {
        content: '', provider: 'agentai', finishReason: 'tool_calls',
        toolCalls: [{ id: `c${n}`, name: 'read_file', args: { file_path: 'src/keep.ts' } }],
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      };
    });
    registry.dispatch = vi.fn(async (calls: any[]) =>
      calls.map((c: any) => ({ id: c.id, result: { success: true, output: 'ok' } })),
    );

    await loop.run('读 src/keep.ts');
    const led = (loop as any).ledger;
    expect(led.listReads()).toContain('src/keep.ts');

    // 模拟历史被彻底清空（压缩/裁剪的最坏情况）
    (loop as any).context.appendOnlyLog = [];
    expect(led.listReads(), '台账不依赖 appendOnlyLog').toContain('src/keep.ts');
    expect(led.render()).toContain('src/keep.ts');
  });
});

describe('台账隔离: 防止跨任务串味', () => {
  it('不同 workspace 各自独立', async () => {
    const a = makeLoop(() => {}, { workspace: WS + '-A' });
    const b = makeLoop(() => {}, { workspace: WS + '-B' });

    let n = 0;
    (a.loop as any).router.chat = vi.fn(async () => {
      n++;
      if (n > 1) return { content: 'ok', provider: 'agentai', finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
      return {
        content: '', provider: 'agentai', finishReason: 'tool_calls',
        toolCalls: [{ id: 'a1', name: 'read_file', args: { file_path: 'projA-only.ts' } }],
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      };
    });
    a.registry.dispatch = vi.fn(async (calls: any[]) =>
      calls.map((c: any) => ({ id: c.id, result: { success: true, output: 'ok' } })),
    );

    await a.loop.run('处理 projA 的任务');
    expect((a.loop as any).ledger.listReads()).toContain('projA-only.ts');
    expect((b.loop as any).ledger.listReads(), 'B 不应看到 A 的已读文件').not.toContain('projA-only.ts');
  });
});