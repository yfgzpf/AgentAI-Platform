import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { detectBusinessLogicTamper } from './agentai-loop.js';

/**
 * ③ 赏金 prompt 三件套收尾 (2026-10-20): 场景 D 审批门 + A/B/C 定向打击链剧本
 *
 * D 门是**代码级强制** — 赏金 prompt 场景 D (price=0/-1、redirect_uri 劫持) 是真实
 * 生产写入, prompt 克制条款不可信 (medium=死同款病)。判据钉死形态 + 作用域限定
 * security/pentest 语境 (开发场景 price=0 自测不误伤 — 丝滑性优先)。
 */

describe('③-D detectBusinessLogicTamper: 业务逻辑篡改判据', () => {
  it('判据①: 金额/数量 = 0 或负值 → hit (三种载荷形态)', () => {
    expect(detectBusinessLogicTamper('http_replay', {
      method: 'POST', url: 'https://shop.example.com/api/order',
      body: '{"itemId":1001,"price":0,"quantity":1}',
    }).hit).toBe(true);
    expect(detectBusinessLogicTamper('http_replay', {
      method: 'POST', url: 'https://shop.example.com/api/order',
      body: '{"amount": -1}',
    }).hit).toBe(true);
    expect(detectBusinessLogicTamper('run_command', {
      command: 'curl -d "price=-0.01&total=0" https://shop.example.com/pay',
    }).hit).toBe(true);
    // form 形态 quantity=0
    expect(detectBusinessLogicTamper('http_replay', {
      method: 'POST', url: 'https://shop.example.com/cart', body: 'quantity=0',
    }).hit).toBe(true);
  });

  it('判据②: redirect_uri/callback 指向外部 host → hit; 同 host 不误伤', () => {
    expect(detectBusinessLogicTamper('http_replay', {
      method: 'GET', url: 'https://sso.example.com/oauth/authorize',
      body: 'redirect_uri=https://evil.example.net/callback&state=x',
    }).hit).toBe(true);
    // 同 host (含子域) 是正常 OAuth 流, 不拦
    expect(detectBusinessLogicTamper('http_replay', {
      method: 'GET', url: 'https://sso.example.com/oauth/authorize',
      body: 'redirect_uri=https://app.example.com/cb',
    }).hit).toBe(false);
  });

  it('丝滑性: 正常载荷零误伤 (price=100 / 裸 url 参数 / 无目标 url)', () => {
    // 正常价格
    expect(detectBusinessLogicTamper('http_replay', {
      method: 'POST', url: 'https://shop.example.com/api/order', body: '{"price":100}',
    }).hit).toBe(false);
    // 裸 url 参数指向 CDN 是正常载荷 (刻意不收 — 收了误伤成片)
    expect(detectBusinessLogicTamper('http_replay', {
      method: 'POST', url: 'https://api.example.com/collect',
      body: '{"url":"https://cdn.example.com/a.js","amount":99}',
    }).hit).toBe(false);
    // 无 args.url 时判据②不启动 (没有"目标 host"可比对)
    expect(detectBusinessLogicTamper('run_command', {
      command: 'curl -d "redirect_uri=https://evil.com" https://x/y',
    }).hit).toBe(true); // command 串里两者都有 → 仍命中 (url 出现在 command 里)
  });

  it('作用域: 非载荷工具不检测 (write_file 内容里的 price=0 与我无关)', () => {
    expect(detectBusinessLogicTamper('write_file', {
      file_path: 'test/fixture.json', content: '{"price":0}',
    }).hit).toBe(false);
    expect(detectBusinessLogicTamper('read_file', { file_path: 'a.txt' }).hit).toBe(false);
    // 空 body 的 GET 不炸
    expect(detectBusinessLogicTamper('http_replay', { method: 'GET', url: 'https://a.example.com' }).hit).toBe(false);
  });
});

describe('③-D dispatch 接线契约 (源码级)', () => {
  const loopSrc = readFileSync(new URL('./agentai-loop.ts', import.meta.url), 'utf-8');

  it('非文件工具分支挂了闸门 + auto 拒绝 + planning 审批 (超时=拒)', () => {
    expect(loopSrc).toContain('const tamper = this._detectBusinessLogicTamper(tc.name, tc.args);');
    // 作用域: 只在 security / pentest 子代理语境
    expect(loopSrc).toContain("this._taskType === 'security'");
    expect(loopSrc).toContain("String(this.opts.subagentType || '').startsWith('pentest')");
    // auto: 命中即拒 (明确 tool 错误, 不是静默成功)
    expect(loopSrc).toContain('[安全拒绝] 检测到业务逻辑篡改载荷');
    // planning/review: 人类审批, 超时=拒绝 (与 delete_file 同级)
    expect(loopSrc).toMatch(/type: 'business_logic'/);
    expect(loopSrc).toMatch(/业务逻辑篡改审批\] \$\{tc\.name\}/);
  });

  it('私有方法委托模块级纯函数 (判据单一来源, 测试直打不复制)', () => {
    expect(loopSrc).toContain('return detectBusinessLogicTamper(toolName, args);');
    expect(loopSrc).toContain('export function detectBusinessLogicTamper');
  });
});

describe('③-ABC 定向打击链剧本 (契约)', () => {
  const rolesSrc = readFileSync(new URL('./pentest/roles.ts', import.meta.url), 'utf-8');
  const playbookSrc = readFileSync(new URL('./security-playbook.ts', import.meta.url), 'utf-8');
  const subagentSrc = readFileSync(new URL('./subagent.ts', import.meta.url), 'utf-8');

  it('EXPLOIT_PROMPT 含 A/B/C/D 四个场景 + 即停线 + 脱敏纪律', () => {
    expect(rolesSrc).toContain('## 定向打击链');
    expect(rolesSrc).toContain('### A · 云 API Key 泄露');
    expect(rolesSrc).toContain('### B · 未授权/越权 (IDOR) 深挖');
    expect(rolesSrc).toContain('### C · 对象存储 (OSS/S3) 配置错误');
    expect(rolesSrc).toContain('### D · 业务逻辑/状态机');
    // 即停线 (prompt 原文的克制参数变成可执行纪律)
    expect(rolesSrc).toContain('遍历上限 20-50 个 ID');
    expect(rolesSrc).toContain('**敏感度即停**');
    expect(rolesSrc).toContain('只下载一个样本');
    expect(rolesSrc).toContain('脱敏后 (138****1234) 存入 save_and_hash_evidence');
    // 云服务商 host 授权纪律 (scope 闸门覆盖第三方 API — 与 F1 一致)
    expect(rolesSrc).toContain('先向用户说明并取得同意');
  });

  it('playbook 铁律段 + pentest 主 prompt 都宣告了 D 门存在 (AI 不反复撞墙)', () => {
    expect(playbookSrc).toContain('**业务逻辑篡改有代码级闸门**');
    expect(playbookSrc).toContain('auto 模式拒绝, planning/review 需人类审批');
    expect(subagentSrc).toContain('dispatch 层有**代码级闸门**');
    expect(subagentSrc).toContain('别尝试拆参数/编码/换工具绕过');
  });
});
