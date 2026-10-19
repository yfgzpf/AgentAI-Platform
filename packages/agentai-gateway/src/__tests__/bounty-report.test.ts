import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { EXTRA_HANDLERS, EXTRA_TOOLS } from '../tools.js';
import { TOOL_GROUPS, TASK_TYPE_TOOL_MAP } from '../tool-groups.js';
import { SECURITY_PLAYBOOK, SECURITY_OPS_TOOLS } from '../security-playbook.js';

const WS = path.join(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'),
  '__bounty_report_ws__',
);

function writeVulnFile(records: any[]) {
  const dir = path.join(WS, '.agentai', 'vulns');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'vulns.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf-8');
}

beforeAll(() => {
  fs.mkdirSync(WS, { recursive: true });
});
afterAll(() => {
  fs.rmSync(WS, { recursive: true, force: true });
});

describe('bounty_report: 结构与接线 (2026-10-19: 此前是幻影, 断头路终点)', () => {
  it('工具已声明且可从 EXTRA_HANDLERS 取到', () => {
    expect(EXTRA_TOOLS.some((t: any) => t.name === 'bounty_report')).toBe(true);
    expect(typeof EXTRA_HANDLERS.bounty_report).toBe('function');
  });

  it('声明写清参数、触发场景与"断头路终点"语义', () => {
    const decl = EXTRA_TOOLS.find((t: any) => t.name === 'bounty_report') as any;
    for (const p of ['target', 'platform', 'minSeverity', 'status', 'outFile']) {
      expect(decl.parameters.properties[p]).toBeTruthy();
    }
    expect(decl.description).toContain('断头路');
  });

  it('三处工具集都接进 (security_ops / TASK_TYPE_TOOL_MAP.security / SECURITY_OPS_TOOLS)', () => {
    expect(TOOL_GROUPS.security_ops).toContain('bounty_report');
    expect(TASK_TYPE_TOOL_MAP.security).toContain('bounty_report');
    expect(SECURITY_OPS_TOOLS.has('bounty_report')).toBe(true);
  });

  it('Playbook 工具铁律点名 bounty_report (收尾出报告)', () => {
    expect(SECURITY_PLAYBOOK).toContain('bounty_report');
  });
});

