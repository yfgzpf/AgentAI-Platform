/**
 * 右栏双模式 + 文件就地查看 回归 (2026-10-11)
 * ========================================================================
 * 用户原始诉求 (逐字):
 *   「你这个自动打开前端 自动调试前端的功能有赋予我项目吧？你看我们可不可以类 zcode
 *     一样来优化我们的前端，将浏览器和它一样嵌在右侧等相关实现，还有那个打开文件
 *     老是跳到什么编辑器很不方便 查看也是要处理掉」
 *
 * 两件事的事实认定 (已核实, 非推测):
 *   1. 浏览器栈项目里本来就有 (browser-engine.ts 993 行 + ~23 个 browser_* 工具 +
 *      review_frontend 视觉自检 + EmbeddedBrowser)。缺的是**宿主位置** —— 原先只挂在
 *      右侧浮层 Drawer 上, 不像 ZCode 那样嵌在右栏常驻。
 *   2. 「跳到编辑器」不是外部编辑器: 全 GUI grep `openExternal|vscode://|spawn(` 零命中。
 *      是自己 Monaco editor 页, 根因是两处**整行 onClick**:
 *        · FileCard.tsx        read 模式整行 onClick={handleOpen}
 *        · GeneratedFilesPanel.tsx 整行 onClick={() => handleOpen(path)}
 *
 * 本文件锁住的约定 (源码文本断言, 与 layout-panes.test.ts 同一套路):
 *   A. 文件卡片行点击不再派发 agentai:navigate; 只剩「编辑器」按钮这条跳转路径
 *   B. 右栏有 信息/浏览器 双模式, 浏览器走独立宽度 key, 且全项目只有 2 个 pane-grip
 *   C. window 事件监听只有一份 (browser-host.ts), 防双宿主 → 双开 + 双导航 + 重复订阅 socket
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const GUI = 'packages/agentai-gui';
const ROOT = resolve(__dirname, '..', '..', '..');
const src = (p: string) => readFileSync(join(ROOT, GUI, 'src', p), 'utf-8');

/** 去掉注释行 —— 修复点旁边的注释会引用被禁掉的旧写法, 直接 grep 会假阳性 */
const stripComments = (code: string) =>
  code.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

const count = (s: string, re: RegExp) => (s.match(re) || []).length;

// ════════════════════════════════════════════════════════════════════════
// A. 文件就地查看 — 行点击不跳页
// ════════════════════════════════════════════════════════════════════════

