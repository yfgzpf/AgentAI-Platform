/**
 * http-replay.ts — HTTP 请求重放执行器 (2026-10-16 第一梯队挖洞工具)
 *
 * 为什么不用 fetch: 挖洞目标大量是自签名证书 / 过期证书的内网资产, fetch 会直接
 * 抛证书错误。node:https 的 rejectUnauthorized:false 可控 (仅本工具用, 属渗透
 * 测试语义内的必要能力)。
 * 为什么不用 curl (run_command): ① Windows 本机未必装 curl; ② 更重要 — 本实现把
 * "重定向每一跳都校验授权"做进代码里, shell 管道做不到。
 *
 * 安全设计 (调用方 http_replay handler 负责闸门/限频/CRLF, 本模块负责执行):
 * - follow_redirect 开启时最多跟 maxRedirects 跳, 每跳的 host 都过 isTargetInScope
 *   (防"授权 A 被 302 到未授权 B"的借道打) — isTargetInScope 由调用方闭包注入
 * - 响应体硬上限 5MB (maxBuffer 语义), 防内存打爆
 */

import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

export interface ReplayOptions {
  follow: boolean;
  timeoutMs: number;
  maxRedirects: number;
  /** 重定向目标 host 是否仍在授权范围内 (调用方注入 isTargetInScope 闭包) */
  isTargetInScope: (host: string) => boolean;
}

export interface ReplayResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  redirects: string[];
}

const MAX_BODY = 5 * 1024 * 1024;

function requestOnce(
  method: string, u: URL, headers: Record<string, string>, body: string | undefined, timeoutMs: number,
): Promise<{ status: number; statusText: string; headers: Record<string, string>; body: string; location?: string }> {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method,
      headers: body !== undefined
        ? { ...headers, 'Content-Length': Buffer.byteLength(body) }
        : headers,
      // 渗透测试语义: 目标自签名/过期证书是常态, 不因证书失败中断重放。
      // 仅影响传输层 TLS 校验, 不触碰也不绕过业务认证。
      rejectUnauthorized: false,
      timeout: timeoutMs,
    }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c: Buffer) => {
        size += c.length;
        if (size <= MAX_BODY) chunks.push(c);
        else req.destroy(new Error(`响应体超过 ${MAX_BODY} 字节上限, 已中断`));
      });
      res.on('end', () => {
        const hdrs: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          hdrs[k] = Array.isArray(v) ? v.join(', ') : String(v ?? '');
        }
        resolve({
          status: res.statusCode || 0,
          statusText: res.statusMessage || '',
          headers: hdrs,
          body: Buffer.concat(chunks).toString('utf-8'),
          location: hdrs['location'],
        });
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error(`请求超时 (${timeoutMs}ms)`)));
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

export async function httpRequestRaw(
  method: string, u: URL, headers: Record<string, string>, body: string | undefined, opts: ReplayOptions,
): Promise<ReplayResult> {
  const redirects: string[] = [];
  let current = u;
  let currentMethod = method;
  let currentBody = body;

  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    const r = await requestOnce(currentMethod, current, headers, currentBody, opts.timeoutMs);
    const isRedirect = r.status >= 300 && r.status < 400 && r.location;
    if (!opts.follow || !isRedirect) {
      return { status: r.status, statusText: r.statusText, headers: r.headers, body: r.body, redirects };
    }
    // 跟跳: 解析 Location (可能相对路径), 每跳校验授权
    let next: URL;
    try { next = new URL(r.location!, current.toString()); }
    catch { return { ...r, redirects }; } // Location 畸形 → 就当最终响应返回
    if (!opts.isTargetInScope(next.hostname)) {
      // 借道未授权域: 不跟跳, 把当前响应 + 警告返回 (调用方 output 里能看见)
      return {
        status: r.status, statusText: r.statusText, headers: r.headers,
        body: r.body + `\n[pulseflow] 重定向目标 ${next.hostname} 不在授权范围, 已停止跟跳 (range-safe)。`,
        redirects,
      };
    }
    redirects.push(next.toString());
    current = next;
    currentMethod = 'GET';
    currentBody = undefined;
    // 302/303 规范上要转 GET; 307/308 保留方法与体 — 简化为 GET 已够挖洞用,
    // 需要保留方法的场景用 follow_redirect:false 手动跟。
  }
  return { status: 0, statusText: 'too many redirects', headers: {}, body: '', redirects };
}
