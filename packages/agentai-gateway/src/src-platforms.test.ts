/**
 * src-platforms.test.ts — SRC 平台档案 + deny 硬闸门 回归锁
 * ============================================================================
 * 2026-10-16 富哥实机反馈: "同时授权多个SRC, 不能正确对应属于哪家 → 浪费"
 *
 * 本文件锁三层不变量:
 *   ① deny 硬闸门: 平台禁止项必须让 isTargetInScope 返回 false,
 *      且**优先于**授权通配 (授权 *.a.com 但禁止 sub.a.com → 必须拦住)
 *   ② 归属反查: 每个 host 能唯一/就近映射到平台 (report_vulnerability 自动填 platform)
 *   ③ AI 投喂: renderPlatformsForAi 必须含平台分组 + 禁止项 + "不要再问"
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  readSrcPlatforms, writeSrcPlatforms, upsertPlatform, confirmPlatform, removePlatform,
  platformFromParsed, findPlatformForTarget, isDeniedByAnyPlatform, groupHostsByPlatform,
  hostMatches, slugifyPlatform, renderPlatformsForAi, srcPlatformsPath,
} from './src-platforms.js';
import { isTargetInScope, writeScopeWithSource } from './pentest-scope-guard.js';

let WS = '';

beforeEach(() => {
  WS = fs.mkdtempSync(path.join(os.tmpdir(), 'srcplat-'));
  fs.mkdirSync(path.join(WS, '.agentai'), { recursive: true });
});

afterEach(() => {
  try { fs.rmSync(WS, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('① deny 硬闸门 (安全底线)', () => {
  it('平台 deny 的目标即使在授权通配里也必须被拦', () => {
    // 授权 *.bestpay.cn 全通配, 但平台明确写 "oms.bestpay.cn 不在范围"
    // 这是 SRC 页面最常见的形态 —— 只靠 prompt 约束必然被 AI 打进去
    writeScopeWithSource(WS, [
      { host: '*.bestpay.cn', source: 'vala' },
      { host: 'api.bestpay.cn', source: 'vala' },
    ]);
    upsertPlatform(WS, platformFromParsed({
      name: '漏洞盒子·vala', baseUrl: 'https://valasrc.vulbox.com/home',
      inScope: ['*.bestpay.cn', 'api.bestpay.cn'],
      outOfScope: ['oms.bestpay.cn'],
      forbiddenActions: [], rewards: [], confirmed: true,
    }));

    expect(isTargetInScope(WS, 'api.bestpay.cn')).toBe(true);       // 授权内 → 放行
    expect(isTargetInScope(WS, 'oms.bestpay.cn')).toBe(false);      // 禁止 → 拦截
    expect(isTargetInScope(WS, 'www.bestpay.cn')).toBe(true);       // 其他子域不受影响
  });

  it('deny 支持通配形态, 且不误伤同后缀域名', () => {
    writeScopeWithSource(WS, [{ host: '*.a.com', source: 'x' }]);
    upsertPlatform(WS, platformFromParsed({
      name: 'x', inScope: ['*.a.com'], outOfScope: ['*.admin.a.com'],
      forbiddenActions: [], rewards: [], confirmed: true,
    }));
    expect(isTargetInScope(WS, 'db.admin.a.com')).toBe(false);      // 通配禁止 → 拦
    expect(isTargetInScope(WS, 'www.a.com')).toBe(true);
    expect(isTargetInScope(WS, 'evil-a.com')).toBe(false);          // 后缀绕过
    expect(isTargetInScope(WS, 'notadmin.a.com')).toBe(true);       // 不能过度拦截
  });

  it('isDeniedByAnyPlatform 返回命中的平台 id 与pattern (便于告知用户原因)', () => {
    upsertPlatform(WS, platformFromParsed({
      id: 'vulbox-vala', name: 'vulbox', inScope: ['*.bestpay.cn'],
      outOfScope: ['oms.bestpay.cn'], forbiddenActions: [], rewards: [], confirmed: true,
    }));
    const r = isDeniedByAnyPlatform(WS, 'oms.bestpay.cn');
    expect(r).toEqual({ denied: true, platformId: 'vulbox-vala', pattern: 'oms.bestpay.cn' });
    expect(isDeniedByAnyPlatform(WS, 'www.bestpay.cn').denied).toBe(false);
  });

  it('loopback 仍免授权 (本地调试不受 deny 规则影响)', () => {
    expect(isTargetInScope(WS, '127.0.0.1')).toBe(true);
    expect(isTargetInScope(WS, 'localhost')).toBe(true);
  });

  it('无平台档案时行为不变 (回归: 不影响既有授权流程)', () => {
    writeScopeWithSource(WS, [{ host: 'example.com', source: 'manual' }]);
    expect(isTargetInScope(WS, 'example.com')).toBe(true);
    expect(isTargetInScope(WS, 'evil.com')).toBe(false);
  });
});

describe('② 归属反查 (多SRC 不浪费的核心)', () => {
  beforeEach(() => {
    upsertPlatform(WS, platformFromParsed({
      id: 'vulbox-vala', name: '漏洞盒子·vala',
      inScope: ['*.bestpay.com.cn'], outOfScope: [], forbiddenActions: [], rewards: [], confirmed: true,
    }));
    upsertPlatform(WS, platformFromParsed({
      id: 'butian', name: '补天',
      inScope: ['*.tycredit.com'], outOfScope: [], forbiddenActions: [], rewards: [], confirmed: true,
    }));
  });

  it('host 能反查到归属平台 (report_vulnerability 自动填 platform 的依据)', () => {
    expect(findPlatformForTarget(WS, 'api.bestpay.com.cn')?.id).toBe('vulbox-vala');
    expect(findPlatformForTarget(WS, 'www.tycredit.com')?.id).toBe('butian');
    expect(findPlatformForTarget(WS, 'unknown.org')).toBeNull();
  });

  it('多个平台都覆盖时取最具体的那个 (最长 pattern)', () => {
    upsertPlatform(WS, platformFromParsed({
      id: 'broad', name: 'broad', inScope: ['*.example.com'],
      outOfScope: [], forbiddenActions: [], rewards: [], confirmed: true,
    }));
    upsertPlatform(WS, platformFromParsed({
      id: 'narrow', name: 'narrow', inScope: ['*.api.example.com'],
      outOfScope: [], forbiddenActions: [], rewards: [], confirmed: true,
    }));
    expect(findPlatformForTarget(WS, 'v1.api.example.com')?.id).toBe('narrow');
  });

  it('未确认的平台不参与归属 (确认前不得据此开扫)', () => {
    upsertPlatform(WS, platformFromParsed({
      id: 'pending-plat', name: '待确认', inScope: ['*.pending.com'],
      outOfScope: [], forbiddenActions: [], rewards: [], confirmed: false,
    }));
    expect(findPlatformForTarget(WS, 'www.pending.com')).toBeNull();
    confirmPlatform(WS, 'pending-plat');
    expect(findPlatformForTarget(WS, 'www.pending.com')?.id).toBe('pending-plat');
  });

  it('groupHostsByPlatform 按平台分组 (batch_pentest 投喂用)', () => {
    const g = groupHostsByPlatform(WS);
    expect(g.length).toBe(2);
    expect(g.map(x => x.platform.id).sort()).toEqual(['butian', 'vulbox-vala']);
  });

  it('slugifyPlatform 从 URL 取稳定 id', () => {
    expect(slugifyPlatform('https://valasrc.vulbox.com/home')).toBe('valasrc.vulbox.com');
    expect(slugifyPlatform('漏洞盒子 vala')).toBe('vala');
  });
});

describe('③ 平台档案 CRUD 与合并语义', () => {
  it('同 id 重复导入是合并而非替换 (用户分多次粘贴同一平台页面)', () => {
    upsertPlatform(WS, platformFromParsed({
      id: 'p1', name: '平台一', inScope: ['a.com'], outOfScope: ['bad.com'],
      forbiddenActions: ['DoS'], rewards: [], confirmed: true,
    }));
    upsertPlatform(WS, platformFromParsed({
      id: 'p1', name: '平台一', inScope: ['b.com'], outOfScope: ['worse.com'],
      forbiddenActions: ['社会工程'], rewards: [], confirmed: false,
    }));
    const p = readSrcPlatforms(WS).find(x => x.id === 'p1')!;
    expect(p.hosts).toEqual(['a.com', 'b.com']);       // 合并
    expect(p.deny).toEqual(['bad.com', 'worse.com']);   // 合并
    expect(p.forbiddenActions).toEqual(['DoS', '社会工程']);
    expect(p.confirmed).toBe(true);                     // 已确认不被新导入降级
  });

  it('合并时自动清理 hosts 里与 deny 冲突的目标', () => {
    upsertPlatform(WS, platformFromParsed({
      id: 'p2', name: 'p2', inScope: ['*.x.com'], outOfScope: ['admin.x.com'],
      forbiddenActions: [], rewards: [], confirmed: true,
    }));
    const p = readSrcPlatforms(WS).find(x => x.id === 'p2')!;
    expect(p.hosts).not.toContain('admin.x.com');
  });

  it('removePlatform 只删指定平台', () => {
    upsertPlatform(WS, platformFromParsed({ id: 'a', name: 'a', inScope: ['a.com'], outOfScope: [], forbiddenActions: [], rewards: [], confirmed: true }));
    upsertPlatform(WS, platformFromParsed({ id: 'b', name: 'b', inScope: ['b.com'], outOfScope: [], forbiddenActions: [], rewards: [], confirmed: true }));
    expect(removePlatform(WS, 'a')).toBe(true);
    expect(readSrcPlatforms(WS).map(p => p.id)).toEqual(['b']);
    expect(removePlatform(WS, 'nope')).toBe(false);
  });

  it('落盘位置正确且能被读回 (含中文路径)', () => {
    upsertPlatform(WS, platformFromParsed({ id: 'cn', name: '中文平台', inScope: ['a.cn'], outOfScope: [], forbiddenActions: [], rewards: [], confirmed: true }));
    expect(fs.existsSync(srcPlatformsPath(WS))).toBe(true);
    expect(readSrcPlatforms(WS)[0]!.name).toBe('中文平台');
  });

  it('损坏的 JSON 不导致崩溃 (退化为空列表)', () => {
    fs.writeFileSync(srcPlatformsPath(WS), '{ this is not json', 'utf8');
    expect(readSrcPlatforms(WS)).toEqual([]);
  });

  it('版本号不匹配时拒绝读取 (避免结构变更后误读)', () => {
    fs.writeFileSync(srcPlatformsPath(WS), JSON.stringify({ version: 99, platforms: [{ id: 'x', hosts: ['a.com'] }] }), 'utf8');
    expect(readSrcPlatforms(WS)).toEqual([]);
  });
});

describe('④ AI 投喂 (消除反复追问的关键)', () => {
  it('摘要含平台分组 + id + 禁止项 + 不要再问', () => {
    upsertPlatform(WS, platformFromParsed({
      id: 'vulbox-vala', name: '漏洞盒子·vala',
      inScope: ['*.bestpay.cn'], outOfScope: ['oms.bestpay.cn'],
      forbiddenActions: ['DoS 攻击'], rewards: ['高危 5000元'], confirmed: true,
    }));
    const s = renderPlatformsForAi(WS);
    expect(s).toContain('漏洞盒子·vala');
    expect(s).toContain('platform id: vulbox-vala');   // AI 要靠 id 填 report 的 platform
    expect(s).toContain('*.bestpay.cn');
    expect(s).toContain('oms.bestpay.cn');
    expect(s).toContain('DoS 攻击');
    expect(s).toMatch(/不要再.*确认|直接开扫/);
    expect(s).toMatch(/deny 优先/);
  });

  it('未确认平台明确标注"不要打"', () => {
    upsertPlatform(WS, platformFromParsed({
      id: 'pend', name: '待确认平台', inScope: ['*.pend.com'],
      outOfScope: [], forbiddenActions: [], rewards: [], confirmed: false,
    }));
    const s = renderPlatformsForAi(WS);
    expect(s).toContain('待人类确认');
    expect(s).toMatch(/不要对这些资产发起扫描或攻击/);
  });

  it('无平台时返回空串 (不注入空标题)', () => {
    expect(renderPlatformsForAi(WS)).toBe('');
  });

  it('多平台时禁止项跨平台汇总 (最严口径)', () => {
    upsertPlatform(WS, platformFromParsed({ id: 'a', name: 'a', inScope: ['a.com'], outOfScope: ['deny-a.com'], forbiddenActions: [], rewards: [], confirmed: true }));
    upsertPlatform(WS, platformFromParsed({ id: 'b', name: 'b', inScope: ['b.com'], outOfScope: ['deny-b.com'], forbiddenActions: [], rewards: [], confirmed: true }));
    const s = renderPlatformsForAi(WS);
    expect(s).toContain('全局禁止目标');
    expect(s).toContain('deny-a.com');
    expect(s).toContain('deny-b.com');
  });
});

describe('⑤ hostMatches 语义与授权闸门一致', () => {
  it('通配不覆盖裸域, 不被后缀绕过', () => {
    expect(hostMatches('*.a.com', 'x.a.com')).toBe(true);
    expect(hostMatches('*.a.com', 'x.y.a.com')).toBe(true);
    expect(hostMatches('*.a.com', 'a.com')).toBe(false);
    expect(hostMatches('*.a.com', 'evil-a.com')).toBe(false);
  });
  it('精确与子域匹配', () => {
    expect(hostMatches('a.com', 'a.com')).toBe(true);
    expect(hostMatches('a.com', 'x.a.com')).toBe(true);
    expect(hostMatches('a.com', 'b.com')).toBe(false);
  });
});
/**
 * 多项目隔离纪律 (2026-10-16)
 * ----------------------------------------------------------------
 * 实机事故: 富哥授权了两个项目 (bestpay + u51), AI **一锅端**同时探, 无法分开。
 *
 * 根因不是 AI 偷懒, 是提示词自己教的:
 *   ① renderPlatformsForAi 把 N 家平台**平铺成一份清单**, 没有任何"分开"的约束
 *   ② 纪律第 5 条写"命中即停, 把数量堆上去" —— 鼓励横扫的措辞, 多平台下直接诱发一锅端
 *   ③ renderAuthForAi 同样有第 5 条"把数量堆上去"
 *
 * 真实代价不只是报告难分, 更严重的是跨项目串味:
 *   A 的凭据打 B = 未授权访问(最严重) / A 的洞报给 B = 白干 + 触发对方风控 /
 *   两项目禁令不同, 混着做必然踩掉其中一个
 */
