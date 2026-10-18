/**
 * deepseek-reasoning.test.ts — DeepSeek V4.1-Flash thinking 模式 400 回归
 * ----------------------------------------------------------------
 * 2026-10-16: 长任务 (多轮工具调用) 必 400 的根因 ——
 *   DeepSeek 官方规矩: 带 tool_calls 的 assistant 消息必须原样回传 reasoning_content。
 *   但主循环存 assistant 消息时只存了 content + tool_calls, 漏存了 reasoning_content
 *   (res.reasoningContent 由 router 取回但没写进 appendOnlyLog) → 下一轮该字段缺失 → 400。
 *   修复: agentai-loop.ts 存消息时带上 reasoning_content; llm-router.ts:1797 的保留段
 *   原样带出, 发给 DeepSeek。
 *
 * 本文件锁这条不变量 (防"有人把修复删回去"), 走源码契约层:
 *   ① agentai-loop.ts 存 assistant 消息时写 reasoning_content
 *   ② llm-router.ts 请求体保留 reasoning_content (工具轮必需)
 *   ③ sanitizeToolMessages 摘 tool_calls 时不丢 reasoning_content (rest 展开)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = (f: string) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf-8');

describe('DeepSeek thinking 模式 reasoning_content 回传 (2026-10-16)', () => {
  it('agentai-loop.ts 存 assistant 消息时写入 reasoning_content', () => {
    const loop = src('agentai-loop.ts');
    // 修复点: assistantMsg.reasoning_content = res.reasoningContent
    expect(loop).toMatch(/assistantMsg\.reasoning_content\s*=\s*\(res as any\)\.reasoningContent/);
  });

  it('llm-router.ts 请求体保留 reasoning_content (有工具轮必需)', () => {
    const router = src('llm-router.ts');
    // 保留段: 消息带 reasoning_content 时原样带入 body
    expect(router).toMatch(/msg\.reasoning_content\s*=\s*\(m as any\)\.reasoning_content/);
  });

  it('sanitizeToolMessages 摘 tool_calls 时用 ...rest 保留其他字段 (含 reasoning_content)', () => {
    const mu = src('message-utils.ts');
    // 关键: 摘除 tool_calls 走解构 rest (保留 reasoning_content 等字段), 而非重造消息对象
    expect(mu).toMatch(/const \{ tool_calls: _dropped, \.\.\.rest \} = m;/);
    expect(mu).toMatch(/result\.push\(rest as ChatMessage\)/);
  });
});

/**
 * 2026-10-16 二次复现（同日·更晚）: "昨天 100+ 轮都正常, 今天突然全挂 400"
 *
 * 上一版修复的漏洞: `if (res.reasoningContent) { assistantMsg.reasoning_content = ... }`
 * 是**条件写入** —— 只要某轮返回的 reasoning_content 是空串/undefined
 * (思考被跳过 / 命中 cache / token 预算耗尽 / 纯工具轮不吐思考),
 * 该条 assistant 消息就带 tool_calls 而**没有** reasoning_content → 下一轮 400。
 *
 * 这是间歇性故障的根源: 100 轮里可能只有 1~2 轮缺字段, 前 100 轮全好,
 * 第 101 轮第一次把那条脏消息带进请求 → 立刻 400 且重试无效 (确定性重放)。
 *
 * 三道防线:
 *   L1 写入端  (agentai-loop.ts) 无条件写入, 缺失时补空串
 *   L2 请求端  (llm-router.ts) 发请求前扫描自愈 —— 唯一能拦住历史脏数据的关卡
 *   L3 删除端  (llm-router.ts) deepseek 永不因"本轮没吐思考"而删该字段
 */