describe('bounty_report: 功能 — 聚合 vulns.jsonl → 平台级 markdown', () => {
  it('空漏洞库 → 友好提示而非抛错', async () => {
    fs.rmSync(path.join(WS, '.agentai', 'vulns'), { recursive: true, force: true });
    const r = await EXTRA_HANDLERS.bounty_report({}, { workspace: WS });
    expect(r.success).toBe(true);
    expect(String(r.output)).toMatch(/暂无漏洞库|漏洞库为空/);
  });

  it('聚合多条 + 按严重度分层 + PoC + 证据附件 + 落盘 + 附件存在性校验', async () => {
    const existPath = path.join(WS, '.agentai', 'evidence', 'poc-exist.txt');
    fs.mkdirSync(path.dirname(existPath), { recursive: true });
    fs.writeFileSync(existPath, 'HTTP/1.1 200 OK\nX-Injected: true', 'utf-8');
    const missingPath = path.join(WS, '.agentai', 'evidence', 'poc-missing.txt');

    writeVulnFile([
      {
        id: 'vuln-1', ts: 1000, title: 'SQL 注入', target: 'api.airbnb.cn', severity: 'critical',
        vulnType: 'sqli', poc: 'GET /x?id=1\'--', evidence: '响应延迟 5s', evidencePaths: [existPath],
        platform: 'src-abc', platformTrusted: true, status: 'verified',
      },
      {
        id: 'vuln-2', ts: 2000, title: 'XSS', target: 'airbnb.cn', severity: 'medium',
        vulnType: 'xss', poc: '<img src=x onerror=alert(1)>', evidence: '', evidencePaths: [missingPath],
        platform: '', platformTrusted: false, platformWarn: 'platform 为空', status: 'unverified',
      },
      {
        id: 'vuln-3', ts: 3000, title: 'SSRF', target: 'other.com', severity: 'high',
        vulnType: 'ssrf', poc: 'url=http://169.254.169.254', evidence: '', evidencePaths: [],
        platform: 'src-xyz', platformTrusted: true, status: 'reported',
      },
    ]);

    const r = await EXTRA_HANDLERS.bounty_report({}, { workspace: WS });
    expect(r.success).toBe(true);
    const md = String((r.data as any).markdown ?? r.output);
    expect(md).toContain('渗透测试报告');
    // 执行摘要统计
    expect(md).toContain('漏洞总数');
    expect(md).toContain('CRITICAL');
    expect(md).toContain('HIGH');
    expect(md).toContain('MEDIUM');
    // 严重度降序: critical 节在 high 之前
    expect(md.indexOf('CRITICAL 级别漏洞')).toBeLessThan(md.indexOf('HIGH 级别漏洞'));
    expect(md.indexOf('HIGH 级别漏洞')).toBeLessThan(md.indexOf('MEDIUM 级别漏洞'));
    // PoC 被带出
    expect(md).toContain("GET /x?id=1'--");
    expect(md).toContain('<img src=x onerror=alert(1)>');
    // 证据附件存在性校验: 存在 → 📎, 缺失 → ⚠️缺失
    expect(md).toContain('📎');
    expect(md).toContain('⚠️缺失');
    // 归属不可信标记
    expect(md).toContain('归属不可信');
    // 落盘
    const reportPath = (r.data as any).report as string;
    expect(reportPath).toBeTruthy();
    expect(fs.existsSync(reportPath)).toBe(true);
    expect(fs.readFileSync(reportPath, 'utf-8')).toContain('渗透测试报告');
  });

  it('target 过滤: airbnb.cn 召回 api.airbnb.cn 与 airbnb.cn, 不含 other.com', async () => {
    const r = await EXTRA_HANDLERS.bounty_report({ target: 'airbnb.cn' }, { workspace: WS });
    expect(r.success).toBe(true);
    expect((r.data as any).count).toBe(2);
    const md = String((r.data as any).markdown ?? r.output);
    expect(md).toContain('api.airbnb.cn');
    expect(md).toContain('airbnb.cn');
    expect(md).not.toContain('other.com');
  });

  it('minSeverity 过滤: 只保留 high 及以上 (medium 被剔除)', async () => {
    const r = await EXTRA_HANDLERS.bounty_report({ minSeverity: 'high' }, { workspace: WS });
    expect((r.data as any).count).toBe(2); // critical + high
    const md = String((r.data as any).markdown ?? r.output);
    expect(md).not.toContain('MEDIUM 级别漏洞');
  });

  it('status 过滤: 只导出 verified', async () => {
    const r = await EXTRA_HANDLERS.bounty_report({ status: 'verified' }, { workspace: WS });
    expect((r.data as any).count).toBe(1);
    const md = String((r.data as any).markdown ?? r.output);
    expect(md).toContain('SQL 注入');
    expect(md).not.toContain('XSS');
  });

  it('outFile:false → 不落盘, 仍返回 markdown', async () => {
    const r = await EXTRA_HANDLERS.bounty_report({ outFile: false, target: 'airbnb.cn' }, { workspace: WS });
    expect(r.success).toBe(true);
    expect((r.data as any).report).toBeNull();
    expect(String((r.data as any).markdown ?? r.output)).toContain('渗透测试报告');
  });

  it('坏行容错: 混入非法 JSON 行不影响其余记录', async () => {
    const dir = path.join(WS, '.agentai', 'vulns');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'vulns.jsonl'),
      'this is not json\n' + JSON.stringify({ id: 'v-ok', ts: 1, title: 'T', target: 'a.com', severity: 'low', status: 'unverified' }) + '\n',
      'utf-8',
    );
    const r = await EXTRA_HANDLERS.bounty_report({ target: 'a.com' }, { workspace: WS });
    expect(r.success).toBe(true);
    expect((r.data as any).count).toBe(1);
  });
});
