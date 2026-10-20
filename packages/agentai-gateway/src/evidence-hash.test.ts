import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { createHash } from 'node:crypto';

/**
 * ② 赏金防篡改证据包 (2026-10-20, 富哥拍板的三件套第二件)
 *
 * 背景: 赏金平台提交漏洞时, "证据被我固化后未被篡改" 是审核争议里的硬通货。
 * save_evidence 只落盘无哈希语义; 本工具把 request_raw/response_raw/
 * extracted_sensitive_data 打成规范化 JSON 包 + SHA-256, verify 动作供平台方独立重算。
 *
 * 验收要点 (与实锤攻击面对应):
 *  - 哈希覆盖**磁盘真实字节** (写完读回再算), 不是入参字符串
 *  - 篡改一个字节 → MISMATCH (防篡改语义真的生效)
 *  - 超长字段截断 + 包内登记 (不假装完整, 哈希仍有效)
 *  - 必填/空内容/verify 缺参 → 明确失败, 不静默
 */

const mkWs = () => {
  const ws = mkdtempSync(nodePath.join(tmpdir(), 'evidence-hash-'));
  mkdirSync(nodePath.join(ws, '.agentai'), { recursive: true });
  return ws;
};

describe('② save_and_hash_evidence: 防篡改证据包', () => {
  // ⚠️ 冷启敏感: 动态 import('./tools.ts') 是 10k 行 @ts-nocheck 模块 — 单跑 ~9s,
  //    全套 10 文件并行下 ~10s+, 会顶爆默认 testTimeout 10000 (D3 测试同款坑)。
  //    功能本身毫秒级, 给显式 30s 消除时序脆弱。
  it('save: 落盘 + SHA-256 覆盖磁盘真实字节 (与重算一致)', async () => {
    const { EXTRA_HANDLERS } = await import('./tools.ts');
    const ws = mkWs();
    try {
      const r = await EXTRA_HANDLERS['save_and_hash_evidence']({
        vuln_type: 'IDOR_Data_Leak',
        target: 'api.example.com',
        request_raw: 'GET /v1/user/1002 HTTP/1.1\nHost: api.example.com',
        response_raw: 'HTTP/1.1 200 OK\nContent-Type: application/json\n\n{"id":1002,"phone":"138****1234"}',
        extracted_sensitive_data: '138****1234 (已脱敏)',
      }, { workspace: ws } as any);
      expect(r.success).toBe(true);
      const file = r.data.evidencePaths[0];
      expect(existsSync(file)).toBe(true);
      // 返回的哈希 == 磁盘文件重算哈希 (覆盖真实字节, 不是入参)
      const onDisk = createHash('sha256').update(readFileSync(file)).digest('hex');
      expect(r.data.sha256).toBe(onDisk);
      expect(r.data.sha256).toMatch(/^[0-9a-f]{64}$/);
      // 机器可读标记 (前端/报告聚合按同约定解析)
      expect(r.output).toContain('EVIDENCE_PATHS:');
      expect(r.output).toContain('EVIDENCE_SHA256:');
      // 包内容: schema + 三段原文 + 固化时间
      const pkg = JSON.parse(readFileSync(file, 'utf-8'));
      expect(pkg.schema).toBe('agentai-evidence/v1');
      expect(pkg.vuln_type).toBe('IDOR_Data_Leak');
      expect(pkg.request_raw).toContain('/v1/user/1002');
      expect(pkg.response_raw).toContain('138****1234');
      expect(typeof pkg.captured_at).toBe('string');
      expect(pkg.truncated_fields).toEqual([]);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  }, 30_000);

  it('verify: 原样文件 MATCH; 改一个字节 MISMATCH (防篡改语义实锤)', async () => {
    const { EXTRA_HANDLERS } = await import('./tools.ts');
    const ws = mkWs();
    try {
      const r = await EXTRA_HANDLERS['save_and_hash_evidence']({
        vuln_type: 'XSS_Reflected', target: 'www.example.com',
        request_raw: 'GET /s?q=<script>alert(1)</script>',
        response_raw: 'HTTP/1.1 200 OK\n\n<script>alert(1)</script>',
      }, { workspace: ws } as any);
      const file = r.data.evidencePaths[0];
      const sha = r.data.sha256;

      const ok = await EXTRA_HANDLERS['save_and_hash_evidence']({
        action: 'verify', evidence_path: file, expected_sha256: sha,
      }, { workspace: ws } as any);
      expect(ok.success).toBe(true);
      expect(ok.output).toContain('MATCH');
      expect(ok.data.match).toBe(true);

      // 篡改: 往包里加一个字符 (模拟"固化后被改")
      writeFileSync(file, readFileSync(file, 'utf-8') + ' ', 'utf-8');
      const bad = await EXTRA_HANDLERS['save_and_hash_evidence']({
        action: 'verify', evidence_path: file, expected_sha256: sha,
      }, { workspace: ws } as any);
      expect(bad.success).toBe(false);
      expect(bad.output).toContain('MISMATCH');
      expect(bad.data.match).toBe(false);
      expect(bad.data.actual).not.toBe(sha);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('必填校验: 缺 vuln_type / 三段全空 / verify 缺参 → 明确失败', async () => {
    const { EXTRA_HANDLERS } = await import('./tools.ts');
    const ws = mkWs();
    try {
      const noType = await EXTRA_HANDLERS['save_and_hash_evidence']({
        request_raw: 'GET / HTTP/1.1',
      }, { workspace: ws } as any);
      expect(noType.success).toBe(false);
      expect(noType.output).toContain('vuln_type');

      const empty = await EXTRA_HANDLERS['save_and_hash_evidence']({
        vuln_type: 'IDOR_Data_Leak',
      }, { workspace: ws } as any);
      expect(empty.success).toBe(false);
      expect(empty.output).toContain('至少给一项');

      const badVerify = await EXTRA_HANDLERS['save_and_hash_evidence']({
        action: 'verify', evidence_path: '',
      }, { workspace: ws } as any);
      expect(badVerify.success).toBe(false);

      const missingFile = await EXTRA_HANDLERS['save_and_hash_evidence']({
        action: 'verify', evidence_path: nodePath.join(ws, 'nope.json'), expected_sha256: 'a'.repeat(64),
      }, { workspace: ws } as any);
      expect(missingFile.success).toBe(false);
      expect(missingFile.output).toContain('不存在');
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('超长字段截断 + 包内登记 (哈希仍覆盖真实字节)', async () => {
    const { EXTRA_HANDLERS } = await import('./tools.ts');
    const ws = mkWs();
    try {
      const huge = 'A'.repeat(250_000);
      const r = await EXTRA_HANDLERS['save_and_hash_evidence']({
        vuln_type: 'OSS_Public_Read', target: 'bucket.oss-cn-hangzhou.aliyuncs.com',
        response_raw: huge,
      }, { workspace: ws } as any);
      expect(r.success).toBe(true);
      expect(r.data.truncatedFields).toContain('response_raw');
      expect(r.output).toContain('已截断字段');
      const pkg = JSON.parse(readFileSync(r.data.evidencePaths[0], 'utf-8'));
      expect(pkg.truncated_fields).toEqual(['response_raw']);
      expect(pkg.response_raw.length).toBeLessThan(huge.length);
      expect(pkg.response_raw).toContain('truncated by agentai');
      // 截断不影响哈希有效性: verify 仍 MATCH
      const v = await EXTRA_HANDLERS['save_and_hash_evidence']({
        action: 'verify', evidence_path: r.data.evidencePaths[0], expected_sha256: r.data.sha256,
      }, { workspace: ws } as any);
      expect(v.data.match).toBe(true);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('文件名/目录按 save_evidence 约定归组 (target-title + 时间戳)', async () => {
    const { EXTRA_HANDLERS } = await import('./tools.ts');
    const ws = mkWs();
    try {
      const r = await EXTRA_HANDLERS['save_and_hash_evidence']({
        vuln_type: 'IDOR_Data_Leak', target: 'api.example.com', title: 'idor-user-order',
        request_raw: 'GET /v1/order/1001',
      }, { workspace: ws } as any);
      const file = r.data.evidencePaths[0];
      expect(file).toContain(nodePath.join('.agentai', 'evidence', 'api.example.com-idor-user-order'));
      expect(nodePath.basename(file)).toMatch(/^\d{4}-\d{2}-\d{2}T.*-IDOR_Data_Leak\.json$/);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});

describe('② 接线契约 (schema / 角色 / 优先级名单)', () => {
  it('EXTRA_TOOLS 有 schema 声明 (build 的 231→232 工具校验靠它)', async () => {
    const { EXTRA_TOOLS } = await import('./tools.ts');
    const t = EXTRA_TOOLS.find((x: any) => x.name === 'save_and_hash_evidence');
    expect(t, 'schema 未注册').toBeTruthy();
    expect(t.parameters.properties.vuln_type).toBeTruthy();
    expect(t.parameters.properties.action.enum).toEqual(['save', 'verify']);
    expect(t.riskLevel).toBe('low');
  });

  it('pentest exploit/validator 角色工具集含新工具 (子代理能用)', async () => {
    const { PENTEST_ROLE_DEFS } = await import('./pentest/roles.ts');
    for (const role of ['pentest_exploit', 'pentest_validator']) {
      expect((PENTEST_ROLE_DEFS as any)[role].tools).toContain('save_and_hash_evidence');
    }
  });

  it('SECURITY_OPS_TOOLS + PRIORITY_TOOLS + DEGRADE 保留名单 + playbook 提示 五处同源', async () => {
    const { readFileSync } = await import('node:fs');
    const rd = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf-8');
    expect(rd('./security-playbook.ts')).toContain("'save_and_hash_evidence'");
    const loopSrc = rd('./agentai-loop.ts');
    expect(loopSrc).toContain("'save_evidence', 'save_and_hash_evidence'");
    // playbook 工作流告诉 AI 何时用 (阶段 4)
    expect(rd('./security-playbook.ts')).toContain('save_and_hash_evidence 打防篡改证据包');
    // pentest 主 prompt 也教了这条证据链
    expect(rd('./subagent.ts')).toContain('save_and_hash_evidence({vuln_type');
  });
});