describe('DeepSeek reasoning_content 三道防线 (2026-10-16 二次)', () => {
  it('L1 写入端: 不得用真值判断 (那正是间歇性 400 的根因)', () => {
    const loop = src('agentai-loop.ts');
    // 必须出现显式的 undefined/null 判断, 而不是 `if (res.reasoningContent)`
    expect(loop).toMatch(/reasoningContent\s*!==\s*undefined\s*&&\s*\(res as any\)\.reasoningContent\s*!==\s*null/);
    // 反断言: 旧的脆弱真值判断已被替换, 不应再作为唯一守卫存在
    expect(loop).not.toMatch(/if\s*\(\(res as any\)\.reasoningContent\)\s*\{/);
  });

  it('L1 写入端: 带 tool_calls 但缺思考内容时补空串', () => {
    const loop = src('agentai-loop.ts');
    expect(loop).toMatch(/else if \(res\.toolCalls && res\.toolCalls\.length > 0\)[\s\S]{0,200}reasoning_content\s*=\s*''/);
  });

  it('L2 请求端: 发请求前对 deepseek 做 reasoning_content 自愈扫描', () => {
    const router = src('llm-router.ts');
    expect(router).toMatch(/isDeepSeekModel && Array\.isArray\(bodyObj\.messages\)/);
    // 缺失或 null 都要补(不只是 undefined)
    expect(router).toMatch(/m\.reasoning_content === undefined \|\| m\.reasoning_content === null/);
  });

  it('L2 请求端: 补齐范围是**所有** assistant, 不只是带 tool_calls 的', () => {
    // ⚠️ 这条是 2026-10-16 22:45 的校准结论 (我前两次都猜错了):
    //   官方规则是 thinking 模式下**所有** assistant 消息都要回传 reasoning_content,
    //   纯文本 assistant 一样会触发 400。
    //   第一版只补 `hasToolCalls` 的 → 实测仍 400 (msgs=39 asst=4 tool=2)。
    // 反断言: 不得把补齐条件限定在"必须带 tool_calls"
    const router = src('llm-router.ts');
    expect(router).not.toMatch(/if \(hasToolCalls && m\.reasoning_content === undefined\)/);
    // 补齐后必须紧跟赋值, 说明条件里不含 tool_calls 限制
    expect(router).toMatch(/if \(m\.reasoning_content === undefined \|\| m\.reasoning_content === null\) \{[\s\S]{0,220}m\.reasoning_content = ''/);
  });

  it('400 时输出消息结构快照 (拿证据不再猜)', () => {
    const router = src('llm-router.ts');
    // 只在 400 且错误文本提到 reasoning_content/thinking 时打
    expect(router).toMatch(/r\.status === 400 && \/reasoning_content\|thinking mode\/i\.test\(errText\)/);
    // 必须显示 rc=MISSING/NULL/len= 之一, 这是定位的关键字段
    expect(router).toMatch(/rc: m\?\.reasoning_content === undefined \? 'MISSING'/);
    // 必须打 thinking 模式开关, 判断是不是 thinking 触发的协议要求
    expect(router).toMatch(/thinking 模式: \$\{JSON\.stringify\(bodyObj\.extra_body\)\}/);
  });

  it('启动时检测 dist 陈旧 (防"改了 src 却跑旧产物")', () => {
    const index = src('index.ts');
    expect(index).toMatch(/运行的是\*\*旧编译产物\*\*/);
    expect(index).toMatch(/npm run build/);
  });

  it('build 脚本写入内容哈希戳 (供启动比对)', () => {
    const build = readFileSync(new URL('../scripts/build.mjs', import.meta.url), 'utf-8');
    expect(build).toMatch(/\.build-stamp\.json/);
    // 测试文件不算进哈希(不影响运行时)
    expect(build).toMatch(/!name\.endsWith\('\.test\.ts'\)/);
  });

  it('L2 请求端: 自愈必须有可观测日志 (否则静默带病运行)', () => {
    const router = src('llm-router.ts');
    expect(router).toMatch(/deepseek thinking 自愈: 补齐 \$\{healed\}/);
  });

  it('L3 删除端: deepseek 不因"本轮未吐思考"而删 reasoning_content', () => {
    const router = src('llm-router.ts');
    // 删除条件必须被 isDeepSeekModel 短路保护
    expect(router).toMatch(/if \(!isDeepSeekModel && !this\._hasReasoningSupport\.get\(id\)\) \{\s*\n\s*delete msg\.reasoning_content;/);
  });

  it('三道防线同时存在才有效 (任一被删则测试失败)', () => {
    const loop = src('agentai-loop.ts');
    const router = src('llm-router.ts');
    const hasL1 = /reasoning_content\s*=\s*''/.test(loop);
    const hasL2 = /deepseek thinking 自愈/.test(router);
    const hasL3 = /!isDeepSeekModel && !this\._hasReasoningSupport\.get\(id\)/.test(router);
    expect({ hasL1, hasL2, hasL3 }).toEqual({ hasL1: true, hasL2: true, hasL3: true });
  });
});

/**
 * 行为测试: 用**真实故障形态**的消息数组验证补齐结果。
 *
 * 2026-10-16 22:45 实测复现的日志形态: msgs=39(user=3, asst=4, tool=2)
 * 关键特征: assistant 数量 > 带 tool_calls 的数量 —— 说明**纯文本 assistant
 * 也缺 reasoning_content**。第一版只补 hasToolCalls 的形态就是漏在这里。
 *
 * 这里不引真实 API (不能依赖密钥), 而是把 llm-router 的补齐规则原样复刻,
 * 对真实形态断言补齐结果 —— 保证"下次复发时这条断言依然描述真实情况"。
 */
describe('自愈逻辑行为验证 (真实故障形态)', () => {
  /** 与 llm-router.ts 中 DeepSeek 自愈段完全一致的规则 */
  const heal = (messages: any[]) => {
    let healed = 0, toolCallHealed = 0;
    for (const m of messages) {
      if (m?.role !== 'assistant') continue;
      if (m.reasoning_content === undefined || m.reasoning_content === null) {
        if (Array.isArray(m.tool_calls) && m.tool_calls.length > 0) toolCallHealed++;
        m.reasoning_content = '';
        healed++;
      }
    }
    return { healed, toolCallHealed };
  };

  it('user=3 asst=4 tool=2 形态: 4 条 assistant 全部补齐', () => {
    // 按实测日志构造: user=3 / asst=4 / tool=2, 且 4 条 assistant 里
    // **只有 1 条带 tool_calls** —— 这正是第一版只补 hasToolCalls 时漏网的原因。
    const msgs: any[] = [
      { role: 'system', content: '...' },
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },                       // 纯文本
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_directory', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: '["a"]' },      // tool 1
      { role: 'assistant', content: 'a2' },                       // 纯文本
      { role: 'tool', tool_call_id: 'c2', content: '["b"]' },      // tool 2
      { role: 'user', content: 'q3' },
      { role: 'assistant', content: 'a3' },                       // 纯文本
    ];
    // 先自检数据形态: 必须真的是 user=3 / asst=4 / tool=2
    // (这几条断言是踩坑后加的 —— 我第一版数据数错了却没自检, 白排查一轮)
    expect(msgs.filter(m => m.role === 'user')).toHaveLength(3);
    expect(msgs.filter(m => m.role === 'assistant')).toHaveLength(4);
    expect(msgs.filter(m => m.role === 'tool')).toHaveLength(2);

    const { healed, toolCallHealed } = heal(msgs);
    expect(healed).toBe(4);            // 全部 4 条 assistant 都补
    expect(toolCallHealed).toBe(1);    // 其中只有 1 条带 tool_calls
    // 关键断言: 补齐后每条 assistant 都有该字段
    for (const a of msgs.filter(m => m.role === 'assistant')) {
      expect(a.reasoning_content).toBe('');
    }
  });

  it('已有 reasoning_content 的不被覆盖 (不能把真实思考内容抹成空串)', () => {
    const msgs: any[] = [
      { role: 'assistant', content: 'a', reasoning_content: '这是真实的思考内容' },
      { role: 'assistant', content: 'b' },
    ];
    heal(msgs);
    expect(msgs[0].reasoning_content).toBe('这是真实的思考内容');
    expect(msgs[1].reasoning_content).toBe('');
  });

  it('null 与 undefined 都算缺失', () => {
    const msgs: any[] = [
      { role: 'assistant', content: 'a', reasoning_content: null },
      { role: 'assistant', content: 'b', reasoning_content: undefined },
    ];
    const { healed } = heal(msgs);
    expect(healed).toBe(2);
    expect(msgs[0].reasoning_content).toBe('');
    expect(msgs[1].reasoning_content).toBe('');
  });

  it('非 assistant 消息不受影响 (tool/user/system 不该有这个字段)', () => {
    const msgs: any[] = [
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
      { role: 'tool', tool_call_id: 'c1', content: 'r' },
    ];
    const { healed } = heal(msgs);
    expect(healed).toBe(0);
    for (const m of msgs) expect(m.reasoning_content).toBeUndefined();
  });

  it('tool_calls 本身不被破坏 (摘掉会导致模型重复调用工具)', () => {
    const msgs: any[] = [{
      role: 'assistant', content: null,
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'x', arguments: '{"a":1}' } }],
    }];
    heal(msgs);
    expect(msgs[0].tool_calls).toHaveLength(1);
    expect(msgs[0].tool_calls[0].function.arguments).toBe('{"a":1}');
  });

  it('幂等: 连续自愈两次结果一致 (可安全重复调用)', () => {
    const msgs: any[] = [{ role: 'assistant', content: 'a' }, { role: 'assistant', content: 'b', tool_calls: [{ id: 'c', type: 'function', function: {} }] }];
    expect(heal(msgs).healed).toBe(2);
    expect(heal(msgs).healed).toBe(0);   // 第二次无新增
  });
});
