/**
 * 品牌标统一回归 (2026-10-12)
 * ========================================================================
 * 用户原始诉求 (逐字): 「LOGO不统一」
 *
 * 事实认定 (已核实, 非推测):
 *   同一产品**两套图形**并存 ——
 *     · public/favicon-*.png / favicon.svg 画的是塔尖"A" mark (#1a1a1e, rx14)
 *     · components/BrandLogo.tsx 画的是两条交错流线 + 交点脉冲 (#1a1a22, rx16)
 *   而标题栏 (App.tsx) 用前者, 启动页/编辑器侧聊用后者 —— 同一屏能同时看到两个不同的标。
 *   名字也四种混用: 岐枢 / 岐枢智能体 / PulseFlow / PulseFlow Studio。
 *
 * 本文件锁住的约定 (源码文本断言, 与 rail-browser.test.ts 同一套路):
 *   A. 唯一品牌标出口 = components/BrandLogo.tsx (标题栏不再用栅格 favicon)
 *   B. public/favicon.svg 与 BrandLogo **同几何** (同一张图的两个落点, 改一边必须同步另一边)
 *   C. 品牌名: 中文主名「岐枢」+ 英文副名「PulseFlow」
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const GUI = 'packages/agentai-gui';
const ROOT = resolve(__dirname, '..', '..', '..');
const src = (p: string) => readFileSync(join(ROOT, GUI, 'src', p), 'utf-8');

/** 去掉注释行 —— 修复点旁边会写「原为…」注释, 注释里引用被禁掉的旧写法会假阳性 */
const stripComments = (code: string) =>
  code.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

/** GUI src 下所有 tsx (跳过测试文件自身) */
const walkTsx = (dir: string, acc: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkTsx(p, acc);
    else if (/\.tsx$/.test(name) && !/\.test\./.test(name)) acc.push(p);
  }
  return acc;
};

// ════════════════════════════════════════════════════════════════════════
// A. 唯一品牌标出口 = BrandLogo
// ════════════════════════════════════════════════════════════════════════

describe('A 品牌标唯一出口 = BrandLogo', () => {
  const app = stripComments(src('App.tsx'));

  it('标题栏走 <BrandLogo>, 不再引用栅格 favicon', () => {
    // 修复前: <img src="/favicon-32.png" alt="岐枢" style={{width:20,height:20}} />
    expect(app).toContain('<BrandLogo size={20} />');
    expect(app).not.toContain('favicon-32.png');
    expect(app).toContain("import { BrandLogo } from './components/BrandLogo'");
  });

  it('src 下没有任何 tsx 再直接引用栅格 favicon 当品牌标', () => {
    const offenders = walkTsx(join(ROOT, GUI, 'src'))
      .filter(f => stripComments(readFileSync(f, 'utf-8')).includes('favicon-32.png'))
      .map(f => f.replace(/\\/g, '/'));
    expect(offenders).toEqual([]);
  });

  it('标题栏保留「岐枢 | PulseFlow」锁排 (中文主名 + 英文副名)', () => {
    expect(app).toContain('>岐枢</span>');
    expect(app).toContain('>PulseFlow</span>');
  });

  it('品牌标至少被 3 处复用 (标题栏 / 启动页 / 编辑器侧聊), 不是各画各的', () => {
    const users = walkTsx(join(ROOT, GUI, 'src'))
      .filter(f => /<BrandLogo\b/.test(readFileSync(f, 'utf-8')));
    expect(users.length).toBeGreaterThanOrEqual(3);
  });
});

// ════════════════════════════════════════════════════════════════════════
// B. favicon.svg 与 BrandLogo 同几何
// ════════════════════════════════════════════════════════════════════════

describe('B favicon.svg 与 BrandLogo 同几何', () => {
  const logo = src('components/BrandLogo.tsx');
  const svg = readFileSync(join(ROOT, GUI, 'public', 'favicon.svg'), 'utf-8');
  const PULSE = 'M18 48 C 18 36, 24 28, 24 16';
  const FLOW = 'M46 16 C 46 28, 40 36, 40 48';

  it('两条流线路径逐字一致 (一处改动必须同步另一处)', () => {
    expect(logo).toContain(PULSE);
    expect(logo).toContain(FLOW);
    expect(svg).toContain(PULSE);
    expect(svg).toContain(FLOW);
  });

  it('favicon.svg 不再是旧的塔尖 mark, 容器色/圆角与组件一致', () => {
    expect(svg).not.toContain('M32 10 L50 46');   // 旧塔尖 A 的路径
    expect(svg).not.toContain('#1a1a1e');          // 旧底色的 1px 差异 (与组件的 #1a1a22 不一致)
    expect(svg).toContain('rx="16"');
    expect(svg).toContain('#1a1a22');
    expect(logo).toContain('rx="16"');
    expect(logo).toContain('#1a1a22');
  });

  it('渐变 id 逐实例唯一 (标题栏/启动页/侧聊同屏多实例, 固定 id 会跨实例串到同一个 def)', () => {
    expect(logo).toContain('useId()');
    expect(logo).toMatch(/id=\{gradId\}/);
    expect(logo).toMatch(/stroke=\{`url\(#\$\{gradId\}\)`\}/);
    expect(logo).not.toContain('id="pf-grad"');
  });
});

// ════════════════════════════════════════════════════════════════════════
// C. 品牌名: 中文主名 + 英文副名
// ════════════════════════════════════════════════════════════════════════

describe('C 品牌名统一', () => {
  it('provider 头像的 label 不再自称 PulseFlow (它与 DeepSeek/OpenAI 并列, 是 provider 名)', () => {
    const av = stripComments(src('components/Avatar.tsx'));
    expect(av).not.toContain("label: 'PulseFlow'");
    expect(av).toContain("label: '岐枢'");
    expect(av).not.toContain("name || 'PulseFlow'");
  });

  it('浏览器标签标题以「岐枢」开头, 英文副名保留', () => {
    const html = readFileSync(join(ROOT, GUI, 'index.html'), 'utf-8');
    expect(html).toMatch(/<title>岐枢 PulseFlow Studio<\/title>/);
  });
});
