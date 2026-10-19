/**
 * alro-probe 单测: 验证分组权限探测的纯函数逻辑 (mock fetch, 不联网)。
 */
import { describe, it, expect, vi } from 'vitest';
import { probeAlroAccess, formatAlroProbeLog, ALRO_PROBE_MODELS } from '../alro-probe.js';

function mockFetch(status: number, body = '') {
  return vi.fn(async () => ({
    status,
    text: async () => body,
  })) as unknown as typeof fetch;
}

describe('probeAlroAccess', () => {
  it('6 个类别全部探测, 不抛异常', async () => {
    const fetchImpl = mockFetch(200);
    const results = await probeAlroAccess({
      baseUrl: 'https://alro.huazhiweilai.com/v1',
      resolveKey: () => undefined,
      masterKey: 'sk-test',
      fetchImpl,
    });
    expect(results.length).toBe(ALRO_PROBE_MODELS.length);
    expect(results.every((r) => r.status === 'ok')).toBe(true);
  });

  it('分组密钥优先于主令牌', async () => {
    const fetchImpl = mockFetch(200);
    await probeAlroAccess({
      baseUrl: 'https://x/v1',
      resolveKey: (envVar) => (envVar === 'FACTORY_GPT_KEY' ? 'sk-gpt' : undefined),
      masterKey: 'sk-master',
      fetchImpl,
    });
    // 只有 GPT 类别用了 sk-gpt, 其余回退 sk-master
    const calls = fetchImpl.mock.calls as any[];
    const gptCall = calls.find((c) => JSON.parse(c[1].body).model === 'gpt-5.5');
    expect(gptCall[1].headers.Authorization).toBe('Bearer sk-gpt');
    const otherCall = calls.find((c) => JSON.parse(c[1].body).model === 'deepseek-flash');
    expect(otherCall[1].headers.Authorization).toBe('Bearer sk-master');
  });

  it('403 → forbidden, 并带 upstream 文案', async () => {
    const fetchImpl = mockFetch(403, '无权访问 国内模型 分组');
    const results = await probeAlroAccess({
      baseUrl: 'https://x/v1',
      resolveKey: () => undefined,
      masterKey: 'sk-test',
      fetchImpl,
    });
    const chat = results.find((r) => r.category === '国内·对话')!;
    expect(chat.status).toBe('forbidden');
    expect(chat.detail).toContain('国内模型');
  });

  it('分组密钥与主令牌都空 → no-key', async () => {
    const fetchImpl = mockFetch(200);
    const results = await probeAlroAccess({
      baseUrl: 'https://x/v1',
      resolveKey: () => undefined,
      fetchImpl,
    });
    expect(results.every((r) => r.status === 'no-key')).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('网络异常 → error, 不抛', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    const results = await probeAlroAccess({
      baseUrl: 'https://x/v1',
      resolveKey: () => undefined,
      masterKey: 'sk-test',
      fetchImpl,
    });
    expect(results.every((r) => r.status === 'error')).toBe(true);
  });

  it('baseUrl 末尾斜杠被清理', async () => {
    const fetchImpl = mockFetch(200);
    await probeAlroAccess({
      baseUrl: 'https://x/v1///',
      resolveKey: () => undefined,
      masterKey: 'sk-test',
      fetchImpl,
    });
    const url = (fetchImpl.mock.calls[0] as any[])[0];
    expect(url).toBe('https://x/v1/chat/completions');
  });
});

describe('formatAlroProbeLog', () => {
  it('渲染各状态文案', () => {
    const log = formatAlroProbeLog([
      { category: '国内·对话', subModel: 'deepseek-flash', status: 'ok' },
      { category: 'GPT', subModel: 'gpt-5.5', status: 'forbidden', detail: '无权访问 X' },
      { category: 'Claude', subModel: 'c', status: 'no-key', detail: 'FACTORY_CLAUDE_KEY 与 ALRC_API_KEY 均空' },
      { category: 'Grok', subModel: 'g', status: 'error', detail: 'timeout' },
    ]);
    expect(log[0]).toContain('✅');
    expect(log[1]).toContain('❌') && expect(log[1]).toContain('无权访问 X');
    expect(log[2]).toContain('➖');
    expect(log[3]).toContain('⚠️');
  });
});
