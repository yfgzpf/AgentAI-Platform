/**
 * auth-attestation.test.ts — 授权声明回归锁 (2026-10-16)
 * ============================================================================
 * 富哥实机反馈 (通用问题, 非个案):
 *   "我不是只有翼支付, 只要是真实的SRC, AI就要开始工作,
 *    不是一直说这是不是真人啥的, 这就不对了"
 *
 * 故障现场 (查工作区实测):
 *   - scope.json 目标都在但 source=unknown (手打)
 *   - AI 声称落盘 auth:bestpay:vulbox:2026-10-16 → **文件不存在**
 *   - AI 只能靠推理判断授权 → 每轮重新怀疑 → 换个会话照旧
 *
 * 本文件锁四个不变量:
 *   ① 声明覆盖的目标确定性放行 (isTargetInScope) —— 这是"AI 敢开工"的根据
 *   ② 声明的 deny 同样进硬闸门 (deny 优先于 allow, 与平台 deny 同级)
 *   ③ AI 上下文里明确禁止"重新核实授权真伪" (反复追问的根因)
 *   ④ 未声明目标仍默认拒绝 + 过期声明不静默生效 (边界没被放宽)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  readAttestations, upsertAttestation, revokeAttestation, renderAuthForAi,
  isHostAttested, isHostDeniedByAttestation, activeAttestations, expiredAttestations, isExpired,
  authFilePath,
} from './auth-attestation.js';
import { isTargetInScope, writeScopeWithSource } from './pentest-scope-guard.js';

let WS = '';
beforeEach(() => {
  WS = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-'));
  fs.mkdirSync(path.join(WS, '.agentai'), { recursive: true });
});
afterEach(() => { try { fs.rmSync(WS, { recursive: true, force: true }); } catch {} });

describe('① 声明覆盖 → 确定性放行', () => {
  it('生效声明内的目标直接放行 (不再需要 AI 自行判断)', () => {
    upsertAttestation(WS, { id: 'vulbox-vala', kind: 'src', name: '翼支付SRC', hosts: ['*.bestpay.com.cn'], active: true });
    expect(isTargetInScope(WS, 'merchant.bestpay.com.cn')).toBe(true);
    expect(isTargetInScope(WS, 'api.bestpay.com.cn')).toBe(true);
  });

  it('通配符合语义: 覆盖子域, 不覆盖裸域, 不被后缀绕过', () => {
    upsertAttestation(WS, { id: 'w', kind: 'src', name: 'w', hosts: ['*.bestpay.com.cn'], active: true });
    expect(isTargetInScope(WS, 'a.bestpay.com.cn')).toBe(true);
    expect(isTargetInScope(WS, 'bestpay.com.cn')).toBe(false);      // 裸域不被 *. 覆盖
    expect(isTargetInScope(WS, 'evil-bestpay.com.cn')).toBe(false); // 后缀绕过
  });

  it('未声明的目标仍默认拒绝 (边界没被放宽)', () => {
    upsertAttestation(WS, { id: 'a', kind: 'src', name: 'a', hosts: ['*.declared.com'], active: true });
    expect(isTargetInScope(WS, 'www.undeclared.com')).toBe(false);
  });

  it('草稿(active=false)不生效', () => {
    upsertAttestation(WS, { id: 'draft', kind: 'src', name: 'draft', hosts: ['*.draft.com'], active: false });
    expect(isTargetInScope(WS, 'x.draft.com')).toBe(false);
    expect(isHostAttested(WS, 'x.draft.com').ok).toBe(false);
  });

  it('isHostAttested 返回命中的声明 (含 kind/声明人)', () => {
    upsertAttestation(WS, { id: 'k', kind: 'pentest-contract', name: '合同', hosts: ['*.x.com'], attestedBy: '张三', active: true });
    const r = isHostAttested(WS, 'a.x.com');
    expect(r.ok).toBe(true);
    expect(r.attestation?.kind).toBe('pentest-contract');
    expect(r.attestation?.attestedBy).toBe('张三');
  });
});

describe('② 声明的 deny 进硬闸门 (deny 优先于 allow)', () => {
  it('声明内禁止项即使被声明授权也必须拦', () => {
    upsertAttestation(WS, {
      id: 'p', kind: 'src', name: 'p',
      hosts: ['*.bestpay.cn'], deny: ['oms.bestpay.cn'],
      active: true,
    });
    expect(isTargetInScope(WS, 'api.bestpay.cn')).toBe(true);
    expect(isTargetInScope(WS, 'oms.bestpay.cn')).toBe(false);  // 硬拦
  });

  it('deny 检查早于 allow (顺序锁)', () => {
    upsertAttestation(WS, { id: 'q', kind: 'src', name: 'q', hosts: ['*.a.com'], deny: ['*.admin.a.com'], active: true });
    expect(isTargetInScope(WS, 'db.admin.a.com')).toBe(false);
    expect(isTargetInScope(WS, 'www.a.com')).toBe(true);
  });

  it('草稿里的 deny 也拦 (人写的意图点名的禁止项多半是真的)', () => {
    upsertAttestation(WS, { id: 'r', kind: 'src', name: 'r', hosts: ['*.b.com'], deny: ['never.b.com'], active: false });
    expect(isHostDeniedByAttestation(WS, 'never.b.com').denied).toBe(true);
  });
});

describe('③ AI 上下文: 明确禁止重新核实授权真伪 (反复追问的根因)', () => {
  it('注入内容含"直接开扫"与"不要反复核实"', () => {
    upsertAttestation(WS, { id: 'v', kind: 'src', name: '漏洞盒子·翼支付', hosts: ['*.bestpay.com.cn'], active: true });
    const s = renderAuthForAi(WS);
    expect(s).toMatch(/不要再追问|不是待核实项/);
    expect(s).toMatch(/直接开扫|直接按授权范围开展工作/);
    expect(s).toMatch(/反复核实授权真伪|重新当一遍审计员/);
  });

  it('注入含授权依据与声明人 (AI 可追溯, 人也可核对)', () => {
    upsertAttestation(WS, {
      id: 'v2', kind: 'src', name: 'n', hosts: ['*.a.com'],
      evidence: ['screenshot-1.png', 'https://vulbox.com/p/1'], attestedBy: '富哥', active: true,
    });
    const s = renderAuthForAi(WS);
    expect(s).toContain('screenshot-1.png');
    expect(s).toContain('vulbox.com/p/1');
    expect(s).toContain('富哥');
  });

  it('禁止项与禁止行为都进上下文 (AI 知道边界在哪)', () => {
    upsertAttestation(WS, {
      id: 'v3', kind: 'src', name: 'n', hosts: ['*.a.com'],
      deny: ['admin.a.com'], forbiddenActions: ['DoS攻击'], active: true,
    });
    const s = renderAuthForAi(WS);
    expect(s).toContain('admin.a.com');
    expect(s).toContain('DoS攻击');
    expect(s).toMatch(/deny 优先于任何授权/);
  });

  it('无声明时返回空串 (不注入空标题浪费 token)', () => {
    expect(renderAuthForAi(WS)).toBe('');
  });

  it('未确认平台不生效时不进"已授权"区', () => {
    upsertAttestation(WS, { id: 'pend', kind: 'src', name: 'pending', hosts: ['*.p.com'], active: false });
    expect(renderAuthForAi(WS)).toBe('');  // 只有生效声明才注入
  });
});

describe('④ 边界未被放宽: 过期 / 撤销 / 损坏', () => {
  it('过期声明不再放行, 但保留记录 (审计痕迹不能抹)', () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    upsertAttestation(WS, { id: 'old', kind: 'src', name: 'old', hosts: ['*.old.com'], validUntil: past, active: true });
    expect(isTargetInScope(WS, 'x.old.com')).toBe(false);   // 已过期 → 不放行
    expect(readAttestations(WS)).toHaveLength(1);           // 但记录还在
    expect(expiredAttestations(WS)).toHaveLength(1);
    // 且 AI 能看到"曾授权但已过期", 而不是无声消失
    expect(renderAuthForAi(WS)).toMatch(/曾授权但已过期/);
  });

  it('未过期声明正常生效', () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    upsertAttestation(WS, { id: 'new', kind: 'src', name: 'new', hosts: ['*.new.com'], validUntil: future, active: true });
    expect(isTargetInScope(WS, 'x.new.com')).toBe(true);
    expect(expiredAttestations(WS)).toHaveLength(0);
  });

  it('revoke 后立即失效', () => {
    upsertAttestation(WS, { id: 'rv', kind: 'src', name: 'rv', hosts: ['*.rv.com'], active: true });
    expect(isTargetInScope(WS, 'x.rv.com')).toBe(true);
    expect(revokeAttestation(WS, 'rv')).toBe(true);
    expect(isTargetInScope(WS, 'x.rv.com')).toBe(false);
    expect(revokeAttestation(WS, 'rv')).toBe(false);
  });

  it('损坏 JSON 不崩 (退化为空)', () => {
    fs.writeFileSync(authFilePath(WS), '{ broken', 'utf8');
    expect(readAttestations(WS)).toEqual([]);
    expect(renderAuthForAi(WS)).toBe('');
  });

  it('循环依赖安全: auth-attestation 不 import scope-guard', () => {
    const src = fs.readFileSync(new URL('./auth-attestation.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/pentest-scope-guard/);
    expect(src).toMatch(/from '\.\/ws-paths\.js'/);
  });
});

describe('⑤ 多平台通用性 (不是给单个平台开后门)', () => {
  it('同时支持多个平台/多种类型', () => {
    upsertAttestation(WS, { id: 'p1', kind: 'src', name: 'SRC-A', hosts: ['*.a.com'], active: true });
    upsertAttestation(WS, { id: 'p2', kind: 'src', name: 'SRC-B', hosts: ['*.b.com'], active: true });
    upsertAttestation(WS, { id: 'own', kind: 'own-assets', name: '自有', hosts: ['internal.corp'], active: true });
    upsertAttestation(WS, { id: 'ctf', kind: 'ctf', name: '靶场', hosts: ['10.10.0.5'], active: true });
    expect(activeAttestations(WS)).toHaveLength(4);
    expect(isTargetInScope(WS, 'x.a.com')).toBe(true);
    expect(isTargetInScope(WS, 'x.b.com')).toBe(true);
    expect(isTargetInScope(WS, 'internal.corp')).toBe(true);
    expect(isTargetInScope(WS, '10.10.0.5')).toBe(true);
    expect(isTargetInScope(WS, 'not-mine.com')).toBe(false);
  });

  it('重复更新是合并 (凭据可增量补充, 不丢首次声明时间)', () => {
    const first = upsertAttestation(WS, { id: 'm', kind: 'src', name: 'm', hosts: ['*.m.com'], active: true });
    const second = upsertAttestation(WS, { id: 'm', kind: 'src', name: 'm', hosts: ['*.n.com'], active: true, evidence: ['shot.png'] });
    expect(second.attestedAt).toBe(first.attestedAt);   // 首次声明时间不可被覆盖
    expect(second.hosts).toEqual(['*.m.com', '*.n.com']);
    expect(second.evidence).toEqual(['shot.png']);
  });

  it('已有生效声明不会被"不带 active 的更新"静默降级', () => {
    upsertAttestation(WS, { id: 's', kind: 'src', name: 's', hosts: ['*.s.com'], active: true });
    const r = upsertAttestation(WS, { id: 's', kind: 'src', name: 's', hosts: ['*.s2.com'] });
    expect(r.active).toBe(true);
  });

  it('显式 active=false 可撤销生效 (人始终有最终控制权)', () => {
    upsertAttestation(WS, { id: 'o', kind: 'src', name: 'o', hosts: ['*.o.com'], active: true });
    const r = upsertAttestation(WS, { id: 'o', kind: 'src', name: 'o', hosts: ['*.o.com'], active: false });
    expect(r.active).toBe(false);
    expect(isTargetInScope(WS, 'x.o.com')).toBe(false);
  });
});