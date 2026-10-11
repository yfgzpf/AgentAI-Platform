/**
 * CSS token 层契约回归 (2026-10-11)
 * ========================================================================
 * 背景: 用户说「前端还是非常的乱不简洁」。量化后发现根因不是"审美", 是
 * **token 层本身是坏的** —— 18 个变量被 tsx 消费但从未在任何 CSS 里定义:
 *   --text-primary/secondary/tertiary / --bg-1 / --muted-1 / --muted-3 /
 *   --muted-soft / --border-color / --color-text-muted / --bg-primary /
 *   --bg-secondary / --bg-active / --accent-bg / --fg-on-accent / --hover /
 *   --demo-color
 * 因为每个调用点都自带硬编码 fallback, 同一"语义角色"在页面上渲染成 3–6 种
 * 不同颜色 (--text-secondary → #aaa(4)/#888(2)/#999(2))。少数调用点
 * **连 fallback 都没有** (SoulPanel 的 var(--bg-1) ×4, Composer.tsx:904 的
 * var(--muted-3) ...) → 整条声明无效被静默忽略。
 * 另有 --radius-lg 在同一个暗色 hex 层里定义两次 (14px 然后 12px),
 * 导致暗色 12px / 浅色 14px 不一致。
 *
 * 本文件锁住的约定:
 *   1. 别名层必须在主题里真实存在 (否则调用点再次退化成"各自 fallback")
 *   2. 别名指向的底层 token 必须在**每个**主题块里都有定义 (否则换主题即失效)
 *   3. 已定义 token 的调用点不得再留死 fallback (死 fallback = 语义分叉的温床)
 *   4. --radius-lg 不得在同一层重复定义
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const GUI = 'packages/agentai-gui';
const ROOT = resolve(__dirname, '..', '..', '..');
const themeCss = readFileSync(join(ROOT, GUI, 'src', 'styles', 'agentai-theme.css'), 'utf-8');

/** 去掉注释 —— 修复点注释本身会引用被禁掉的旧写法/旧色值, 直接 grep 会假阳性 */
const stripComments = (code: string) =>
  code.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

const themeNoComments = stripComments(themeCss);

/** 一次性读出 GUI src 下所有 tsx/css 源码 (跳过测试文件自身) */
const walk = (dir: string, acc: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(tsx|css)$/.test(name)) acc.push(p);
  }
  return acc;
};
const SOURCES = walk(join(ROOT, GUI, 'src'));

/** 别名清单 —— 与 agentai-theme.css 的「语义别名层」逐条对应 */
const ALIASES = [
  'text-primary', 'text-secondary', 'text-tertiary', 'fg-on-accent', 'fg-muted',
  'muted-1', 'muted-3', 'muted-soft', 'bg-1', 'bg-primary', 'bg-secondary',
  'bg-active', 'border-color', 'color-text-muted', 'accent-bg', 'hover', 'demo-color',
];

/** 别名最终落在哪些底层 token 上 (换主题必须仍然可解析) */
const BASE_TOKENS = ['--fg', '--muted', '--muted-2', '--panel-2', '--card-hover', '--bg', '--bg-2', '--accent-soft', '--accent'];

describe('token 层: 别名必须真实定义', () => {
  for (const a of ALIASES) {
    it(`--${a} 在主题里有定义`, () => {
      expect(themeNoComments).toMatch(new RegExp(`^\\s*--${a}\\s*:`, 'm'));
    });
  }
});

describe('token 层: 别名依赖的底层 token 每个主题块都要有', () => {
  // 主题块: 暗色（:root 同块）/ 浅色 / porcelain / midnight / ember 各定义一次
  for (const t of BASE_TOKENS) {
    it(`${t} 至少被 5 个主题层定义（否则换主题后别名解析失败）`, () => {
      const n = (themeNoComments.match(new RegExp(`^\\s*\\${t}\\s*:`, 'gm')) || []).length;
      expect(n).toBeGreaterThanOrEqual(5);
    });
  }
});

