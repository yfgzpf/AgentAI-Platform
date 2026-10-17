#!/usr/bin/env node
/**
 * verify-splat-render.mjs — .splat 渲染器活体验证
 * ================================================
 * 验证对象: packages/agentai-gui/public/splat-viewer.js (vendor 自 antimatter15/splat)
 *
 * 为什么需要这个脚本:
 *   Tripo image-to-splat 要真实 Key + 约 4 分钟 + 30 积分才能拿到产物, 本机没有。
 *   但渲染器本身可以脱离 Tripo 验证 —— 这里现场生成一个合法的 .splat
 *   (Fibonacci 球面, 每点 32 字节: pos f32×3 + scale f32×3 + rgba u8×4 + quat u8×4),
 *   用真实 Chromium + WebGL 渲染, 检查:
 *     1. 渲染器能解析文件并进入 ready (点云数量 > 0)
 *     2. canvas 真的画出了东西 (非黑像素占比 > 阈值)
 *     3. 截帧 API 返回可解码的 JPEG, 且不是全黑
 *     4. setView 换视角后画面确实变化 (排序 + 重绘链路通)
 *
 * 它不能证明的: Tripo 产物的真实尺度/朝向是否合适 (需要真 Key 跑一次)。
 *
 * 用法: node packages/agentai-gateway/scripts/verify-splat-render.mjs
 * 依赖: playwright (gateway 已装) + 本机 Chromium (playwright install chromium)
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const VIEWER_JS = path.resolve(REPO_ROOT, 'packages/agentai-gui/public/splat-viewer.js');
const OUT_DIR = path.join(tmpdir(), 'agentai-splat-verify');

const ROW = 32; // .splat 每点字节数

function hsvToRgb(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const table = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]];
  return table[i % 6].map(x => Math.round(x * 255));
}

/** 生成一个彩色球面点云 (尺度 ~2, 中心在原点) — 用来验证渲染管线 */
function makeSphereSplat(n = 40000, radius = 1.0, sigma = 0.028) {
  const buf = Buffer.alloc(n * ROW);
  const ga = Math.PI * (3 - Math.sqrt(5)); // 黄金角, 保证球面均匀
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = i * ga;
    const off = i * ROW;
    buf.writeFloatLE(Math.cos(phi) * r * radius, off);
    buf.writeFloatLE(y * radius, off + 4);
    buf.writeFloatLE(Math.sin(phi) * r * radius, off + 8);
    // scale 是线性 sigma (不是对数) — 见渲染器 generateTexture 的用法
    buf.writeFloatLE(sigma, off + 12);
    buf.writeFloatLE(sigma, off + 16);
    buf.writeFloatLE(sigma, off + 20);
    // 顶部红 → 中部绿 → 底部蓝: 用来验证「+Y 真的是画面上方」(朝向测试)
    const [cr, cg, cb] = hsvToRgb((1 - (y + 1) / 2) * 0.66, 0.85, 1);
    buf[off + 24] = cr;
    buf[off + 25] = cg;
    buf[off + 26] = cb;
    buf[off + 27] = 255;
    // 四元数编码: (u8 - 128) / 128, 单位四元数 (1,0,0,0)
    buf[off + 28] = 255;
    buf[off + 29] = 128;
    buf[off + 30] = 128;
    buf[off + 31] = 128;
  }
  return buf;
}

/** 与 SplatViewer.tsx 的 srcDoc 同构 (去掉 React 包装) */
function buildPageHtml() {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:#000;overflow:hidden}
  #canvas{width:100%;height:100%;display:block}
  #spinner{position:absolute;left:50%;top:50%;width:28px;height:28px;margin:-14px 0 0 -14px;
    border:3px solid rgba(255,255,255,.18);border-top-color:rgba(255,255,255,.75);border-radius:50%;
    animation:sp 1s linear infinite}
  @keyframes sp{to{transform:rotate(360deg)}}
  #progress{position:absolute;left:0;bottom:0;height:2px;width:0;background:rgba(120,200,255,.9)}
  #message{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
    color:#e8e8ef;font:12px/1.6 sans-serif;pointer-events:none}
  #hud{position:absolute;left:8px;bottom:6px;color:rgba(255,255,255,.45);font:10px/1 sans-serif}
</style></head><body>
<canvas id="canvas"></canvas>
<div id="spinner"></div><div id="progress"></div><div id="message"></div>
<div id="hud"><span id="fps"></span> <span id="camid"></span></div>
<script>
  window.__SPLAT_OPTS__ = {
    url: '/fixture.splat', static: true,
    width: 1280, height: 720, pixelRatio: 1, bg: '#000'
  };
