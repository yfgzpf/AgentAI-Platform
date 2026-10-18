/**
 * 信息架构回归 — 常驻 UI 的"折叠"约定 (2026-10-11)
 * ========================================================================
 * 用户反馈原话: 「再审前端, 我感觉 还是非常的乱不简洁」。
 * 设计尺度 (字号/圆角/颜色) 已由 token-layer 收敛, 剩下的"乱"来自**信息架构**:
 * 同一屏里塞了太多**平级、平铺**的碎片, 每个都只值一次悬停。
 *
 * 本轮收敛的三处 (均以"常驻 → 折叠"为准):
 *  1. 底部状态栏: `QQ` / `微信` 两个常驻 chip + 两个 hover tooltip
 *     → 一个 `渠道` 聚合点 (异常色由聚合点承担) + Popover 明细。
 *  2. 底部状态栏: `置信` / `意图` / `计划` / 心境 / `费用` / 模型 6 个
 *     **tooltip-only** 诊断值 (label+值, 悬停才有细节) 平铺
 *     → 一个 `本次会话` Popover 入口 (低置信时才带红点)。
 *     保留 `TokenPressureBar` 常驻 —— 它是条状图, 一眼可读, 与 6 个纯文本片段不同。
 *  3. 标题栏右区: `GitHub 仓库`(外链) + `联系开发者` + `用户名` 三个控件
 *     → 一个 `用户菜单` (前两者不是操作, 是"关于")。
 *  4. `系统` 下拉 15 项平铺 → 按 section 分段 (段标题 + 分隔线),
 *     且**同 section 必须连续** (下拉按 PAGES 数组顺序渲染, 不连续就会重复段头)。
 *  5. 「免费内置模型」提示条: 常驻压在页面顶部 → 可关闭并记住 (localStorage)。
 *
 * 断言对象是**源码文本** (与 layout-panes / rail-browser / token-layer 同一套路),
 * 因为这些都是结构性约定, 单测渲染不出来。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const GUI = 'packages/agentai-gui';
const ROOT = resolve(__dirname, '..', '..', '..');
const src = (p: string) => readFileSync(join(ROOT, GUI, 'src', p), 'utf-8');

/** 去掉注释行 —— 修复点旁边的注释会引用「原来是…」的旧写法, 直接 grep 会假阳性 */
const stripComments = (code: string) =>
  code.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

const count = (s: string, re: RegExp) => (s.match(re) || []).length;

// ════════════════════════════════════════════════════════════════════════
// 1) 底部状态栏: 渠道折叠 + 本次会话折叠
// ════════════════════════════════════════════════════════════════════════

