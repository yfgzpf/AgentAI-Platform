/**
 * 布局回归 — 页面内可拖拽面板 & 高度收敛 (2026-10-11)
 * ========================================================================
 * 背景 (1280×720 活体 DOM 实测):
 *   · 外壳吃掉 60px (标题栏 36 + 状态栏 24), 页面根却写 `calc(100vh - 50px)` = 670px,
 *     而 .app-content 只有 660px → 所有此类页面**永久多 10px**, 未激活时外面还有
 *     FeatureGuide 的 ~41px 提示条 → 溢出 51px, 底部控件被裁。
 *   · .app-content 实宽仅 700px, 而 VideoGen 控制栏写死 420 → 预览区只剩 ~268px。
 *   · `--chat-max-width` / `--chat-welcome-grid-max` 两个 token 定义在主题文件里,
 *     注释写着「大屏居中」, 但**全项目零消费** —— 消息流一直从最左拉到最右。
 *   · 空态里 `{messages.length === 0 && <div style={{ flex: 1 }} />}` 与消息流
 *     同为 flex:1, 把可用高度**对半分**, 欢迎区被挤到下半屏。
 *
 * 本文件锁住上述四条的修复, 防止回归。断言对象是**源码文本**(与
 * media-contract.test.ts 同一套路), 因为这些都是"跨文件的结构约定",
 * 单测渲染不出来。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const GUI = 'packages/agentai-gui';
const ROOT = resolve(__dirname, '..', '..', '..');
const src = (p: string) => readFileSync(join(ROOT, GUI, 'src', p), 'utf-8');

/** 去掉注释行 —— 本仓库习惯在修复点旁边写「原为…」注释, 注释里会引用被禁掉的旧写法,
 *  直接 grep 会命中注释而假阳性 (media-contract.test.ts 踩过)。 */
const stripComments = (code: string) =>
  code.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

const count = (s: string, re: RegExp) => (s.match(re) || []).length;

// ════════════════════════════════════════════════════════════════════════
// 1) 页面根高度: 一律 height:'100%', 不再出现 calc(100vh - N)
// ════════════════════════════════════════════════════════════════════════

