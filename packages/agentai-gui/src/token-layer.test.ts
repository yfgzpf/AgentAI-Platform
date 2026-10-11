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
 *   5. 字号必须走 --fs-* 六档尺度, 文本档 (7–28px) 不得裸写数字
 *   6. 圆角必须走 --radius-* 四档尺度, 不得裸写数字 (0 = 显式直角除外)
 *   7. 语义色统一: 成功绿 → var(--success) / 错误红 → var(--danger) /
 *      灰阶文字 → var(--muted|--muted-2|--fg-2) / 彩色底上的白字 → var(--fg-on-accent)
 *      —— 例外是**真正的分类色板** (同色相多档 = 有意区分, 如情绪 8 色、
 *      疼痛 5 档、Token 压力 5 档) 与**自带表面主题**的文件 (终端/编辑器内部/
 *      DecorAI 子应用/打印纸张 HTML), 它们在测试里显式列出并注明理由。
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

// ── Commit C (2026-10-11): 圆角与语义色收敛 ──────────────────────────────
// 收敛前: 圆角 19 种裸数字 (1,2,3,4,5,6,8,10,11,12,14,16,17,18,20,24,100),
// 且 --radius-lg 定义了却**零消费**; 成功绿 4 种 (#52c41a/#10b981/#4ade80/#22c55e)、
// 错误红 3 种 (#ef4444/#ff4d4f/#f5222d) 各自渲染同一个"状态色"。
describe('token 层: 圆角尺度收敛 (2026-10-11)', () => {
  const SCALE: Record<string, string> = {
    '--radius-sm': '4px', '--radius-md': '8px', '--radius-lg': '12px', '--radius-pill': '999px',
  };

  it('圆角尺度恰好 4 档, 每档取值固定', () => {
    for (const [t, v] of Object.entries(SCALE)) {
      expect(themeNoComments).toMatch(new RegExp(`^\\s*${t}\\s*:\\s*${v.replace('(', '\\(')}`, 'm'));
    }
  });

  it('--radius-lg / --radius-pill 必须被调用点消费 (不得是零消费僵尸 token)', () => {
    for (const t of ['--radius-lg', '--radius-pill']) {
      const used = SOURCES.some(f => stripComments(readFileSync(f, 'utf-8')).includes(`var(${t}`));
      expect(used, `${t} 零消费`).toBe(true);
    }
  });

  it('不得裸写数字 borderRadius, 必须走 var(--radius-*)', () => {
    // 白名单: 值会被传给**只接受 number 的第三方 API**
    const ALLOW: Array<{ file: string; reason: string }> = [
      { file: 'src/App.tsx', reason: 'Antd ConfigProvider theme.token.borderRadius 只接受 number' },
    ];
    const allowed = (f: string) => ALLOW.some(a => f.replace(/\\/g, '/').endsWith(a.file));

    const offenders: string[] = [];
    for (const f of SOURCES) {
      if (/\.test\./.test(f) || !/\.(tsx|ts)$/.test(f) || allowed(f)) continue;
      for (const line of stripComments(readFileSync(f, 'utf-8')).split('\n')) {
        const m = line.match(/borderRadius:\s*(\d+)(?![\d.])/);
        if (m && Number(m[1]) !== 0) offenders.push(`${f}: ${line.trim()}`);  // 0 = 显式直角
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('token 层: 语义色不得再散落 (2026-10-11)', () => {
  // 真正的**分类色板** (同色相多档 = 有意区分) 与自带表面主题的文件豁免
  const COLOR_SKIP = ['EmotionIndicator.tsx', 'SoulPanel.tsx', 'TokenPressureBar.tsx', 'store/modeStore.ts', 'store/modelStore.ts'];
  const GREY_SKIP = ['DecorAI/', 'VoiceDictation.tsx', 'TerminalPanel.tsx', 'modes/PreviewMode.tsx'];
  // 打印/导出 HTML 模板用的是"亮色纸张"配色 (白底黑字), 与 App 主题无关, 不得 token 化
  const PRINT_SKIP = ['PrescriptionCard.tsx', 'WritePage.tsx'];
  const norm = (f: string) => f.replace(/\\/g, '/');
  const skip = (f: string, list: string[]) => list.some(s => norm(f).includes(s));
  const src = (f: string) => stripComments(readFileSync(f, 'utf-8'));
  // token **定义** 行 (`--danger: #ef4444;`) 是色值的唯一声明处, 不算散落
  const isTokenDef = (line: string) => /^\s*--[\w-]+\s*:/.test(line);

  const scan = (re: RegExp, skips: string[], allowGradient = true) => {
    const offenders: string[] = [];
    for (const f of SOURCES) {
      if (/\.test\./.test(f) || skip(f, skips)) continue;
      for (const line of src(f).split('\n')) {
        if (isTokenDef(line)) continue;
        if (allowGradient && line.includes('gradient')) continue;   // 渐变艺术, 非语义色
        if (re.test(line)) offenders.push(`${f}: ${line.trim()}`);
        re.lastIndex = 0;
      }
    }
    return offenders;
  };

  it('成功绿统一走 var(--success) (原 #52c41a/#10b981/#4ade80/#22c55e 四值并存)', () => {
    expect(scan(/#(52c41a|10b981|4ade80|22c55e|16a34a|238636)\b/gi, COLOR_SKIP)).toEqual([]);
  });

  it('错误红统一走 var(--danger) (原 #ef4444/#ff4d4f/#f5222d 三值并存)', () => {
    expect(scan(/#(ef4444|ff4d4f|f5222d|dc2626|f87171|da3633)\b/gi, COLOR_SKIP)).toEqual([]);
  });

  it('灰阶文字色统一走 var(--muted / --muted-2 / --fg-2)', () => {
    expect(scan(/\bcolor:\s*'#(999|888|aaa|777|666|555|ccc|ddd|eee)'/i, GREY_SKIP, false)).toEqual([]);
  });

  it('纯白文字走 var(--fg-on-accent), 不再裸写 (权重不同但角色相同: 彩色底上的文字)', () => {
    expect(scan(/\bcolor:\s*'?#(fff|ffffff)\b/i, PRINT_SKIP, false)).toEqual([]);
  });

  it('已定义底层 token 的调用点不得再留死 fallback (本轮再清 35 处)', () => {
    const BASE = 'bg|bg-2|panel|panel-2|card|card-hover|border|border-strong|fg|fg-2|muted|muted-2|accent|accent-strong|success|danger|warning';
    expect(scan(new RegExp(`var\\(--(?:${BASE})\\s*,\\s*(?:#[0-9a-fA-F]{3,8}|rgba)`), [], false)).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 8) 氛围层「星野·深空」(2026-10-12)
// ════════════════════════════════════════════════════════════════════════

describe('token 层: 氛围层「星野·深空」必须真被消费', () => {
  const layoutCss = readFileSync(join(ROOT, GUI, 'src', 'styles', 'layout.css'), 'utf-8');
  const stylesDir = join(ROOT, GUI, 'src', 'styles');
  const allCss = readdirSync(stylesDir)
    .filter(f => f.endsWith('.css'))
    .map(f => readFileSync(join(stylesDir, f), 'utf-8'))
    .join('\n')
    // CSS 只有 /* */ 注释 (没有 //, 故不能复用 stripComments —— 会把 url(https://…) 砍断)。
    // 修复合一的注释本身会写「原先 --grid-line 铺出的…」, 不剥就是假阳性。
    .replace(/\/\*[\s\S]*?\*\//g, '');

  for (const t of ['aurora', 'panel-hi']) {
    it(`--${t} 在主题里有定义`, () => {
      expect(themeNoComments).toMatch(new RegExp(`^\\s*--${t}\\s*:`, 'm'));
    });
  }

  it('--aurora / --panel-hi 都有真实消费点 (防僵尸 token —— --radius-lg 当年就零消费)', () => {
    expect(layoutCss).toContain('var(--aurora)');
    // --panel-hi 是内高光: 侧栏 (layout.css) + 标题栏/状态栏 (agentai-theme.css)
    expect(layoutCss).toContain('box-shadow: var(--panel-hi)');
    expect(themeNoComments).toContain('box-shadow: var(--panel-hi)');
  });

  it('★ 网格 token 必须不存在 (用户判定「网格太花」, 再回来就是回归)', () => {
    // 1px 周期纹理在 32px 间距下是**注意力噪音**, 与"深空"要的安静纵深恰好相反。
    // 氛围只由单层 --aurora 承担 —— 不可重复、无周期、无摩尔纹/织布感。
    expect(allCss).not.toContain('--grid-line');
    expect(allCss).not.toContain('--grid-size');
  });

  it('亮色档 (light + porcelain) 必须自己覆写光晕, 不能只靠 :root 继承', () => {
    // 暗色档 --aurora 是 accent 13%/5% 双色标, 直接继承到亮底上会偏重;
    // 两个亮色档各压到 9% 单色标 —— 每个都要自带 (fallback + color-mix) 两行覆写。
    const fromLight = themeNoComments.slice(themeNoComments.indexOf('[data-theme="light"]'));
    const n = (fromLight.match(/^\s*--aurora\s*:/gm) || []).length;
    expect(n).toBeGreaterThanOrEqual(4);
  });

  it('氛围场画在 .app-content 自己的 background 上, 不是叠层 div / backdrop-filter', () => {
    // 为什么必须这样: var(--bg) 的不透明底散在 25 个文件约 50 处 (外壳/ChatView/
    // WritePage/ImageStudio…), 任何独立浮层都会被这些面盖死; 侧栏与标题栏背后
    // 也没有内容可模糊。所以氛围是"面自己的背景", 不是覆盖层。
    expect(layoutCss).toMatch(/\.app-content\s*\{[\s\S]{0,900}?background-image:/);
    expect(layoutCss).not.toMatch(/\.app-content\s*\{[\s\S]{0,900}?backdrop-filter/);
  });

  it('★ .app-content 在所有 CSS 里恰好 1 处定义 (重复定义 = 靠 import 顺序决定谁赢)', () => {
    // 原状: agentai-theme.css 有一份 `background: var(--bg)` 的重复定义,
    // 仅因为 main.tsx 的 import 顺序 (theme → global → layout) 被压住才没生效。
    // cssCodeSplit 下 CSS 合并顺序属实现细节, 一旦翻转, 不透明 --bg 就会盖掉氛围层。
    const defs = (allCss.match(/^\.app-content\s*\{/gm) || []).length;
    expect(defs).toBe(1);
  });

  it('★ .app-content 的 background-image 只有 1 层 (网格时代是 3 层, 靠逗号分层)', () => {
    const block = layoutCss.match(/\.app-content\s*\{[\s\S]*?\}/)?.[0] || '';
    const img = block.match(/background-image:\s*([^;]+);/)?.[1] || '';
    expect(img).toContain('var(--aurora)');
    expect(img).not.toContain(',');   // 变多是又把 repeating 纹理加回来了
  });
});
