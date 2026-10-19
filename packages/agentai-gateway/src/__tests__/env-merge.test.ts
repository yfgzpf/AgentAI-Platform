import { describe, it, expect } from 'vitest';
import { mergeEnvValue, isKeyEnvVar } from '../env-merge.js';

describe('isKeyEnvVar', () => {
  it('识别各类 API Key 变量', () => {
    expect(isKeyEnvVar('DEEPSEEK_API_KEY')).toBe(true);
    expect(isKeyEnvVar('OPENAI_API_KEY')).toBe(true);
    expect(isKeyEnvVar('ALRC_API_KEY')).toBe(true);
    expect(isKeyEnvVar('FACTORY_CHAT_KEY')).toBe(true);
    expect(isKeyEnvVar('FACTORY_GPT_KEY')).toBe(true);
  });
  it('非 key 变量不被识别', () => {
    expect(isKeyEnvVar('AGENTAI_PORT')).toBe(false);
    expect(isKeyEnvVar('AGENTAI_WORKSPACE')).toBe(false);
    expect(isKeyEnvVar('PATH')).toBe(false);
    expect(isKeyEnvVar('NODE_ENV')).toBe(false);
  });
});

describe('mergeEnvValue', () => {
  it('shell 缺失 → 用 .env (原行为)', () => {
    const r = mergeEnvValue('DEEPSEEK_API_KEY', 'new-from-env', undefined);
    expect(r.value).toBe('new-from-env');
    expect(r.overridden).toBe(false);
  });

  it('key 变量: .env 与 shell 不同 → .env 覆盖, 标记 overridden', () => {
    const r = mergeEnvValue('DEEPSEEK_API_KEY', 'new-from-env', 'old-from-shell');
    expect(r.value).toBe('new-from-env');
    expect(r.overridden).toBe(true);
  });

  it('key 变量: .env 与 shell 相同 → 仍是 .env 值, 不标记 overridden', () => {
    const r = mergeEnvValue('DEEPSEEK_API_KEY', 'same', 'same');
    expect(r.value).toBe('same');
    expect(r.overridden).toBe(false);
  });

  it('非 key 变量: shell 优先, .env 被忽略', () => {
    const r = mergeEnvValue('AGENTAI_PORT', '9999', '18789');
    expect(r.value).toBe('18789');
    expect(r.overridden).toBe(false);
  });

  it('key 变量但 .env 为空 → 不覆盖 shell (避免清空密钥)', () => {
    const r = mergeEnvValue('DEEPSEEK_API_KEY', '', 'old-from-shell');
    expect(r.value).toBe('old-from-shell');
    expect(r.overridden).toBe(false);
  });

  it('FACTORY_*_KEY 也走 key 覆盖逻辑', () => {
    const r = mergeEnvValue('FACTORY_CHAT_KEY', 'env-key', 'shell-key');
    expect(r.value).toBe('env-key');
    expect(r.overridden).toBe(true);
  });
});