describe('状态栏: 常驻碎片已折叠 (2026-10-11)', () => {
  const raw = src('components/StatusBar.tsx');
  const clean = stripComments(raw);

  it('引入了 Popover 且恰好 2 个折叠入口 (渠道 / 本次会话)', () => {
    expect(clean).toMatch(/import\s*\{[^}]*Popover[^}]*\}\s*from\s*'antd'/);
    expect(count(clean, /<Popover\b/g)).toBe(2);
  });

  it('渠道聚合点存在, 且 QQ/微信 明细仍在 (功能未丢)', () => {
    expect(clean).toContain('data-testid="statusbar-channels"');
    expect(clean).toContain('data-testid="statusbar-channels-panel"');
    // 明细行必须仍在 popover 内, 否则就是"删功能"而不是"折叠"
    expect(clean).toMatch(/statusDot\(qq, /);
    expect(clean).toMatch(/statusDot\(wx, /);
    // 聚合点要能一眼看出异常 → 必须有聚合色
    expect(clean).toContain('chanColor');
  });

  it('QQ / 微信 不再是常驻 chip (裸 label 已从状态栏主体移除)', () => {
    // 原写法: <span style={... 'var(--muted-2)' }}>QQ</span>
    expect(clean).not.toMatch(/'var\(--muted-2\)'\s*\}\}>QQ<\/span>/);
    expect(clean).not.toMatch(/'var\(--muted-2\)'\s*\}\}>微信<\/span>/);
  });

  it('本次会话 6 项诊断值折叠为一个入口', () => {
    expect(clean).toContain('data-testid="statusbar-session"');
    expect(clean).toContain('data-testid="statusbar-session-panel"');
    expect(clean).toContain('hasSessionStats');
    // 原来的 6 个平铺 chip 标签必须消失 (popover 里用的是「置信度」这类完整词)
    for (const label of ['置信', '意图', '计划', '费用']) {
      expect(clean).not.toContain(`>${label}</span>`);
    }
  });

  it('TokenPressureBar 保持常驻 (条状图, 一眼可读, 不该一起折叠)', () => {
    expect(clean).toMatch(/<TokenPressureBar\b/);
    // 它必须落在「本次会话」Popover 之外: 从入口 span 到 TokenPressureBar 之间,
    // 应当正好有一个 </Popover> 把它关在门外; 为 0 说明被塞进了 popover。
    const between = clean.slice(
      clean.indexOf('data-testid="statusbar-session"'),
      clean.indexOf('<TokenPressureBar'),
    );
    expect(between.length).toBeGreaterThan(0);
    expect(count(between, /<\/Popover>/g)).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 2) 标题栏: 关于类控件并入用户菜单
// ════════════════════════════════════════════════════════════════════════

describe('标题栏: 关于类控件已并入用户菜单 (2026-10-11)', () => {
  const clean = stripComments(src('App.tsx'));

  it('用户菜单存在且唯一', () => {
    expect(clean).toContain('data-testid="user-menu"');
    expect(count(clean, /data-testid="user-menu"/g)).toBe(1);
  });

  it('GitHub / 联系开发者 不再是标题栏独立图标', () => {
    // 原来各自是一个 <Tooltip title="..."> 包着的 30×30 图标; tooltip 标题消失即说明
    // 独立图标已移除。不数 <WechatOutlined /> 个数 —— 联系开发者弹窗正文里还有一个 32px 图标。
    expect(clean).not.toContain('title="GitHub 仓库"');
    expect(clean).not.toContain('title="联系开发者"');
    expect(count(clean, /<GithubOutlined\b/g)).toBe(1);
  });

  it('菜单仍保留跳转与弹窗能力', () => {
    expect(clean).toContain('https://github.com/pulseflow/platform');
    expect(clean).toMatch(/setWechatModalVisible\(true\)/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 3) 系统下拉: 15 项按 section 分段, 且同段连续
// ════════════════════════════════════════════════════════════════════════

describe('系统下拉分段 (2026-10-11)', () => {
  const clean = stripComments(src('App.tsx'));

  /** 按 PAGES 数组顺序取出 system 组的 section (下拉即按此顺序渲染) */
  const systemSections = clean
    .split('\n')
    .filter(l => l.includes("group: 'system'"))
    .map(l => (l.match(/section: '([^']+)'/) || ['', ''])[1]);

  it('每个 system 页都标了 section (漏标即静默掉进"无段"区)', () => {
    expect(systemSections.length).toBeGreaterThanOrEqual(14);
    expect(systemSections.filter(s => !s)).toEqual([]);
  });

  it('section 至少 4 段 (15 项一段到底就没有分段的必要)', () => {
    expect(new Set(systemSections).size).toBeGreaterThanOrEqual(4);
  });

  it('同 section 在数组里必须连续 —— 否则下拉里会重复出现段标题', () => {
    const closed = new Set<string>();
    let prev = '';
    for (const s of systemSections) {
      if (s === prev) continue;
      expect(closed.has(s), `section「${s}」被拆成不连续的多块`).toBe(false);
      if (prev) closed.add(prev);
      prev = s;
    }
  });

  it('NavGroupDropdown 支持段头渲染, 且由 p.section 透传', () => {
    // 2026-10-12: 实现本体搬至 app/NavGroupDropdown.tsx (App.tsx 瘦身第一批),
    // 此处同时断言「实现存在」与「App.tsx 已接线」, 防搬走后就没人引用。
    const nav = stripComments(src('app/NavGroupDropdown.tsx'));
    expect(nav).toMatch(/section\?:\s*string/);
    expect(nav).toMatch(/showSection/);
    expect(nav).toContain('role="menuitem"');
    // 段标题的透传发生在 App.tsx 组装 NavGroupItem 时 (section: p.section)
    expect(clean).toMatch(/section:\s*p\.section/);
    expect(clean).toContain('NavGroupDropdown');
  });
});

// ════════════════════════════════════════════════════════════════════════
// 4) 「免费内置模型」提示条可关闭
// ════════════════════════════════════════════════════════════════════════

describe('免费内置模型提示条可关闭 (2026-10-11)', () => {
  // 2026-10-12: FeatureGuide 本体搬至 app/FeatureGuide.tsx (App.tsx 瘦身第一批),
  // 故断言目标改为新文件, 并加一条「App.tsx 仍引用它」防接线断掉。
  const guide = stripComments(src('app/FeatureGuide.tsx'));
  const clean = stripComments(src('App.tsx'));

  it('App.tsx 已引用搬出的 FeatureGuide', () => {
    expect(clean).toContain('import { FeatureGuide }');
  });

  it('有关闭入口 + localStorage 记忆', () => {
    expect(guide).toContain('data-testid="nag-dismiss"');
    expect(guide).toContain('agentai.nag.freeModelDismissed');
    // 关闭后必须短路返回 children (否则关不掉)
    expect(guide).toMatch(/isActivated \|\| !page\.requireSubscription \|\| dismissed/);
  });

  it('localStorage 取值有 try/catch (隐私模式不能炸)', () => {
    expect(guide).toMatch(/try\s*\{\s*return localStorage\.getItem\(NAG_KEY\)/);
  });
});
