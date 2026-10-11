/**
 * 媒资前后端契约回归测试 (生图 / 生视频 / 分镜, 2026-10-11)
 * ========================================================================
 * 这三块是核心版块, 但缺陷都属于「静默失效」型: UI 看上去一切正常,
 * 请求也发出去了, 只是打到了不存在的端点 / 参数名对不上 / 值被后端忽略。
 * 因此这里锁的是**请求契约**, 而不是渲染结果。
 *
 * 实测依据 (2026-10-11, 网关未重启亦可复现):
 *   curl "http://127.0.0.1:18789/v1/video/query?taskId=X&model=agnes"
 *     → 400 {"error":"无法识别 provider: (空)"}
 *   curl "http://127.0.0.1:18789/v1/video/X?provider=agnes"
 *     → 404 (来自上游 Agnes, 说明路由正确解析了 taskId)
 * 即: `/v1/video/query` 这个端点根本不存在, 会被 GET /v1/video/:taskId
 * 以 taskId='query' 吃掉, 且后端读的是 req.query.provider。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const GUI = 'packages/agentai-gui';
const ROOT = resolve(__dirname, '..', '..', '..');
const src = (p: string) => readFileSync(join(ROOT, GUI, 'src', p), 'utf-8');

/**
 * 去掉整行注释后再断言。
 * 必需: 这些文件的修复注释里会**引用**错误写法 (例如 "曾经打 /v1/video/query"),
 * 直接对原文正则会让注释把自己的负向断言顶掉。
 */
const stripComments = (code: string) =>
  code.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

// ════════════════════════════════════════════════════════════════════════
// 分镜 (StoryboardPanel) — 轮询契约
// ════════════════════════════════════════════════════════════════════════

describe('分镜: 视频任务轮询契约', () => {
  const code = stripComments(src('components/StoryboardPanel.tsx'));

  it('★ 不得再打不存在的 /v1/video/query', () => {
    expect(code).not.toContain('/v1/video/query');
  });

  it('★ 必须与 VideoGen / videoTaskManager 用同一契约: 路径参数 + provider', () => {
    expect(code).toMatch(/\/v1\/video\/\$\{encodeURIComponent\(taskId\)\}\?provider=/);
  });

  it('★ submitVideoTask 必须回传后端 provider, 前端不得自己猜引擎', () => {
    expect(code).toMatch(/taskId:\s*data\.taskId,\s*provider:\s*data\.provider/);
    // 曾经的猜测式映射: modelName === 'agnes-video-2.5' ? 'agnes-video-2.5' : 'agnes'
    expect(code).not.toMatch(/modelName === 'agnes-video-2\.5'/);
  });

  it('残留的 videoResult 拿到的是 provider, 不是 model 名', () => {
    const calls = code.match(/pollVideo\(result\.taskId,[^)]*\)/g) || [];
    expect(calls.length, '两处调用点 (单镜/批量) 都要传 provider').toBeGreaterThanOrEqual(2);
    for (const c of calls) expect(c).toContain('result.provider');
  });
});

