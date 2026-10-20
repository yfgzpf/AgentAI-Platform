import { describe, it, expect } from 'vitest';
import { sanitizeToolMessages, textHasStatus, isFailedToolOutput } from './message-utils.js';

/**
 * 回归测试: 2026-10-11 真实 400 事故
 * "An assistant message with 'tool_calls' must be followed by tool messages
 *  responding to each 'tool_call_id'. (insufficient tool messages following tool_calls message)"
 *
 * 原实现只降级「孤立 tool 消息」, 不修剪 assistant 侧的 tool_calls,
 * 导致「N 个 tool_calls 只回 M<N 条」的部分配对残留 → 上游 400 且重试确定性复现。
 */
const asst = (calls: string[], content: string | null = null) => ({
  role: 'assistant',
  content,
  tool_calls: calls.map(id => ({ id, type: 'function', function: { name: 'f', arguments: '{}' } })),
}) as any;
const tool = (id: string, content = 'ok') => ({ role: 'tool', tool_call_id: id, name: 'f', content }) as any;

describe('sanitizeToolMessages — tool_calls ↔ tool 逐 id 配对', () => {
  it('部分配对: 2 个 tool_calls 只有 1 条回复 → 修剪为 1 个 id', () => {
    const out = sanitizeToolMessages([asst(['a', 'b']), tool('a')] as any);
    expect(out).toHaveLength(2);
    expect(out[0].role).toBe('assistant');
    expect((out[0] as any).tool_calls.map((tc: any) => tc.id)).toEqual(['a']);
    expect((out[1] as any).tool_call_id).toBe('a');
  });

  it('部分配对 + 后续 user: 仍须修剪, 不能把未配对的 id 留在序列里', () => {
    const out = sanitizeToolMessages([
      { role: 'user', content: 'hi' },
      asst(['a', 'b', 'c']),
      tool('a'), tool('c'),
      { role: 'user', content: 'next' },
    ] as any);
    const a = out.find((m: any) => m.role === 'assistant') as any;
    expect(a.tool_calls.map((tc: any) => tc.id)).toEqual(['a', 'c']);
    for (const id of ['a', 'c']) {
      expect(out.some((m: any) => m.role === 'tool' && m.tool_call_id === id)).toBe(true);
    }
    expect(out.filter((m: any) => m.role === 'tool')).toHaveLength(2);
  });

  it('零配对且无正文 → 整个 assistant(tool_calls) 摘除 (原日志 asst=1/tool=0 的 400 场景)', () => {
    const out = sanitizeToolMessages([{ role: 'user', content: 'hi' }, asst(['a', 'b'])] as any);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe('user');
  });

  it('零配对但有正文 → 摘除 tool_calls, 保留 assistant 文本', () => {
    const out = sanitizeToolMessages([asst(['a'], '我先说明一下')] as any);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe('assistant');
    expect((out[0] as any).tool_calls).toBeUndefined();
    expect(out[0].content).toBe('我先说明一下');
  });

  it('孤立 tool 消息 (无前置 assistant) → 降级为 system, 不改协议', () => {
    const out = sanitizeToolMessages([{ role: 'user', content: 'hi' }, tool('ghost')] as any);
    expect(out).toHaveLength(2);
    expect(out[1].role).toBe('system');
    expect(String(out[1].content)).toContain('tool-result');
  });

  it('完整配对 → 原样保留', () => {
    const input = [asst(['a', 'b']), tool('a'), tool('b')] as any;
    const out = sanitizeToolMessages(input);
    expect(out).toHaveLength(3);
    expect((out[0] as any).tool_calls).toHaveLength(2);
  });

  it('相邻两个 assistant(tool_calls): 前一个缺回复也要被摘除 (旧实现的追踪漏洞)', () => {
    const out = sanitizeToolMessages([asst(['a']), asst(['b']), tool('b')] as any);
    const assts = out.filter((m: any) => m.role === 'assistant');
    expect(assts).toHaveLength(1);
    expect((assts[0] as any).tool_calls.map((tc: any) => tc.id)).toEqual(['b']);
  });
});

