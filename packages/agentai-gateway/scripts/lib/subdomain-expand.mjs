/**
 * subdomain-expand.mjs — 授权根域子域自动展开 (crt.sh 证书透明, 2026-10-16 盯哨扩子域)
 * ============================================================================
 * 背景: 盯哨只看 scope.json 里的目标。平台常给"通配符根域" (*.bestpay.com.cn),
 * 但 80% 赏金洞在没人管的子域上 — 只盯 4 个根域, 子域命中就被漏掉。
 *
 * 本模块在盯哨每轮里, 把授权根域用 crt.sh 证书透明日志展开成真实子域清单,
 * 写进 .agentai/cve/subdomains.json (缓存, 不每轮重拉), 让 cve-matcher 能拿子域去
 * 匹配 CVE。
 *
 * 安全边界 (跟盯哨同源, 必须保持):
 *   - 只拉 crt.sh **公开**证书透明日志 (被动情报, 零请求打你的目标)
 *   - 展开出的子域**不自动打** — 只进匹配面; 真验证仍走 nuclei 人工触发 + 授权闸门
 *   - 限频: 每个根域 6h 只拉一次 (缓存在 subdomains.json), 别把 crt.sh 打挂
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const CACHE_TTL_MS = 6 * 3600 * 1000; // 与盯哨同频: 每根域 6h 刷一次
const UA = 'pulseflow-cve-watch/1.0';

/** 读已缓存的子域展开 (按根域) */
export function readSubdomainCache(ws) {
  try {
    const f = path.join(ws, '.agentai', 'cve', 'subdomains.json');
    if (!fs.existsSync(f)) return {};
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch { return {}; }
}

function writeSubdomainCache(ws, cache) {
  try {
    const f = path.join(ws, '.agentai', 'cve', 'subdomains.json');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(cache, null, 2), 'utf8');
  } catch { /* 缓存写失败不影响主流程 */ }
}

/** crt.sh 证书透明: 拉某根域的全部子域 (被动公开情报) */
export async function fetchCrtShSubs(rootDomain, { timeoutMs = 20_000 } = {}) {
  const url = `https://crt.sh/?q=${encodeURIComponent('%.' + rootDomain)}&output=json`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
    if (!r.ok) throw new Error(`crt.sh HTTP ${r.status}`);
    const data = await r.json();
    // 去重子域: value 形如 "admin.example.com,api.example.com" (逗号分隔), 取全小写
    const set = new Set();
    for (const rec of Array.isArray(data) ? data : []) {
      for (const v of String(rec?.value || '').split(',')) {
        const host = v.trim().toLowerCase();
        if (host && host.endsWith('.' + rootDomain)) set.add(host);
      }
    }
    return [...set];
  } finally { clearTimeout(timer); }
}

/**
 * 盯哨每轮调用: 把授权根域展开子域 → 合并进 assets.json (让 cve-matcher 有子域匹配面)。
 * @returns { expanded: 展开的子域名列表, roots: 用了哪些根域 }
 */
export async function expandSubdomains(ws, { verbose = false } = {}) {
  // 读 scope.json (兼容带 source 的对象格式)
  const scopeFile = path.join(ws, '.agentai', 'scope.json');
  let targets = [];
  try {
    if (fs.existsSync(scopeFile)) {
      const d = JSON.parse(fs.readFileSync(scopeFile, 'utf8'));
      targets = (Array.isArray(d?.targets) ? d.targets : [])
        .map((t) => (typeof t === 'string' ? t : t?.host)).filter(Boolean);
    }
  } catch { /* 损坏按空 */ }

  // 取根域: 通配符 *.x.com → x.com; 裸 x.com → x.com
  const roots = [...new Set(targets.map(t => String(t).replace(/^\*\./, '').trim()))].filter(Boolean);
  if (roots.length === 0) return { expanded: [], roots: [] };

  const cache = readSubdomainCache(ws);
  const now = Date.now();
  const expanded = new Set();
  const staleRoots = [];
  for (const root of roots) {
    const hit = cache[root];
    if (hit && hit.subs && now - hit.ts < CACHE_TTL_MS) {
      // 缓存新鲜: 直接用
      hit.subs.forEach(s => expanded.add(s));
      if (verbose) console.log(`[subdomain] ${root}: 缓存 ${hit.subs.length} 个子域`);
    } else {
      // 拉 crt.sh (被动情报)
      try {
        const subs = await fetchCrtShSubs(root, { timeoutMs: 20_000 });
        cache[root] = { ts: now, subs };
        subs.forEach(s => expanded.add(s));
        if (verbose) console.log(`[subdomain] ${root}: crt.sh 发现 ${subs.length} 个子域`);
      } catch (e) {
        // crt.sh 挂了 → 用旧缓存兜底 (没有就跳过该根域, 不阻塞盯哨)
        if (hit?.subs) {
          hit.subs.forEach(s => expanded.add(s));
          if (verbose) console.log(`[subdomain] ${root}: crt.sh 失败 (${e.message}), 用旧缓存 ${hit.subs.length} 个`);
        } else if (verbose) {
          console.log(`[subdomain] ${root}: crt.sh 失败且无缓存, 跳过 (${e.message})`);
        }
      }
    }
  }
  writeSubdomainCache(ws, cache);

  // 把展开的子域合并进 assets.json (没指纹的子域也进匹配面 — 域名关键词匹配够用)
  const assetsFile = path.join(ws, '.agentai', 'assets', 'assets.json');
  let assets = [];
  try { if (fs.existsSync(assetsFile)) assets = JSON.parse(fs.readFileSync(assetsFile, 'utf8')); } catch { assets = []; }
  const knownHosts = new Set(assets.map(a => a.host));
  let added = 0;
  for (const sub of expanded) {
    if (knownHosts.has(sub)) continue;
    assets.push({ host: sub, fingerprints: [], source: 'crtsh', wildcard: false, updatedAt: new Date().toISOString(), note: 'crt.sh 证书透明发现的子域 (无指纹, 匹配走域名关键词)' });
    added++;
  }
  if (added > 0 || assets.length > 0) {
    fs.mkdirSync(path.dirname(assetsFile), { recursive: true });
    fs.writeFileSync(assetsFile, JSON.stringify(assets, null, 2), 'utf8');
  }
  return { expanded: [...expanded], roots, addedToAssets: added };
}
