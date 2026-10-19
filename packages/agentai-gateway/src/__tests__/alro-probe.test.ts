/**
 * alro-probe 单测: 验证分组权限探测的纯函数逻辑 (mock fetch, 不联网)。
 */
import { describe, it, expect, vi } from 'vitest';
import { probeAlroAccess, formatAlroProbeLog, summarizeAlroForbidden, ALRO_PROBE_MODELS } from '../alro-probe.js';

function mockFetch(status: number, body = '') {
  return vi.fn(async () => ({
    status,
    text: async () => body,
  })) as unknown as typeof fetch;
}

describe('probeAlroAccess', () => {
  it('文本类别探测成功, 图像/视频 skipped (2026-10-20: 创建计费任务, 不自动探测)', async () => {
    const fetchImpl = mockFetch(200);
    const results = await probeAlroAccess({
      baseUrl: 'https://alro.huazhiweilai.com/v1',
      resolveKey: () => undefined,
      masterKey: 'sk-test',
      fetchImpl,
    });
    expect(results.length).toBe(ALRO_PROBE_MODELS.length);
    const chat = results.filter((r) => !ALRO_PROBE_MODELS.find((e) => e.category === r.category)?.skipReason);
    expect(chat.every((r) => r.status === 'ok'), '文本类别应全部 ok').toBe(true);
    // 图像/视频: 不发请求 (省钱), 且状态标 skipped 而不是伪造 ok/403
    const skipped = results.filter((r) => r.status === 'skipped');
    expect(skipped.map((r) => r.category).sort()).toEqual(['生图', '视频']);
    expect(fetchImpl.mock.calls.length, '只应探测文本类别').toBe(chat.length);
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
    expect(results.filter((r) => r.status === 'no-key').length).toBe(
      ALRO_PROBE_MODELS.filter((e) => !e.skipReason).length,
    );
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
    const probed = results.filter((r) => r.status !== 'skipped');
    expect(probed.length).toBeGreaterThan(0);
    expect(probed.every((r) => r.status === 'error')).toBe(true);
    // skipped 的两项没有发请求, 所以不受网络异常影响 (2026-10-20)
    expect(results.filter((r) => r.status === 'skipped').length).toBe(2);
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

describe('summarizeAlroForbidden', () => {
  it('无 forbidden → null', () => {
    expect(summarizeAlroForbidden([
      { category: '国内·对话', subModel: 'd', status: 'ok' },
      { category: 'GPT', subModel: 'g', status: 'ok' },
    ])).toBeNull();
  });

  it('5❌同源 domestic 令牌 → 合并成"只需一把全权限 ALRC_API_KEY"', () => {
    const summary = summarizeAlroForbidden([
      { category: '国内·对话', subModel: 'd', status: 'ok' },
      { category: 'GPT', subModel: 'g', status: 'forbidden', detail: '无权访问 国内模型 分组' },
      { category: 'Claude', subModel: 'c', status: 'forbidden', detail: '无权访问 国内 模型 分组' },
      { category: 'Grok', subModel: 'gk', status: 'forbidden', detail: '无权访问 国内模型 分组' },
      { category: '生图', subModel: 'n', status: 'forbidden', detail: '无权访问 国内模型 分组' },
      { category: '视频', subModel: 'dv', status: 'forbidden', detail: '无权访问 国内 模型 分组' },
    ]);
    expect(summary).not.toBeNull();
    expect(summary!).toContain('同一把 domestic 令牌');
    expect(summary!).toContain('ALRC_API_KEY');
    expect(summary!).toContain('GPT/Claude/Grok/生图/视频');
  });

  it('含非分组原因 (如 model_not_found) → 走普通汇总, 不合并', () => {
    const summary = summarizeAlroForbidden([
      { category: 'GPT', subModel: 'g', status: 'forbidden', detail: 'model_not_found: gpt-5.5' },
      { category: 'Claude', subModel: 'c', status: 'forbidden', detail: 'model_not_found: claude-x' },
    ]);
    expect(summary).not.toBeNull();
    expect(summary!).not.toContain('同一把 domestic 令牌');
    expect(summary!).toContain('GPT/Claude');
  });

  it('仅 1 个 forbidden → 普通汇总 (不满足同源≥2)', () => {
    const summary = summarizeAlroForbidden([
      { category: '国内·对话', subModel: 'd', status: 'ok' },
      { category: 'GPT', subModel: 'g', status: 'forbidden', detail: '无权访问 国内模型 分组' },
    ]);
    expect(summary).not.toBeNull();
    expect(summary!).not.toContain('同一把 domestic 令牌');
  });
});
