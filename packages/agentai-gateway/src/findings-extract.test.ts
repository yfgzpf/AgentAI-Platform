/**
 * 发现提取 + 三层落点 (2026-10-21, 富哥实锤事故)
 * ======================================================================
 * 事故现场 (赏金长任务): "上一轮 probe5.out 读过, 跨会话压缩后内容被丢了,
 *   重新读才发现文件根本不在" + "AnyShare 落在哪个 host" 反复问。
 * 根因: 会话压缩**只保动作不保发现** ——
 *   · 层1 历史压缩摘要只留路径, 工具产出内容本体整个丢弃;
 *   · 台账 (唯一扛压缩机制) 只有 reads/writes/commands/failures/decisions,
 *     **无 findings 字段**;
 *   · 层0 crushJson 同构数组只留前 2 个, 尾部事实整段丢。
 *   净效果: "扫出来的事实" 压缩后不存在于任何地方 → AI 反复重读或凭空猜。
 * 本文件锁死:
 *   ①-⑦ 提取行为: 头条/模式行/短输出不提取/错误不提取/[SYSTEM] 跳过/去重+cap
 *   ⑧ F3: crushJson 同构数组保留尾部元素 (扫描数据有趣的常在尾部)
 *   ⑨-⑫ 源码契约: F1 摘要「## 关键发现」段 / F2 台账 hook / 台账字段 / F3 形态
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFindings } from './finding-extract.js';
import { compressToolOutput } from './token-compressor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOOP_SRC = readFileSync(path.resolve(__dirname, 'agentai-loop.ts'), 'utf-8');
const LEDGER_SRC = readFileSync(path.resolve(__dirname, 'task-ledger.ts'), 'utf-8');
const COMPRESSOR_SRC = readFileSync(path.resolve(__dirname, 'token-compressor.ts'), 'utf-8');

describe('extractFindings: 提取行为', () => {
  it('① 头条提取 — 第一行有效内容成为发现 (结论行)', () => {
    const out = '== 0. alive check ==\n/ = 200 size=5714 type=text/html\n/anyshare/ = 200 size=5714';
    const f = extractFindings(out);
    expect(f[0]).toBe('== 0. alive check ==');
    expect(f.length).toBeGreaterThanOrEqual(1);
  });

  it('② 发现模式行提取 — 命中 未授权/200 等事实行', () => {
    const out = [
      'probe3 抓取完成',
      '/anyshare/api/rest/users = 200 type=text/html size=5714',
      '/anyshare/api/rest/files = 200 type=text/html size=5714',
      '普通过程行, 没有任何事实关键词的一句废话',
    ].join('\n');
    const f = extractFindings(out, { max: 5 });
    expect(f.join('\n')).toContain('/anyshare/api/rest/users = 200');
    expect(f.join('\n')).toContain('/anyshare/api/rest/files = 200');
    expect(f.join('\n')).not.toContain('普通过程行');
  });

  it('③ 短输出 (<minChars) 不提取 — 模型在近期上下文里还记得', () => {
    expect(extractFindings('ok')).toEqual([]);
    expect(extractFindings('200')).toEqual([]);
    expect(extractFindings('x'.repeat(59))).toEqual([]);
  });

  it('④ 错误产出不提取 — 错误有专门通道 (errorsHit/recordFailure), 不占发现位', () => {
    expect(extractFindings('[ERROR] 工具执行失败: command not found\n 200 stack trace')).toEqual([]);
    expect(extractFindings('Error: boom\nmore 200 lines')).toEqual([]);
    expect(extractFindings('ENOENT: no such file\n200')).toEqual([]);
  });

  it('⑤ [SYSTEM] 行跳过 — 系统指令不是工具产出 (防自噬, 同 auto-lint 教训)', () => {
    const out = [
      '[SYSTEM] 注意: read_file("x.ts") 本会话已读过 2 次, 200 次都行',
      '真实结论行: 未授权访问确认',
      '[SYSTEM] 请立即检查是否有编译/lint 错误, 200 ok',
    ].join('\n');
    const f = extractFindings(out, { max: 5 });
    expect(f.join('\n')).not.toContain('[SYSTEM]');
    expect(f.join('\n')).toContain('未授权访问确认');
  });

  it('⑥ 去重 + max 截断 — 控量, 不把台账/摘要撑爆', () => {
    const out = [
      '结论: 确认存在未授权访问漏洞, 可直接读取用户数据',
      '状态码 200 的记录行, 详细描述一些内容',
      '状态码 200 的记录行, 详细描述一些内容',   // 与上行完全相同 → 去重
      '第三条: 403 forbidden 端口关闭状态',
    ].join('\n');
    const f = extractFindings(out, { max: 2 });
    expect(f.length).toBe(2);
    expect(new Set(f).size).toBe(2, '重复行必须去重');
    expect(f[0]).toBe('结论: 确认存在未授权访问漏洞, 可直接读取用户数据'); // 头条必占一位
  });

  it('⑦ null/undefined/空串 → [] (不抛)', () => {
    expect(extractFindings(undefined)).toEqual([]);
    expect(extractFindings(null)).toEqual([]);
    expect(extractFindings('')).toEqual([]);
  });
});

describe('F3: crushJson 同构数组保留尾部 (扫描数据有趣的常在尾部)', () => {
  it('⑧ 前2 + 末1 + 计数, 中间丢', () => {
    const arr = [1, 2, 3, 4, 5].map((i) => ({ id: i, data: `tail-${i}-` + 'x'.repeat(300) }));
    const json = JSON.stringify(arr);
    expect(json.length).toBeGreaterThan(1000); // 越过 minCharsToCompress 门槛
    const { compressed } = compressToolOutput(json, 'probe');
    expect(compressed).toContain('tail-1-'); // 头部保留
    expect(compressed).toContain('tail-5-'); // 尾部保留 (F3 新增)
    expect(compressed).toContain('2 more');  // 计数正确 (5 - 3 = 2)
    expect(compressed).not.toContain('tail-3-'); // 中间确实丢
  });
});

describe('源码契约: 三层落点都在', () => {
  it('⑨ F1: 压缩块 import extractFindings + findingsHit + 「## 关键发现」摘要段', () => {
    expect(LOOP_SRC).toContain("import { extractFindings } from './finding-extract.js'");
    expect(LOOP_SRC).toContain('const findingsHit: string[] = [];');
    expect(LOOP_SRC).toContain('extractFindings(text)');
    expect(LOOP_SRC).toContain('## 关键发现');
    // 发现段必须在用户请求段之后 (摘要有 4000 字硬顶且 slice 保头, 靠前才活得下来)
    const uIdx = LOOP_SRC.indexOf('`## 用户请求');
    const fIdx = LOOP_SRC.indexOf('`## 关键发现');
    expect(uIdx, '用户请求段必须存在').toBeGreaterThan(0);
    expect(fIdx, '关键发现段必须存在').toBeGreaterThan(0);
    expect(fIdx, '关键发现段应置于用户请求之后').toBeGreaterThan(uIdx);
  });

  it('⑩ F2: 台账 hook 在 ledger.record 之后调 recordFinding (成功产出)', () => {
    const recIdx = LOOP_SRC.indexOf('this.ledger.record(c.name, _target, _kind as any)');
    const fIdx = LOOP_SRC.indexOf('this.ledger.recordFinding(`${c.name}: ${f}`)');
    expect(recIdx, 'ledger.record 必须存在').toBeGreaterThan(0);
    expect(fIdx, 'recordFinding hook 必须存在').toBeGreaterThan(0);
    expect(fIdx, 'hook 必须在 record 之后').toBeGreaterThan(recIdx);
    expect(LOOP_SRC).toContain("extractFindings(r.result.output, { max: 2 })");
  });

  it('⑪ F2: 台账有 findings 字段 + recordFinding + 注入段', () => {
    expect(LEDGER_SRC).toContain('private findings: string[] = [];');
    expect(LEDGER_SRC).toContain('recordFinding(finding: string, maxLen = 160): void');
    expect(LEDGER_SRC).toContain('findings: this.listFindings(12),');
    expect(LEDGER_SRC).toContain('## 关键发现（已确认的事实，不要重复探测/读取）');
    // reset 必须清 findings (会话隔离)
    expect(LEDGER_SRC).toMatch(/reset\(\): void \{[\s\S]*?this\.findings = \[\];/);
  });

  it('⑫ F3: crushJson 同构数组形态是 前2 + 末1 + 计数', () => {
    expect(COMPRESSOR_SRC).toContain('val[val.length - 1]!');
    expect(COMPRESSOR_SRC).toContain('more...');
  });
});
