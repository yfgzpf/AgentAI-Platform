/**
 * OOB (Out-of-Band) 回连接收器 — 填补盲测盲区 (盲 XSS / 盲 SSRF / 异步 RCE / DNS 外带)
 *
 * 背景: 赏金里大量高危是"盲"的 —— 你发出的 payload 不会在响应里给答案, 只能靠目标
 * **主动回连**到你的服务器来确认 (例如 <img src=https://you/oob/x> 是否真的发了请求)。
 * 之前这类只能"怀疑"无法"确认", 因为项目明确不做第三方 OAST/DNSLog (需 token)。
 *
 * 本模块在网关内**自带**一个轻量 HTTP 回调监听 (独立端口, 不挂主网关, 避免 share_port
 * 暴露整个 API)。不依赖任何外部服务。用法:
 *   1. oob_register({label}) → 拿到 oob_id + callbackUrl
 *   2. 把 callbackUrl 拼进盲测 payload (如 image src / SSRF url / DNS 子域)
 *   3. oob_check({id}) → 看目标是否真的回连了 (带来源 IP / UA / 时间 / body)
 *
 * ⚠️ 公网可达性: callbackUrl 默认 http://localhost:<port>, 仅本机/同内网可见。
 *   要让**外网**目标回连, 二选一:
 *     a. 在拥有公网 IP 的机器上跑网关 (OOB_PUBLIC_URL 指向该 IP)
 *     b. 用 share_port 把本 OOB 端口暴露为公网 (只暴露这个轻端口, 不是整个网关)
 *   纯本地实现, 零第三方依赖 —— 这正是它和"外部 OAST 服务"的本质区别。
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import * as crypto from 'crypto';

const TTL_MS = 30 * 60 * 1000; // 30 分钟无回连即过期, 防内存泄漏

export interface OobHit {
  at: number;
  method: string;
  ip: string;
  ua: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: string;
}

export interface OobRecord {
  id: string;
  label: string;
  createdAt: number;
  hits: OobHit[];
}

const store = new Map<string, OobRecord>();
let server: ReturnType<typeof createServer> | null = null;
let port = 0;

function getConfigPort(): number {
  const p = Number(process.env.OOB_PORT);
  return p > 0 && p < 65536 ? p : 8800;
}

/** 生成 oob_id + 回调 URL。id 是 24 位 hex (128-bit), 等同预共享 token, 猜中概率可忽略。 */
export function createOobId(label = ''): { id: string; callbackUrl: string } {
  prune();
  const id = crypto.randomBytes(12).toString('hex');
  store.set(id, { id, label: String(label).slice(0, 64), createdAt: Date.now(), hits: [] });
  return { id, callbackUrl: getCallbackBase() + '/oob/' + id };
}

/** 回连基础地址: 优先 OOB_PUBLIC_URL (公网), 否则 localhost:<实际监听端口> */
export function getCallbackBase(): string {
  const cfg = (process.env.OOB_PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (cfg) return cfg;
  const p = getPort() || getConfigPort();
  return `http://localhost:${p}`;
}

export function getPort(): number { return port; }

export function recordHit(id: string, hit: OobHit): boolean {
  const rec = store.get(id);
  if (!rec) return false; // 未知 id 不记录 (防污染/探测)
  rec.hits.push(hit);
  return true;
}

export function checkOob(id: string): { found: boolean; record?: OobRecord } {
  const rec = store.get(String(id || '').trim());
  if (!rec) return { found: false };
  return { found: true, record: rec };
}

export function prune(): void {
  const now = Date.now();
  for (const [k, v] of store) {
    if (now - v.createdAt > TTL_MS) store.delete(k);
  }
}

/** 启动独立 OOB HTTP server。幂等; 失败抛错由调用方吞掉 (OOB 是增强, 不能阻断网关启动)。 */
export function startOobServer(listenPort = getConfigPort()): Promise<number> {
  return new Promise((resolve, reject) => {
    if (server) { resolve(port); return; }
    const srv = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || '/', 'http://localhost');
      const m = url.pathname.match(/^\/oob\/([a-f0-9]{8,64})$/i);
      if (!m) { res.writeHead(404); res.end('not found'); return; }
      const id = m[1].toLowerCase();
      let body = '';
      req.on('data', (c: Buffer) => {
        body += c.toString('utf-8');
        if (body.length > 1_000_000) req.destroy(); // 1MB 上限, 防滥用
      });
      req.on('end', () => {
        const ok = recordHit(id, {
          at: Date.now(),
          method: req.method || 'GET',
          ip: (req.headers['x-forwarded-for'] as string) || (req.socket.remoteAddress || ''),
          ua: (req.headers['user-agent'] as string) || '',
          query: Object.fromEntries(url.searchParams.entries()),
          headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v)])),
          body: body.slice(0, 1_000_000),
        });
        if (!ok) { res.writeHead(404); res.end('unknown oob id'); return; }
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('oob ok');
      });
    });
    srv.on('error', reject);
    srv.listen(listenPort, '0.0.0.0', () => {
      port = (srv.address() as any)?.port ?? listenPort;
      server = srv;
      resolve(port);
    });
  });
}

export function stopOobServer(): void {
  if (server) { server.close(); server = null; port = 0; }
}
