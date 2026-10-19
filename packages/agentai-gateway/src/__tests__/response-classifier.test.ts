import { describe, it, expect } from 'vitest';
import {
  classifyResponse,
  formatAnalysis,
} from '../pentest/response-classifier.js';
import { TOOL_GROUPS, TASK_TYPE_TOOL_MAP } from '../tool-groups.js';
import { SECURITY_OPS_TOOLS } from '../security-playbook.js';

describe('classifyResponse 各类拦截识别', () => {
  it('正常响应 → normal (high)', () => {
    const a = classifyResponse(200, { 'content-type': 'text/html' }, '<html>hello</html>');
    expect(a.kind).toBe('normal');
    expect(a.confidence).toBe('high');
  });

  it('429 + 限流关键词 → rate-limit (high)', () => {
    const a = classifyResponse(429, {}, 'Too Many Requests - rate limit exceeded');
    expect(a.kind).toBe('rate-limit');
    expect(a.confidence).toBe('high');
    expect(a.advice).toContain('降低');
  });

  it('403 + 体含 Access Denied → waf-block (high)', () => {
    const a = classifyResponse(403, {}, 'Access Denied by security policy');
    expect(a.kind).toBe('waf-block');
    expect(a.confidence).toBe('high');
  });

  it('Cloudflare 响应头指纹 → waf-block', () => {
    const a = classifyResponse(403, { server: 'cloudflare' }, '');
    expect(a.kind).toBe('waf-block');
    expect(a.reasons.join(' ')).toMatch(/Cloudflare/);
  });

  it('captcha 关键词 → captcha', () => {
    const a = classifyResponse(200, {}, 'please solve the recaptcha to continue');
    expect(a.kind).toBe('captcha');
    expect(a.advice).toContain('browser');
  });

  it('人机验证挑战 → challenge', () => {
    const a = classifyResponse(403, {}, 'verify you are a human before continuing');
    expect(a.kind).toBe('challenge');
  });

  it('401 → auth-required', () => {
    const a = classifyResponse(401, {}, 'Unauthorized');
    expect(a.kind).toBe('auth-required');
  });

  it('403 无特征 → forbidden (medium)', () => {
    const a = classifyResponse(403, { server: 'nginx' }, '<h1>403 Forbidden</h1>');
    expect(a.kind).toBe('forbidden');
  });

  it('503 + WAF 体特征 → waf-block; 503 无特征 → rate-limit', () => {
    const waf = classifyResponse(503, {}, 'request blocked by WAF');
    expect(waf.kind).toBe('waf-block');
    const plain = classifyResponse(503, {}, 'Service Temporarily Unavailable');
    expect(plain.kind).toBe('rate-limit');
  });

  it('中文拦截词也能识别 (访问被拒绝)', () => {
    const a = classifyResponse(403, {}, '您的请求被拦截，访问被拒绝');
    expect(a.kind).toBe('waf-block');
  });
});

describe('formatAnalysis', () => {
  it('非空且含分析图标', () => {
    const a = classifyResponse(429, {}, 'too many requests');
    expect(formatAnalysis(a)).toContain('⏳');
    expect(formatAnalysis(a)).toContain('响应分析');
  });
});

describe('工具接线', () => {
  it('classify_response 在 security 工具集', () => {
    expect(TOOL_GROUPS.security_ops).toContain('classify_response');
    expect(TASK_TYPE_TOOL_MAP.security).toContain('classify_response');
    expect(SECURITY_OPS_TOOLS.has('classify_response')).toBe(true);
  });
});
