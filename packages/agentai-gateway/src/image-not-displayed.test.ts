/**
 * 生图链路回归测试 (2026-10-21)
 * 锁定上一轮审计发现的 P0/P1 不回退:
 *   P0 — 网关「200 但解析不到地址」曾返回 {url:'', provider:'none'} (无 error),
 *        前端据此调用 message.success 假成功、却无图可显。
 *   P1a — 图生图失败曾是"空头降级"(只 console.warn 不重发), 函数自然结束返回空 200。
 *   P1b — 智谱 CogView 免费模型悄悄丢失 2K/3K/4K 档位, 无提示。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { tierDowngradeNotice } from './routes/image';

const SRC = readFileSync(resolve(__dirname, 'routes/image.ts'), 'utf-8');

describe('P0: 生图绝不再「返回成功但无图」', () => {
  it('已彻底移除 url:""(provider:none) 的假成功返回', () => {
    expect(SRC).not.toMatch(/url:\s*'',\s*provider:\s*'none'/);
  });
  it('图生图与文生图两条分支终态无地址都返回明确的 GENERATED_BUT_NO_URL 错误', () => {
    const hits = (SRC.match(/code:\s*'GENERATED_BUT_NO_URL'/g) || []).length;
    expect(hits).toBe(2);
  });
  it('返回错误用 res.status(500) 而非 res.json(空 url)', () => {
    expect(SRC).toMatch(/res\.status\(500\)\.json\(\{\s*error: '图片已生成但未能解析出地址/);
  });
});

describe('P1a: 图生图失败是真实降级, 非空头支票', () => {
  it('agnesText2ImgPayload 辅助函数已定义', () => {
    expect(SRC).toMatch(/async function agnesText2ImgPayload\(/);
  });
  it('图生图 !resp.ok 非 429/402 时真的调降级 (而非只 warn)', () => {
    expect(SRC).toMatch(/const fb = await agnesText2ImgPayload\(apiKey, finalPrompt, tier, finalRatio, negative_prompt\);/);
    expect(SRC).toMatch(/return res\.status\(resp\.status\)\.json\(\{\s*error: `图生图失败/);
  });
  it('图生图 200 空地址也尝试真实降级, 仍失败才报错', () => {
    expect(SRC).toMatch(/const fb2 = await agnesText2ImgPayload\(apiKey, finalPrompt, tier, finalRatio, negative_prompt\);/);
  });
});

describe('P1b: 智谱高清档位降级必须透出提示', () => {
  it('tierDowngradeNotice 在两条智谱返回路径都被调用', () => {
    const calls = (SRC.match(/const notice = tierDowngradeNotice\(size\);/g) || []).length;
    expect(calls).toBe(2);
  });
  it('notice 字段会被并入响应 (dedicated cogview + text2img 降级)', () => {
    expect(SRC).toMatch(/\.\.\.\(notice \? \{ notice \} : \{\}\)/);
  });
});

describe('tierDowngradeNotice 纯函数行为', () => {
  it('2K/3K/4K 返回降级提示', () => {
    expect(tierDowngradeNotice('2K')).toContain('不支持 2K/3K/4K');
    expect(tierDowngradeNotice('4k')).toContain('不支持 2K/3K/4K');
    expect(tierDowngradeNotice('3K')).toContain('不支持 2K/3K/4K');
  });
  it('1K 与空值不提示 (标准分辨率本就支持)', () => {
    expect(tierDowngradeNotice('1K')).toBeUndefined();
    expect(tierDowngradeNotice('')).toBeUndefined();
    expect(tierDowngradeNotice('1024x1024')).toBeUndefined();
  });
});
