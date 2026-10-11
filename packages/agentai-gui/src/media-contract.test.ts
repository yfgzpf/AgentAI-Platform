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
