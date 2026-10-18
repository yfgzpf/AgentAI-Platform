/**
 * chat-utils 单测 — 2026-10-12 ChatView 拆分配套护甲
 * 覆盖从 ChatView.tsx 拆出的两个纯函数:
 *   generateConversationSummary / detectAndInsertImage
 * ⚠️ vitest 环境为 node (vite.config.ts 无 test.environment 配置),
 *   故只测不访问 window 的分支; FILE:/URL: 文本回退分支依赖
 *   (window as any).__AGENTAI_GATEWAY__, 留给 jsdom 环境后续补。
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { generateConversationSummary, detectAndInsertImage } from './chat-utils';

describe('generateConversationSummary', () => {
  it('空消息数组也能产出结构完整摘要', () => {
    const out = generateConversationSummary([]);
    expect(out).toContain('上一轮对话摘要');
    expect(out).toContain('**用户需求**: ');
    expect(out).toContain('上下文压缩摘要');
  });

  it('提取用户需求 / 工具操作 / 最近回复', () => {
    const out = generateConversationSummary([
      { role: 'user', segments: [{ kind: 'text', text: '帮我查天气' }] },
      { role: 'assistant', segments: [{ kind: 'tool', name: 'get_weather', result: '{}' }] },
      { role: 'assistant', segments: [{ kind: 'text', text: '北京今天晴' }] },
    ]);
    expect(out).toContain('帮我查天气');
    expect(out).toContain('已执行操作: get_weather');
    expect(out).toContain('北京今天晴');
  });

  it('用户需求只保留最近 3 条', () => {
    const msgs = Array.from({ length: 5 }, (_, i) => ({
      role: 'user',
      segments: [{ kind: 'text', text: `需求${i + 1}` }],
    }));
    const out = generateConversationSummary(msgs);
    expect(out).toContain('需求3 → 需求4 → 需求5');
    expect(out).not.toContain('需求1');
    expect(out).not.toContain('需求2');
  });
});

describe('detectAndInsertImage', () => {
  const makeUpdater = () => {
    const fn = vi.fn();
    return { fn, update: (id: string, f: (m: any) => any) => fn(id, f) };
  };

  it('result 为空直接返回, 不调用 updateMessage', () => {
    const { fn, update } = makeUpdater();
    detectAndInsertImage('bot1', 'generate_image', undefined, update);
    expect(fn).not.toHaveBeenCalled();
  });

  it('黑名单工具永不触发图片检测', () => {
    const { fn, update } = makeUpdater();
    detectAndInsertImage('bot1', 'read_file', '{"imageBase64":"abc"}', update);
    expect(fn).not.toHaveBeenCalled();
  });

  it('browser_screenshot 的 imageBase64 插入 image segment', () => {
    const { fn, update } = makeUpdater();
    detectAndInsertImage('bot1', 'browser_screenshot', JSON.stringify({ imageBase64: 'BASE64DATA' }), update);
    expect(fn).toHaveBeenCalledTimes(1);
    const [id, transform] = fn.mock.calls[0];
    expect(id).toBe('bot1');
    const next = transform({ segments: [] });
    expect(next.segments[0]).toMatchObject({ kind: 'image', base64: 'BASE64DATA', alt: '浏览器截图' });
  });

  it('重复 base64 不重复插入', () => {
    const { fn, update } = makeUpdater();
    detectAndInsertImage('bot1', 'browser_screenshot', JSON.stringify({ imageBase64: 'DUP' }), update);
    const [, transform] = fn.mock.calls[0];
    const existing = { segments: [{ kind: 'image', base64: 'DUP', url: undefined }] };
    expect(transform(existing)).toBe(existing); // 原样返回, 不插入
  });

  it('通用 imageUrl 字段也识别', () => {
    const { fn, update } = makeUpdater();
    detectAndInsertImage('bot1', 'some_tool', JSON.stringify({ imageUrl: 'https://example.com/a.png' }), update);
    const [, transform] = fn.mock.calls[0];
    const next = transform({ segments: [] });
    expect(next.segments[0]).toMatchObject({ kind: 'image', url: 'https://example.com/a.png' });
  });

  it('非 JSON 无图片信号时静默跳过', () => {
    const { fn, update } = makeUpdater();
    detectAndInsertImage('bot1', 'some_tool', 'plain text, no image', update);
    expect(fn).not.toHaveBeenCalled();
  });
});

/* ═══ 文本回退分支 (依赖 window.__AGENTAI_GATEWAY__) ═══
 * vitest 为 node 环境, 这里用 globalThis.window 最小 mock 注入 gateway 地址,
 * 覆盖 FILE: 本地路径 / URL: 直链 / Markdown 图片三条回退路径。
 * (jsdom 包未安装且 pnpm 生态暂不可加新依赖, 用轻量 mock 等效验证。)
 */
describe('detectAndInsertImage — 文本回退分支 (window mock)', () => {
  const makeUpdater = () => {
    const fn = vi.fn();
    return { fn, update: (id: string, f: (m: any) => any) => fn(id, f) };
  };

  beforeAll(() => {
    (globalThis as any).window = { __AGENTAI_GATEWAY__: 'ws://127.0.0.1:18789' };
  });
  afterAll(() => {
    delete (globalThis as any).window;
  });

  it('FILE: 本地路径 → 转 gateway download URL 插入', () => {
    const { fn, update } = makeUpdater();
    detectAndInsertImage('bot1', 'some_tool', 'FILE: C:/out/gen-abc.png', update);
    expect(fn).toHaveBeenCalledTimes(1);
    const [, transform] = fn.mock.calls[0];
    const next = transform({ segments: [] });
    expect(next.segments[0]).toMatchObject({
      kind: 'image',
      url: 'http://127.0.0.1:18789/api/files/download?path=C%3A%2Fout%2Fgen-abc.png',
      alt: 'AI 生成图片',
    });
  });

  it('URL: 直链 → 直接插入', () => {
    const { fn, update } = makeUpdater();
    detectAndInsertImage('bot1', 'some_tool', 'URL: https://cdn.example.com/x.png', update);
    const [, transform] = fn.mock.calls[0];
    const next = transform({ segments: [] });
    expect(next.segments[0]).toMatchObject({ kind: 'image', url: 'https://cdn.example.com/x.png' });
  });

  it('Markdown 图片 ![alt](url) → 提取 url 并保留 alt', () => {
    const { fn, update } = makeUpdater();
    detectAndInsertImage('bot1', 'some_tool', '结果 ![示意图](https://cdn.example.com/y.png)', update);
    const [, transform] = fn.mock.calls[0];
    const next = transform({ segments: [] });
    expect(next.segments[0]).toMatchObject({ url: 'https://cdn.example.com/y.png', alt: '示意图' });
  });

  it('系统路径 (system32/favicon/logo) 不误判为图片', () => {
    const { fn, update } = makeUpdater();
    detectAndInsertImage('bot1', 'some_tool', 'C:\\Windows\\System32\\cmd.exe 输出完毕', update);
    detectAndInsertImage('bot1', 'some_tool', 'favicon.svg 已更新', update);
    expect(fn).not.toHaveBeenCalled();
  });
});
