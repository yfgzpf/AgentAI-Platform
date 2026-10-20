#!/usr/bin/env node
// 视频成片恢复脚本 (2026-10-20)
// ==================================================================
// 用途: 当 GUI 因「视频生成成功但前端不显示」bug 漏掉成片地址时,
//   只要拿到任务 ID (浏览器 localStorage `agentai-video-history` 里的 taskId),
//   本脚本直接向上游 ALRO 查询并捞出真实成片地址, 不依赖 GUI 状态。
//
// 用法:
//   node scripts/recover-video.mjs <taskId>
//
// 示例:
//   node scripts/recover-video.mjs 7f3a9c2e-xxxx-xxxx-xxxx-xxxxxxxxxxxx
//
// 可选环境变量 (默认从项目根 .env 读取):
//   ALRC_BASE_URL      默认 https://alro.huazhiweilai.com/v1
//   FACTORY_VIDEO_KEY / ALRC_API_KEY  二选一, 与提交时同源

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function loadEnv() {
  const envPath = resolve(ROOT, '.env');
  try {
    const text = readFileSync(envPath, 'utf8');
    for (const line of text.split('\n')) {
      const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    /* .env 不存在就靠已注入的环境变量 */
  }
}
loadEnv();

const taskId = process.argv[2];
if (!taskId) {
  console.error('用法: node scripts/recover-video.mjs <taskId>');
  process.exit(1);
}

const base = (process.env['ALRC_BASE_URL'] || 'https://alro.huazhiweilai.com/v1').replace(/\/+$/, '');
const fKey = (process.env['FACTORY_VIDEO_KEY'] || process.env['ALRC_API_KEY'] || '').trim();
if (!fKey) {
  console.error('未找到 FACTORY_VIDEO_KEY / ALRC_API_KEY, 请在项目根 .env 配置。');
  process.exit(1);
}

// 与网关 routes/video.ts 工厂分支同源的候选查询地址
const candidates = [
  `${base}/video/generations/${encodeURIComponent(taskId)}`,
  `${base}/contents/generations/tasks/${encodeURIComponent(taskId)}`,
  `${base}/videos/${encodeURIComponent(taskId)}`,
];

// 与网关 extractVideoUrl 同源的地址提取 (沿 .data 信封下钻最多 4 层)
function extractVideoUrl(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const seen = new Set();
  let cur = raw;
  for (let d = 0; d < 4 && cur && typeof cur === 'object' && !seen.has(cur); d++) {
    seen.add(cur);
    const cands = [
      cur.result_url, cur.video_url, cur.url, cur.output?.url, cur.output?.[0]?.url,
      cur.content?.video?.url, cur.content?.video_url, cur.video?.url,
      cur.videos?.[0]?.url, cur.result?.video_url, cur.outputs?.[0]?.url,
    ];
    for (const c of cands) {
      if (typeof c === 'string' && /^https?:\/\//.test(c.trim())) return c.trim();
    }
    cur = cur.data;
  }
  return null;
}

const statusOf = (raw) => String(raw?.status ?? raw?.state ?? 'processing').toLowerCase().trim();

async function main() {
  console.log(`查询任务: ${taskId}`);
  console.log(`base: ${base}\n`);
  let lastRaw = null;
  for (const url of candidates) {
    try {
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${fKey}` },
        signal: AbortSignal.timeout(15000),
      });
      const txt = await resp.text();
      if (!resp.ok) {
        console.log(`  ✗ ${url}\n    HTTP ${resp.status}: ${txt.slice(0, 200)}`);
        continue;
      }
      let data;
      try { data = JSON.parse(txt); } catch { console.log(`  ✗ ${url}\n    非 JSON 响应: ${txt.slice(0, 200)}`); continue; }
      lastRaw = data;
      const url_out = extractVideoUrl(data);
      const st = statusOf(data);
      console.log(`  ✓ ${url}\n    status=${st}`);
      if (url_out) {
        console.log(`\n✅ 成片地址已找到:\n${url_out}\n`);
        console.log('（在浏览器打开即可下载/播放；如需保存，可右键另存或用 curl 下载）');
        return;
      }
      console.log(`    ⚠️ 终态但响应里没有成片地址, 响应字段: ${Object.keys(data).join(', ')}`);
    } catch (e) {
      console.log(`  ✗ ${url}\n    异常: ${e.message}`);
    }
  }
  console.log('\n❌ 三个候选地址都没解析出成片地址。');
  if (lastRaw) console.log('最后一次响应原文:\n' + JSON.stringify(lastRaw, null, 2).slice(0, 1500));
  console.log('\n可能原因: ① 任务 ID 不对; ② 上游已清理该任务(超出保留期); ③ 响应结构有变, 把上面原文发我我帮你钉死提取链。');
  process.exit(2);
}

main();