describe('⑤多项目隔离纪律 (2026-10-16 实机事故)', () => {
  it('两个已确认平台 → 注入隔离纪律且含五条关键约束', () => {
    upsertPlatform(WS, { id: 'vulbox-vala', name: '翼支付SRC', hosts: ['*.bestpay.com.cn'], deny: [], forbiddenActions: [], rewards: [] });
    upsertPlatform(WS, { id: 'u51', name: 'U51众测', hosts: ['*.u51.com'], deny: [], forbiddenActions: [], rewards: [] });
    confirmPlatform(WS, 'vulbox-vala');
    confirmPlatform(WS, 'u51');

    const out = renderPlatformsForAi(WS);
    expect(out).toMatch(/多项目隔离纪律/);
    expect(out).toMatch(/互不相干的独立任务/);
    expect(out).toMatch(/一次只做一个项目/);
    expect(out).toMatch(/绝不跨项目混用上下文/);
    expect(out).toMatch(/拿 A 的凭据打 B = 未授权访问/);
    expect(out).toMatch(/汇报必须按项目分节/);
    expect(out).toMatch(/禁令按项目分别遵守/);
    // ⚠️ 反断言: 多平台下绝不能再出现鼓励横扫的措辞
    expect(out).not.toMatch(/把数量堆上去/);
  });

  it('单平台 → 不注入隔离纪律, 且保留"把数量堆上去"(单平台下这是对的)', () => {
    upsertPlatform(WS, { id: 'solo', name: '单平台', hosts: ['*.solo.com'], deny: [], forbiddenActions: [], rewards: [] });
    confirmPlatform(WS, 'solo');
    const out = renderPlatformsForAi(WS);
    expect(out).not.toMatch(/多项目隔离纪律/);
    expect(out).toMatch(/把数量堆上去/);
  });

  it('零确认平台 → 明确要求别开扫', () => {
    upsertPlatform(WS, { id: 'draft', name: '草稿平台', hosts: ['*.d.com'], deny: [], forbiddenActions: [], rewards: [] });
    const out = renderPlatformsForAi(WS);
    expect(out).toMatch(/暂无已确认平台 → 不要开扫/);
  });
});

