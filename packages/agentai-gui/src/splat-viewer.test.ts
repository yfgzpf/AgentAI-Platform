/**
 * 高斯场景 (.splat) 渲染槽 + 截帧 回归 (2026-10-17)
 * ========================================================================
 * 用户诉求 (逐字): 「给我们当前项目生视频精修页面同样添加同样支持生成3D场景」
 *   + 「固定种子将场景渲染浏览器截图是不是比我们传场景要好得多」
 *
 * 背景: Tripo image-to-splat 产出 .splat, 但没有任何视频引擎吃 3D 资产。
 * 唯一通路是 .splat → 渲染成 1280x720 的 2D 帧 → 视频 firstFrame。
 * 本文件锁住这条链路**在源码层面**的硬约定 (真正的活体验证在
 * packages/agentai-gateway/scripts/verify-splat-render.mjs, 需要 Playwright)。
 *
 * 为什么这些断言值得单独立文件:
 *   相机矩阵的**约定错一次就是全黑画面** (本轮实际踩过) —— 该渲染器的
 *   view space 是 +z = 视线方向 (COLMAP 风格), 且投影矩阵把 y 取负,
 *   所以相机 +y 必须指向世界下方。这类「矩阵转置/翻转」缺陷看代码看不出来,
 *   只有 9/9 的活体验证 + 这里的方向断言能兜住。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..', '..');
const GUI = join(ROOT, 'packages/agentai-gui');
const read = (rel: string) => readFileSync(join(GUI, rel), 'utf-8');

const viewer = read('public/splat-viewer.js');
const splatViewer = read('src/components/SplatViewer.tsx');
const model3d = read('src/components/Model3DGen.tsx');
const videoGen = read('src/components/VideoGen.tsx');
const verifyScript = readFileSync(
  join(ROOT, 'packages/agentai-gateway/scripts/verify-splat-render.mjs'),
  'utf-8',
);

// ════════════════════════════════════════════════════════════════════════
// A. 渲染器 (vendor) — 三处「不修就白屏/黑屏」的补丁
// ════════════════════════════════════════════════════════════════════════

describe('A 渲染器补丁', () => {
  it('保留 MIT 归属 (vendor 合法性)', () => {
    expect(viewer).toMatch(/MIT/i);
    expect(viewer).toMatch(/Kevin Kwok/);
  });

  it('preserveDrawingBuffer: true — 否则 toDataURL 读到空缓冲', () => {
    expect(viewer).toMatch(/preserveDrawingBuffer:\s*true/);
  });

  it('截帧前铺不透明底色 (着色器用加法混合, 画布 alpha 恒为 0)', () => {
    // capture() 里必须 fillRect 再 drawImage, 不能直接把透明画布导成 PNG
    const cap = viewer.slice(viewer.indexOf('const capture ='));
    expect(cap).toMatch(/ctx\.fillRect\(/);
    expect(cap).toMatch(/ctx\.drawImage\(canvas/);
    expect(cap).toMatch(/image\/jpeg/);
  });

  it('相机约定: view-space +z = 视线方向 (center - eye)', () => {
    // 写反 (eye - center) → 所有点 w < 0 被裁掉 → 全黑。实测 0 像素 vs 124k 像素
    expect(viewer).toMatch(/const z = \[fit\.center\[0\] - eye\[0\]/);
  });

  it('相机 +y 指向世界下方 (投影矩阵 y 取负)', () => {
    // y = cross(x, z); 若写成 cross(z, x) 出图上下颠倒 (合成球实测蓝顶红底)
    expect(viewer).toMatch(/const y = \[\s*x\[1\] \* z\[2\] - x\[2\] \* z\[1\]/);
    expect(viewer).toMatch(/getProjectionMatrix[\s\S]{0,200}-\s*\(2 \* fy\)/);
  });

  it('自动取景半径 = 实测最远点距 (不是包围盒对角线)', () => {
    expect(viewer).toMatch(/Math\.sqrt\(maxDist\)/);
  });

  it('渲染分辨率与 CSS 尺寸解耦 (固定 1280x720)', () => {
    expect(viewer).toMatch(/Number\(OPTS\.width\) \|\| innerWidth/);
    expect(viewer).toMatch(/Number\(OPTS\.height\) \|\| innerHeight/);
  });

  it('worker 由 Blob 创建 (CSP worker-src blob:, 不走跨源 URL)', () => {
    expect(viewer).toMatch(/new Worker\([\s\S]{0,120}URL\.createObjectURL/);
  });

  it('暴露宿主控制面 __splatApi / __splatReady / __splatError', () => {
    for (const k of ['__SPLAT_OPTS__', '__splatApi', '__splatReady', '__splatError', '__splatBounds']) {
      expect(viewer).toContain(k);
    }
    expect(viewer).toMatch(/window\.__splatApi = \{\s*setView,\s*capture,/);
  });

  it('原始 debug 脚本已清理', () => {
    const scripts = readdirSync(join(ROOT, 'packages/agentai-gateway/scripts'));
    expect(scripts.filter(f => f.startsWith('_dbg'))).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════
// B. 宿主组件 — iframe 同源 + 1280x720 + 5 个预设视角
// ════════════════════════════════════════════════════════════════════════

describe('B SplatViewer 宿主', () => {
  it('截帧尺寸固定 1280x720', () => {
    expect(splatViewer).toMatch(/const FRAME_W = 1280/);
    expect(splatViewer).toMatch(/const FRAME_H = 720/);
  });

  it('iframe 同源 (srcDoc + allow-same-origin) — 否则读不到 contentWindow 的 canvas', () => {
    expect(splatViewer).toMatch(/srcDoc=\{html\}/);
    expect(splatViewer).toMatch(/sandbox="allow-scripts allow-same-origin"/);
  });

  it('srcDoc 必须按 URL 记忆化 — 每次渲染重拼会让 iframe 反复重载', () => {
    expect(splatViewer).toMatch(/useMemo\(\(\) => buildSplatHtml\(splatUrl\), \[splatUrl\]\)/);
  });

  it('厂商预签名外链走 gateway 白名单代理', () => {
    expect(splatViewer).toContain('/v1/3d-file?url=');
    expect(splatViewer).toContain('GATEWAY_HTTP');
  });

  it('5 个预设视角 + 「截取当前视角」入口', () => {
    const presetCount = (splatViewer.match(/key: '(front|left|right|back|top)'/g) || []).length;
    expect(presetCount).toBe(5);
    expect(splatViewer).toContain('截取当前视角');
  });

  it('截帧为空时明确报错, 不把空白图发给生视频', () => {
    expect(splatViewer).toMatch(/dataUrl\.length < 2000/);
  });

  it('视角切换后等一次新的深度排序 (否则截到旧画面)', () => {
    expect(splatViewer).toMatch(/s\.sorts \|\| 0\) > \(before\.sorts/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// C. 跨页接线 — 3D 页 → localStorage → 生视频页
// ════════════════════════════════════════════════════════════════════════

describe('C 3D 页 → 生视频 首帧通路', () => {
  const KEY = 'agentai-video-sceneframe';

  it('SplatViewer 写、VideoGen 读, 同一个 key', () => {
    expect(splatViewer).toContain(KEY);
    expect(videoGen).toContain(KEY);
  });

  it('Model3DGen 的 tripo 任务走 SplatViewer (非 GLB 查看器)', () => {
    expect(model3d).toMatch(/import \{ SplatViewer \} from '\.\/SplatViewer'/);
    expect(model3d).toMatch(/provider === 'tripo'[\s\S]{0,120}<SplatViewer/);
  });

  it('保留「发源图」快速路径 (原图直发, 不需等渲染)', () => {
    expect(model3d).toContain('发源图');
  });

  it('持久化任务时剥掉 sourceImage (base64 可达 8MB, 会撑爆 localStorage 5MB)', () => {
    expect(model3d).toMatch(/\.map\(\(\{ sourceImage, \.\.\.rest \}\) => rest\)/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// D. 活体验证脚本本身 — 必须包含朝向断言, 否则「上下颠倒」测不出来
// ════════════════════════════════════════════════════════════════════════

describe('D 活体验证脚本', () => {
  it('存在且用 SwiftShader 软件 WebGL (无 GPU 机器也能跑)', () => {
    expect(existsSync(join(ROOT, 'packages/agentai-gateway/scripts/verify-splat-render.mjs'))).toBe(true);
    expect(verifyScript).toContain('--use-angle=swiftshader');
  });

  it('fixture 带方向色 (顶红 / 底蓝) 并断言 +Y 在画面上方', () => {
    expect(verifyScript).toContain('朝向正确 (+Y 在画面顶部)');
    expect(verifyScript).toMatch(/topRgb\[0\] > front\.topRgb\[2\]/);
  });

  it('断言截帧真的是 1280x720 JPEG', () => {
    expect(verifyScript).toMatch(/front\.w === 1280 && front\.h === 720/);
    expect(verifyScript).toContain('data:image/jpeg');
  });
});
