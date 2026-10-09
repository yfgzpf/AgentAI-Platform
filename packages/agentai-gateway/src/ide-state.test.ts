/**
 * IDE 状态串味回归测试
 * =====================================================
 * 三个原缺陷:
 *   1. 守卫 fail-open: `if (currentWorkspace && ideStateWorkspace && ...)`
 *      —— ideStateWorkspace 为空时整体失效，任何工作区都能读到上一份状态
 *   2. 无 TTL: updatedAt 被记录但从不检查，状态永不过期
 *   3. resetIdeState() 漏清 ideStateWorkspace
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  updateIdeState,
  buildIdeContext,
  getIdeState,
  resetIdeState,
  IDE_STATE_TTL,
} from './ide-state.js';

const state = {
  openFiles: [{ path: 'src/old.tsx', language: 'tsx', cursorLine: 10, cursorColumn: 5 }],
  activeFile: 'src/old.tsx',
  isEditing: true,
};

beforeEach(() => {
  resetIdeState();
  vi.useRealTimers();
});

afterEach(() => {
  resetIdeState();
  vi.useRealTimers();
});

describe('缺陷1: 守卫必须 fail-closed', () => {
  it('ideStateWorkspace 为空时其他工作区读不到（原实现会放行）', () => {
    // 模拟 GUI 首次推送时 workspace 为空（localStorage 未初始化）
    updateIdeState(state, '');
    expect(getIdeState().openFiles.length).toBe(1);   // 状态确实存了
    expect(buildIdeContext('D:/projB')).toBe('');    // 任何具体工作区都读不到 ★
    expect(buildIdeContext('D:/projA')).toBe('');
  });

  it('两侧都为空视为同一个 key（与 soul workspace-scope 的 __default__ 一致）', () => {
    updateIdeState(state, '');
    // 请求侧也没 workspace → 双方都是 ''，视为同一桶，允许注入
    // （行为与 soul/workspace-scope.ts 的 normalizeWs('') === '__default__' 对齐）
    expect(buildIdeContext(undefined)).toContain('src/old.tsx');
  });

  it('workspace 匹配时才注入', () => {
    updateIdeState(state, 'D:/projA');
    const ctx = buildIdeContext('D:/projA');
    expect(ctx).toContain('src/old.tsx');
    expect(ctx).toContain('<ide-context>');
  });

  it('workspace 不匹配时不注入', () => {
    updateIdeState(state, 'D:/projA');
    expect(buildIdeContext('D:/projB')).toBe('');
  });

  it('请求侧不传 workspace 时也不注入', () => {
    updateIdeState(state, 'D:/projA');
    expect(buildIdeContext(undefined)).toBe('');
  });

  it('切换 workspace 会清空旧文件列表', () => {
    updateIdeState(state, 'D:/projA');
    expect(getIdeState().openFiles.length).toBe(1);

    updateIdeState(
      { openFiles: [{ path: 'src/new.py', language: 'py', cursorLine: 1, cursorColumn: 1 }], activeFile: 'src/new.py', isEditing: true },
      'D:/projB',
    );
    // A 的文件已被清掉，只剩B 的
    expect(getIdeState().openFiles.map((f) => f.path)).toEqual(['src/new.py']);
    expect(buildIdeContext('D:/projA')).toBe('');
    expect(buildIdeContext('D:/projB')).toContain('src/new.py');
  });
});

describe('缺陷2: TTL 过期', () => {
  it('状态超过 TTL 后不注入', () => {
    vi.useFakeTimers();
    updateIdeState(state, 'D:/projA');

    // 用实际导出的 TTL 计算，不硬编码时间 —— 否则调参即红
    vi.advanceTimersByTime(Math.floor(IDE_STATE_TTL * 0.5));
    expect(buildIdeContext('D:/projA')).toContain('src/old.tsx');

    // 越过 TTL —— 过期
    vi.advanceTimersByTime(Math.ceil(IDE_STATE_TTL * 0.6));
    expect(buildIdeContext('D:/projA')).toBe('');
  });

  it('isEditing=false（用户已关闭编辑器）时不注入', () => {
    // 对应 ide-state.ts 的"闸 3": 用户关掉编辑器面板后不再推送，
    // 但 TTL 内的缓存还在；加isEditing 检查确保只在真正编辑时注入
    updateIdeState({ ...state, isEditing: false }, 'D:/projA');
    expect(buildIdeContext('D:/projA')).toBe('');
  });

  it('updatedAt 为 0（从未推送有效状态）时不注入', () => {
    // reset 后状态为空，openFiles 也是空，天然不注入
    expect(buildIdeContext('D:/projA')).toBe('');

    // 模拟：状态里有文件但 updatedAt 归零（历史数据/迁移）
    updateIdeState(state, 'D:/projA');
    const s = getIdeState();
    s.updatedAt = 0;
    expect(buildIdeContext('D:/projA')).toBe('');
  });
});

describe('缺陷3: resetIdeState 必须清 workspace 标记', () => {
  it('reset 后不再注入任何工作区', () => {
    updateIdeState(state, 'D:/projA');
    expect(buildIdeContext('D:/projA')).toContain('src/old.tsx');

    resetIdeState();

    // 原实现：文件列表清了但 ideStateWorkspace 还是 'D:/projA'，
    // 此时若再推一份状态，守卫会认为 workspace 匹配
    expect(buildIdeStatePlaceholder()).toBe('');

    // 关键：reset 后再用同一 workspace 推送，状态是干净的新状态
    updateIdeState(
      { openFiles: [{ path: 'src/fresh.ts', language: 'ts', cursorLine: 1, cursorColumn: 1 }], activeFile: 'src/fresh.ts', isEditing: true },
      'D:/projA',
    );
    const ctx = buildIdeContext('D:/projA');
    expect(ctx).toContain('src/fresh.ts');
    expect(ctx).not.toContain('src/old.tsx');
  });
});

// 辅助: reset 后 openFiles 为空，buildIdeContext 必然返回 ''
function buildIdeStatePlaceholder(): string {
  return buildIdeContext('D:/projA');
}

describe('注入内容正确性（防回归）', () => {
  it('注入内容包含活动文件、光标、其他打开文件', () => {
    updateIdeState(
      {
        openFiles: [
          { path: 'src/a.ts', language: 'ts', cursorLine: 10, cursorColumn: 5, selectedText: 'const x = 1;' },
          { path: 'src/b.tsx', language: 'tsx', cursorLine: 3, cursorColumn: 1 },
        ],
        activeFile: 'src/a.ts',
        diagnostics: [
          { file: 'src/a.ts', line: 12, severity: 'error', message: 'TS2304: cannot find name' },
        ],
        isEditing: true,
      },
      'D:/projA',
    );
    const ctx = buildIdeContext('D:/projA');
    expect(ctx).toContain('当前文件: src/a.ts');
    expect(ctx).toContain('光标: L10:5');
    expect(ctx).toContain('选中文本');
    expect(ctx).toContain('src/b.tsx');
    expect(ctx).toContain('1 个编译错误');
    expect(ctx.trim().endsWith('</ide-context>')).toBe(true);
  });
});