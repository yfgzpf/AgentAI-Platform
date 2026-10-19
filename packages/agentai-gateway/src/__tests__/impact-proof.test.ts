/**
 * impact-proof 回归测试
 *
 * 背景: 富哥 2026-10-19 反馈"我们打得太表层了, 厂商老是忽略我们"。
 * 真因不是洞浅, 而是**证据链不完整** —— 只说"未登录能下载", 没说"是谁的数据、有多少、
 * 能造成什么", 审核员只能判"无影响"。
 *
 * 但"证明影响"不等于"造成损害"。为了让智能体打得更狠而去做
 * (批量下载真实 PII / 取云 AK / 接管他人账号 / 真实扣款), 是违法且会被 SRC 拒收的。
 * 本测试同时锁两件事:
 *   ① 每个类型都有一条可执行的证明链 (不是空话)
 *   ② 红线是机检的 (正则硬挡), 不靠提示词自觉
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeKind,
  planImpactProof,
  checkRedLine,
  gradeEvidence,
  formatImpactPlan,
  formatEvidenceGrade,
  type ImpactKind,
} from '../pentest/impact-proof.js';
import { EXTRA_HANDLERS, EXTRA_TOOLS } from '../tools.js';
import { TOOL_GROUPS } from '../tool-groups.js';
import { SECURITY_OPS_TOOLS, SECURITY_PLAYBOOK } from '../security-playbook.js';

describe('impact_proof: 类型识别', () => {
  it('中英文 + 各种写法都能归一化', () => {
    expect(normalizeKind('IDOR 越权读取')).toBe('idor');
    expect(normalizeKind('未授权接口信息泄露')).toBe('unauth-read');
    expect(normalizeKind('SSRF')).toBe('ssrf');
    expect(normalizeKind('任意文件读取')).toBe('file-read');
    expect(normalizeKind('支付逻辑 price 篡改')).toBe('payment');
    expect(normalizeKind('actuator 未授权')).toBe('unauth-panel');
    expect(normalizeKind('sql injection')).toBe('sqli');
    expect(normalizeKind('存储型 XSS')).toBe('xss');
    expect(normalizeKind('')).toBe('generic');
    expect(normalizeKind('完全看不懂的类型')).toBe('generic');
  });
});

describe('impact_proof: 证明链完整性', () => {
  const kinds: ImpactKind[] = [
    'idor', 'unauth-read', 'ssrf', 'file-read',
    'payment', 'unauth-panel', 'sqli', 'xss', 'generic',
  ];

  it('每种类型都有步骤 / 红线 / 证据清单 / 定级依据 (不能是空壳)', () => {
    for (const k of kinds) {
      const p = planImpactProof(k);
      expect(p.steps.length, `${k} steps`).toBeGreaterThanOrEqual(3);
      expect(p.redLines.length, `${k} redLines`).toBeGreaterThanOrEqual(2);
      expect(p.evidenceChecklist.length, `${k} checklist`).toBeGreaterThanOrEqual(2);
      expect(p.verdictRule.length, `${k} verdictRule`).toBeGreaterThan(20);
      // 每步都要说清"记录什么", 否则等于没给证明方法
      for (const s of p.steps) expect(s.record.length, `${k} step${s.n} record`).toBeGreaterThan(4);
    }
  });

  it('关键类型必须带 stopLine (到哪停), 否则智能体会一路打到底', () => {
    for (const k of ['idor', 'unauth-read', 'ssrf', 'file-read', 'payment', 'sqli'] as ImpactKind[]) {
      const p = planImpactProof(k);
      expect(p.steps.some((s) => !!s.stopLine), `${k} 缺 stopLine`).toBe(true);
    }
  });

  it('越权缺双账号时, 第一步必须提示先去注册测试号 (禁止拿真实用户试)', () => {
    const p = planImpactProof('idor', { hasTwoAccounts: false });
    expect(p.steps[0].action).toContain('两个测试账号');
    expect(p.steps[0].stopLine).toContain('不要');
  });

  it('SSRF 的停线必须明确禁止取凭证', () => {
    const text = JSON.stringify(planImpactProof('ssrf'));
    expect(text).toContain('security-credentials');
    expect(text).toMatch(/不获取云凭证|绝不请求/);
  });

  it('渲染出的 markdown 含停线与定级依据 (AI 能读懂)', () => {
    const out = formatImpactPlan(planImpactProof('idor'));
    expect(out).toContain('停线');
    expect(out).toContain('定级依据');
    expect(out).toContain('能影响');
  });
});

describe('impact_proof: 红线机检 (不靠提示词自觉)', () => {
  it('sqlmap dump / os-shell 类 → 挡', () => {
    expect(checkRedLine('sqlmap -u "http://x/a?id=1" --dump').blocked).toBe(true);
    expect(checkRedLine('sqlmap --os-shell').blocked).toBe(true);
    expect(checkRedLine('sqlmap --file-read=/etc/passwd').blocked).toBe(true);
  });

  it('读口令哈希 / 私钥 / 配置 → 挡', () => {
    expect(checkRedLine('cat /etc/shadow').blocked).toBe(true);
    expect(checkRedLine('读取 ~/.ssh/id_rsa').blocked).toBe(true);
    expect(checkRedLine('下载 application.yml 看数据库密码').blocked).toBe(true);
    expect(checkRedLine('读 .env 拿密钥').blocked).toBe(true);
  });

  it('取云元数据凭证 → 挡 (但根路径可达性放行)', () => {
    expect(checkRedLine('curl 169.254.169.254/latest/meta-data/iam/security-credentials/').blocked).toBe(true);
    expect(checkRedLine('请求 169.254.169.254/ 看状态码').blocked).toBe(false);
  });

  it('批量拿真实用户数据 → 挡 (样本 1-3 条脱敏放行)', () => {
    expect(checkRedLine('批量下载 500 条用户数据').blocked).toBe(true);
    expect(checkRedLine('遍历所有用户 ID 导出').blocked).toBe(true);
    expect(checkRedLine('取 1 条样本并脱敏姓名手机号').blocked).toBe(false);
  });

  it('接管他人账号 → 挡', () => {
    expect(checkRedLine('修改他人手机号完成接管').blocked).toBe(true);
    expect(checkRedLine('重置他人密码后登录').blocked).toBe(true);
    expect(checkRedLine('用账号B请求账号A的资源ID').blocked).toBe(false);
  });

  it('真实扣款 → 挡', () => {
    expect(checkRedLine('支付 0.01 元完成实际付款').blocked).toBe(true);
    expect(checkRedLine('篡改 price 后停在订单确认页').blocked).toBe(false);
  });

  it('踩红线时给出等效合法做法 (不能只说"不行")', () => {
    const v = checkRedLine('cat /etc/shadow');
    expect(v.blocked).toBe(true);
    expect(v.alternative).toBeTruthy();
    expect(String(v.alternative)).toContain('hostname');
  });
});

describe('impact_proof: 证据强度分级 (C 级不许出报告)', () => {
  it('四项齐全 → A', () => {
    const g = gradeEvidence({
      hasRequestResponse: true, hasCrossAccount: true,
      hasScaleEstimate: true, hasSensitiveProof: true,
    });
    expect(g.grade).toBe('A');
    expect(g.score).toBe(4);
    expect(g.advice).toContain('可以出报告');
  });

  it('两项 → B (可报但容易被判影响不足)', () => {
    const g = gradeEvidence({ hasRequestResponse: true, hasSensitiveProof: true });
    expect(g.grade).toBe('B');
    expect(g.missing.length).toBe(2);
  });

  it('一项或零项 → C, 明确说"不要出报告"', () => {
    const g = gradeEvidence({ hasRequestResponse: true });
    expect(g.grade).toBe('C');
    expect(g.advice).toContain('不要出报告');
  });

  it('一票否决: 落盘未脱敏 PII → C + blocker', () => {
    const g = gradeEvidence({
      hasRequestResponse: true, hasCrossAccount: true,
      hasScaleEstimate: true, hasSensitiveProof: true,
      rawPiiSaved: true,
    });
    expect(g.grade).toBe('C');           // 信号再全也压不过越界
    expect(g.blockers.join()).toContain('未脱敏');
  });

  it('一票否决: 接管他人账号 / 用真实凭证 / 造成真实损失', () => {
    expect(gradeEvidence({ actedOnOtherUser: true }).grade).toBe('C');
    expect(gradeEvidence({ usedRealCredential: true }).grade).toBe('C');
    expect(gradeEvidence({ causedRealLoss: true }).grade).toBe('C');
  });

  it('渲染结果带等级图标与整改指引', () => {
    const out = formatEvidenceGrade(gradeEvidence({ rawPiiSaved: true }));
    expect(out).toContain('🔴');
    expect(out).toContain('先整改');
  });
});

describe('impact_proof: 工具接线 (不能被 MAX_TOOLS 裁掉)', () => {
  it('已声明且 handler 可达', () => {
    expect(EXTRA_TOOLS.some((t: any) => t.name === 'impact_proof')).toBe(true);
    expect(typeof EXTRA_HANDLERS.impact_proof).toBe('function');
  });

  it('进 security_ops 工具组 + security 任务映射 + SECURITY_OPS_TOOLS', () => {
    expect(TOOL_GROUPS.security_ops).toContain('impact_proof');
    expect(SECURITY_OPS_TOOLS.has('impact_proof')).toBe(true);
  });

  it('Playbook 点名了它 (否则 AI 不知道有这个能力)', () => {
    expect(SECURITY_PLAYBOOK).toContain('impact_proof');
  });

  it('plan 动作返回可执行证明链', async () => {
    const r = await EXTRA_HANDLERS.impact_proof({ action: 'plan', vulnType: 'idor' });
    expect(r.success).toBe(true);
    expect(String(r.output)).toContain('影响证明链');
    expect(String(r.output)).toContain('双账号');
  });

  it('check 动作拦截越界步骤', async () => {
    const bad = await EXTRA_HANDLERS.impact_proof({ action: 'check', step: 'cat /etc/shadow' });
    expect(bad.success).toBe(false);
    expect(String(bad.output)).toContain('红线');
    const good = await EXTRA_HANDLERS.impact_proof({ action: 'check', step: '读 /etc/hostname 证明可读' });
    expect(good.success).toBe(true);
  });

  it('evaluate 动作对 C 级返回 success=false (阻止出报告)', async () => {
    const r = await EXTRA_HANDLERS.impact_proof({ action: 'evaluate', evidence: { hasRequestResponse: true } });
    expect(r.success).toBe(false);
    expect(String(r.output)).toContain('不要生成报告');
  });
});
