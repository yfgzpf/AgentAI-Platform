/**
 * 自定义视频模型 (BYOK) 凭证解析 —— 2026-10-13
 * ====================================================================
 * 这条断链的教训: BYOK 打通时只改了 videoTaskManager 那条提交路径, 而
 * StoryboardPanel 有**自己独立实现**的 submitVideoTask + pollVideo。
 * 结果同一个自定义模型,「单次生成」模式正常、「剧本分镜」模式 Key 不下发。
 * 两处都正确、只有一处坏 —— 极难自查, 且用户只会报"分镜生成不出来"。
 *
 * 所以这里测的是**两条路径共用的同一个解析函数**, 保证今后再加提交路径时
 * 只需 import 它就能拿到一致行为。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getCustomModels,
  saveCustomModels,
  resolveByokCredential,
  CUSTOM_VIDEO_MODELS_KEY,
  type CustomVideoModel,
} from './customVideoModels';

function stubStorage(initial: Record<string, string> = {}) {
  const store: Record<string, string> = { ...initial };
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  });
  return store;
}

const models: CustomVideoModel[] = [
  { id: 'custom-1', name: '我的视频模型', apiKey: '  KEY-ABC  ', baseUrl: 'https://my.provider/v1' },
  { id: 'custom-2', name: '无 URL 的模型', apiKey: 'KEY-DEF', baseUrl: '' },
  { id: 'custom-3', name: '没填 Key 的模型', apiKey: '', baseUrl: 'https://x.example.com/v1' },
];

afterEach(() => { vi.unstubAllGlobals(); });

describe('customVideoModels: 存取', () => {
  it('应能写入并读回 (key 名与历史保持一致, 否则老用户已存的模型会消失)', () => {
    const store = stubStorage();
    saveCustomModels(models);
    expect(Object.keys(store)).toContain(CUSTOM_VIDEO_MODELS_KEY);
    expect(getCustomModels()).toHaveLength(3);
  });

  it('存储损坏时应返回空数组而不是抛错', () => {
    stubStorage({ [CUSTOM_VIDEO_MODELS_KEY]: '{not json' });
    expect(getCustomModels()).toEqual([]);
  });
});

describe('resolveByokCredential: 凭证解析', () => {
  beforeEach(() => {
    stubStorage({ [CUSTOM_VIDEO_MODELS_KEY]: JSON.stringify(models) });
  });

  it('应按 custom:<id> 取到对应凭证', () => {
    const cred = resolveByokCredential('custom:custom-1');
    expect(cred).toEqual({ apiKey: 'KEY-ABC', baseUrl: 'https://my.provider/v1' });
  });

  it('Key 应被 trim —— 用户从网页复制常带首尾空白', () => {
    // 后端会再兜一层, 但前端就该给出干净的值 (避免日志里出现带空格的 Key)
    expect(resolveByokCredential('custom:custom-1')!.apiKey).toBe('KEY-ABC');
  });

  it('baseUrl 为空时应返回 undefined 而不是空串 (空串会让后端拼出坏 URL)', () => {
    const cred = resolveByokCredential('custom:custom-2');
    expect(cred!.apiKey).toBe('KEY-DEF');
    expect(cred!.baseUrl).toBeUndefined();
  });

  it('内置模型应返回 null (调用方据此走服务端 env)', () => {
    expect(resolveByokCredential('cogvideo')).toBeNull();
    expect(resolveByokCredential('agnes')).toBeNull();
    expect(resolveByokCredential('seedance-2.5')).toBeNull();
    expect(resolveByokCredential(undefined)).toBeNull();
    expect(resolveByokCredential('')).toBeNull();
  });

  it('用户建了模型却没填 Key 时应返回 null, 而不是返回空 apiKey', () => {
    // 语义很重要: 返回"空凭证"会让下游以为用户提供了有效 Key,
    // 从而走后端 env 而不是提示"请填写 Key"。两者行为不同。
    expect(resolveByokCredential('custom:custom-3')).toBeNull();
  });

  it('模型 id 不存在时返回 null', () => {
    expect(resolveByokCredential('custom:does-not-exist')).toBeNull();
  });
});