/**
 * asset-fingerprint.mjs — 授权资产指纹采集 (2026-10-16)
 * ============================================================================
 * CVE_WATCH_PLAN 的 D3 落地。scope.json 只有域名, 没有技术栈 — CVE 匹配需要指纹
 * (nginx 1.18 / ThinkPHP 5 / WordPress 6.2 之类)。
 * 采集通道 (按优先级):
 *   1. WSL kali 的 httpx: `wsl -d kali-linux -- httpx -l domains.txt -json -title -tech-detect -status-code`
 *      (一次调用采一批, JSON 行输出, 解析成 [{ host, fingerprints:[{product,version,raw}] }])
 *   2. kali 无 httpx 但有 curl: 退化为 curl -sI 取 Server/X-Powered-By 头
 *   3. 无 WSL: 只录 host, fingerprints: [] (匹配退化为域名关键词, 输出明确标注降级)
 * 通配符目标 (*.x.com): 不能直接探测 — 录裸域 x.com 并标 wildcard:true, 提示用
 * enum_subdomains 展开后再采。
 *
 * ⚠️ 只探测 scope.json 里**人类已授权**的域名 (授权边界), 与 pentest 闸门同源。
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';

const WSL_DISTRO = process.env.PENTEST_WSL_DISTRO || 'kali-linux';

function run(cmd, args, timeoutMs = 120_000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true, encoding: 'utf8' },
      (err, so, se) => resolve({ ok: !err, stdout: String(so ?? ''), stderr: String(se ?? ''), err }));
  });
}

/** WSL kali 是否可用 (2s 快探, 不阻塞太久) */
export async function wslAvailable() {
  const r = await run('wsl', ['-l', '-q'], 8000);
  if (!r.ok) return false;
  // -l -q 只列发行版名 (UTF-16LE 输出, 松散匹配)
  const names = r.stdout.replace(/\0/g, '').toLowerCase();
  return names.includes(WSL_DISTRO.toLowerCase());
}

/** scope.json targets → 可探测域名列表 (通配符取裸域并标记) */
export function targetsToProbe(targets) {
  const out = [];
  for (const t of targets || []) {
    const s = String(t || '').trim().toLowerCase();
    if (!s) continue;
    if (s.startsWith('*.')) out.push({ host: s.slice(2), wildcard: true, raw: s });
    else out.push({ host: s, wildcard: false, raw: s });
  }
  return out;
}

/** httpx JSON 行 → 指纹结构 (导出供测试) */
export function parseHttpxJsonLines(text) {
  const byHost = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || !t.startsWith('{')) continue;
    let j;
    try { j = JSON.parse(t); } catch { continue; }
    const host = String(j.input || j.host || j.url || '').replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
    if (!host) continue;
    const fps = [];
    for (const tech of j.tech || []) {
      // tech 形如 "nginx:1.18" / "WordPress" — 冒号后是版本
      const [name, version] = String(tech).split(':');
      if (name) fps.push({ product: name.trim(), version: (version || '').trim(), raw: String(tech) });
    }
    if (j.webserver) {
      // webserver 形如 "Apache-Coyote/1.1" — 按 / 拆产品名与版本 (与 curl 通道同口径)
      const parts = String(j.webserver).split('/');
      fps.push({ product: parts[0].trim(), version: (parts[1] || '').trim(), raw: `webserver: ${j.webserver}` });
    }
    if (j.title) fps.push({ product: '', version: '', raw: `title: ${j.title}` });
    if (j.status_code) fps.push({ product: '', version: '', raw: `status: ${j.status_code}` });
    byHost[host] = { host, wildcard: false, fingerprints: fps, url: j.url || '', title: j.title || '', status: j.status_code || 0, source: 'httpx' };
  }
  return byHost;
}

/** curl -sI 退化通道: 取 Server/X-Powered-By 头 */
function parseCurlHeaders(headersText, host) {
  const fps = [];
  const server = headersText.match(/^server:\s*(.+)$/im)?.[1]?.trim();
  const powered = headersText.match(/^x-powered-by:\s*(.+)$/im)?.[1]?.trim();
  if (server) fps.push({ product: server.split('/')[0], version: server.split('/')[1] || '', raw: `server: ${server}` });
  if (powered) fps.push({ product: powered.split('/')[0], version: '', raw: `x-powered-by: ${powered}` });
  return { host, wildcard: false, fingerprints: fps, source: 'curl-headers' };
}