describe('⑥scope.json 兜底分组 (实机就是这个状态: 只塞了目标, 没建档案)', () => {
  it('无平台档案也能按 source 分组并注入隔离纪律', async () => {
    const { renderScopeGroupsForAi } = await import('./src-platforms.js');
    writeScopeWithSource(WS, [
      { host: 'images.bestpay.com.cn', source: '翼支付SRC' },
      { host: 'www.bestpay.com.cn', source: '翼支付SRC' },
      { host: 'pic.u51.com', source: 'U51众测' },
      { host: 'sfs-gateway.u51.com', source: 'U51众测' },
      { host: 'legacy.example.com', source: 'unknown' },
    ]);
    const out = await renderScopeGroupsForAi(WS);
    expect(out).toMatch(/授权范围里有 2 个不同项目/);
    expect(out).toMatch(/【翼支付SRC】\(2 个目标\)/);
    expect(out).toMatch(/【U51众测】\(2 个目标\)/);
    // unknown 必须归"未归属"而非自己成一个项目 (否则凭空造出第三个项目)
    expect(out).toMatch(/【未归属】\(1 个目标/);
    expect(out).toMatch(/归属不明/);
    // 每个项目的目标逐条列出, AI 才知道边界在哪
    expect(out).toMatch(/images\.bestpay\.com\.cn/);
    expect(out).toMatch(/sfs-gateway\.u51\.com/);
    expect(out).toMatch(/绝不跨项目混用上下文/);
  });

  it('全是占位标记 → 不注入 (凭空造项目反而更乱)', async () => {
    const { renderScopeGroupsForAi } = await import('./src-platforms.js');
    writeScopeWithSource(WS, [
      { host: 'a.com', source: 'unknown' },
      { host: 'b.com', source: 'manual' },
      { host: 'c.com', source: 'ai-granted' },
    ]);
    expect(await renderScopeGroupsForAi(WS)).toBe('');
  });

  it('只有一个真实项目 → 不注入 (无谓隔离只会打乱单项目流程)', async () => {
    const { renderScopeGroupsForAi } = await import('./src-platforms.js');
    writeScopeWithSource(WS, [
      { host: 'a.com', source: '翼支付SRC' },
      { host: 'b.com', source: '翼支付SRC' },
      { host: 'c.com', source: 'unknown' },
    ]);
    expect(await renderScopeGroupsForAi(WS)).toBe('');
  });

  it('目标过多时截断显示但保留计数', async () => {
    const { renderScopeGroupsForAi } = await import('./src-platforms.js');
    const many = Array.from({ length: 40 }, (_, i) => ({ host: `h${i}.bestpay.com.cn`, source: '翼支付SRC' }));
    writeScopeWithSource(WS, [...many, { host: 'x.u51.com', source: 'U51众测' }]);
    const out = await renderScopeGroupsForAi(WS);
    expect(out).toMatch(/【翼支付SRC】\(40 个目标\)/);
    expect(out).toMatch(/… 另 10 个/);
    expect(out).toMatch(/【U51众测】/);
  });

  it('无授权目标 → 返回空 (不注入无意义内容)', async () => {
    const { renderScopeGroupsForAi } = await import('./src-platforms.js');
    writeScopeWithSource(WS, []);
    expect(await renderScopeGroupsForAi(WS)).toBe('');
  });
});
