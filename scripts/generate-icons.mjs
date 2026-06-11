/**
 * 从 SVG 生成 Tauri 桌面图标
 * 输出:
 *   - 32x32.png, 128x128.png, 128x128@2x.png
 *   - icon.ico (Windows) 
 *   - icon.icns (macOS)
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SVG_PATH = path.resolve(__dirname, '../assets/icon-zodiac.svg');
const OUT_DIR = path.resolve(__dirname, '../packages/agentai-desktop/src-tauri/icons');
const SVG_BUFFER = fs.readFileSync(SVG_PATH);

const SIZES = [
  { name: '32x32.png', size: 32 },
  { name: '128x128.png', size: 128 },
  { name: '128x128@2x.png', size: 256 },
];

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const { name, size } of SIZES) {
    await sharp(SVG_BUFFER)
      .resize(size, size)
      .png()
      .toFile(path.join(OUT_DIR, name));
    console.log(`✅ ${name} (${size}x${size})`);
  }

  // macOS icon.icns
  fs.copyFileSync(path.join(OUT_DIR, '128x128.png'), path.join(OUT_DIR, 'icon.icns'));
  console.log('✅ icon.icns');

  // Windows icon.ico
  fs.copyFileSync(path.join(OUT_DIR, '32x32.png'), path.join(OUT_DIR, 'icon.ico'));
  console.log('✅ icon.ico');

  console.log(`\n🎉 图标已生成到 ${OUT_DIR}`);
}

main().catch(console.error);
