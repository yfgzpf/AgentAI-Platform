/**
 * media-view.test.ts — 媒体查看链路回归 (2026-10-18)
 * ============================================================
 * 对应四条实机反馈:
 *   ① "AI 任务里生成的图不能点开看大图"
 *      → 气泡 `.bubble-enter` 的动画终帧 `transform: scale(1)` 被 forwards 残留,
 *        让祖先成为 position:fixed 后代的包含块 → 预览层被裁在气泡里。
 *        修法: 预览层走 createPortal 挂 body + keyframes 终帧改 `transform: none`。
 *   ② "生成的文件无法查看"（点开是乱码）
 *      → Editor.openFile 一律 API.read(utf-8) 塞 Monaco; 媒体类型必须走预览。
 *   ③ "生成的文件列表里没有生图产物"
 *      → generate_image 的路径只在输出文本 `FILE:` 行, 不在 args。
 *   ④ "对话改图没效果"
 *      → 附件 dataUrl 是网关 http URL, 既裂图又让厂商抓不到 127.0.0.1。
 *
 * 这些是**源码契约**断言 (与 rail-browser.test.ts 同风格), 防回归比跑 DOM 更稳。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as nodePath from 'node:path';
import { toImageDataUrl } from './components/chat/chat-utils';

const guiRoot = nodePath.resolve(__dirname, '..');
const read = (rel: string) => readFileSync(nodePath.join(guiRoot, rel), 'utf-8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .map((l) => { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l; }).join('\n');

describe('① 大图预览不再被气泡 transform 困住', () => {
  const css = read('src/styles/agentai-theme.css');
  const thread = strip(read('src/components/Thread.tsx'));

  it('bubbleIn 终帧必须是 transform: none (残留 transform 会变成包含块)', () => {
    const block = css.match(/@keyframes bubbleIn\s*\{[\s\S]*?\n\}/);
    expect(block, 'bubbleIn 关键帧应存在').toBeTruthy();
    expect(block![0]).toMatch(/to\s*\{[^}]*transform:\s*none/);
    // 反断言: 不允许把终帧写回 scale(1) —— 那正是事故根因
    expect(block![0]).not.toMatch(/to\s*\{[^}]*transform:\s*scale\(1\)/);
  });

  it('预览层用 Portal 挂到 body, 而不是就地 position:fixed', () => {
    expect(thread).toContain("import { createPortal } from 'react-dom'");
    expect(thread).toMatch(/const Lightbox[\s\S]{0,2500}createPortal\(/);
    expect(thread).toMatch(/document\.body/);
  });

  it('画廊与单图预览都走 Lightbox (不再各自写一份 fixed 层)', () => {
    const lightboxUses = (thread.match(/<Lightbox/g) || []).length;
    expect(lightboxUses, '至少两处: ImageGallery + ImageCardSmall').toBeGreaterThanOrEqual(2);
    // 预览层 z-index 必须是具体数字 (CSS 变量没定义会掉成 auto, 被面板盖住)
    expect(thread).toMatch(/zIndex:\s*\d{6,}/);
  });

  it('大图仍保留「保存 / 打开原图」动作', () => {
    expect(thread).toContain('保存图片');
    expect(thread).toContain('打开原图');
    expect(thread).toMatch(/downloadImage\(/);
  });
});

describe('② 媒体文件走预览, 不塞进 Monaco', () => {
  const editor = strip(read('src/components/Editor.tsx'));

  it('openFile 先按扩展名判类型, 媒体/PDF 直接 openPreview', () => {
    expect(editor).toContain('getPreviewType');
    expect(editor).toMatch(/ptype === 'image'[\s\S]{0,200}openPreview\(node\)/);
    expect(editor).toMatch(/openPreview/);
  });

  it('媒体分支在 API.read 之前 return (不能先读文本再预览)', () => {
    const previewIdx = editor.indexOf("ptype === 'image'");
    const readIdx = editor.indexOf('await API.read(filePath)');
    expect(previewIdx).toBeGreaterThan(-1);
    expect(readIdx).toBeGreaterThan(-1);
    expect(previewIdx).toBeLessThan(readIdx);
  });
});

describe('③ 生成的文件列表能收到生图产物', () => {
  const gen = strip(read('src/components/GeneratedFilesPanel.tsx'));

  it('路径从输出文本 FILE: 行兜底 (generate_image 不在 args 里给路径)', () => {
    expect(gen).toMatch(/FILE:\\s\*\(\[\^\\s\\n\"'\]\+\)/);
    expect(gen).toContain('pathFromOutput');
  });

  it('generate_video 也纳入列表', () => {
    expect(gen).toMatch(/generate_image\|generate_diagram\|generate_video/);
  });

  it('媒体类型不按 utf-8 读 (图片就地渲染, 视频给播放器, PDF 转预览面板)', () => {
    expect(gen).toMatch(/IMAGE_EXT/);
    expect(gen).toMatch(/VIDEO_EXT/);
    // 媒体分支必须在 fetch('/v1/files/read') 之前 return
    const mediaIdx = gen.indexOf('IMAGE_EXT.test(ext)');
    const fetchIdx = gen.indexOf("fetch(`/v1/files/read");
    expect(mediaIdx).toBeGreaterThan(-1);
    expect(mediaIdx).toBeLessThan(fetchIdx);
  });
});

describe('④ 对话改图: 附件统一转 data URI', () => {
  const chat = strip(read('src/components/ChatView.tsx'));

  it('发送前把非 data: 的图片地址转换掉', () => {
    expect(chat).toContain('toImageDataUrl');
    expect(chat).toMatch(/!a\.dataUrl\.startsWith\('data:'\)/);
  });

  it('转换结果用于显示与请求体 (同一份 currentAttachments)', () => {
    expect(chat).toMatch(/attachments:\s*currentAttachments\.length/);
    expect(chat).toMatch(/kind === 'image' && att\.dataUrl/);
  });

  it('toImageDataUrl: data URI 原样返回, 失败返回 null 不抛', async () => {
    expect(await toImageDataUrl('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    expect(await toImageDataUrl('http://127.0.0.1:18789/api/files/download?path=x.png')).toBeNull();
  });

  it('toImageDataUrl: 非 2xx 返回 null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    expect(await toImageDataUrl('http://x/y.png')).toBeNull();
  });
});

afterEach(() => { vi.unstubAllGlobals(); });