describe('页面根高度不再用 calc(100vh - N)', () => {
  // 只针对**页面根的高度**。`maxHeight: 'calc(100vh - 300px)'` (ImageStudio 预览图)
  // 和 Modal/Drawer 内部的 100vh 是合法的视口相对尺寸, 不在收敛范围。
  const HEIGHT_PAGES = [
    'components/VideoGen.tsx',
    'components/ImageStudio.tsx',
    'components/StoryboardPanel.tsx',
  ];

  for (const p of HEIGHT_PAGES) {
    it(`${p} 页面根高度不含 calc(100vh`, () => {
      expect(stripComments(src(p))).not.toMatch(/height: 'calc\(100vh/);
    });
  }

  it('★ 改动过的页面根确实用 height: \'100%\' 接管高度', () => {
    const gen = stripComments(src('components/VideoGen.tsx'));
    expect(gen).toMatch(/flexDirection: 'column', height: '100%'/);
    const studio = stripComments(src('components/ImageStudio.tsx'));
    // edit 分支与非 edit 分支都要 (共 2 处)
    expect(count(studio, /height: '100%'/g)).toBeGreaterThanOrEqual(2);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 2) 页面内面板宽度可拖拽: 统一走 .page-pane + <PaneGrip>
// ════════════════════════════════════════════════════════════════════════

describe('页面内面板可拖拽 (复用 useResizable, 不重复实现)', () => {
  const PANED_PAGES = [
    'components/VideoGen.tsx',
    'components/ImageStudio.tsx',
  ];

  for (const p of PANED_PAGES) {
    it(`${p} 使用 page-pane 类 + PaneGrip (而非手写 width 常量)`, () => {
      const code = stripComments(src(p));
      expect(code).toContain('useResizable');
      expect(code).toContain("from './PaneGrip'");
      expect(code).toContain('page-pane');
      expect(code).toContain('<PaneGrip');
      // 把手必须挂在带 ref 的外层 (useResizable 靠 paneRef 取计算宽度)
      expect(code).toMatch(/ref=\{\w+Pane\.paneRef\}/);
    });
  }

  it('★ VideoGen 旧的写死宽度 420 已消失 (控制栏改由 hook 提供)', () => {
    const gen = stripComments(src('components/VideoGen.tsx'));
    expect(gen).not.toMatch(/width: 420/);
    expect(gen).toContain('defaultWidth: 420');
  });

  it('★ ImageStudio 三个面板宽度全部改为 hook 提供', () => {
    const studio = stripComments(src('components/ImageStudio.tsx'));
    for (const w of [320, 240, 380]) {
      expect(studio, `写死的 width: ${w} 应已移除`).not.toMatch(new RegExp(`width: ${w},`));
      expect(studio, `defaultWidth: ${w} 应存在`).toContain(`defaultWidth: ${w}`);
    }
    // 3 个 hook 必须**无条件**调用 (下方有 `if (mode === 'edit') return` 提前返回)
    expect(count(studio, /useResizable\(\{/g)).toBe(3);
  });

  it('★ 可滚动面板必须两层: 把手在非滚动外层 (否则拖动时把手随内容滚走)', () => {
    const css = src('styles/layout.css');
    // .pane-grip 是 position:absolute —— 这一条是两层结构的根本原因
    expect(css).toMatch(/\.pane-grip\s*\{[^}]*position:\s*absolute/);
    // 页面内面板的定位类必须存在, 且左右各自贴边
    expect(css).toContain('.page-pane');
    expect(css).toContain('.page-pane--left');
    expect(css).toContain('.page-pane--right');
    // 必须是 `0` 而非外壳那套 `-2px`: .page-pane 带 overflow:hidden,
    // 外探的 2px 会被裁掉, 5px 把手里只剩 3px 可抓 (实测鼠标差 1px 就抓不住)。
    expect(css).toMatch(/\.page-pane--left\s*>\s*\.pane-grip\s*\{\s*right:\s*0\s*;/);
    expect(css).toMatch(/\.page-pane--right\s*>\s*\.pane-grip\s*\{\s*left:\s*0\s*;/);

    const gen = stripComments(src('components/VideoGen.tsx'));
    expect(gen).toContain('/内层滚动');           // VideoGen 内层滚动容器
    const studio = stripComments(src('components/ImageStudio.tsx'));
    expect(count(studio, /\/内层滚动/g)).toBeGreaterThanOrEqual(2); // 240 / 380 两个面板
  });

  it('PaneGrip 组件本身带无障碍属性 (键盘可调 + 双击复位)', () => {
    const grip = stripComments(src('components/PaneGrip.tsx'));
    expect(grip).toContain('role="separator"');
    expect(grip).toContain('aria-valuenow');
    expect(grip).toContain('aria-valuemin');
    expect(grip).toContain('aria-valuemax');
    expect(grip).toContain('onKeyDown');
    expect(grip).toContain('onDoubleClick');
  });
});

// ════════════════════════════════════════════════════════════════════════
// 3) 中栏宽度统一 + 空态居中
// ════════════════════════════════════════════════════════════════════════

describe('对话中栏宽度: 死 token --chat-max-width 已被消费', () => {
  const chat = stripComments(src('components/ChatView.tsx'));

  it('★ 消息流与输入框共用同一 token (否则大屏上"上面缩着、下面摊开")', () => {
    const hits = count(chat, /var\(--chat-max-width\)/g);
    expect(hits, '消息流 padding 1 处 + Composer 1 处').toBeGreaterThanOrEqual(2);
  });

  it('★ 空态里与消息流抢 flex:1 的垫高 div 已删除', () => {
    // 原写法: {messages.length === 0 && <div style={{ flex: 1 }} />}
    // 它与上方 flex:1 的消息区平分剩余高度 → 欢迎区被挤到下半屏
    expect(chat).not.toMatch(/messages\.length === 0 && <div style=\{\{ flex: 1 \}\}/);
  });

  it('★ WelcomePanel 不再写死 460, 改用 --chat-welcome-grid-max', () => {
    const welcome = stripComments(src('components/WelcomePanel.tsx'));
    expect(welcome).toContain('var(--chat-welcome-grid-max)');
    expect(welcome).not.toContain('maxWidth: 460');
  });

  it('两个 token 仍定义在主题文件里 (消费点不能悬空)', () => {
    const theme = src('styles/agentai-theme.css');
    expect(theme).toContain('--chat-max-width');
    expect(theme).toContain('--chat-welcome-grid-max');
  });

  it('★ 宽度 token 必须是自适应的, 不许写死 px (写死 = 大屏中间一条窄栏)', () => {
    // 实测教训 (2026-10-11): 曾把 --chat-max-width 定为 800px, 在 1920 窗口下
    // .app-content=1340px, 对话只占中间 795px, 两侧各空 ~270px, 用户反馈"看都看不全"。
    const theme = src('styles/agentai-theme.css');
    for (const name of ['--chat-max-width', '--chat-welcome-grid-max']) {
      const m = theme.match(new RegExp(name + ':\\s*([^;]+);'));
      expect(m, `${name} 未定义`).toBeTruthy();
      const value = m![1].trim();
      expect(value, `${name} 为常量 "${value}", 必须含 clamp()/% 才是自适应`)
        .toMatch(/clamp\(/);
      expect(value).toContain('%');
    }
  });
});

// ════════════════════════════════════════════════════════════════════════
// 4) 右栏空态合并 + 状态条不显示裸数字
// ════════════════════════════════════════════════════════════════════════

describe('右栏: 两个空面板合并为一行, 不叠两张 Empty 插画', () => {
  const rp = stripComments(src('components/RightPanel.tsx'));

  it('★ 空态判据在父级计算, 且与子组件数据源一致', () => {
    expect(rp).toContain('useTaskOrchestrator');   // TaskPlanPanel 的数据源
    expect(rp).toContain('activeTask');
    expect(rp).toContain('railHasProgress');
    expect(rp).toContain('暂无任务计划 / 生成文件');
  });

  it('★ 两个面板改为条件渲染 (不再是固定两段 Card)', () => {
    expect(rp).toMatch(/\{!!activeTask && \(/);
    expect(rp).toMatch(/\{hasGeneratedFiles && \(/);
  });
});

describe('状态条: 不渲染永远填不上的占位符 / 裸数字', () => {
  it('★ 置信度无数据时整个隐藏 (强模型 tier 在 gateway 侧被门控跳过, 恒为 --)', () => {
    const sb = stripComments(src('components/StatusBar.tsx'));
    expect(sb).toMatch(/\{dash\.confidence != null && \(/);
  });

  it('★ Git 变更数字带千分位 + 单位 + 悬浮说明 (原为裸 "-30528")', () => {
    const gsb = stripComments(src('components/GitStatusBar.tsx'));
    expect(gsb).toContain('toLocaleString()');
    expect(gsb).toContain('个文件');
    expect(gsb).toMatch(/title=\{/);
  });
});
