/**
 * 子智能体模型继承 + 已下线 agnes-2.0 清理 — 回归测试 (2026-10-12)
 * ==========================================================================
 * 用户诉求: ① agnes-2.0 / agnes-2.0-flash 官方已下架 (实测 HTTP 503), 全链路清除;
 *           ② 强模型调子智能体必须用**父模型自身** (provider + 精确子模型名), 只在断连时降级;
 *           ③ 降级也要用**正确的 agnes-2.5-flash**, 不是死掉的 2.0。
 *
 * 修的 4 个叠加缺陷:
 *   A  MODEL_MAP['agnes-2.0'] 在 BUILTIN_IDS 内 → 前端 modelConfig 覆盖不了它 → 死名直达上游
 *   B  两张别名表都没有 agnes 键 → 老客户端/老持久化的死名无人拦
 *   C  routes/chat.ts 把 selected.subModel 灌进 opts.modelName → 内联子智能体原样继承死名
 *   D  subagent.ts 恒把 modelName 设成 '' + 5 个调用点一个都没传父模型 → 子智能体静默跑免费默认档
 *
 * ⚠️ 诚实边界 (必须保留本段, 别把测试当端到端证明):
 *   本文件有两层 ——
 *   ① 行为层: 用**打桩的 AgentAILoop** 断言"子 loop 最终拿到的 model/modelName 是什么"。
 *      这验证的是**继承决策逻辑**, 不是"上游真的返回了正确模型"。无真实上游凭据时,
 *      "子智能体确实跑在父模型上"无法自动化验证, 只能靠此处的参数级证明 + 线上实测。
 *   ② 契约层: 断言源码结构 (签名/注入点/别名表)。它只能防"有人把修复删回去",
 *      不能证明运行时行为 —— 行为层的 4 条断言才是真正的证明。
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveRetiredModelAlias } from './llm-router.js';
import { runSubagent } from './subagent.js';

// ===== 打桩 AgentAILoop: 捕获子智能体 loop 实际收到的 opts =====
// 用 vi.hoisted 是因为 vi.mock 工厂会被提升到 import 之前, 不能引用普通模块级变量。
const h = vi.hoisted(() => ({ captured: [] as any[] }));

vi.mock('./agentai-loop.js', () => ({
  AgentAILoop: class {
    constructor(_router: any, _registry: any, _tools: any, opts: any) {
      h.captured.push(opts);
    }
    async run() {
      return { content: 'stub-subagent-output' };
    }
  },
}));

/** 只实现 runSubagent 会用到的最小接口 (list + register) */
const fakeRegistry = { list: () => [], register: () => {} } as any;
/** providers 为空 Map → 不会触发熔断降级分支 */
const quietRouter = { providers: new Map() } as any;

function callRun(...args: any[]) {
  h.captured.length = 0;
  return runSubagent(...(args as [any, any, any, any, string, string, any?, any?]));
}

// ==========================================================================
// 行为层 — 子智能体到底继承了谁
// ==========================================================================
describe('行为: 子智能体继承父模型 (provider + 精确子模型名)', () => {
  it('强模型 (deepseek) 调子智能体 → 子 loop 拿到父 provider + 父精确模型名', async () => {
    await callRun('explore', 'task', quietRouter, fakeRegistry, 'u1', '/ws', 'deepseek', 'deepseek-flash');
    expect(h.captured).toHaveLength(1);
    expect(h.captured[0].model).toBe('deepseek');
    // 关键断言: 这是本批次的核心。修复前这里恒为 '' → 子智能体退化成 provider 默认模型。
    expect(h.captured[0].modelName).toBe('deepseek-flash');
  });

  it('强模型 (openai/gpt-4o) 同理 — 不再被降级到免费档', async () => {
    await callRun('review', 'task', quietRouter, fakeRegistry, 'u1', '/ws', 'openai', 'gpt-4o');
    expect(h.captured[0].model).toBe('openai');
    expect(h.captured[0].modelName).toBe('gpt-4o');
  });

  it('未传父模型 → 保持历史兜底 (agentai + 空模型名, 由 env 解析)', async () => {
    await callRun('explore', 'task', quietRouter, fakeRegistry, 'u1', '/ws');
    expect(h.captured[0].model).toBe('agentai');
    expect(h.captured[0].modelName).toBe('');
  });

  it('父模型熔断降级 → 换 provider 时清空父模型名 (不把异 provider 的名字传给上游)', async () => {
    // deepseek 熔断, agentai 可用且环境有 key
    const router = {
      providers: new Map([
        ['deepseek', { tripped: true }],
        ['agentai', { tripped: false }],
      ]),
    } as any;
    const saved = process.env.AGENTAI_API_KEY;
    process.env.AGENTAI_API_KEY = 'dummy-for-test';
    try {
      await callRun('explore', 'task', router, fakeRegistry, 'u1', '/ws', 'deepseek', 'deepseek-v4-pro');
      expect(h.captured[0].model).toBe('agentai');
      // 父模型名 'deepseek-v4-pro' 对 agentai 无意义, 必须清空走 env/默认解析
      expect(h.captured[0].modelName).toBe('');
    } finally {
      if (saved === undefined) delete process.env.AGENTAI_API_KEY;
      else process.env.AGENTAI_API_KEY = saved;
    }
  });

  it('sensenova 未传精确名 → 保留历史专用兜底 (行为兼容, 不回归)', async () => {
    await callRun('explore', 'task', quietRouter, fakeRegistry, 'u1', '/ws', 'sensenova');
    expect(h.captured[0].model).toBe('sensenova');
    expect(h.captured[0].modelName).toBe('sensenova-6.7-flash-lite');
  });

  it('未知子智能体类型 → 直接返回, 不构造 loop', async () => {
    await callRun('no-such-type', 'task', quietRouter, fakeRegistry, 'u1', '/ws', 'deepseek', 'deepseek-flash');
    expect(h.captured).toHaveLength(0);
  });
});

