/**
 * subagent-policy 回归测试 — 2026-10-21
 * ----------------------------------------------------------------
 * 富哥拍板: 「做赏金任务要不要子智能体其实没什么用, 其它长任务是可以用的」
 * 本测试锁死这条策略的**代码闸门**行为 (提示词只是双保险, 不测):
 *   ① pentest 类型 → 禁 (不论工作区)
 *   ② 赏金/渗透工作区 → 禁 (不论类型)
 *   ③ 普通工作区 + 非 pentest 类型 → 放行
 *   ④ 防误伤: 'src' 路径不躺枪; 任务文本不参与判定 ("修复登录漏洞" 是开发任务)
 *   ⑤ 拒绝理由必须带替代路径 (batch_pentest / pentest_pipeline),
 *      否则 AI 被拒后不知道下一步干什么, 只会反复重试同一请求
 */
import { describe, it, expect } from 'vitest';
import { checkSubagentSpawnPolicy, isBountyWorkspace } from './subagent-policy.js';

describe('isBountyWorkspace: 赏金工作区判定 (工具下发的 security 信号)', () => {
  it('命中赏金关键词变体', () => {
    for (const ws of ['F:\\挖洞赏金', 'D:/赏金猎人', 'D:/bug-bounty', 'D:/hackerone-scope', 'D:/渗透测试项目']) {
      expect(isBountyWorkspace(ws)).toBe(true);
    }
  });

  it('普通开发工作区不误判 (含 src 也不躺枪)', () => {
    expect(isBountyWorkspace('D:/projects/agentai-platform')).toBe(false);
    expect(isBountyWorkspace('F:/agentai-platform/packages/agentai-gui/src')).toBe(false);
  });

  it('空/undefined 安全', () => {
    expect(isBountyWorkspace('')).toBe(false);
    expect(isBountyWorkspace(undefined)).toBe(false);
    expect(isBountyWorkspace(null)).toBe(false);
  });
});

describe('subagent-policy: 赏金/渗透任务禁派子智能体', () => {
  describe('① pentest 类型一律禁 (不论工作区)', () => {
    it('pentest_recon 在普通工作区也被禁', () => {
      const r = checkSubagentSpawnPolicy({ type: 'pentest_recon', task: '扫端口', workspace: 'D:/projects/demo' });
      expect(r.allowed).toBe(false);
      expect(r.rule).toBe('pentest_type');
    });

    it('pentest_exploit / pentest_validator / pentest_planner 同样被禁', () => {
      for (const type of ['pentest_exploit', 'pentest_validator', 'pentest_planner', 'pentest']) {
        const r = checkSubagentSpawnPolicy({ type, workspace: 'D:/projects/demo' });
        expect(r.allowed).toBe(false);
        expect(r.rule).toBe('pentest_type');
      }
    });

    it('大小写不敏感: PENTEST_RECON / Pentest 也拦', () => {
      expect(checkSubagentSpawnPolicy({ type: 'PENTEST_RECON', workspace: 'D:/x' }).allowed).toBe(false);
      expect(checkSubagentSpawnPolicy({ type: 'Pentest', workspace: 'D:/x' }).allowed).toBe(false);
    });
  });

  describe('② 赏金/渗透工作区一律禁 (不论类型)', () => {
    it('F:\\挖洞赏金 工作区派 research 也被禁 (实证事故现场)', () => {
      const r = checkSubagentSpawnPolicy({ type: 'research', task: '调研', workspace: 'F:\\挖洞赏金' });
      expect(r.allowed).toBe(false);
      expect(r.rule).toBe('bounty_workspace');
    });

    it('命中各赏金关键词变体', () => {
      const paths = [
        'D:/赏金猎人',
        'D:/bug-bounty',
        'D:/bugbounty-targets',
        'D:/hackerone-scope',
        'D:/渗透测试项目',
        'D:/漏洞猎手',
      ];
      for (const workspace of paths) {
        expect(checkSubagentSpawnPolicy({ type: 'explore', workspace }).allowed).toBe(false);
      }
    });
  });

  describe('③ 普通长任务放行', () => {
    it('普通工作区 + explore/research/review 放行', () => {
      for (const type of ['explore', 'research', 'review', 'general', '']) {
        const r = checkSubagentSpawnPolicy({ type, task: '读代码', workspace: 'D:/projects/agentai-platform' });
        expect(r.allowed).toBe(true);
        expect(r.rule).toBeUndefined();
        expect(r.reason).toBeUndefined();
      }
    });

    it('battle 类型在普通工作区放行 (竞争择优是另一条能力线)', () => {
      const r = checkSubagentSpawnPolicy({ type: 'battle', workspace: 'D:/projects/demo' });
      expect(r.allowed).toBe(true);
    });
  });

  describe('④ 防误伤边界', () => {
    it("路径含 'src' 不躺枪 (每个项目都有 src/)", () => {
      const r = checkSubagentSpawnPolicy({ type: 'explore', workspace: 'D:/projects/myapp/src' });
      expect(r.allowed).toBe(true);
    });

    it('任务文本不参与判定 — "修复登录漏洞" 是开发任务, 放行', () => {
      const r = checkSubagentSpawnPolicy({
        type: 'research',
        task: '修复登录接口的越权漏洞',
        workspace: 'D:/projects/webapp',
      });
      expect(r.allowed).toBe(true);
    });

    it('空 workspace + 空 type → 放行 (无信号不拦)', () => {
      expect(checkSubagentSpawnPolicy({}).allowed).toBe(true);
      expect(checkSubagentSpawnPolicy({ workspace: '' }).allowed).toBe(true);
    });
  });

  describe('⑤ 拒绝理由必须带替代路径 (AI 被拒后知道下一步)', () => {
    it('pentest 类型拒绝理由含 batch_pentest 与 pentest_pipeline', () => {
      const r = checkSubagentSpawnPolicy({ type: 'pentest_recon', workspace: 'D:/demo' });
      expect(r.reason).toContain('batch_pentest');
      expect(r.reason).toContain('pentest_pipeline');
    });

    it('赏金工作区拒绝理由含替代路径与工作区名 (便于定位)', () => {
      const r = checkSubagentSpawnPolicy({ type: 'research', workspace: 'F:\\挖洞赏金' });
      expect(r.reason).toContain('F:\\挖洞赏金');
      expect(r.reason).toContain('batch_pentest');
    });
  });
});
