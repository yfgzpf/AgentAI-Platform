/**
 * 页面壳层 + 外壳高度 + 魔法高度 契约回归 (2026-10-12)
 * ========================================================================
 * 用户原始诉求 (逐字):
 *   「底背景我不要网格太花了，你优化好像还是没有到位呢？ 其实我是要**所有页面的统一优化**，
 *     以你最前沿的知识来优化，从文案字体要**从打包层面**出发，确保打包后不会出现问题，
 *     以前打包会**功能缺失** 与**开发状态显示不一致**、**溢出**、**控件与开发状态显示
 *     不一致**的问题不应该再出现」
 *
 * 六件事的事实认定 (全部源码/产物级核实, 非推测):
 *   1. 背景网格太花 —— `--grid-line` 32px 周期纹理 + 5% 不透明度, 是注意力噪音。
 *   2. `.app-content` 被**定义了两次**: agentai-theme.css(不透明 `background: var(--bg)`)
 *      + layout.css(氛围层)。仅靠 main.tsx 的 import 顺序被压住才没失效 —— 而 Tauri 打包走
 *      `vite build`, cssCodeSplit 下 CSS 合并顺序属实现细节, 一旦翻转氛围层就被盖掉。
 *   3. 外壳 `100vh` **无 dvh 兜底**: 正确写法(100vh→100dvh 双声明)写在 layout.css 的
 *      `.app-shell` 上, 而该选择器**零引用**; 真正生效的是 App.tsx 根 div 的 inline `100vh`
 *      与 `#root{height:100vh}` → Tauri 无边框窗口下底栏被顶出可视区(溢出)。
 *   4. 魔法高度残留 4 处 (`calc(100vh - 44/48/140/300px)`), 而正确值 60 只写在注释里。
 *   5. `.app-pane-body` 缺 `min-height:0` → 纵向 flex 子项不滚动而是撑破父级。
 *   6. 页面根**四种派别**: 12 页 inline `height:'100%'`, 其余不设高度; 3 页还画了不透明
 *      整页底 (--editor-bg / --bg-1 / --panel) 把氛围层盖死; 另有 EditorChatPanel 硬编码
 *      `#121212` (亮色主题下仍是纯黑)。
 *
 * 本文件锁住的约定 (源码文本断言, 与 layout-panes / rail-browser / token-layer 同一套路):
 *   A. 页壳三件存在且被唯一渲染点消费 —— 24 个页面在 App.tsx 一处统一拿到契约
 *   B. 外壳高度两处真相点 (#root / .app-root) 都必须带 100dvh; 死掉的 .app-shell 不得复活
 *   C. 全库不再出现 `calc(100vh - …)` 魔法高度
 *   D. `.app-content` 只有单层光晕, 且不再依赖 background-size (网格才需要)
 *   E. 页面根不再画整页不透明底 / 不再硬编码暗色
 *   F. 新增排版 token 全部有真实消费点 (防僵尸 token)
 *
 * ⚠️ 本文件用自建的 stripAll 而不是仓库里通用的 stripComments:
 *    后者只剥「整行以 // 、* 、/* 开头」的行, 于是 JSX 注释 `{/* … *\/}` 会被漏掉
 *    —— 而本轮多处修复注释**恰好引用了被移除的旧写法** (`calc(100vh - 140px)`、
 *    `var(--editor-bg)`), 不剥干净就全是假阳性。
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const GUI = 'packages/agentai-gui';
const ROOT = resolve(__dirname, '..', '..', '..');
const SRC = join(ROOT, GUI, 'src');
const STYLES = join(SRC, 'styles');

const read = (p: string) => readFileSync(p, 'utf-8');
const readSrc = (p: string) => read(join(SRC, p));
const readStyle = (p: string) => read(join(STYLES, p));

/** 剥掉 JSX 注释、块注释、CSS 注释、整行行注释 —— 顺序重要: JSX 注释必须先剥 */
const stripAll = (code: string) =>
  code
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/** GUI src 下所有 .tsx (跳过测试自身) */
const walkTsx = (dir: string, acc: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkTsx(p, acc);
    else if (/\.tsx$/.test(name) && !/\.test\./.test(name)) acc.push(p);
  }
  return acc;
};

