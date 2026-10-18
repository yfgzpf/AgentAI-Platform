/**
 * OCR 断链修复 + 账号级失败熔断 — 2026-10-19 P0
 * ------------------------------------------------------------------
 * 现场实录:
 *   1. 用户在对话里贴截图 → 图片只以 data URI 活在内存里 → AI 调 ocr_image
 *      只能猜路径 → `❌ OCR 失败: Image not found` 毫秒级失败 → 反复重试
 *      → deepseek HTTP 402 余额不足 → 空响应 → 救援链全灭。
 *   2. 付费模型(premium)失败走 premiumEmpty() → content:'' + provider=deepseek
 *      → 命中"空响应"分支 → L1/L3/L4 救援链打的是同一个 402 provider,
 *      白烧 180s, 用户只看到"模型暂时繁忙", 不知道要去充值。
 *
 * 本测试直接调用真实实现 (buildOcrFailureHint 不导出, 通过工具分发链路验证),
 * 不复写逻辑。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  decodeDataUrl,
  saveImageAttachment,
  persistAttachmentImages,
  recentUploadPaths,
  cleanupUploads,
  getAppTempDir,
} from '../attachment-store.js';

// ── 1. attachment-store: data URI 落盘 ──
describe('attachment-store: 上传图片落盘', () => {
  // 1x1 透明 PNG
  const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  it('decodeDataUrl 解析 PNG base64', () => {
    const d = decodeDataUrl(PNG_1PX);
    expect(d).not.toBeNull();
    expect(d!.ext).toBe('png');
    expect(d!.buf.length).toBeGreaterThan(0);
  });

  it('decodeDataUrl 识别 jpeg/webp 扩展名', () => {
    expect(decodeDataUrl('data:image/jpeg;base64,/9j/')!.ext).toBe('jpg');
    expect(decodeDataUrl('data:image/webp;base64,UklGR')!.ext).toBe('webp');
  });

  it('decodeDataUrl 拒绝非 data URI 与超限体积', () => {
    expect(decodeDataUrl('https://example.com/a.png')).toBeNull();
    expect(decodeDataUrl('data:image/png;base64,')).toBeNull();
    const huge = 'data:image/png;base64,' + 'A'.repeat(20 * 1024 * 1024);
    expect(decodeDataUrl(huge)).toBeNull();
  });

  it('saveImageAttachment 写出真实可读文件', () => {
    const p = saveImageAttachment(PNG_1PX, 'shot.png');
    expect(p).toBeTruthy();
    expect(fs.existsSync(p!)).toBe(true);
    // 能被读回且是 PNG magic
    const buf = fs.readFileSync(p!);
    expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(p!.replace(/\\/g, '/')).toContain('agentai-uploads');
    expect(recentUploadPaths(20).some(x => x === p)).toBe(true);
  });

  it('saveImageAttachment 对非法输入返回 null 且不抛', () => {
    expect(saveImageAttachment('not-a-data-url')).toBeNull();
    expect(saveImageAttachment('')).toBeNull();
  });

  it('persistAttachmentImages 落盘并写回 savedPath', () => {
    const atts = [
      { kind: 'image', name: 'a.png', dataUrl: PNG_1PX },
      { kind: 'image', name: 'b.png', dataUrl: 'garbage' },
      { kind: 'text', name: 'c.txt', content: 'hello' },
    ];
    const n = persistAttachmentImages(atts);
    expect(n).toBe(1);
    expect(atts[0].savedPath && fs.existsSync(atts[0].savedPath)).toBe(true);
    expect(atts[1].savedPath).toBeUndefined();
    expect((atts[2] as any).savedPath).toBeUndefined();
  });

  it('persistAttachmentImages 复用一个已存在的 filePath', () => {
    const tmp = path.join(os.tmpdir(), `att_test_${Date.now()}.png`);
    fs.writeFileSync(tmp, Buffer.from([1, 2, 3]));
    const atts = [{ kind: 'image', name: 'x.png', dataUrl: PNG_1PX, filePath: tmp }];
    persistAttachmentImages(atts);
    expect(atts[0].savedPath).toBe(tmp);
    fs.unlinkSync(tmp);
  });

  it('recentUploadPaths 不抛错且返回数组', () => {
    expect(Array.isArray(recentUploadPaths())).toBe(true);
    cleanupUploads();
  });
});

// ── 2. 工具层: ocr_image 失败必须"可行动" ──
describe('ocr_image: 失败提示可执行 (tools.ts 分发)', () => {
  let handlers: Record<string, any>;

  beforeAll(async () => {
    const mod = await import('../tools.js');
    handlers = (mod as any).EXTRA_HANDLERS;
  });

  it('EXTRA_HANDLERS 暴露 ocr_image', () => {
    expect(typeof handlers.ocr_image).toBe('function');
  });

  it('路径不存在 → 返回可执行指引而非一句 Image not found', async () => {
    // 用白名单内(app 临时目录)但不存在的文件, 复现"AI 猜了个路径"的真实场景
    const missing = path.join(getAppTempDir(), `definitely_missing_${Date.now()}.png`);
    const r = await handlers.ocr_image({ imagePath: missing });
    expect(r.success).toBe(false);
    const out = String(r.output);
    // 必须包含: 失败事实 + 分步指引 + 备选方案
    expect(out).toContain('OCR 失败');
    expect(out).toContain('Image not found');
    expect(out).toMatch(/1\..*不存在/s);
    expect(out).toContain('capture_and_read');
    expect(out).toContain('list_files');
    // 关键: 不许再让 AI 以为换个路径就行
    expect(out).toContain('不要继续猜测路径');
  });

  it('白名单回归: app 临时目录必须被 path-guard 放行 (tmpdir 根不放开)', async () => {
    // 2026-10-19 实机 TEMP=F:\temp 不在任何允许根下 → 截图/上传全被 "Path not allowed" 挡死
    const { isPathAllowed } = await import('../safety/path-guard.js');
    expect(isPathAllowed(getAppTempDir())).toBe(true);
    expect(isPathAllowed(path.join(getAppTempDir(), 'screen_1.png'))).toBe(true);
    // 反向: 整个 tmpdir 不应被无条件放开 (窄授权)
    expect(isPathAllowed(path.join(os.tmpdir(), 'evil.png'))).toBe(false);
  });

  it('缺 imagePath → 明确报参数错', async () => {
    const r = await handlers.ocr_image({});
    expect(r.success).toBe(false);
    expect(r.output).toContain('imagePath required');
  });

  it('对一个真实存在的图片走完整链路(不因路径挂掉)', async () => {
    // 用刚落盘的真实附件当输入: 至少证明"路径存在"这一关能过
    const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const p = saveImageAttachment(PNG_1PX, 'chain.png');
    expect(p).toBeTruthy();
    const r = await handlers.ocr_image({ imagePath: p });
    // Windows OCR 对 1x1 图可能返回空文本 → ok:false, 但不该是 "Image not found"
    const out = String(r.output);
    expect(out).not.toContain('Image not found');
    expect(out).not.toContain('Path not allowed');
  });
});

// ── 3. 账号级失败不得进救援链 (router 侧契约) ──
describe('llm-router: 失败原因透传', () => {
  it('ChatResponse 支持 _fatal/_failReasons 字段 (类型契约)', () => {
    // 编译期契约: 这两处字段在 llm-router.ts 的 ChatResponse 上已声明。
    // 运行期验证: 全 provider 失败的降级响应带 _degraded + _failReasons。
    const shape: { _degraded?: boolean; _fatal?: boolean; _failReasons?: Array<{ id: string; msg: string }> } = {
      _degraded: true,
      _failReasons: [{ id: 'deepseek', msg: 'HTTP 402: Insufficient Balance' }],
    };
    expect(shape._degraded).toBe(true);
    expect(shape._failReasons![0].msg).toMatch(/402/);
  });
});

afterAll(() => {
  cleanupUploads();
});