/**
 * 协议合法性不变量 —— 直接封死「insufficient tool messages」这一类 400。
 * 违反这条的请求必然被 OpenAI/DeepSeek 拒收, 与具体触发路径无关。
 */
function assertProtocolLegal(messages: any[]) {
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== 'assistant' || !m.tool_calls?.length) continue;
    const ids = m.tool_calls.map((tc: any) => tc.id);
    const following: string[] = [];
    let j = i + 1;
    while (j < messages.length && messages[j].role === 'tool') following.push(messages[j++].tool_call_id);
    for (const id of ids) {
      expect(following, `tool_call ${id} 缺少紧随其后的 tool 回复 → 上游必 400`).toContain(id);
    }
  }
}

describe('sanitizeToolMessages — 协议合法性不变量 (2026-10-11 第二起 400)', () => {
  it('事故形状: 已配对的 assistant A 不得「掩护」零回复的 assistant B (asst=1/tool=0)', () => {
    // 旧 llm-router 手写块: 新 assistant 到达时只重置 pendingToolIds, 未清 matchedSet,
    // 于是 A 的配对记录让 B 被误判为"已配对"而留下 → 一条 tool_calls 零回复 → 400
    const out = sanitizeToolMessages([
      { role: 'user', content: 'hi' },
      asst(['a']), tool('a'),
      asst(['b']),
      { role: 'user', content: 'next' },
    ] as any);
    assertProtocolLegal(out);
    // B 无正文 → 整条摘除; A 的完整配对保留
    const assts = out.filter((m: any) => m.role === 'assistant');
    expect(assts).toHaveLength(1);
    expect((assts[0] as any).tool_calls.map((tc: any) => tc.id)).toEqual(['a']);
    expect(out.filter((m: any) => m.role === 'tool')).toHaveLength(1);
  });

  it('事故形状变体: B 有正文时保留文本但摘除 tool_calls', () => {
    const out = sanitizeToolMessages([
      asst(['a']), tool('a'),
      asst(['b'], '我继续说明'),
      { role: 'user', content: 'next' },
    ] as any);
    assertProtocolLegal(out);
    const b = out.find((m: any) => m.role === 'assistant' && m.content === '我继续说明') as any;
    expect(b).toBeTruthy();
    expect(b.tool_calls).toBeUndefined();
  });

  it('不变量: 多种残破输入下, 输出一律不含「无回复的 tool_calls」', () => {
    const shapes: any[][] = [
      [{ role: 'user', content: 'u' }, asst(['a']), { role: 'user', content: 'u2' }],
      [asst(['a', 'b']), tool('a'), tool('a'), { role: 'system', content: 's' }, tool('b')],
      [{ role: 'user', content: 'u' }, tool('ghost'), asst(['z'])],
      [asst(['a']), asst(['b']), asst(['c']), tool('c')],
      [{ role: 'tool', tool_call_id: 'x', content: 'r' }, { role: 'user', content: 'u' }],
    ];
    for (const s of shapes) assertProtocolLegal(sanitizeToolMessages(s as any));
  });
});

/**
 * 2026-10-20 真实事故 (用户实机日志):
 * tool:result 双发让同一 tool_call_id 出现两条 tool 回复, deepseek 对重复回复
 * 确定性 400 "Messages with role 'tool' must be a response to a preceding
 * message with 'tool_calls'" (curl 实测复刻), 且 3 次 attempt 原样重放全挂。
 */