/**
 * 主入口: 采集 scope 内目标指纹 → 写 .agentai/assets/assets.json
 * @returns { assets, mode: 'httpx'|'curl'|'none', skipped: 通配符未展开数 }
 */
export async function collectFingerprints(ws, { verbose = false } = {}) {
  const scopeFile = path.join(ws, '.agentai', 'scope.json');
  let targets = [];
  try {
    if (fs.existsSync(scopeFile)) {
      const d = JSON.parse(fs.readFileSync(scopeFile, 'utf8'));
      targets = Array.isArray(d.targets) ? d.targets : [];
    }
  } catch { /* 损坏按空 */ }
  const probes = targetsToProbe(targets);
  const assetsFile = path.join(ws, '.agentai', 'assets', 'assets.json');
  fs.mkdirSync(path.dirname(assetsFile), { recursive: true });
  // 读旧资产库 (增量: 没采到的保留旧记录, 标 stale)
  let oldAssets = [];
  try { if (fs.existsSync(assetsFile)) oldAssets = JSON.parse(fs.readFileSync(assetsFile, 'utf8')); } catch { /* 重建 */ }
  const oldByHost = Object.fromEntries((oldAssets || []).map(a => [a.host, a]));

  if (probes.length === 0) {
    return { assets: [], mode: 'none', skipped: 0, note: 'scope.json 为空 — 先授权目标 (GUI 授权面板 / grant_scope)' };
  }

  const hasWsl = await wslAvailable();
  let mode = 'none';
  const byHost = {};

  if (hasWsl) {
    // 通道 1: httpx 批量探测 (域名写临时文件, wsl 侧读 /mnt/ 路径)
    const tmpList = path.join(os.tmpdir(), `pulseflow-httpx-${Date.now()}.txt`);
    fs.writeFileSync(tmpList, probes.map(p => p.host).join('\n') + '\n', 'utf8');
    const wslPath = tmpList.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/mnt/$1'.toLowerCase());
    const args = ['-d', WSL_DISTRO, '--', 'httpx', '-l', wslPath, '-json', '-title', '-tech-detect', '-status-code', '-silent', '-timeout', '8'];
    if (verbose) console.log(`[fingerprint] wsl ${args.join(' ')}`);
    const r = await run('wsl', args, 180_000);
    fs.unlinkSync(tmpList);
    const parsed = parseHttpxJsonLines(r.stdout);
    if (Object.keys(parsed).length > 0) {
      mode = 'httpx';
      Object.assign(byHost, parsed);
    } else if (verbose) {
      console.log(`[fingerprint] httpx 无输出 (可能未装), 退化 curl。stderr: ${r.stderr.slice(0, 200)}`);
    }
    // 通道 2: httpx 没采到 → curl 头逐个探测
    if (mode === 'none') {
      for (const p of probes) {
        const c = await run('wsl', ['-d', WSL_DISTRO, '--', 'curl', '-s', '-I', '-m', '8', `https://${p.host}`], 30_000);
        const c2 = c.ok && c.stdout ? c : await run('wsl', ['-d', WSL_DISTRO, '--', 'curl', '-s', '-I', '-m', '8', `http://${p.host}`], 30_000);
        if (c2.stdout) { byHost[p.host] = parseCurlHeaders(c2.stdout, p.host); mode = 'curl'; }
      }
    }
  }

  // 合并: 新采集 > 旧记录; 没采到的旧记录标 stale; 通配符原样保留标记
  const now = new Date().toISOString();
  const assets = [];
  for (const p of probes) {
    const fresh = byHost[p.host];
    const old = oldByHost[p.host];
    if (fresh) {
      assets.push({ ...fresh, wildcard: p.wildcard, updatedAt: now });
    } else if (old) {
      assets.push({ ...old, wildcard: p.wildcard, stale: true });
    } else {
      assets.push({ host: p.host, wildcard: p.wildcard, fingerprints: [], source: 'none', updatedAt: now });
    }
  }
  fs.writeFileSync(assetsFile, JSON.stringify(assets, null, 2), 'utf8');
  const skipped = probes.filter(p => p.wildcard).length;
  return { assets, mode, skipped, note: mode === 'none' ? (hasWsl ? 'httpx/curl 均无输出' : '无 WSL kali — 指纹为空, 匹配退化为域名关键词 (低置信)') : '' };
}