const allCssFiles = () => readdirSync(STYLES).filter(f => f.endsWith('.css'));
/** 全部 CSS, 已剥注释 */
const allCss = () =>
  allCssFiles().map(f => stripAll(readStyle(f))).join('\n');

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** 抽出某个选择器的声明体 (精确到 `sel {` , 不会误取 `.page-body p {`) */
const ruleBody = (css: string, sel: string): string => {
  const m = css.match(new RegExp(`^\\s*${esc(sel)}\\s*\\{([\\s\\S]*?)\\}`, 'm'));
  return m ? m[1] : '';
};
const count = (s: string, re: RegExp) => (s.match(re) || []).length;

const themeCss = stripAll(readStyle('agentai-theme.css'));
const layoutCss = stripAll(readStyle('layout.css'));
const appTsx = stripAll(readSrc('App.tsx'));

// ════════════════════════════════════════════════════════════════════════
// A. 页壳三件 —— 24 个页面在唯一渲染点统一拿到契约
// ════════════════════════════════════════════════════════════════════════

describe('A 页壳层: 三件存在, 且 24 页在唯一渲染点统一拿到契约', () => {
  it('shell.css 存在, 三个类齐备', () => {
    expect(existsSync(join(STYLES, 'shell.css'))).toBe(true);
    const css = readStyle('shell.css');
    for (const sel of ['.page-shell', '.page-header', '.page-body', '.page-empty']) {
      expect(ruleBody(css, sel), `${sel} 未定义`).not.toBe('');
    }
  });

  it('★ .page-body 的 min-height:0 —— 这一行就是"溢出"类缺陷的根治点', () => {
    const body = ruleBody(readStyle('shell.css'), '.page-body');
    expect(body).toContain('min-height: 0');
    expect(body).toContain('overflow: auto');
  });

  it('★ .page-shell 是"能收缩"的纵向 flex —— 否则内容撑破 .app-content', () => {
    const shell = ruleBody(readStyle('shell.css'), '.page-shell');
    expect(shell).toContain('min-height: 0');
    expect(shell).toContain('height: 100%');
    expect(shell).toMatch(/display:\s*flex/);
    expect(shell).toMatch(/flex-direction:\s*column/);
  });

  it('★ .page-shell 不画底色 —— 页面根一旦画不透明底就盖死氛围层', () => {
    const shell = ruleBody(readStyle('shell.css'), '.page-shell');
    expect(shell).not.toMatch(/background(-color)?:\s*(?!transparent)/);
  });

  it('★ shell.css 必须在 layout.css 之后导入 (同级选择器要能覆盖骨架层)', () => {
    const main = readSrc('main.tsx');
    const iLayout = main.indexOf("'./styles/layout.css'");
    const iShell = main.indexOf("'./styles/shell.css'");
    expect(iLayout).toBeGreaterThan(-1);
    expect(iShell).toBeGreaterThan(-1);
    expect(iShell).toBeGreaterThan(iLayout);
  });

  it('★ 24 个页面在 App.tsx 这一个渲染点统一包裹 (改一处即全覆盖)', () => {
    // PAGES 数组的条目数 = 页面数 (每条以 `  { key: '` 开头)
    expect(count(appTsx, /^\s*\{ key: '/gm)).toBe(24);

    // 恰好一对 PageShell, 且包住页面渲染区
    expect(count(appTsx, /<PageShell>/g)).toBe(1);
    expect(count(appTsx, /<\/PageShell>/g)).toBe(1);
    const iOpen = appTsx.indexOf('<PageShell>');
    const iComp = appTsx.indexOf('currentPage.comp');
    const iClose = appTsx.indexOf('</PageShell>');
    expect(iOpen).toBeGreaterThan(-1);
    expect(iOpen).toBeLessThan(iComp);
    expect(iComp).toBeLessThan(iClose);
  });

  it('shell/index.ts 导出三件', () => {
    const idx = readSrc('components/shell/index.ts');
    for (const n of ['PageShell', 'PageHeader', 'EmptyState']) {
      expect(idx).toContain(n);
    }
  });

  it('★ PageHeader / EmptyState 必须有真实页面消费 —— 否则就是零消费的僵尸组件', () => {
    // PageShell 由 App.tsx 单点注入 (24 页共用) 所以只需 1 处; 而 PageHeader /
    // EmptyState 必须逐页消费 —— 本轮落地 5 个页头 + 1 个页面级空态。
    // 若哪天被删空, 这里会红: 提醒要么用起来, 要么删掉 (本项目 --radius-lg 的教训)。
    const shellDir = /components[\\/]shell[\\/]/;
    const consumers: Record<string, string[]> = { PageHeader: [], EmptyState: [] };
    for (const p of walkTsx(SRC)) {
      if (shellDir.test(p)) continue;
      const code = stripAll(read(p));
      for (const name of Object.keys(consumers)) {
        if (new RegExp(`<${name}[\\s/>]`).test(code)) consumers[name].push(p.replace(ROOT, ''));
      }
    }
    expect(consumers.PageHeader.length).toBeGreaterThanOrEqual(4);
    expect(consumers.EmptyState.length).toBeGreaterThanOrEqual(1);
  });

  it('★ 已改页头的页面不再保留"页根 padding:24 + 自带大标题"的旧写法', () => {
    const converted = [
      'components/MonitoringPanel.tsx',
      'components/StatsPanel.tsx',
      'components/ProactiveSuggestionsPanel.tsx',
      'components/QQBotPanel.tsx',
      'components/KnowledgeBasePanel.tsx',
    ];
    const offenders: string[] = [];
    for (const p of converted) {
      const code = stripAll(readSrc(p));
      if (/return \(\s*<div style=\{\{ padding: 24/.test(code)) offenders.push(`${p} 页根仍是旧 padding:24`);
      if (!code.includes('className="page-body"')) offenders.push(`${p} 未接入 .page-body`);
    }
    expect(offenders).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════
// B. 外壳高度: 两个真相点都要有 dvh 兜底; 死掉的 .app-shell 不得复活
// ════════════════════════════════════════════════════════════════════════

describe('B 外壳高度: 100vh 必须有 100dvh 兜底', () => {
  it('★ #root 双声明 (agentai-theme.css)', () => {
    const body = ruleBody(themeCss, '#root');
    expect(body).toContain('height: 100vh');
    expect(body).toContain('height: 100dvh');
  });

  it('★ .app-root 双声明 (layout.css) —— App.tsx 根 div 的原 inline 100vh 无兜底', () => {
    const body = ruleBody(layoutCss, '.app-root');
    expect(body).toContain('height: 100vh');
    expect(body).toContain('height: 100dvh');
  });

  it('★ App.tsx 根节点走 .app-root, 不再 inline 写 height:100vh', () => {
    expect(appTsx).toContain('className="app-root"');
    expect(appTsx).not.toMatch(/height:\s*'100vh'/);
  });

  it('★ 死掉的 .app-shell 不得复活 (零引用 = 第三份真相)', () => {
    for (const f of allCssFiles()) {
      expect(stripAll(readStyle(f)), `${f} 里又出现了 .app-shell`).not.toMatch(/^\s*\.app-shell\s*\{/m);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════
// C. 魔法高度归零
// ════════════════════════════════════════════════════════════════════════

describe('C 魔法高度: 全库不再出现 calc(100vh - …)', () => {
  it('★ 所有 tsx 里 calc(100vh - ) 归零 (原来是 44/48/140/300 四个凭空猜测)', () => {
    const offenders: string[] = [];
    for (const p of walkTsx(SRC)) {
      const code = stripAll(read(p));
      if (/calc\(100vh\s*-/.test(code)) offenders.push(p.replace(ROOT, ''));
    }
    expect(offenders).toEqual([]);
  });

  it('★ 所有 css 里 calc(100vh - ) 归零', () => {
    const offenders = allCssFiles().filter(f => /calc\(100vh\s*-/.test(stripAll(readStyle(f))));
    expect(offenders).toEqual([]);
  });

  it('★ 取而代之的是带 --chrome-h / --titlebar-h 的 dvh 计算 (不是又一次裸猜)', () => {
    const src = allCss() + walkTsx(SRC).map(read).join('\n');
    expect(src).toMatch(/calc\(100dvh\s*-\s*var\(--chrome-h\)/);
    expect(src).toMatch(/calc\(100dvh\s*-\s*var\(--titlebar-h\)/);
  });

  it('★ 纵向 flex 滚动容器 .app-pane-body 也有 min-height:0', () => {
    expect(ruleBody(layoutCss, '.app-pane-body')).toContain('min-height: 0');
  });
});

// ════════════════════════════════════════════════════════════════════════
// D. 底背景: 单层光晕, 无网格
// ════════════════════════════════════════════════════════════════════════

describe('D 底背景: 只留单层顶部光晕', () => {
  it('★ .app-content 的 background-image 就是 --aurora 单层', () => {
    const body = ruleBody(layoutCss, '.app-content');
    expect(body).toMatch(/background-image:\s*var\(--aurora\)\s*;/);
  });

  it('★ .app-content 不再有 background-size (那是网格分层才需要的)', () => {
    expect(ruleBody(layoutCss, '.app-content')).not.toContain('background-size');
  });

  it('★ .app-content 的 background-repeat 不带逗号分层', () => {
    const body = ruleBody(layoutCss, '.app-content');
    const repeat = body.match(/background-repeat:\s*([^;]+);/)?.[1] ?? '';
    expect(repeat).not.toContain(',');
  });
});

// ════════════════════════════════════════════════════════════════════════
// E. 页面根底色统一
// ════════════════════════════════════════════════════════════════════════

describe('E 页面根: 不再画整页不透明底 / 不再硬编码暗色', () => {
  it('★ Editor 页根不再画 --editor-bg 整页底', () => {
    expect(stripAll(readSrc('components/Editor.tsx'))).not.toContain('var(--editor-bg)');
  });

  it('★ WorkflowPanel 页根不再画 --panel 整页底', () => {
    expect(stripAll(readSrc('components/WorkflowPanel.tsx'))).not.toContain("background: 'var(--panel)'");
  });

  it('★ SoulPanel 页根去底色 (卡片内 --bg-1 保留, 那是内层表面)', () => {
    const code = stripAll(readSrc('components/SoulPanel.tsx'));
    // 页根仍存在 (padding 12 + 自滚 + 100% 高), 但不再带 background
    expect(code).toMatch(/padding:\s*12,\s*overflow:\s*'auto',\s*height:\s*'100%'\s*\}\}/);
    expect(code).not.toMatch(/height:\s*'100%',\s*background:/);
  });

  it('★ EditorChatPanel 不再硬编码 #121212 (亮色主题下本该跟随)', () => {
    const code = stripAll(readSrc('components/EditorChatPanel.tsx'));
    expect(code).not.toContain("'#121212'");
    expect(code).toContain('var(--editor-bg)');
  });

  it('★ 通用规则: 任何 tsx 都不得同时声明 height:100% 与整页不透明底', () => {
    const offenders: string[] = [];
    for (const p of walkTsx(SRC)) {
      const code = stripAll(read(p));
      // 允许 --card/--bg-2 这类**内层卡片**表面; 禁的是整页级表面 token
      if (/height:\s*'100%',\s*background:\s*'var\(--(bg|bg-1|panel|editor-bg)'/.test(code)) {
        offenders.push(p.replace(ROOT, ''));
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════
// F. 新增排版 token: 定义即必须被消费 (防僵尸 token)
// ════════════════════════════════════════════════════════════════════════

describe('F 排版/壳层 token 全部有真实消费点', () => {
  const TOKENS = [
    'lh-tight', 'lh-snug', 'lh-normal',
    'fw-normal', 'fw-semibold', 'fw-bold',
    'font-mono',
    'page-pad-x', 'page-pad-y', 'page-head-h',
    'titlebar-h', 'statusbar-h', 'chrome-h',
  ];

  for (const t of TOKENS) {
    it(`--${t} 在主题里有定义`, () => {
      expect(themeCss).toMatch(new RegExp(`^\\s*--${t}\\s*:`, 'm'));
    });
  }

  it('★ 每个 token 都有真实消费点 (防 --radius-lg 式僵尸 token)', () => {
    const consumers = allCss() + walkTsx(SRC).map(read).join('\n');
    const missing = TOKENS.filter(t => !consumers.includes(`var(--${t})`));
    expect(missing).toEqual([]);
  });

  it('★ 外壳常量由标题栏/状态栏真实消费, 不是只写注释', () => {
    expect(ruleBody(themeCss, '.app-titlebar')).toContain('var(--titlebar-h)');
    expect(ruleBody(themeCss, '.app-statusbar')).toContain('var(--statusbar-h)');
  });

  it('★ --chrome-h 被魔法高度收口处消费 (3 处以上)', () => {
    const src = walkTsx(SRC).map(read).join('\n');
    expect(count(src, /var\(--chrome-h\)/g)).toBeGreaterThanOrEqual(3);
  });

  it('★ 无诚实消费点的档位有意不定义 (--fw-medium 不得偷偷回来)', () => {
    expect(themeCss).not.toMatch(/^\s*--fw-medium\s*:/m);
  });
});