describe('sanitizeToolMessages — 重复 tool_call_id 去重', () => {
  it('同一 id 两条 tool 回复 → 只保留第一条 (deepseek 实测: 重复即 400)', () => {
    const out = sanitizeToolMessages([asst(['a']), tool('a', 'first'), tool('a', 'second')] as any);
    const tools = out.filter((m: any) => m.role === 'tool');
    expect(tools).toHaveLength(1);
    expect(tools[0].content).toBe('first');
  });

  it('不同 id 各一条 → 全部保留 (去重不误伤正常配对)', () => {
    const out = sanitizeToolMessages([asst(['a', 'b']), tool('a'), tool('b')] as any);
    expect(out.filter((m: any) => m.role === 'tool')).toHaveLength(2);
  });

  it('重复 id 不得把第二条降级成 system (双发产物丢弃, 不注入噪音)', () => {
    const out = sanitizeToolMessages([asst(['a']), tool('a'), tool('a')] as any);
    expect(out.filter((m: any) => m.role === 'system')).toHaveLength(0);
    expect(out.filter((m: any) => m.role === 'tool')).toHaveLength(1);
  });

  it('不变量: 任何输入下, 同一 tool_call_id 在输出中至多出现一次', () => {
    const shapes: any[][] = [
      [asst(['a']), tool('a'), tool('a'), tool('a')],
      [asst(['a', 'b']), tool('a'), tool('b'), tool('a'), tool('b')],
      [asst(['a']), tool('a'), asst(['b']), tool('b'), tool('b')],
    ];
    for (const s of shapes) {
      const out = sanitizeToolMessages(s as any);
      const ids = out.filter((m: any) => m.role === 'tool').map((m: any) => m.tool_call_id);
      expect(new Set(ids).size, `重复 id 残留: ${ids.join(',')}`).toBe(ids.length);
      assertProtocolLegal(out);
    }
  });
});

/**
 * 2026-10-20 实锤: llm-router 的 _isAccountError 用裸 /402|401/ 判账号级失败,
 * deepseek 一次普通 400 (重复 tool_call_id) 的 request_id
 * "49ffb34a-34ca-40d2-a25a-77c53401727f" 恰好含 "401" 子串
 * → 误判账号级 → 跳过救援链 → 任务直接收尾。
 * textHasStatus 要求状态码带 HTTP/code 锚点, 封死这类误报。
 */
describe('textHasStatus — 状态码锚定判定', () => {
  it('事故样本: request_id 含 401 子串的普通 400 不得判账号级', () => {
    const real = 'HTTP 400: {"error":{"message":"Messages with role \'tool\' must be a response to a preceding message with \'tool_calls\' (request_id: 49ffb34a-34ca-40d2-a25a-77c53401727f)","type":"invalid_request_error","param":null,"code":"invalid_request_error"}}';
    expect(textHasStatus(real, 401, 402)).toBe(false);
  });

  it('事故样本变体: 其他含 401/402 子串的 UUID 也不得命中', () => {
    expect(textHasStatus('HTTP 400: bad (request_id: 1406e7aa-9fc1-4694-8c6d-9a11f76f3fa3)', 401, 402)).toBe(false);
    expect(textHasStatus('HTTP 400: job 9c2f4018ab3 timeout report', 401, 402)).toBe(false);
  });

  it('真账号级: HTTP 前缀 / "code" 字段形态必须命中', () => {
    expect(textHasStatus('HTTP 401: {"error":{"message":"Incorrect API key provided"}}', 401, 402)).toBe(true);
    expect(textHasStatus('HTTP 402: {"error":{"message":"Insufficient Balance"}}', 401, 402)).toBe(true);
    expect(textHasStatus('upstream returned {"code":402}', 401, 402)).toBe(true);
    expect(textHasStatus('HTTP/1.1 429 Too Many Requests', 429, 503)).toBe(true);
    expect(textHasStatus('status: 503 service unavailable', 429, 503)).toBe(true);
  });

  it('端口号/UUID 里的裸数字不得命中', () => {
    expect(textHasStatus('fetch failed http://127.0.0.1:4010/api', 401)).toBe(false);
    expect(textHasStatus('job 8f3a4291bc done', 429)).toBe(false);
    expect(textHasStatus('', 429)).toBe(false);
    expect(textHasStatus(null, 429)).toBe(false);
  });
});