describe('A 文件卡片: 就地展开, 不整行跳编辑器', () => {
  const fileCard = stripComments(src('components/FileCard.tsx'));
  const genPanel = stripComments(src('components/GeneratedFilesPanel.tsx'));

  it('read 模式整行点击不派发 agentai:navigate', () => {
    // 修复前: <div onClick={handleOpen} style={{... cursor: 'pointer'}}>
    // 该行 onClick 必须只做展开
    expect(fileCard).not.toMatch(/onClick=\{handleOpen\}[\s\S]{0,120}?cursor: 'pointer'/);
    expect(fileCard).toContain('void toggleInline()');
  });

  it('「编辑器」按钮仍是跳转路径 (能力没被删掉)', () => {
    const handleOpen = fileCard.slice(fileCard.indexOf('const handleOpen'));
    expect(handleOpen).toContain("'agentai:navigate'");
    expect(handleOpen).toContain("'agentai:open-file-pending'");
    // 底部按钮文案改为「编辑器」, 不再是含糊的「打开」
    expect(count(fileCard, /label="编辑器"/g)).toBeGreaterThanOrEqual(2); // read + write/edit 两处
    expect(fileCard).not.toContain('label="打开"');
  });

  it('就地展开渲染上限: 超过 PREVIEW_LINE_CAP 才提示截断', () => {
    // 仓库里出现过单文件 30,528 行的变更, 3 万个 <div> 会卡死页面
    expect(fileCard).toContain('const PREVIEW_LINE_CAP = 400');
    expect(fileCard).toContain('已显示前 {PREVIEW_LINE_CAP} 行');
    expect(fileCard).toContain('显示全部');
    expect(fileCard).not.toContain('slice(0, 10)');   // 旧的"只给 10 行"
    expect(fileCard).not.toContain("点击\"打开\"在编辑器查看完整内容");
  });

  it('read_file 卡片无 content 时按需拉取 (FilesFromToolSegment 只传 path)', () => {
    expect(fileCard).toContain('/v1/files/read?path=');
    expect(fileCard).toContain('const [fetched, setFetched]');
  });

  it('GeneratedFilesPanel 行点击改预览, 跳转只留给「编辑器」图标', () => {
    expect(genPanel).toContain('/v1/files/read?path=');
    expect(genPanel).toMatch(/onClick=\{\(\) => handlePreview\(f\.path\)\}/);
    expect(genPanel).not.toMatch(/onClick=\{\(\) => handleOpen\(f\.path\)\}/);
    // 行内 tooltip 不再承诺"点击在编辑器中打开"
    expect(genPanel).toContain('点击展开预览');
    // 显式跳转入口仍在
    expect(genPanel).toMatch(/handleOpen\(f\.path\)/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// B. 右栏 信息 / 浏览器 双模式
// ════════════════════════════════════════════════════════════════════════

describe('B 右栏双模式 (信息 / 浏览器)', () => {
  const app = stripComments(src('App.tsx'));

  it('浏览器模式有独立宽度 key, 不与信息栏共用', () => {
    expect(app).toContain("storageKey: 'agentai.pane.browser.width'");
    expect(app).toContain("storageKey: 'agentai.pane.right.width'");
    // JSX 必须读 activePane —— 直接读 rightPane.width 会让浏览器栏拿到 320 而不是 520
    expect(app).toContain('const activePane = railMode');
  });

  it('模式切换有 testid 且信息模式只留给 chat 页', () => {
    expect(app).toContain('data-testid="rail-mode-info"');
    expect(app).toContain('data-testid="rail-mode-browser"');
    // 非 chat 页只有浏览器模式: Editor/ImageStudio 自带多栏, 平白加信息栏只会挤
    expect(app).toContain("const showInfoRail = page === 'chat' && railMode === 'info'");
    expect(app).toContain("const showBrowserRail = railMode === 'browser'");
  });

  it('仍然只有 2 根把手 (两种模式共用一个, 不能出现第三根)', () => {
    // layout-regression.test.ts 也断言 2, 这里再锁一次是因为本改动最容易加出第三根
    expect(count(app, /className=\{`pane-grip/g)).toBe(2);
  });

  it('浏览器宿主外套不滚动 (浏览器自己滚, 否则双层滚动条)', () => {
    expect(app).toMatch(/railMode === 'browser' \?[\s\S]{0,400}?minHeight: 0, overflow: 'hidden'/);
  });

  it('导航栏浏览器按钮切右栏模式, 不再直接开浮层', () => {
    const nav = app.slice(app.indexOf('data-testid="open-browser"') - 200);
    expect(nav).toContain("setRailMode('browser')");
    expect(app).toContain('railBrowserActive');
  });

  it('Ctrl+B 归 App (默认宿主是右栏, 不再是抽屉内部快捷键)', () => {
    expect(app).toMatch(/key\.toLowerCase\(\) === 'b'[\s\S]{0,200}?setRailMode/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// C. 宿主唯一性 — 事件监听只有一份
// ════════════════════════════════════════════════════════════════════════

describe('C 浏览器宿主: 唯一事件中枢', () => {
  const host = src('services/browser-host.ts');
  const drawer = stripComments(src('components/GlobalBrowserDrawer.tsx'));
  const app = stripComments(src('App.tsx'));

  it('中枢装且只装一份 window 监听 (含幂等 flag)', () => {
    expect(count(host, /addEventListener\('agentai:show-browser'/g)).toBe(1);
    expect(count(host, /addEventListener\('pulseflow:browser:open'/g)).toBe(1);
    expect(count(host, /addEventListener\('pulseflow:browser:close'/g)).toBe(1);
    expect(host).toContain('__agentaiBrowserHostInstalled');
  });

  it('GlobalBrowserDrawer 降级为纯消费方 (不再自己监听)', () => {
    expect(drawer).not.toContain("addEventListener('agentai:show-browser'");
    expect(drawer).not.toContain("addEventListener('pulseflow:browser:open'");
    expect(drawer).not.toContain("addEventListener('keydown'");
    expect(drawer).toContain('useBrowserHost()');
  });

  it('抽屉只在 intent === drawer 时渲染 (auto 走右栏), EmbeddedBrowser 因而只有一个实例', () => {
    expect(drawer).toContain("host.visible && host.intent === 'drawer'");
    // 两个宿主都挂同一份 EmbeddedBrowser, 但互斥条件保证同时只有一个存在:
    // 抽屉激活时必须把右栏收起, 否则两份 socket /browser 订阅
    expect(app).toContain("const drawerHostActive = hostVisible && hostIntent === 'drawer'");
    expect(app).toMatch(/showRightPanel = rightPanelVisible &&[\s\S]{0,80}?!drawerHostActive/);
    const appHasBrowser = /<EmbeddedBrowser/.test(app);
    const drawerHasBrowser = /<EmbeddedBrowser/.test(drawer);
    expect(appHasBrowser && drawerHasBrowser).toBe(true);
  });

  it('AI 自动调试链路仍通: 唤起事件 → 切右栏浏览器模式', () => {
    expect(host).toContain("addEventListener('pulseflow:browser:ai-start', () => BrowserHost.aiStart())");
    expect(host).toMatch(/aiStart\(\): void \{[\s\S]{0,200}?aiActive: true/);
    expect(app).toMatch(/hostVisible && hostIntent === 'auto'[\s\S]{0,200}?setRailMode\('browser'\)/);
    // openSeq 依赖: 只依赖 visible 布尔值的话, 手动切回信息模式后再唤起浏览器会"消失"
    expect(app).toContain('hostOpenSeq');
    expect(host).toContain('openSeq: this.state.openSeq + 1');
  });

  it('旧调用点 API 仍在 (ChatView / EditorChatPanel 未改)', () => {
    expect(host).toContain('export function openGlobalBrowser');
    expect(host).toContain('export function navigateGlobalBrowser');
    expect(drawer).toContain('export { openGlobalBrowser, navigateGlobalBrowser }');
  });
});
