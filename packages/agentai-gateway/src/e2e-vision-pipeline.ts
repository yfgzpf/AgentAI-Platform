/**
 * e2e-vision-pipeline.ts
 * ----------------------------------------------------
 * 端到端验证 capture_and_read 链路:
 *  1. 用一张真实图片 (不依赖屏幕)
 *  2. 调用 captureAndOcr (OCR 部分)
 *  3. 调用 vision LLM (GLM-4.6V-Flash) 描述
 *  4. 输出 AI 视觉理解结果
 *
 * 验证: capture_and_read 真实工作
 * 目的: sandbox 环境无法真截图, 但可以验证整链路
 */
import * as fs from 'fs';
import * as path from 'path';

// 加载 .env
function loadEnv() {
  const envPath = path.join(process.cwd(), '..', '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
loadEnv();

// === 把工程根 .agentai 加入 path-guard 白名单 (测试用) ===
// 脚本位置: packages/agentai-gateway/src/e2e-vision-pipeline.ts
// .agentai 位置: <repoRoot>/.agentai
const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')),
  '..', '..', '..'
);
const agentaiDir = path.join(repoRoot, '.agentai');
if (!process.env.AGENTAI_FS_ALLOWED_ROOTS) {
  process.env.AGENTAI_FS_ALLOWED_ROOTS = agentaiDir;
} else if (!process.env.AGENTAI_FS_ALLOWED_ROOTS.includes(agentaiDir)) {
  process.env.AGENTAI_FS_ALLOWED_ROOTS += ',' + agentaiDir;
}

async function main() {
  // 1. 创建测试图 (3x3 红格) — 写到工程根 .agentai 目录, 不依赖 cwd
  process.stdout.write('Step 1: Create test image (3x3 red)...\n');
  // 用 zlib 实时合成一张 64x64 红色 PNG (避免硬编码 base64 的截断/损坏)
  const zlib = await import('zlib');
  const W = 64, H = 64;
  const raw = Buffer.alloc(H * (1 + W * 3));   // 每行 1 字节 filter type + RGB
  for (let y = 0; y < H; y++) {
    const off = y * (1 + W * 3);
    raw[off] = 0;                                  // filter: None
    for (let x = 0; x < W; x++) {
      raw[off + 1 + x * 3 + 0] = 0xCC;             // R
      raw[off + 1 + x * 3 + 1] = 0x33;             // G
      raw[off + 1 + x * 3 + 2] = 0x33;             // B
    }
  }
  const idatData = zlib.deflateSync(raw);

  // CRC table
  const crcTable: number[] = (() => {
    const t: number[] = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (buf: Buffer): number => {
    let c = 0xFFFFFFFF;
    for (const b of buf) c = (crcTable[(c ^ b) & 0xFF] ^ (c >>> 8)) >>> 0;
    return (c ^ 0xFFFFFFFF) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;        // bit depth
  ihdr[9] = 2;        // color type RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const pngBuf = Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  // 写到工程根的 .agentai 目录 (path-guard 默认允许 cwd 及其子目录,
  // 也允许 AGENTAI_FS_ALLOWED_ROOTS 中的目录, 此处通过把 .agentai 加入白名单)
  const testImage = path.resolve(
    path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')),
    '..', '..', '..', '.agentai', 'e2e-test.png'
  );
  fs.mkdirSync(path.dirname(testImage), { recursive: true });
  fs.writeFileSync(testImage, pngBuf);
  process.stdout.write(`  saved: ${testImage} (${pngBuf.length} bytes, ${W}x${H} RGB)\n\n`);

  // 2. 测试 OCR (Tesseract / Windows)
  process.stdout.write('Step 2: Test OCR pipeline...\n');
  try {
    const { ocrImage } = await import('./ocr.js');
    const ocrResult = await ocrImage(testImage, { engine: 'auto' });
    if (ocrResult.ok) {
      process.stdout.write(`  OCR engine: ${ocrResult.engine}\n`);
      process.stdout.write(`  OCR text: "${ocrResult.text.slice(0, 100)}"\n`);
    } else {
      process.stdout.write(`  OCR failed: ${ocrResult.error}\n`);
    }
  } catch (e: any) {
    process.stdout.write(`  OCR error: ${e.message}\n`);
  }
  process.stdout.write('\n');

  // 3. 测试 Vision LLM (关键)
  process.stdout.write('Step 3: Test Vision LLM (GLM-4.6V-Flash)...\n');
  try {
    const { AgentAIRouter } = await import('./llm-router.js');
    const router = new AgentAIRouter();
    const base64 = pngBuf.toString('base64');
    const start = Date.now();
    const response = await router.chat({
      model: 'zhipu',                    // provider id (内置)
      subModel: 'glm-4.6v-flash',         // 视觉模型 (zhipu 支持 image_url)
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: '这张图里有什么? 请只用一个词回答。' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } }
        ] as any,
      }],
      maxTokens: 100,
    });
    const ms = Date.now() - start;
    process.stdout.write(`  LLM responded in ${ms}ms\n`);
    process.stdout.write(`  Content: "${response.content?.slice(0, 200)}"\n\n`);

    // 4. 测试 capture_and_read (one-shot 工具)
    process.stdout.write('Step 4: Test capture_and_read tool handler...\n');
    const { EXTRA_HANDLERS } = await import('./tools.js');
    if (EXTRA_HANDLERS.capture_and_read) {
      const toolResult = await EXTRA_HANDLERS.capture_and_read({
        savePath: testImage,
        prompt: '这张图里有什么?',
      });
      process.stdout.write(`  Tool ok: ${toolResult.success}\n`);
      process.stdout.write(`  Output: ${toolResult.output?.slice(0, 300)}...\n`);
    } else {
      process.stdout.write(`  capture_and_read not registered\n`);
    }
  } catch (e: any) {
    process.stdout.write(`  Vision LLM error: ${e.message}\n`);
  }
}

main().then(() => process.exit(0)).catch(e => {
  process.stderr.write(`E2E failed: ${e}\n`);
  process.exit(1);
});