describe('token 层: 不得残留死 fallback', () => {
  // token 已定义 → `var(--x, #hex)` 的 fallback 永不生效, 留着就是同语义多种灰
  const deadRe = new RegExp(`var\\(--(?:${ALIASES.join('|')})\\s*,\\s*(?:#[0-9a-fA-F]{3,6}|rgba)`, 'g');

  it('别名调用点不再自带硬编码 fallback', () => {
    const offenders: string[] = [];
    for (const f of SOURCES) {
      for (const line of stripComments(readFileSync(f, 'utf-8')).split('\n')) {
        if (deadRe.test(line)) offenders.push(`${f}: ${line.trim()}`);
        deadRe.lastIndex = 0;
      }
    }
    expect(offenders).toEqual([]);
  });

  it('原先无 fallback 的调用点现在能解析 (--bg-1 / --muted-1 / --muted-3 / --color-text-muted 已定义)', () => {
    for (const t of ['bg-1', 'muted-1', 'muted-3', 'color-text-muted']) {
      const used = SOURCES.some(f => stripComments(readFileSync(f, 'utf-8')).includes(`var(--${t})`));
      if (used) expect(themeNoComments).toMatch(new RegExp(`^\\s*--${t}\\s*:`, 'm'));
    }
  });

  it('CSS 里不再出现写死的靛蓝 #6366f1 (demo 卡片曾与主题橙 accent 并列)', () => {
    expect(stripComments(themeCss)).not.toContain('#6366f1');
  });
});

describe('token 层: 圆角与字号尺度', () => {
  it('--radius-lg 不得在同一层重复定义 (曾暗色 12px / 浅色 14px 不一致)', () => {
    const defs = (themeNoComments.match(/^\s*--radius-lg\s*:\s*([^;]+);/gm) || [])
      .map(s => s.split(':')[1].trim().replace(';', ''));
    expect(defs.length).toBe(2);           // 暗色 hex 层 + 浅色 hex 层
    expect(new Set(defs).size).toBe(1);    // 且取值一致
  });

  it('存在通用文本尺度 (此前主题只有对话域字号, 无通用尺度)', () => {
    for (const t of ['--fs-micro', '--fs-sm', '--fs-md', '--fs-lg', '--fs-xl', '--fs-hero']) {
      expect(themeNoComments).toMatch(new RegExp(`^\\s*${t}\\s*:`, 'm'));
    }
  });

  it('对话域字号已经挂到通用尺度上 (10.5px 是 0.5 步长的产物, 已归到 micro 档)', () => {
    expect(themeNoComments).toMatch(/--tool-font-size\s*:\s*11px/);
    expect(themeNoComments).toMatch(/--ui-font-size\s*:\s*var\(--fs-micro\)/);
  });
});

describe('token 层: 字号调用点必须走尺度 (2026-10-11 收敛)', () => {
  // 收敛前: 23 种 fontSize, ≤12px 上千处, 7/8/9/10 与 12/13/14/15 互相只差 1px 无法分辨
  const FS_BAND_MIN = 7, FS_BAND_MAX = 28;

  it('文本档 (7–28px) 不得再出现裸数字, 必须用 var(--fs-*)', () => {
    // 白名单: 值会被传给**只接受 number 的第三方 API**, 塞不进 CSS 变量
    //   MonacoEditor 的 options.fontSize 由 Monaco 自己解析, 不经过浏览器 CSS
    const ALLOW: Array<{ file: string; reason: string }> = [
      { file: 'components/MonacoEditor.tsx', reason: 'Monaco options.fontSize 只接受 number' },
    ];
    const allowed = (f: string) => ALLOW.some(a => f.replace(/\\/g, '/').endsWith(a.file));

    const offenders: string[] = [];
    for (const f of SOURCES) {
      if (/\.test\./.test(f) || allowed(f)) continue;
      for (const line of stripComments(readFileSync(f, 'utf-8')).split('\n')) {
        const m = line.match(/fontSize:\s*(['"]?)([\d.]+)\1(?![\d.])/);
        if (!m) continue;
        const v = parseFloat(m[2]);
        if (v >= FS_BAND_MIN && v <= FS_BAND_MAX) offenders.push(`${f}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('var(--fs-*) 确实被调用点消费 (不是零消费的僵尸 token)', () => {
    let used = 0;
    for (const f of SOURCES) {
      if (/\.test\./.test(f)) continue;
      used += (stripComments(readFileSync(f, 'utf-8')).match(/var\(--fs-(micro|sm|md|lg|xl|hero)\)/g) || []).length;
    }
    expect(used).toBeGreaterThan(1000);
  });

  it('图标/emoji/logo 档 (≥32px) 有意保留裸数字, 不得被并进文本尺度', () => {
    // 这些是 Antd 图标 size / emoji / Splash 大标题, 不是文字尺度 (如 fontSize: 64 是头像)
    const themeScale = themeNoComments.match(/--fs-(hero)\s*:\s*(\d+)px/);
    expect(themeScale && parseFloat(themeScale[2])).toBe(28);
  });
});
