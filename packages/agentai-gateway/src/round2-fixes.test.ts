/**
 * round2-fixes.test.ts — 2026-10-20 第二轮深挖 F1-F9 修复验收
 * ============================================================================
 * 背景: 富哥「再探, 深入一点」纯侦察产出 9 个发现 (授权边界/信号湮灭/状态污染/
 * 优先级体系), 本轮全部落实到代码。本文件锁死每项修复:
 *   F1 授权边界: extractTargets 裸主机/IP 提取 (nmap -p 80,443 10.0.0.5 不再失明)
 *      + wsl_exec 的 args[] 数组 + 闸门工具集扩容 (源码契约)
 *   F2 信号湮灭: 六个 deferred 来源 + low_conf_clarify medium→high (源码契约)
 *   F3 fail_strategy: 瞬时错误/参数格式两分支 medium→high (源码契约)
 *   F4 planning 路径: delete_file 审批超时=拒绝 (源码契约, 与普通路径同参)
 *   F5 状态污染: _toolCallHistory 两侧 sha256 短哈希 (源码契约)
 *   F6 状态污染: bgJobs 退出驱逐保最近 20 (行为测试, 真 spawn 25 个 job)
 *   F7 裸数字: 降级建议换 textHasStatus (源码契约, 区域无 /402|/401|/429|)
 *   F8 ambiguity: medium→high (源码契约)
 *   F9 死代码: hasCriticalDeferred/fileMetaCache 删除 + flushAll 文案校正 (源码契约)
 */

import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as nodePath from 'node:path';

const ROOT = nodePath.resolve(__dirname, '..', '..', '..');
const src = (rel: string) => readFileSync(nodePath.join(ROOT, rel), 'utf-8');
const loopSrc = src('packages/agentai-gateway/src/agentai-loop.ts');
const routerSrc = src('packages/agentai-gateway/src/llm-router.ts');
const mgrSrc = src('packages/agentai-gateway/src/system-directive-manager.ts');