// ==========================================================================
// 行为层 — 已下线模型名别名解析
// ==========================================================================
describe('行为: resolveRetiredModelAlias 兜住已下架的 agnes-2.0', () => {
  it('provider 作用域两端 (agentai / agnes) 都解析到活的 2.5-flash', () => {
    // 'agentai' 是 MODEL_MAP 用的 id, 'agnes' 是 model-selector 用的 id
    expect(resolveRetiredModelAlias('agentai', 'agnes-2.0')).toBe('agnes-2.5-flash');
    expect(resolveRetiredModelAlias('agentai', 'agnes-2.0-flash')).toBe('agnes-2.5-flash');
    expect(resolveRetiredModelAlias('agnes', 'agnes-2.0')).toBe('agnes-2.5-flash');
    expect(resolveRetiredModelAlias('agnes', 'agnes-2.0-flash')).toBe('agnes-2.5-flash');
  });

  it('活模型名原样返回 (别名表不得误伤)', () => {
    expect(resolveRetiredModelAlias('agentai', 'agnes-2.5-flash')).toBe('agnes-2.5-flash');
    expect(resolveRetiredModelAlias('agnes', 'agnes-3.0-flash')).toBe('agnes-3.0-flash');
  });

  it('未知 provider 不套用 agnes 规则 (作用域隔离)', () => {
    expect(resolveRetiredModelAlias('openai', 'agnes-2.0')).toBe('agnes-2.0');
  });

  it('deepseek 系的旧别名仍然有效 (本批次未破坏既有行为)', () => {
    expect(resolveRetiredModelAlias('deepseek', 'deepseek-v4-pro')).toBe('deepseek-flash');
    expect(resolveRetiredModelAlias('deepseek', 'deepseek-v4-flash')).toBe('deepseek-flash');
  });
});

// ==========================================================================
// 契约层 — 防"修复被删回去"
// ==========================================================================
const src = (f: string) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf-8');

