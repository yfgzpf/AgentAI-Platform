import { describe, it, expect } from 'vitest';
import { generateKey, start, complete, fail, cleanup } from './idempotency.js';

describe('idempotency', () => {
  it('generates same key for same body', () => {
    const k1 = generateKey({ a: 1 });
    const k2 = generateKey({ a: 1 });
    expect(k1).toBe(k2);
  });
  it('generates different key for different body', () => {
    const k1 = generateKey({ a: 1 });
    const k2 = generateKey({ a: 2 });
    expect(k1).not.toBe(k2);
  });
  it('start returns ok for new key', () => {
    const key = generateKey({ test: Date.now() });
    const r = start(key);
    expect(r.ok).toBe(true);
  });
  it('start returns in_progress for duplicate', () => {
    const key = generateKey({ test2: Date.now() });
    start(key);
    const r = start(key);
    expect(r.ok).toBe(false);
    expect(r.existing?.status).toBe('in_progress');
  });
  it('complete then start returns existing result', () => {
    const key = generateKey({ test3: Date.now() });
    start(key);
    complete(key, { result: 'done' });
    const r = start(key);
    expect(r.ok).toBe(false);
    expect(r.existing?.result).toBe('done');
  });
  it('fail clears the key', () => {
    const key = generateKey({ test4: Date.now() });
    start(key);
    fail(key);
    const r = start(key);
    expect(r.ok).toBe(true);
  });
});

describe('idempotency - cleanup', () => {
  it('cleanup does not throw', () => {
    expect(() => cleanup()).not.toThrow();
  });
});