describe('分镜: 续集尾帧', () => {
  const code = stripComments(src('components/StoryboardPanel.tsx'));

  it('★ apiLastFrame 不得是恒 undefined 的占位表达式', () => {
    expect(code).not.toMatch(/videoUrl\s*\?\s*undefined\s*:\s*undefined/);
    expect(code).toMatch(/const apiLastFrame = lastShot\?\.lastFrameUrl/);
  });

  it('Shot 携带 lastFrameUrl, 且轮询结果写回镜次', () => {
    expect(code).toMatch(/lastFrameUrl\?:\s*string/);
    const writes = code.match(/lastFrameUrl: videoResult\.lastFrameUrl/g) || [];
    expect(writes.length, '单镜 + 批量两条路径都要写回').toBeGreaterThanOrEqual(2);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 生图 (ImageStudio) — 请求体契约
// ════════════════════════════════════════════════════════════════════════

describe('生图: /v1/image 请求体', () => {
  const code = stripComments(src('components/ImageStudio.tsx'));

  it('★ 必须发送 ratio (后端早支持, 前端此前从不发 → 出图恒 1:1)', () => {
    expect(code).toMatch(/const body: any = \{ prompt: finalPrompt, size, ratio, model, mode \}/);
  });

  it('★ 画幅选择器真的接上了常量 (ASPECT_RATIOS 不再是死代码)', () => {
    expect(code).toMatch(/options=\{ASPECT_RATIOS\}/);
    // 常量定义与引用都要在
    expect(code).toContain('const ASPECT_RATIOS');
  });

  it('★ 清晰度默认值必须落在 SIZES 的选项集合里', () => {
    expect(code).toMatch(/const \[size, setSize\] = useState\('1K'\)/);
    // SIZES 的值域
    expect(code).toMatch(/const SIZES = \[[\s\S]{0,200}'1K'[\s\S]{0,200}'2K'[\s\S]{0,200}'4K'/);
  });

  it('★ 「张数」不再是死控件: 前端串行补足, 且不再发无效的 n', () => {
    expect(code).toMatch(/const times = mode === 'text2img'/);
    expect(code).not.toMatch(/n:\s*batchCount/);
  });

  it('批次仅对文生图生效 (改图/换装是多轮语义, 不能被倍数放大)', () => {
    expect(code).toMatch(/Math\.max\(1, Math\.min\(4, batchCount\)\)/);
    expect(code).toContain('genOnce');
  });
});

// ════════════════════════════════════════════════════════════════════════
// 生视频 — 引擎可用性自检 + 限流重试 (2026-10-11)
// ════════════════════════════════════════════════════════════════════════
//
// 实测 (2026-10-11, POST /v1/video):
//   model=agnes-video-2.5 → 400 缺 AGNES_VIDEO_API_KEY
//   model=seedance-2.5    → 400 缺 VOLCANO_API_KEY
//   model=cogvideo        → 200 queued
//   model=agnes           → 429 「您已达到免费用户的 API 速率限制」 ← 用户口中的"队列满"
// 即 4 个引擎只有 1 个能跑, 而前端此前**完全无从知道** Key 配没配。

const GW = 'packages/agentai-gateway';
const gwSrc = (p: string) => readFileSync(join(ROOT, GW, 'src', p), 'utf-8');

describe('生视频: GET /v1/video/engines 可用性自检', () => {
  const code = stripComments(gwSrc('routes/video.ts'));

  it('★ engines 路由必须注册在 /v1/video/:taskId 之前 (否则被当成 taskId 吞掉)', () => {
    const enginesAt = code.indexOf("router.get('/v1/video/engines'");
    const taskIdAt = code.indexOf("router.get('/v1/video/:taskId'");
    expect(enginesAt, 'engines 端点缺失').toBeGreaterThan(-1);
    expect(taskIdAt).toBeGreaterThan(-1);
    expect(enginesAt, 'engines 在 :taskId 之后 → 会被 Express 吞掉').toBeLessThan(taskIdAt);
  });

  it('返回 available + requiredEnv, 前端才能提示该配哪个变量', () => {
    expect(code).toMatch(/available:\s*engineAvailable\(e\)/);
    expect(code).toMatch(/requiredEnv:\s*e\.env/);
  });

  it('★ 引擎表只有一处 (POST 自动选择与 engines 端点共用, 不得再写死第二份)', () => {
    expect(code).toContain('const VIDEO_ENGINES');
    expect(code).toMatch(/VIDEO_ENGINES\.filter\(engineAvailable\)/);
    // 原先 POST 处理器里的内联 candidates 数组应已删除
    expect(code).not.toMatch(/const candidates: Array<\{ name: string; env: string\[\] \}>/);
  });
});

describe('生视频: 前端不把用户送进必然 400 的引擎', () => {
  const gen = stripComments(src('components/VideoGen.tsx'));

  it('拉取引擎可用性', () => {
    expect(gen).toContain('/v1/video/engines');
    expect(gen).toContain('isEngineAvailable');
  });

  it('★ 未配置 Key 的引擎在下拉里被禁用并标注', () => {
    expect(gen).toMatch(/disabled:\s*unavailable/);
    expect(gen).toContain('未配置 Key');
  });

  it('★ 两处自动切换都必须先查可用性 (原先无条件切到缺 Key 的正式版)', () => {
    const switches = gen.match(/setModel\('agnes-video-2\.5'\)/g) || [];
    const guards = gen.match(/isEngineAvailable\('agnes-video-2\.5'\)/g) || [];
    expect(switches.length, 'extract-frames + extract-tail 两处切换').toBe(2);
    expect(guards.length, `守卫数须与切换数一致 (${switches.length})`).toBe(switches.length);
    // 不得再有裸切换
    expect(gen).not.toMatch(
      /if \(model === 'cogvideo' \|\| model === 'agnes'\) \{\s*\n\s*setModel\('agnes-video-2\.5'\)/,
    );
  });
});

describe('生视频: 限流重试不得无限循环', () => {
  const code = stripComments(src('services/videoTaskManager.ts'));

  it('★ 重试有上限 (原先每次限流都 unshift 回队首 → 任务永远"排队中")', () => {
    expect(code).toContain('MAX_THROTTLE_RETRIES');
    expect(code).toMatch(/tries <= MAX_THROTTLE_RETRIES/);
  });

  it('429 也算限流 (原先只认 503, 429 被立刻标失败, 丢失退避机会)', () => {
    expect(code).toMatch(/resp\.status === 429/);
  });

  it('重试耗尽后落到 failed 并给出可执行的替代方案', () => {
    expect(code).toContain('仍被限流');
    expect(code).toContain('CogVideoX-Flash');
  });
});

describe('生视频: 引擎忽略的参数不得在 UI 上装作可调', () => {
  const gen = stripComments(src('components/VideoGen.tsx'));
  const gw = stripComments(gwSrc('routes/video.ts'));

  it('★ 后端 submitCogVideo 确实不接收 seconds/size/aspectRatio (锁 UI 的依据)', () => {
    const sig = gw.match(/async function submitCogVideo\(([^)]*)\)/)?.[1];
    expect(sig, 'submitCogVideo 签名必须存在').toBeTruthy();
    expect(sig).not.toContain('seconds');
    expect(sig).not.toContain('aspectRatio');
    // 调用点同样不传 (res, key, prompt, image, end_frame)
    expect(gw).toContain('submitCogVideo(res, key, prompt, image, end_frame)');
  });

  it('★ cogvideo 标 ignoresParams, 时长标签变暗不可点', () => {
    expect(gen).toContain('ignoresParams: true');
    // CheckableTag 无 disabled prop → 必须用样式锁 (tsc 已证)
    expect(gen).toContain("pointerEvents: 'none'");
    const tags = gen.match(/style=\{lockedTagStyle\}/g) || [];
    expect(tags.length, 'DURATIONS 与 Seedance 两条渲染路径都要锁').toBe(2);
    expect(gen).toContain('由引擎决定 · 不可调');
  });

  it('★ 宽高比 Select 也锁 (原先完全开放, 但后端从不读它)', () => {
    expect(gen).toMatch(/disabled=\{!!getModelCaps\(model\)\.ignoresParams\} options=\{ASPECT_RATIOS\}/);
  });

  it('★ 预计耗时不再由无效的 duration 推导 (假精度)', () => {
    expect(gen).toContain("? '预计 2-4 分钟'");
  });
});

describe('生视频: 死代码 pollTask 不得复活', () => {
  const gen = stripComments(src('components/VideoGen.tsx'));

  it('本地 setInterval 轮询已删除, 轮询只在 videoTaskManager', () => {
    expect(gen).not.toMatch(/const pollTask = \(/);
    expect(gen).toContain("from '../services/videoTaskManager'");
  });
});