describe('契约: 子智能体继承链的 4 个注入点都在', () => {
  it('ToolContext 有 modelName?: 字段, 且注释说明它 ≠ provider 名', () => {
    const t = src('tool-registry.ts');
    expect(t).toMatch(/modelName\?:\s*string;/);
    expect(t).toContain('这是 provider, 不是模型名');
  });

  it('agentai-loop dispatchToolCalls 把 this.opts.modelName 注入 ctx', () => {
    expect(src('agentai-loop.ts')).toContain('modelName: this.opts.modelName,');
  });

  it('runSubagent 有 parentModelName 形参, 且 modelName 用的是 subModelName 而非恒空串', () => {
    const s = src('subagent.ts');
    expect(s).toMatch(/parentModelName\?:\s*string,/);
    expect(s).toContain("let subModelName = parentModelName || '';");
    expect(s).toMatch(/modelName:\s*subModelName \|\|/);
    // 反例守卫: 修复前那行是 `modelName: subModel === parentModel ? (...)` —— 恒 ''
    expect(s).not.toMatch(/modelName:\s*subModel === parentModel \?/);
  });

  it('熔断降级分支会清空 subModelName', () => {
      expect(src('subagent.ts')).toContain("subModelName = '';");
  });

  it('内联 spawn (强模型主路径) 仍然继承 this.opts 的 provider + 精确模型名', () => {
    const l = src('agentai-loop.ts');
    expect(l).toContain('let subModel = this.opts.model;');
    expect(l).toContain('let subModelName = this.opts.modelName;');
  });

  it('tools.ts 的 6 个 spawn 调用点都传了 ctx?.modelName (battle/spawn_subagent/3×review/run_team)', () => {
    // 数量即契约: 少一个就说明新加的路径又漏传父模型
    expect((src('tools.ts').match(/ctx\?\.modelName/g) || []).length).toBe(6);
    expect(src('tools.ts')).not.toMatch(/ctx\?\.model,\s*\)/); // 反例: 只传 model 不传 modelName
  });

  it('team-orchestrator 全链路串了 parentModelName (runTeam→parallel/sequential/review→member)', () => {
    const t = src('team-orchestrator.ts');
    // 5 处签名 + 转发
    expect((t.match(/parentModelName\?:\s*string,/g) || []).length).toBe(5);
    const call = t.slice(t.indexOf('const output = await runSubagent('));
    expect(call.slice(0, 300)).toContain('parentModelName,');
  });
});

describe('契约: 已下架的 agnes-2.0 不再从任何路径抵达上游', () => {
  it('routes/chat.ts 的两张 MODEL_MAP 都把 agnes-2.0 别名指向活的 2.5-flash', () => {
    const lines = src('routes/chat.ts').split('\n').filter(l => /'agnes-2\.0':\s*\{/.test(l));
    expect(lines).toHaveLength(2); // MODEL_MAP + nss_MODEL_MAP
    for (const l of lines) expect(l).toContain("'agnes-2.5-flash'");
  });

  it('没有任何 subModel 被赋成死名', () => {
    for (const f of ['routes/chat.ts', 'model-selector.ts', 'llm-router.ts', 'model-classifier.ts', 'model-capabilities.ts']) {
      expect(src(f), `${f} 不应把 subModel 指向已下架的 agnes-2.0`).not.toMatch(/subModel:\s*'agnes-2\.0/);
    }
  });

  it('硬编码模型名的 5 个热点文件已全部换成 2.5-flash', () => {
    for (const f of ['tools.ts', 'agentai-loop.ts', 'smart-model-switcher.ts', 'subagent.ts', 'run-vision-test.ts']) {
      expect(src(f), `${f} 不应再出现已下架的 agnes-2.0-flash 字面量`).not.toContain("'agnes-2.0-flash'");
    }
  });

  it('RETIRED_MODEL_ALIASES 含 4 个 agnes 键 (provider 作用域双写)', () => {
    const r = src('llm-router.ts');
    for (const k of ['agentai:agnes-2.0', 'agentai:agnes-2.0-flash', 'agnes:agnes-2.0', 'agnes:agnes-2.0-flash']) {
      expect(r).toContain(`'${k}': 'agnes-2.5-flash'`);
    }
  });

  it('LEGACY_MODEL_ALIASES (上下文窗口表) 同步兜底, 旧名不再落回 256K', () => {
    const c = src('model-capabilities.ts');
    expect(c).toContain("'agnes-2.0': 'agnes-2.5-flash'");
    expect(c).toContain("'agnes-2.0-flash': 'agnes-2.5-flash'");
  });

  it('死名残留在白名单/分组别名里是**刻意的** (移除会让旧 modelName 误判为付费档 → 放行子智能体)', () => {
    const r = src('llm-router.ts');
    expect(r).toContain("'agnes-2.0', 'deepseek-flash'"); // FREE_PROVIDERS
    expect(r).toContain("'agnes-2.0':       'agnes'");    // vendor 分组别名
  });
});

describe('契约: agnes-2.0-flash 已从模型注册表移除', () => {
  it('model-classifier.ts 没有 agnes-2.0-flash 条目, 只有 2.5-flash (512K)', () => {
    const c = src('model-classifier.ts');
    expect(c).not.toMatch(/id:\s*'agentai:agnes-2\.0-flash'/);
    expect(c).toContain("id: 'agentai:agnes-2.5-flash'");
    expect(c).toMatch(/subModel: 'agnes-2\.5-flash',[\s\S]{0,400}?maxContext: 512_000,/);
  });
});