// ════════════════════════════════════════════════════════════════════════
// F1: pentest scope 闸门 — 裸主机提取 + 授权闭环
// ════════════════════════════════════════════════════════════════════════
describe('F1: extractTargets 裸主机/IP 提取 (闸门失明修复)', () => {
  it('nmap 裸 IP / curl 裸域 / ssh user@host 都能提取', async () => {
    const { extractTargets } = await import('./pentest-scope-guard.ts');
    expect(extractTargets('run_command', { command: 'nmap -p 80,443 10.0.0.5' })).toEqual(['10.0.0.5']);
    expect(extractTargets('run_command', { command: 'curl -s api.target.com/x' })).toEqual(['api.target.com']);
    expect(extractTargets('run_command', { command: 'ssh root@10.0.0.5' })).toEqual(['10.0.0.5']);
    // 端口后缀不影响提取
    expect(extractTargets('run_command', { command: 'openssl s_client -connect target.com:443' })).toEqual(['target.com']);
  });

  it('wsl_exec 的 args[] 数组也逃不掉 (Kali 全能力入口)', async () => {
    const { extractTargets } = await import('./pentest-scope-guard.ts');
    expect(extractTargets('wsl_exec', { command: 'nmap', args: ['-p', '80,443', 'evil.com'] })).toEqual(['evil.com']);
    expect(extractTargets('wsl_exec', { command: 'bash', args: ['-lc', 'curl https://evil.com/FUZZ'] })).toEqual(['evil.com']);
  });

  it('run_background / run_shell_command 的 command 字符串同样提取', async () => {
    const { extractTargets } = await import('./pentest-scope-guard.ts');
    expect(extractTargets('run_background', { command: 'ffuf -u https://evil.com/FUZZ -w w.txt' })).toEqual(['evil.com']);
    expect(extractTargets('run_shell_command', { command: 'dig +short authorized.com' })).toEqual(['authorized.com']);
  });

  it('本地命令不误拦: 文件扩展名/路径上下文/版本号全部过滤', async () => {
    const { extractTargets } = await import('./pentest-scope-guard.ts');
    expect(extractTargets('run_command', { command: 'ls -la && cat a.txt' })).toEqual([]);
    expect(extractTargets('run_command', { command: 'cat scope.json' })).toEqual([]);
    // nmap 自带脚本 .nse 是文件不是目标; loopback 由 isTargetInScope 免授权
    expect(extractTargets('run_command', { command: 'nmap --script vuln.nse -p80 127.0.0.1' })).toEqual(['127.0.0.1']);
    // 版本号 (TLD 非纯字母) 不是主机
    expect(extractTargets('run_command', { command: 'python3.11 -m http.server 8000' })).toEqual([]);
    // 路径分隔符前缀 → 不是目标
    expect(extractTargets('run_command', { command: 'cat /usr/share/wordlists/common.txt' })).toEqual([]);
    // git@ 形式的主机要抓; repo.git 在路径段里不抓
    expect(extractTargets('run_command', { command: 'git clone git@github.com:org/repo.git' })).toEqual(['github.com']);
  });

  it('URL 形态不回归 (2026-10-15 原行为保持)', async () => {
    const { extractTargets } = await import('./pentest-scope-guard.ts');
    expect(extractTargets('run_command', { command: 'curl -s http://api.example.com/x?y=1' })).toEqual(['api.example.com']);
    expect(extractTargets('browser_navigate', { url: 'https://sub.example.com/login' })).toEqual(['sub.example.com']);
    expect(extractTargets('web_fetch', { url: 'http://127.0.0.1:8080/api' })).toEqual(['127.0.0.1']);
  });

  it('闸门判定闭环: 提取到的未授权目标过 isTargetInScope 判否, 授权目标判是', async () => {
    const { extractTargets, isTargetInScope } = await import('./pentest-scope-guard.ts');
    const ws = mkdtempSync(nodePath.join(tmpdir(), 'round2-scope-'));
    try {
      mkdirSync(nodePath.join(ws, '.agentai'), { recursive: true });
      writeFileSync(nodePath.join(ws, '.agentai', 'scope.json'),
        JSON.stringify({ targets: ['authorized.roundtest'], max_rps: 5 }));
      // 修复前: 这两个调用提取=[] → 闸门放行 (未授权目标直通)
      const t1 = extractTargets('run_command', { command: 'nmap -p 80,443 10.0.0.5' });
      expect(t1).toEqual(['10.0.0.5']);
      expect(isTargetInScope(ws, t1[0]!)).toBe(false);
      const t2 = extractTargets('wsl_exec', { command: 'nmap', args: ['evil.roundtest'] });
      expect(isTargetInScope(ws, t2[0]!)).toBe(false);
      // 授权内的目标照常放行
      expect(isTargetInScope(ws, 'authorized.roundtest')).toBe(true);
      expect(isTargetInScope(ws, 'sub.authorized.roundtest')).toBe(true);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('闸门工具集覆盖 wsl_exec/run_background/run_shell_command (源码契约)', () => {
    expect(loopSrc).toMatch(
      /new Set\(\['run_command', 'browser_navigate', 'web_fetch', 'wsl_exec', 'run_background', 'run_shell_command'\]\)/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// F1b: 目标清单文件读取 — `httpx -l subs.txt` 盲区 (2026-10-20 第二轮)
// 背景: 赏金工作流是清单驱动 (subfinder 产出 → httpx/nuclei/nmap 吃文件),
//   命令行干净得像个本地命令 → 旧 extractor 提取=[] → 500 个越权子域直通。
// ════════════════════════════════════════════════════════════════════════
describe('F1b: extractTargets 读目标清单文件 (命令行干净≠无目标)', () => {
  const mkListWs = () => {
    const ws = mkdtempSync(nodePath.join(tmpdir(), 'round2-list-'));
    mkdirSync(nodePath.join(ws, '.agentai'), { recursive: true });
    writeFileSync(nodePath.join(ws, '.agentai', 'scope.json'),
      JSON.stringify({ targets: ['authorized.roundtest'], max_rps: 5 }));
    return ws;
  };

  it('httpx -l / nmap -iL / --list= / subfinder -dL 四种形态都读清单', async () => {
    const { extractTargets } = await import('./pentest-scope-guard.ts');
    const ws = mkListWs();
    try {
      writeFileSync(nodePath.join(ws, 'subs.txt'),
        ['# 注释行 evil.com 不算', 'authorized.roundtest', 'evil.roundtest', '', 'https://url-form.roundtest/path', '10.0.0.9:8080'].join('\n'));
      const got = extractTargets('run_command', { command: 'httpx -l subs.txt' }, ws);
      expect(got).toContain('authorized.roundtest');
      expect(got).toContain('evil.roundtest');      // 越权主机必须被看见 (修复前完全失明)
      expect(got).toContain('url-form.roundtest');  // 清单行是完整 URL 也提取
      expect(got).toContain('10.0.0.9');             // host:port 形态
      expect(got).not.toContain('evil.com');         // 注释行不提 (evil.com 不在清单里)
      expect(extractTargets('run_command', { command: 'nmap -iL subs.txt -p80' }, ws)).toContain('evil.roundtest');
      expect(extractTargets('run_command', { command: 'nuclei --list=subs.txt' }, ws)).toContain('evil.roundtest');
      expect(extractTargets('run_command', { command: 'subfinder -dL subs.txt' }, ws)).toContain('evil.roundtest');
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('wsl_exec: argv 数组形态 + /mnt/f/... WSL 路径翻译 (Kali 全能力入口)', async () => {
    const { extractTargets } = await import('./pentest-scope-guard.ts');
    const ws = mkListWs();
    try {
      writeFileSync(nodePath.join(ws, 'subs.txt'), 'evil.roundtest\n');
      // argv 分币形态
      expect(extractTargets('wsl_exec', { command: 'httpx', args: ['-l', 'subs.txt'] }, ws)).toContain('evil.roundtest');
      // bash -lc 整串形态 (argv 元素自带空格 → 二次切词)
      expect(extractTargets('wsl_exec', { command: 'bash', args: ['-lc', 'httpx -l subs.txt'] }, ws)).toContain('evil.roundtest');
      // /mnt/f/... → F:/... 翻译: 文件在 Windows 侧, 不翻译 readSync 直接 ENOENT
      const mntPath = `/mnt/${ws[0].toLowerCase()}/${ws.slice(2).replace(/\\/g, '/')}/subs.txt`;
      expect(extractTargets('wsl_exec', { command: 'bash', args: ['-lc', `httpx -l ${mntPath}`] }, ws)).toContain('evil.roundtest');
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('ffuf -w 单词表不当目标清单 (内容是路径不是主机)', async () => {
    const { extractTargets } = await import('./pentest-scope-guard.ts');
    const ws = mkListWs();
    try {
      writeFileSync(nodePath.join(ws, 'wordlist.txt'), ['/admin', '/api/v1', '/.env', 'admin.html'].join('\n'));
      const got = extractTargets('run_command', { command: 'ffuf -u https://authorized.roundtest/FUZZ -w wordlist.txt' }, ws);
      expect(got).toEqual(['authorized.roundtest']); // 单词表内容零混入
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('混合清单闸门闭环: 授权内放行/越权拒 (复刻真实攻击: 一个清单混装', async () => {
    const { extractTargets, isTargetInScope } = await import('./pentest-scope-guard.ts');
    const ws = mkListWs();
    try {
      writeFileSync(nodePath.join(ws, 'subs.txt'), 'authorized.roundtest\nevil.roundtest\n');
      const targets = extractTargets('run_command', { command: 'httpx -l subs.txt' }, ws);
      expect(targets).toContain('authorized.roundtest');
      // 闸门口径: find(t => !isTargetInScope) → evil 命中即整单拒
      expect(isTargetInScope(ws, 'authorized.roundtest')).toBe(true);
      expect(isTargetInScope(ws, 'evil.roundtest')).toBe(false);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('缺失清单/无 workspace/值形态异常 → 优雅降级不抛错 (不误拦合法扫描)', async () => {
    const { extractTargets } = await import('./pentest-scope-guard.ts');
    const ws = mkListWs();
    try {
      // 文件不存在: 只靠命令行, 不炸
      expect(extractTargets('run_command', { command: 'httpx -l not-exist.txt' }, ws)).toEqual([]);
      // 无 workspace (legacy 两参调用/单测): 相对路径不猜, 不读
      expect(extractTargets('run_command', { command: 'httpx -l subs.txt' })).toEqual([]);
      // -l 后面跟的是 flag 不是文件
      expect(extractTargets('run_command', { command: 'httpx -l -v' }, ws)).toEqual([]);
      // stdin 形态 (-l -) 看不见, 跳过不炸
      expect(extractTargets('run_command', { command: 'cat subs.txt | httpx -l -' }, ws)).toEqual([]);
      // 命令行本身有主机时不受清单影响
      expect(extractTargets('run_command', { command: 'curl evil.roundtest -l subs.txt' }, ws)).toEqual(['evil.roundtest']);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('中文工作区路径 (F:\\挖洞赏金 同款场景) 相对清单可解析', async () => {
    const { extractTargets } = await import('./pentest-scope-guard.ts');
    const ws = mkdtempSync(nodePath.join(tmpdir(), '赏金-'));
    try {
      writeFileSync(nodePath.join(ws, 'subs.txt'), 'evil.roundtest\n');
      expect(extractTargets('run_command', { command: 'httpx -l subs.txt' }, ws)).toContain('evil.roundtest');
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('巨型清单封顶: 3000 行也只读头部 500 主机 (防拖死网关)', async () => {
    const { extractTargets } = await import('./pentest-scope-guard.ts');
    const ws = mkListWs();
    try {
      const lines: string[] = [];
      for (let i = 0; i < 3000; i++) lines.push(`h${i}.example.com`);
      writeFileSync(nodePath.join(ws, 'big.txt'), lines.join('\n'));
      const got = extractTargets('run_command', { command: 'httpx -l big.txt' }, ws);
      expect(got.length).toBe(500);            // LIST_MAX_HOSTS 封顶
      expect(got[0]).toBe('h0.example.com');   // 保留头部 (最早进清单的)
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('loop 闸门调用传 workspace (源码契约: 不传=清单读取静默失效)', () => {
    expect(loopSrc).toMatch(/extractTargets\(c\.name, c\.args \|\| \{\}, this\.opts\.workspace\)/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// F2/F3/F8: 优先级体系 — medium 入队 = 运行时 no-op, 全部升 high
// ════════════════════════════════════════════════════════════════════════
describe('F2/F3/F8: 指令优先级空转修复 (deferred/flushAll 只放行 high)', () => {
  it('六个 deferred 来源 + low_conf_clarify 全部 high 入队', () => {
    // DEFERRABLE_SOURCES 六个 (meta_ask 全库无注入点, 死来源名) + 即时注入的
    // low_conf_clarify (管理器注释要求"必须即时注入", medium 会被 flushAll 丢弃)
    for (const s of ['op_awareness', 'meta_pua', 'boundary_check', 'boundary_p0', 'low_conf_search', 'low_conf_clarify']) {
      const re = new RegExp(`directives\\.add\\('${s}'[\\s\\S]*?,\\s*'high'\\)`);
      expect(loopSrc, `${s} 必须 high 入队 (medium = 被消费端静默丢弃)`).toMatch(re);
    }
  });

  it('fail_strategy 瞬时错误 (429/503/timeout) 与参数格式两分支升 high', () => {
    expect(loopSrc).toMatch(/瞬时错误\(网络\/限流\), 可重试。等待2秒后换参数重试。`, 'high'\)/);
    expect(loopSrc).toMatch(/失败因为参数格式错误, 请检查参数语法后修正重试。`, 'high'\)/);
  });

  it('ambiguity 升 high (管理器注释: 歧义检测必须首轮立即注入)', () => {
    expect(loopSrc).toMatch(/directives\.add\('ambiguity',[\s\S]*?'high'\)/);
  });

  it('防回归注记: DEFERRABLE_SOURCES 文档写明入队必须 ≥ high', () => {
    expect(mgrSrc).toMatch(/优先级\*\*必须 ≥ 'high'\*\*/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// F4: planning 路径审批超时 — delete_file 超时=拒绝
// ════════════════════════════════════════════════════════════════════════
describe('F4: planning 路径 delete_file 审批超时=拒绝 (D2 修复补齐)', () => {
  it('planning 与普通路径都传 onTimeout: delete_file→reject', () => {
    const matches = loopSrc.match(
      /waitForApproval\(approvalId, 90_000, tc\.name === 'delete_file' \? 'reject' : 'approve'\)/g) || [];
    // planning (7665 区块) + 普通 (7740 区块) 两条路径, 缺一即修复留半
    expect(matches.length).toBe(2);
  });
});

// ════════════════════════════════════════════════════════════════════════
// F5: _toolCallHistory sha256 短哈希 (写重型长任务内存线性涨的修法)
// ════════════════════════════════════════════════════════════════════════
describe('F5: _toolCallHistory 两侧统一 sha256 短哈希', () => {
  it('记录侧与比对侧走同一个 _toolCallSig (口径一致, 去重才命得中)', () => {
    expect(loopSrc).toMatch(/import \{ createHash \} from 'crypto'/);
    expect(loopSrc).toMatch(/private _toolCallSig\(name: string, args: any\): string/);
    // 记录侧 (工具成功后 add)
    expect(loopSrc).toMatch(/this\._toolCallHistory\.add\(this\._toolCallSig\(r\.name, _tc\.args \|\| \{\}\)\)/);
    // 比对侧 (dispatch 前查 has)
    expect(loopSrc).toMatch(/const _sig = this\._toolCallSig\(tc\.name, tc\.args \?\? \{\}\)/);
    // _toolCallHistory 两条老接线形态消失 (全量 JSON 进 Set / add 局部变量)。
    // 注意: 4923 行 duplicateTracker 的 `tc.name:${JSON.stringify(args).slice(0,500)}`
    // 是另一机制 (同参连续失败追踪, 有意截断), 不在本断言范围。
    expect(loopSrc).not.toMatch(/_toolCallHistory\.add\(_sig\)/);
    expect(loopSrc).not.toMatch(/const _sig = `\$\{tc\.name\}:\$\{_argsJson\}`/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// F6: bgJobs 驱逐 (只进不出 → 退出后保最近 20)
// ════════════════════════════════════════════════════════════════════════
describe('F6: bgJobs 退出驱逐 (200KB×N 内存无释放的修法)', () => {
  it('25 个瞬间退出 job → 最早的被驱逐, 最近的保留, 总量 ≤20', async () => {
    const { EXTRA_HANDLERS } = await import('./tools.ts');
    const handlers = EXTRA_HANDLERS as any;
    const ids: number[] = [];
    for (let i = 0; i < 25; i++) {
      const r = await handlers.run_background({ command: 'exit 0' });
      expect(r.success).toBe(true);
      ids.push(r.data.jobId);
    }
    // 轮询等全部退出 (不睡死)
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const list = await handlers.list_jobs({});
      const running = String(list.output).split('\n').filter(l => l.includes('running=true')).length;
      if (running === 0) break;
      await new Promise(r => setTimeout(r, 250));
    }
    // 最早的 5 个 (25-20) 被驱逐 → job_output 报 Not found
    const first = await handlers.job_output({ jobId: ids[0] });
    expect(first.success, `最早 job #${ids[0]} 应被驱逐, 实际 output=${first.output}`).toBe(false);
    // 最近的保留 (AI 刚跑的扫描要能查到)
    const last = await handlers.job_output({ jobId: ids[24] });
    expect(last.success, `最近 job #${ids[24]} 应保留`).toBe(true);
    // 总量封顶
    const list = await handlers.list_jobs({});
    const lines = String(list.output).split('\n').filter(Boolean).length;
    expect(lines).toBeLessThanOrEqual(20);
  }, 60_000);
});

// ════════════════════════════════════════════════════════════════════════
// F7: llm-router 降级建议 — 裸数字 → textHasStatus 锚定
// ════════════════════════════════════════════════════════════════════════
describe('F7: 降级建议裸数字匹配修复 (ts=20240201153022 被建议充实的实锤)', () => {
  it('全部失败区域: 402/401/429 走 textHasStatus, 无裸数字分支', () => {
    const from = routerSrc.indexOf('真的全部失败');
    const to = routerSrc.indexOf('_degraded: true');
    expect(from, '定位不到"真的全部失败"区块').toBeGreaterThan(-1);
    expect(to, '定位不到 _degraded 返回').toBeGreaterThan(from);
    const region = routerSrc.slice(from, to);
    expect(region).toMatch(/textHasStatus\(blob, 402\)/);
    expect(region).toMatch(/textHasStatus\(blob, 401\)/);
    expect(region).toMatch(/textHasStatus\(blob, 429\)/);
    expect(region).not.toMatch(/\/402\|/);
    expect(region).not.toMatch(/\/401\|/);
    expect(region).not.toMatch(/\/429\|/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// F9: 死代码清理 + 文案校正
// ════════════════════════════════════════════════════════════════════════
describe('F9: 死代码与不实文案清理', () => {
  it('hasCriticalDeferred (零调用方) 与 fileMetaCache (零使用) 已删', () => {
    expect(mgrSrc).not.toMatch(/hasCriticalDeferred/);
    expect(loopSrc).not.toMatch(/_fileMetaCache/);
    expect(loopSrc).not.toMatch(/FILE_META_TTL_MS|FILE_META_MAX/);
  });

  it('flushAll 溢出文案: "延后" (不实) → "已省略" (pending 整行清空是丢弃)', () => {
    expect(mgrSrc).not.toMatch(/本轮延后/);
    expect(mgrSrc).toMatch(/已省略，未注入本轮/);
  });
});
