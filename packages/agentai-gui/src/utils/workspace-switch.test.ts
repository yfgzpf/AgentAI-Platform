/**
 * workspace-switch 单测 — 2026-10-12 会话↔工作区联动配套护甲
 * ----------------------------------------------------
 * 背景: Session.workspace 曾是"死字段"(createSession 从不传参),
 * 导致「点进历史会话不回原工作区」。本模块是切换工作区的唯一入口,
 * 逻辑错了会静默把用户带到错误目录 → 工具在错路径下跑, 属高后果缺陷,
 * 故补此测试。
 *
 * 环境: node + src/test/setup.ts 全局 stub (window/localStorage/document)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getCurrentWorkspace, switchWorkspace, workspaceLabel } from './workspace-switch';
import { useProfileStore } from '../store';

/**
 * ⚠️ 本项目 vite.config.ts 未配 vitest setupFiles, src/test/setup.ts 实际未生效,
 * 故此处自带浏览器全局 stub (zustand persist 与本模块都需要)。
 */
const installBrowserStubs = () => {
  const mem: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in mem ? mem[k] : null),
    setItem: (k: string, v: string) => { mem[k] = String(v); },
    removeItem: (k: string) => { delete mem[k]; },
    clear: () => { for (const k of Object.keys(mem)) delete mem[k]; },
    get length() { return Object.keys(mem).length; },
    key: (i: number) => Object.keys(mem)[i] ?? null,
  });
  vi.stubGlobal('window', {
    __AGENTAI_GATEWAY__: undefined,
    dispatchEvent: vi.fn(),
  });
};

describe('workspaceLabel', () => {
  it('取路径末段作为显示名', () => {
    expect(workspaceLabel('F:/agentai-platform')).toBe('agentai-platform');
    expect(workspaceLabel('F:/a/b/c')).toBe('c');
  });

  it('兼容反斜杠与结尾斜杠', () => {
    expect(workspaceLabel('F:\\work\\proj')).toBe('proj');
    expect(workspaceLabel('F:/work/proj/')).toBe('proj');
  });

  it('空值走 fallback (老会话的"未分类"桶)', () => {
    expect(workspaceLabel('')).toBe('未分类');
    expect(workspaceLabel(undefined)).toBe('未分类');
    expect(workspaceLabel('   ')).toBe('未分类');
    expect(workspaceLabel('', '历史')).toBe('历史');
  });

  it('单段路径原样返回', () => {
    expect(workspaceLabel('C:')).toBe('C:');
  });
});

describe('getCurrentWorkspace', () => {
  beforeEach(() => {
    installBrowserStubs();
    useProfileStore.getState().clearProfile();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('profile.workspace 优先', () => {
    useProfileStore.getState().setProfile({
      name: 'U', onboardedAt: 1, language: 'zh', workspace: 'F:/from-profile',
    });
    localStorage.setItem('agentai.workspace', 'F:/from-localstorage');
    expect(getCurrentWorkspace()).toBe('F:/from-profile');
  });

  it('profile 无 workspace 时回退 localStorage', () => {
    useProfileStore.getState().setProfile({ name: 'U', onboardedAt: 1, language: 'zh' });
    localStorage.setItem('agentai.workspace', 'F:/from-localstorage');
    expect(getCurrentWorkspace()).toBe('F:/from-localstorage');
  });

  it('两处都没有时返回空串 (不抛)', () => {
    expect(getCurrentWorkspace()).toBe('');
  });
});

describe('switchWorkspace', () => {
  beforeEach(() => {
    installBrowserStubs();
    useProfileStore.getState().clearProfile();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('切换成功: 返回 true 且写入 localStorage', () => {
    const ok = switchWorkspace('F:/target-ws', { syncGateway: false });
    expect(ok).toBe(true);
    expect(localStorage.getItem('agentai.workspace')).toBe('F:/target-ws');
  });

  it('同步更新 profileStore.workspace', () => {
    switchWorkspace('F:/target-ws', { syncGateway: false });
    expect(useProfileStore.getState().profile?.workspace).toBe('F:/target-ws');
  });

  it('广播 agentai:workspace-changed 事件', () => {
    switchWorkspace('F:/target-ws', { syncGateway: false });
    expect((window as any).dispatchEvent).toHaveBeenCalledTimes(1);
    const evt = (window as any).dispatchEvent.mock.calls[0][0];
    expect(evt.type).toBe('agentai:workspace-changed');
    expect(evt.detail.workspace).toBe('F:/target-ws');
  });

  it('目标与当前相同 → 不切换, 不发事件 (幂等)', () => {
    useProfileStore.getState().setProfile({
      name: 'U', onboardedAt: 1, language: 'zh', workspace: 'F:/same-ws',
    });
    const ok = switchWorkspace('F:/same-ws', { syncGateway: false });
    expect(ok).toBe(false);
    expect((window as any).dispatchEvent).not.toHaveBeenCalled();
  });

  it('空路径 / 纯空白 → 拒绝切换', () => {
    expect(switchWorkspace('', { syncGateway: false })).toBe(false);
    expect(switchWorkspace('   ', { syncGateway: false })).toBe(false);
    expect(localStorage.getItem('agentai.workspace')).toBe(null);
  });

  it('路径两端空白被裁剪', () => {
    switchWorkspace('  F:/padded-ws  ', { syncGateway: false });
    expect(localStorage.getItem('agentai.workspace')).toBe('F:/padded-ws');
  });

  it('默认同步 gateway /v1/workspace', () => {
    switchWorkspace('F:/gw-ws');
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as any).mock.calls[0];
    expect(String(url)).toContain('/v1/workspace');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ path: 'F:/gw-ws' });
  });

  it('syncGateway:false 时不请求 gateway', () => {
    switchWorkspace('F:/no-gw-ws', { syncGateway: false });
    expect(fetch).not.toHaveBeenCalled();
  });
});