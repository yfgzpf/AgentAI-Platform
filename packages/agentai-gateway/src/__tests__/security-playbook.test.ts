import { describe, it, expect } from 'vitest';
import {
  SECURITY_PLAYBOOK,
  TOOL_DEVIATION_DIRECTIVE,
  SECURITY_OPS_TOOLS,
  shouldTripToolDeviation,
} from '../security-playbook.js';
import { buildWslScanAdvice } from '../tools.js';
import { TOOL_GROUPS } from '../tool-groups.js';

describe('security-playbook: 主对话注入的工作流', () => {
  it('五阶段全部在场 (授权→侦察→扫描→验证→报告)', () => {
    for (const phase of ['授权确认', '资产侦察', '漏洞扫描', '验证与深挖', '报告']) {
      expect(SECURITY_PLAYBOOK).toContain(phase);
    }
  });

  it('每阶段都点名了该用的专用工具', () => {
    // 阶段 2 侦察
    expect(SECURITY_PLAYBOOK).toMatch(/enum_subdomains[\s\S]*?wsl_scan[\s\S]*?extract_js_endpoints/);
    // 阶段 3 扫描: nmap/nuclei/sqlmap 组合
    expect(SECURITY_PLAYBOOK).toContain('nmap -sV');
    expect(SECURITY_PLAYBOOK).toContain('nuclei');
    expect(SECURITY_PLAYBOOK).toContain('sqlmap');
    // 阶段 4 验证: http_replay
    expect(SECURITY_PLAYBOOK).toContain('http_replay');
    // 阶段 5 报告
    expect(SECURITY_PLAYBOOK).toContain('report_vulnerability');
    expect(SECURITY_PLAYBOOK).toContain('save_evidence');
  });

  it('工具选择铁律点名"手搓脚本"这个实锤坑', () => {
    expect(SECURITY_PLAYBOOK).toContain('run_command');
    expect(SECURITY_PLAYBOOK).toContain('probe8.js');
    expect(SECURITY_PLAYBOOK).toContain('probe_pay10.js');
  });

  it('授权底线声明在场 (未授权不扫)', () => {
    expect(SECURITY_PLAYBOOK).toContain('未授权目标一律不扫');
  });

  it('长度受控 (每轮进 immutablePrefix, 不许膨胀)', () => {
    // 与 pentest-pipeline.test.ts 同一定义: 2026-10-20 新增防篡改证据包/业务逻辑闸门/
    // 定向打击链三条硬规则后, 上限从 2500 抬到 3400 (仍为单段注入量级, 不允许无界增长)
    expect(SECURITY_PLAYBOOK.length).toBeLessThanOrEqual(3400);
  });
});

describe('security-playbook: 偏离纠正', () => {
  it('阈值判定: 6 批触发, 5 批不触发', () => {
    expect(shouldTripToolDeviation(5)).toBe(false);
    expect(shouldTripToolDeviation(6)).toBe(true);
    expect(shouldTripToolDeviation(7)).toBe(true);
  });

  it('自定义阈值生效', () => {
    expect(shouldTripToolDeviation(3, 3)).toBe(true);
    expect(shouldTripToolDeviation(2, 3)).toBe(false);
  });

  it('纠正指令指向具体工具, 不是空泛的"注意点"', () => {
    expect(TOOL_DEVIATION_DIRECTIVE).toContain('wsl_scan');
    expect(TOOL_DEVIATION_DIRECTIVE).toContain('http_replay');
    expect(TOOL_DEVIATION_DIRECTIVE).toContain('enum_subdomains');
    // 必须点名正在犯的错 (否则 AI 不知道在说自己)
    expect(TOOL_DEVIATION_DIRECTIVE).toContain('run_command');
  });

  it('SECURITY_OPS_TOOLS 与 tool-groups 的 security_ops 组一致', () => {
    // 2026-10-19: 原来硬编码 expect(size).toBe(10) —— 能力扩充后必然假失败。
    // 真意图是**两边一致** (集合级契约), 不是"永远 10 个"。改为互为子集双向校验。
    const group = new Set(TOOL_GROUPS.security_ops ?? []);
    for (const t of group) expect(SECURITY_OPS_TOOLS.has(t)).toBe(true);
    for (const t of SECURITY_OPS_TOOLS) expect(group.has(t)).toBe(true);
    // 核心 10 个渗透工具一个都不能少 (防"精简"时把关键能力删掉)
    for (const t of ['wsl_scan', 'enum_subdomains', 'extract_js_endpoints', 'http_replay',
      'batch_pentest', 'scope_guard', 'grant_scope', 'list_scope', 'report_vulnerability', 'save_evidence']) {
      expect(SECURITY_OPS_TOOLS.has(t)).toBe(true);
    }
  });
});

describe('buildWslScanAdvice: wsl_scan 失败必须可行动', () => {
  it('WSL/Kali 未装 → 让用户装 + 给顶替方案 + 禁止手搓', () => {
    const a = buildWslScanAdvice('Command failed: wsl -d kali-linux -- nmap target\n适用于 Linux 的 Windows 子系统没有安装分发版。');
    expect(a).toContain('wsl --install -d kali-linux');
    expect(a).toContain('enum_subdomains');
    expect(a).toContain('http_replay');
    expect(a).toContain('不要改用 run_command 手搓');
    // 必须说明"为什么必须用户装" — Agent 的 wsl.exe 被黑名单挡
    expect(a).toContain('程序黑名单');
  });

  it('扫描器未装 → 给 apt install 命令 + 顶替方案', () => {
    const a = buildWslScanAdvice('bash: nmap: command not found');
    expect(a).toContain('apt-get install -y nmap');
    expect(a).toContain('enum_subdomains');
    expect(a).toContain('http_replay');
  });

  it('其他失败 → 简短指引, 不编造安装命令', () => {
    const a = buildWslScanAdvice('spawn wsl ENOENT');
    expect(a).not.toContain('wsl --install');
    expect(a).not.toContain('apt-get install');
    expect(a).toContain('授权范围');
  });

  it('三条路都禁止"绕道手搓脚本" (这是实锤死循环根因)', () => {
    const cases = [
      '没有安装分发版',
      'nmap: command not found',
      'spawn ENOENT',
    ];
    for (const c of cases) {
      expect(buildWslScanAdvice(c)).toContain('run_command');
    }
  });
});