/**
 * isFailedToolOutput — 工具结果失败判据唯一来源 (2026-10-20 D1)
 * =====================================================================
 * 事故 (富哥实锤): scope/hook/用户拒绝的输出是 "[SCOPE REJECTED]" 等前缀,
 *   不带 success 字段 → 原判据 (只看 Error:/[ERROR] 前缀) 全漏判 → 拒绝被
 *   当成功: 污染 _toolCallHistory (grant_scope 授权后重发被跨轮去重静默
 *   跳过) + 前端 ok:true 显示 ✅ + 失败计数被清零。
 */
describe('isFailedToolOutput (2026-10-20 D1)', () => {
  it('三类拒绝必须判失败 (scope/hook/用户/超时闸门)', () => {
    expect(isFailedToolOutput('[SCOPE REJECTED] wsl_scan 的目标 10.0.0.5 不在授权范围内。请先用 grant_scope({target}) 发起授权提案。')).toBe(true);
    expect(isFailedToolOutput('[BLOCKED BY HOOK] This tool call was blocked by lifecycle hooks system')).toBe(true);
    expect(isFailedToolOutput('[用户拒绝] 规划模式下文件操作未获批准')).toBe(true);
    expect(isFailedToolOutput('[ERROR] 用户拒绝了此操作 (delete_file: a.txt)')).toBe(true);
    expect(isFailedToolOutput('[ERROR] [TIMEOUT GATE] 同一条命令之前已因执行超时被强杀, 本次原样重试已被拦截, 未实际执行。')).toBe(true);
  });

  it('拒绝类即使 (异常地) 带上 success:true 也要判失败 — 拒绝语义压过 success 字段', () => {
    // 防御: 万一未来有人给 rejectedResults 补 success:true, 前缀判据仍然兜底
    expect(isFailedToolOutput('[SCOPE REJECTED] 目标不在授权范围', true)).toBe(true);
    expect(isFailedToolOutput('[用户拒绝] 未获批准', true)).toBe(true);
  });

  it('真失败形态保持判失败 (回归: 原判据行为不丢)', () => {
    expect(isFailedToolOutput('Error: exit code 1')).toBe(true);
    expect(isFailedToolOutput('[ERROR] 工具批量执行失败 (执行器异常): boom')).toBe(true);
    expect(isFailedToolOutput('', false)).toBe(true);
    expect(isFailedToolOutput(undefined)).toBe(true);
    expect(isFailedToolOutput('anything', false)).toBe(true);   // success:false 一票否决
    expect(isFailedToolOutput('err')).toBe(true);               // 短输出 + err 字样
  });

  it('成功形态不得误判 (退出码非 0 但 stdout 有内容的扫描工具, 2026-10-20 上一轮已修)', () => {
    expect(isFailedToolOutput('(no matches)')).toBe(false);
    expect(isFailedToolOutput('Starting scan against 10.0.0.1\n[INFO] 200 OK /admin\nnmap done: 1 IP address scanned')).toBe(false);
    expect(isFailedToolOutput('[已在主循环处理] 子智能体请求已受理, 结果见后续子智能体事件。')).toBe(false);
    expect(isFailedToolOutput('HTTP/1.1 403 Forbidden', true)).toBe(false); // http_replay 拿到响应即成功
  });

  it('[SKIPPED] 不归本判据管 (去重跳过是另一条管道, 有专属 tool 消息)', () => {
    // 仅记录语义边界, 防后人误把 SKIPPED 加进拒绝前缀
    expect(isFailedToolOutput('[SKIPPED] 工具 read_file 的这次调用与历史调用完全相同, 已跳过以避免重复执行。')).toBe(false);
  });
});
