/**
 * 回归测试: 「视频生成成功但前端不显示」(2026-10-20 实锤)
 * ========================================================================
 * 根因: ALRO(new-api 系) 视频查询响应常被包在 data.data 信封里, 真实
 *   status / result_url 在里层。旧提取链只查顶层字段 → videoUrl=null 但
 *   status 照透传 → 前端"显示成功却没视频"。
 *
 * 修复三道防线:
 *   G1 网关: 解包信封(unwrapVideoPayload) + 广撒网取 URL(extractVideoUrl)
 *            + 终态无地址时明确返回 warning(不再"完成但空地址")
 *   G2 前端 videoTaskManager: 终态 + 有地址 才算完成; 终态无地址 → 失败+原因
 *   G3 前端 StoryboardPanel.pollVideo: 兼容 'succeeded'; 绝不 resolve 空 URL
 *
 * 上半部分 = 对导出纯函数的真实单测(实际执行修复逻辑);
 * 下半部分 = 源码断言锁定三处行为, 防止修复被静默回退。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as nodePath from 'node:path';
import {
  unwrapVideoPayload,
  extractVideoUrl,
  normalizeVideoTaskStatus,
} from './routes/video.js';

const ROOT = nodePath.resolve(__dirname, '..', '..', '..');
const rd = (rel: string) => readFileSync(nodePath.join(ROOT, rel), 'utf-8');

const videoSrc = rd('packages/agentai-gateway/src/routes/video.ts');
const taskManagerSrc = rd('packages/agentai-gui/src/services/videoTaskManager.ts');
const storyboardSrc = rd('packages/agentai-gui/src/components/StoryboardPanel.tsx');

function codeOnly(src: string): string {
  const NL = String.fromCharCode(10);
  return src
    .split(NL)
    .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
    .join(NL);
}
const videoCode = codeOnly(videoSrc);
const tmCode = codeOnly(taskManagerSrc);
const sbCode = codeOnly(storyboardSrc);

// ===================== 真实单测 =====================

describe('unwrapVideoPayload — 解包 new-api 信封', () => {
  it('data.data 是对象时解包到里层', () => {
    const wrapped = { data: { status: 'succeeded', result_url: 'https://x/v.mp4' } };
    expect(unwrapVideoPayload(wrapped)).toBe(wrapped.data);
  });
  it('无 data 字段时原样返回', () => {
    const flat = { status: 'succeeded', url: 'https://x/v.mp4' };
    expect(unwrapVideoPayload(flat)).toBe(flat);
  });
  it('data.data 是数组时不解包(防止误判)', () => {
    const arr = { data: [{ status: 'succeeded' }] };
    expect(unwrapVideoPayload(arr)).toBe(arr);
  });
  it('data 本身为 null 时返回原值', () => {
    expect(unwrapVideoPayload(null)).toBe(null);
  });
});

describe('extractVideoUrl — 广撒网取地址', () => {
  const U = 'https://cdn.example.com/v.mp4';
  it('顶层 result_url', () => {
    expect(extractVideoUrl({ result_url: U })).toBe(U);
  });
  it('顶层 url', () => {
    expect(extractVideoUrl({ url: U })).toBe(U);
  });
  it('顶层 video_url', () => {
    expect(extractVideoUrl({ video_url: U })).toBe(U);
  });
  it('信封里 data.url', () => {
    expect(extractVideoUrl({ data: { url: U } })).toBe(U);
  });
  it('content.video.url (火山原生)', () => {
    expect(extractVideoUrl({ content: { video: { url: U } } })).toBe(U);
  });
  it('output[0].url', () => {
    expect(extractVideoUrl({ output: [{ url: U }] })).toBe(U);
  });
  it('videos[0].url', () => {
    expect(extractVideoUrl({ videos: [{ url: U }] })).toBe(U);
  });
  it('data.data.url (双层信封)', () => {
    expect(extractVideoUrl({ data: { data: { url: U } } })).toBe(U);
  });
  it('没有地址时返回 null', () => {
    expect(extractVideoUrl({ status: 'succeeded' })).toBe(null);
  });
  it('非 http(s) 字符串被忽略', () => {
    expect(extractVideoUrl({ url: 'ftp://x/v.mp4' })).toBe(null);
    expect(extractVideoUrl({ url: 'just-a-string' })).toBe(null);
  });
  it('兼容大小写混杂的对象形状', () => {
    expect(extractVideoUrl({ RESULT_URL: U })).toBe(null); // 仅小写字匹配
    expect(extractVideoUrl({ result_url: U })).toBe(U);
  });
});

describe('normalizeVideoTaskStatus — 状态归一(大小写/new-api 兼容)', () => {
  it("new-api 'succeeded' → done", () => {
    expect(normalizeVideoTaskStatus({ status: 'succeeded' })).toBe('done');
  });
  it("大写 'Succeeded' → done (大小写不敏感)", () => {
    expect(normalizeVideoTaskStatus({ status: 'Succeeded' })).toBe('done');
  });
  it("'completed' → done", () => {
    expect(normalizeVideoTaskStatus({ status: 'completed' })).toBe('done');
  });
  it("'failed' → failed", () => {
    expect(normalizeVideoTaskStatus({ status: 'failed' })).toBe('failed');
  });
  it("'processing' → pending", () => {
    expect(normalizeVideoTaskStatus({ status: 'processing' })).toBe('pending');
  });
  it("'queued' → pending", () => {
    expect(normalizeVideoTaskStatus({ status: 'queued' })).toBe('pending');
  });
  it('state 字段兜底', () => {
    expect(normalizeVideoTaskStatus({ state: 'succeeded' })).toBe('done');
  });
});

// ===================== 源码断言(防回归) =====================

describe('G1 网关: 工厂 seedance 查询修复', () => {
  it('工厂分支使用信封解包 + 广撒网提取', () => {
    expect(videoCode).toContain('extractVideoUrl(payload) || extractVideoUrl(data)');
    expect(videoCode).toContain('unwrapVideoPayload(data)');
  });
  it('终态无地址时返回 warning(绝不"完成但空地址")', () => {
    expect(videoCode).toContain('terminalNoUrl');
    expect(videoCode).toContain('未能从上游响应中解析出视频地址');
  });
});

describe('G2 前端 videoTaskManager: 终态无地址不得标完成', () => {
  it('有地址才算完成', () => {
    expect(tmCode).toContain('if (isTerminalDone && finalUrl)');
  });
  it('终态但无地址 → 失败 + 可操作原因', () => {
    expect(tmCode).toContain('} else if (isTerminalDone && !finalUrl) {');
    expect(tmCode).toContain('未能取到视频地址');
  });
  it('WS 推送: 收到"完成"但无地址时继续轮询(不实然停止)', () => {
    expect(tmCode).toContain('if (!data.videoUrl) return;');
  });
});

describe('G3 前端 StoryboardPanel.pollVideo: 兼容 succeeded + 绝不 resolve 空 URL', () => {
  it('终态集合包含 succeeded', () => {
    expect(sbCode).toContain("'completed', 'success', 'succeeded', 'done', 'finished'");
  });
  it('解析出的地址赋给 vurl, 仅当 vurl 存在才 resolve 成功', () => {
    expect(sbCode).toContain('const vurl =');
    expect(sbCode).toContain('if (vurl) {');
  });
  it('终态无地址时多等几轮再判失败, 不立即 resolve 空 URL', () => {
    expect(sbCode).toContain('noUrlCount');
    expect(sbCode).toContain('++noUrlCount > 6');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2026-10-21 追加: 「10s 生成 5s / 参考图全丢」防回归
// 根因: 网关解析了 seconds/images/aspect_ratio 但只喂 Agnes 引擎,
//   工厂与火山 seedance 分支只传 prompt+image(单数, 分镜路径恒 undefined)。
// 修复: 提交参数 opts 透传 (duration/ratio/resolution/image_url/images)。
// ─────────────────────────────────────────────────────────────────────────────
describe('F: seedance 提交参数透传 (时长/参考图/画幅)', () => {
  it('工厂分支接收并透传 seconds/images/aspectRatio/size', () => {
    expect(videoSrc).toContain("submitSeedanceViaFactory(res, fKey, seedanceSubModel, prompt, { seconds, images: reqImages, aspectRatio, size: agnesSize })");
    expect(videoSrc).toContain('body.duration = durNum');
    expect(videoSrc).toContain('body.ratio = opts.aspectRatio');
    expect(videoSrc).toContain('body.resolution = reso');
    expect(videoSrc).toContain('if (imgs.length > 1) body.images = imgs');
  });
  it('火山直连同源透传 (duration + 多参考图 role 标注)', () => {
    expect(videoSrc).toContain("submitSeedance(res, key, prompt, image, { seconds, images: reqImages, aspectRatio, size: agnesSize })");
    expect(videoSrc).toContain("role: i === 0 ? 'first_frame' : 'reference_images'");
  });
  it('公网参考图直传 URL, 内网才转 base64 (不再 5×2MB 撑爆请求体)', () => {
    expect(videoSrc).toContain('async function toUpstreamImage');
    expect(videoSrc).toContain('await toUpstreamImage(imgs[0]!)');
  });
});
