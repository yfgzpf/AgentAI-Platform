import { describe, it, expect } from 'vitest';
import { RateLimiter } from './rate-limit.js';
import { log, query, summary, cleanup } from './audit.js';

describe('RateLimiter', () => {
  it('allows first request', () => {
    const r = new RateLimiter();
    expect(r.check('user1').allowed).toBe(true);
  });
  it('blocks over concurrency', () => {
    const r = new RateLimiter();
    r.setAvailableProviders(1); // 限制并发上限为 min(3, 1*2) = 2
    r.check('user2');
    r.check('user2');
    const result = r.check('user2');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('concurrency_limit');
  });
  it('release decrements concurrency', () => {
    const r = new RateLimiter();
    r.check('user3');
    r.release('user3');
    const result = r.check('user3');
    expect(result.allowed).toBe(true);
  });
  it('snapshot returns counts', () => {
    const r = new RateLimiter();
    r.check('user4');
    const s = r.snapshot('user4');
    expect(s.rpm).toBeGreaterThanOrEqual(1);
  });
});

describe('audit log', () => {
  it('log does not throw', () => {
    expect(() => log({ userId: 'test', workspace: 'w', action: 'test', result: 'ok' })).not.toThrow();
  });
  it('query returns entries', () => {
    log({ userId: 'test2', workspace: 'w', action: 'test', result: 'ok' });
    const r = query({ userId: 'test2' });
    expect(r.length).toBeGreaterThanOrEqual(1);
  });
  it('summary has byAction', () => {
    log({ userId: 'test3', workspace: 'w', action: 'ping', result: 'ok' });
    const s = summary();
    expect(s.byAction).toBeTruthy();
  });
  it('cleanup does not throw', () => {
    expect(() => cleanup()).not.toThrow();
  });
});
