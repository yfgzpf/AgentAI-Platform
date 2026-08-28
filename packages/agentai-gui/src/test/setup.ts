/**
 * vitest 全局 setup —— node 环境下补齐浏览器全局对象
 * config.ts 在模块加载期读取 window.__AGENTAI_GATEWAY__；
 * zustand persist 需要 localStorage。
 */
import { vi } from 'vitest';

const localStorageStub = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
})();

vi.stubGlobal('window', {
  __AGENTAI_GATEWAY__: undefined,
  location: { hostname: 'localhost', port: '5173', protocol: 'http:' },
  addEventListener: () => {},
  removeEventListener: () => {},
});

vi.stubGlobal('localStorage', localStorageStub);
vi.stubGlobal('document', {
  addEventListener: () => {},
  removeEventListener: () => {},
  querySelector: () => null,
  createElement: () => ({ style: {}, setAttribute: () => {}, appendChild: () => {} }),
});

vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0) as unknown as number);
vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