<\/script>
<script src="/splat-viewer.js"><\/script>
</body></html>`;
}

/** 从 WebGL 绘制缓冲读像素 (preserveDrawingBuffer:true 才读得到) */
async function readStats(page) {
  return page.evaluate(() => {
    const c = document.getElementById('canvas');
    const gl = c.getContext('webgl2');
    const px = new Uint8Array(c.width * c.height * 4);
    gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let nonZero = 0;
    const sum = [0, 0, 0];
    let maxA = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i] + px[i + 1] + px[i + 2] + px[i + 3] > 12) nonZero++;
      sum[0] += px[i]; sum[1] += px[i + 1]; sum[2] += px[i + 2];
      if (px[i + 3] > maxA) maxA = px[i + 3];
    }
    const n = c.width * c.height;
    // 方向带: readPixels 原点在左下 → 「画面顶部」是缓冲区末尾行
    const bandAvg = (fromRow, toRow) => {
      const s = [0, 0, 0];
      let cnt = 0;
      for (let row = fromRow; row < toRow; row++) {
        for (let col = 0; col < c.width; col++) {
          const i = (row * c.width + col) * 4;
          if (px[i] + px[i + 1] + px[i + 2] < 12) continue;
          s[0] += px[i]; s[1] += px[i + 1]; s[2] += px[i + 2]; cnt++;
        }
      }
      return cnt ? s.map(v => Math.round(v / cnt)) : [0, 0, 0];
    };
    const bandH = Math.floor(c.height * 0.22);
    return {
      w: c.width, h: c.height,
      nonZeroPct: +(100 * nonZero / n).toFixed(2),
      avgRgb: sum.map(v => Math.round(v / n)),
      topRgb: bandAvg(c.height - bandH, c.height),
      bottomRgb: bandAvg(0, bandH),
      maxA,
    };
  });
}

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const fixture = makeSphereSplat();
  const viewer = readFileSync(VIEWER_JS);
  const html = Buffer.from(buildPageHtml(), 'utf-8');

  const server = createServer((req, res) => {
    if (req.url === '/' || req.url?.startsWith('/index')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } else if (req.url === '/splat-viewer.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(viewer);
    } else if (req.url === '/fixture.splat') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': fixture.length });
      res.end(fixture);
    } else {
      res.writeHead(404); res.end('not found');
    }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  console.log(`\n[verify] 合成点云 ${fixture.length / ROW} 点 / ${(fixture.length / 1024).toFixed(0)} KB, 本地服务 :${port}`);

  const browser = await chromium.launch({
    headless: true,
    // 无 GPU 的真机也能跑: 强制 SwiftShader 软件 WebGL
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') pageErrors.push(m.text()); });

  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    await page.waitForFunction(
      () => window.__splatReady === true || !!window.__splatError,
      null,
      { timeout: 60000 },
    );

    const st = await page.evaluate(() => ({
      ...((window.__splatApi && window.__splatApi.getState()) || {}),
      error: window.__splatError || null,
      bounds: window.__splatBounds || null,
    }));
    check('渲染器就绪 (__splatReady)', st.ready === true, `frames=${st.frames} sorts=${st.sorts}`);
    check('点云解析 (vertexCount > 0)', (st.vertexCount || 0) > 0, `vertexCount=${st.vertexCount}`);
    check('包围盒自动取景 (bounds.radius > 0)', (st.bounds?.radius || 0) > 0,
      `center=${JSON.stringify(st.bounds?.center?.map(v => +v.toFixed(3)))} radius=${st.bounds?.radius?.toFixed(3)}`);

    const front = await readStats(page);
    check('画面非空 (>5% 像素被点亮)', front.nonZeroPct > 5,
      `nonZero=${front.nonZeroPct}% avgRgb=${JSON.stringify(front.avgRgb)} canvas=${front.w}x${front.h}`);
    check('画布分辨率固定 1280x720', front.w === 1280 && front.h === 720, `${front.w}x${front.h}`);
    // fixture 顶部红/底部蓝 → 图像上带应该红、下带应该蓝
    const upOk = front.topRgb[0] > front.topRgb[2] + 20 && front.bottomRgb[2] > front.bottomRgb[0] + 20;
    check('朝向正确 (+Y 在画面顶部)', upOk,
      `top=${JSON.stringify(front.topRgb)} bottom=${JSON.stringify(front.bottomRgb)}`);

    // 截帧 → 写文件, 供人眼复核
    const dataUrl = await page.evaluate(() => window.__splatApi.capture('image/jpeg', 0.92));
    const b64 = String(dataUrl).split(',')[1] || '';
    const jpeg = Buffer.from(b64, 'base64');
    const outFile = path.join(OUT_DIR, 'splat-front.jpg');
    writeFileSync(outFile, jpeg);
    check('截帧 API 返回 JPEG', dataUrl.startsWith('data:image/jpeg') && jpeg.length > 5000,
      `${(jpeg.length / 1024).toFixed(0)} KB → ${outFile}`);

    // 换视角: 等一次新的深度排序, 再比对像素均值
    const before = await page.evaluate(() => window.__splatSorts || 0);
    await page.evaluate(() => window.__splatApi.setView(Math.PI * 0.75, 0.5, 1.15));
    await page.waitForFunction(n => (window.__splatSorts || 0) > n, before, { timeout: 20000 });
    await page.waitForTimeout(300);
    const side = await readStats(page);
    const changed = Math.abs(side.nonZeroPct - front.nonZeroPct) > 0.5
      || Math.abs(side.avgRgb[0] - front.avgRgb[0]) + Math.abs(side.avgRgb[1] - front.avgRgb[1]) + Math.abs(side.avgRgb[2] - front.avgRgb[2]) > 6;
    check('setView 后画面确实变化', changed,
      `front=${front.nonZeroPct}%/${JSON.stringify(front.avgRgb)} → side=${side.nonZeroPct}%/${JSON.stringify(side.avgRgb)}`);

    const sideUrl = await page.evaluate(() => window.__splatApi.capture('image/jpeg', 0.92));
    writeFileSync(path.join(OUT_DIR, 'splat-side.jpg'), Buffer.from(String(sideUrl).split(',')[1] || '', 'base64'));

    check('无页面运行时错误', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || 'none');
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }

  const failed = checks.filter(c => !c.ok);
  console.log(`\n[verify] ${checks.length - failed.length}/${checks.length} 通过`);
  console.log(`[verify] 截图目录: ${OUT_DIR}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch(e => { console.error('[verify] 异常:', e); process.exit(1); });
