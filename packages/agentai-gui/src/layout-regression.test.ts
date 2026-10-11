/**
 * 前端布局回归测试 (L-Batch 1, 2026-10-06)
 * ========================================================================
 * 覆盖:
 *   T1 useResizable —— 持久化/clamp/键盘/复位
 *   T2 layout.css —— z-index 层级定义 + 断点 + 关键布局属性
 *   T3 App.tsx —— 三栏已改用可拖拽（不再是硬编码 260/320）
 *   T4 fetchInterceptor —— x-workspace 头注入
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const GUI = 'packages/agentai-gui';
// vitest 的 cwd 是包目录（packages/agentai-gui），
// 相对路径必须基于 __dirname 上溯到 monorepo 根，否则会拼成
// packages/agentai-gui/packages/agentai-gui/... 报 ENOENT。
const ROOT = resolve(__dirname, '..', '..', '..');
const src = (p: string) => readFileSync(join(ROOT, GUI, 'src', p), 'utf-8');

// ════════════════════════════════════════════════════════════════════════
// T2: layout.css 骨架
// ════════════════════════════════════════════════════════════════════════

describe('T2 layout.css 布局骨架', () => {
  const css = src('styles/layout.css');

  it('z-index 层级已集中定义（7 层）', () => {
    for (const v of ['--z-base', '--z-sticky', '--z-dropdown', '--z-drawer',
      '--z-modal', '--z-toast', '--z-tooltip', '--z-dragging']) {
      expect(css, `缺少 ${v}`).toContain(v);
    }
  });

  it('★ 层级严格递增（Drawer<Modal<Tooltip，语义正确）', () => {
    const val = (name: string) => {
      const m = css.match(new RegExp(name + ':\\s*(\\d+)'));
      return m ? parseInt(m[1], 10) : -1;
    };
    expect(val('--z-base')).toBeLessThan(val('--z-sticky'));
    expect(val('--z-sticky')).toBeLessThan(val('--z-dropdown'));
    expect(val('--z-dropdown')).toBeLessThan(val('--z-drawer'));
    expect(val('--z-drawer')).toBeLessThan(val('--z-modal'));
    expect(val('--z-modal')).toBeLessThan(val('--z-toast'));
    expect(val('--z-toast')).toBeLessThan(val('--z-tooltip'));
    // 拖拽态必须最高
    expect(val('--z-tooltip')).toBeLessThan(val('--z-dragging'));
  });

  it('app-main 用 flex + min-height:0（避免撑破容器）', () => {
    const m = css.match(/\.app-main\s*\{([^}]*)\}/);
    expect(m).toBeTruthy();
    expect(m![1]).toMatch(/display:\s*flex/);
    expect(m![1]).toMatch(/min-height:\s*0/);
    expect(m![1]).toMatch(/min-width:\s*0/);
  });

  it('app-content 有 min-width:0（★ 三栏能收缩的关键）', () => {
    const m = css.match(/\.app-content\s*\{([^}]*)\}/);
    expect(m).toBeTruthy();
    expect(m![1]).toMatch(/min-width:\s*0/);
  });

  it('侧栏 flex-shrink:0（不被内容挤压）', () => {
    const m = css.match(/\.app-pane\s*\{([^}]*)\}/);
    expect(m).toBeTruthy();
    expect(m![1]).toMatch(/flex-shrink:\s*0/);
  });

  it('★ 有响应式断点（此前完全缺失）', () => {
    const bp = css.match(/@media\s*\([^)]+\)/g) || [];
    expect(bp.length, '至少要有 2 个断点').toBeGreaterThanOrEqual(2);
    expect(css).toContain('max-width: 1024px');
    expect(css).toContain('max-width: 720px');
  });

  it('窄屏下侧栏转为浮层且不显示拖拽把手', () => {
    const narrow = css.slice(css.indexOf('@media (max-width: 1024px)'));
    expect(narrow).toContain('position: absolute');
    expect(narrow).toContain('--z-drawer');
    expect(narrow).toMatch(/pane-grip[\s\S]{0,200}display:\s*none/);
  });

  it('把手有 hover/focus/dragging 三态 + 焦点轮廓（无障碍）', () => {
    expect(css).toContain('.pane-grip:hover');
    expect(css).toContain('.pane-grip:focus-visible');
    expect(css).toContain('.pane-grip.is-dragging');
  });

  it('★ 拖拽期禁用 iframe 指针（防拖拽卡死）', () => {
    expect(css).toContain('body.is-pane-resizing');
    expect(css).toMatch(/is-pane-resizing iframe[\s\S]{0,120}pointer-events:\s*none/);
  });

  it('不再有 calc(100vh - N) 魔法数字', () => {
    // 主骨架用 100vh + flex，不该再有 calc(100vh - 218px) 这类硬编码
    const appMain = src('App.tsx');
    expect(appMain).not.toMatch(/calc\(100vh\s*-\s*\d+px\)/);
  });

  it('提供通用工具类（替代内联 style 三件套）', () => {
    expect(css).toContain('.u-ellipsis');
    expect(css).toContain('.u-ellipsis-2');
    expect(css).toContain('.u-row');
    expect(css).toContain('.u-spacer');
  });

  it('已在 main.tsx 引入且在 global.css 之后', () => {
    const main = src('main.tsx');
    const layoutAt = main.indexOf("styles/layout.css");
    expect(layoutAt, 'main.tsx 未引入 layout.css').toBeGreaterThan(-1);
    expect(main.indexOf('styles/global.css')).toBeLessThan(layoutAt);
  });
});

// ════════════════════════════════════════════════════════════════════════
// T3: App.tsx 三栏改造
// ════════════════════════════════════════════════════════════════════════

describe('T3 App.tsx 三栏已改为可拖拽', () => {
  const app = src('App.tsx');

  it('不再有硬编码的 width:260 / width:320', () => {
    expect(app).not.toMatch(/width:\s*260,\s*borderRight/);
    expect(app).not.toMatch(/width:\s*320,\s*borderLeft/);
  });

  it('两侧栏都用 className 而非内联样式', () => {
    expect(app).toContain('app-pane app-pane-left');
    expect(app).toContain('app-pane app-pane-right');
    expect(app).toContain('app-pane-body');
  });

  it('两个把手都有无障碍属性', () => {
    const grips = app.match(/className=\{`pane-grip/g) || [];
    expect(grips.length).toBe(2);
    expect((app.match(/role="separator"/g) || []).length).toBe(2);
    expect((app.match(/tabIndex=\{0\}/g) || []).length).toBe(2);
    expect((app.match(/onKeyDown=\{/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('已接入 useResizable', () => {
    expect(app).toContain('useResizable');
    expect(app).toContain('leftPane.width');
    // 右栏 2026-10-11 起有 信息/浏览器 两种模式, JSX 统一读 activePane ——
    // 用 rightPane.width 的话浏览器模式会拿到信息栏的宽度 (320 而不是 520)
    expect(app).toContain('activePane.width');
    // PulseFlowSidebar 宽度应跟随
    expect(app).toMatch(/<PulseFlowSidebar\s+width=\{leftPane\.width\}/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// T4: useResizable 实现
// ════════════════════════════════════════════════════════════════════════

describe('T4 useResizable 实现', () => {
  const hook = src('hooks/useResizable.ts');

  it('导出 useResizable 与结果类型', () => {
    expect(hook).toContain('export function useResizable');
    expect(hook).toContain('UseResizableOptions');
    expect(hook).toContain('UseResizableResult');
  });

  it('★ 窄屏自适应上限（<1024px 时侧栏最多占 24%）', () => {
    expect(hook).toContain('clampWidth');
    const m = hook.match(/function clampWidth[\s\S]{0,400}/);
    expect(m![0]).toContain('1024');
    expect(m![0]).toMatch(/0\.24/);
  });

  it('键盘三键：← → Home', () => {
    expect(hook).toContain('ArrowLeft');
    expect(hook).toContain('ArrowRight');
    expect(hook).toContain("'Home'");
  });

  it('Shift 加速（步长 40 vs 12）', () => {
    const m = hook.match(/const step = [^\n]+/);
    expect(m).toBeTruthy();
    expect(m![0]).toContain('shiftKey');
    expect(m![0]).toContain('40');
    expect(m![0]).toContain('12');
  });

  it('★ 拖拽期设置/清理 body.is-pane-resizing（配 layout.css）', () => {
    const adds = (hook.match(/classList\.add\('is-pane-resizing'\)/g) || []).length;
    const removes = (hook.match(/classList\.remove\('is-pane-resizing'\)/g) || []).length;
    expect(adds, '必须有 add').toBeGreaterThanOrEqual(1);
    // remove 应出现在 onUp 与 useEffect cleanup 两处
    expect(removes, 'add 与 remove 必须配对（否则 iframe 永久失去交互）').toBeGreaterThanOrEqual(2);
  });

  it('宽度持久化到 localStorage', () => {
    expect(hook).toContain('localStorage.setItem(storageKey');
    expect(hook).toContain('localStorage.getItem(storageKey');
  });

  it('卸载时清理全部事件监听', () => {
    const m = hook.match(/return \(\) => \{[\s\S]{0,600}?\};/);
    expect(m).toBeTruthy();
    expect(m![0]).toContain("removeEventListener('mousemove'");
    expect(m![0]).toContain("removeEventListener('mouseup'");
    expect(m![0]).toContain("removeEventListener('mousedown'");
    expect(m![0]).toContain("removeEventListener('dblclick'");
  });

  it('注释说明为什么不用 CSS resize（防止后人改回去）', () => {
    expect(hook).toContain('resize');
    expect(hook).toMatch(/为什么不用 CSS/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// T5: fetchInterceptor 的 x-workspace 注入
// ════════════════════════════════════════════════════════════════════════

describe('T5 fetchInterceptor 注入 x-workspace', () => {
  const ic = src('services/fetchInterceptor.ts');

  it('读取 agentai.workspace（与 WorkspaceSelector 写入的键一致）', () => {
    expect(ic).toContain('agentai.workspace');
    expect(ic).toContain('currentWorkspace');
  });

  it('只对 Gateway API 路径注入', () => {
    expect(ic).toMatch(/API_PREFIXES[\s\S]{0,120}url\.startsWith/);
  });

  it('★ 不覆盖调用方显式设置的 x-workspace（useIdeState 已手动设过）', () => {
    expect(ic).toContain("headers.has('x-workspace')");
  });

  it('localStorage 不可用时静默降级', () => {
    const m = ic.match(/try \{[\s\S]{0,600}?localStorage[\s\S]{0,200}?catch/);
    expect(m).toBeTruthy();
    expect(ic).toMatch(/catch\s*\{\s*\/\*\s*localStorage 不可用/);
  });
});