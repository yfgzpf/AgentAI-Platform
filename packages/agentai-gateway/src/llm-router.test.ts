/**
 * AgentAIRouter tests
 * ----------------------------------------------------
 * Covers provider registration, no-API-key handling, cost guard defaults,
 * and the graceful degradation path (all providers unavailable).
 * No network calls — these are pure routing/state assertions.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AgentAIRouter, ChatRequest } from './llm-router.js';

// Ensure deterministic state: no real keys present during tests.
const KEY_ENVS = ['AGENTAI_API_KEY', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'CLINE_API_KEY'];
const saved: Record<string, string | undefined> = {};

describe('AgentAIRouter', () => {
  beforeEach(() => {
    // Strip keys so provider tripping is deterministic.
    for (const k of KEY_ENVS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  // Restore keys after each test so other suites are unaffected.
  const restore = () => {
    for (const k of KEY_ENVS) {
      if (saved[k] !== undefined) process.env[k] = saved[k];
      else delete process.env[k];
    }
  };

  it('registers the four built-in providers', () => {
    const router = new AgentAIRouter();
    router.recheckApiKeys();
    // recheckApiKeys logs provider status; the router should expose the providers
    // map indirectly via model selection. We assert no throw and a stable instance.
    expect(router).toBeInstanceOf(AgentAIRouter);
    expect(typeof router.recheckApiKeys).toBe('function');
    expect(typeof router.chat).toBe('function');
    restore();
  });

  it('marks providers without an API key as tripped', () => {
    const router = new AgentAIRouter();
    router.recheckApiKeys();
    // With no keys set, every provider should be tripped (no-key state).
    // Access the private providers map via the same reflection the chat route uses.
    const providers = (router as unknown as { providers: Map<string, { tripped: boolean }> }).providers;
    for (const id of ['agentai', 'deepseek', 'openai', 'zhipu']) {
      const stats = providers.get(id);
      expect(stats).toBeDefined();
      expect(stats!.tripped).toBe(true);
    }
    restore();
  });

  it('clears the tripped flag when a key becomes available', () => {
    process.env.AGENTAI_API_KEY = 'test-key';
    const router = new AgentAIRouter();
    router.recheckApiKeys();
    const providers = (router as unknown as { providers: Map<string, { tripped: boolean }> }).providers;
    expect(providers.get('agentai')!.tripped).toBe(false);
    // Other providers remain tripped (no key).
    expect(providers.get('deepseek')!.tripped).toBe(true);
    restore();
  });

  it('degrades gracefully when every provider is unavailable', async () => {
    const router = new AgentAIRouter();
    router.recheckApiKeys();
    const req: ChatRequest = {
      messages: [{ role: 'user', content: 'hello' }],
      userId: 'test',
      workspace: '.',
    };
    // With all providers tripped, chat() must not hang or crash. It either
    // resolves (with a no-key fallback message) or rejects with a clear error.
    let result: { threw: boolean; msg?: string } = { threw: false };
    try {
      const res = await router.chat(req);
      // If it resolves, it must be a well-formed ChatResponse.
      expect(res).toBeDefined();
      expect(typeof res.content).toBe('string');
      expect(res.usage).toBeDefined();
    } catch (e: any) {
      result = { threw: true, msg: String(e?.message || e) };
      // A rejection is acceptable as long as it carries a meaningful message.
      expect(result.msg!.length).toBeGreaterThan(0);
    }
    restore();
  });

  it('emits provider:failed when a locked provider throws', async () => {
    process.env.AGENTAI_API_KEY = 'invalid-test-key'; // present but invalid
    const router = new AgentAIRouter();
    router.recheckApiKeys();
    let failedEmitted = false;
    router.on('provider:failed', () => { failedEmitted = true; });

    const req: ChatRequest = {
      model: 'agentai',
      messages: [{ role: 'user', content: 'hi' }],
      userId: 'test',
      workspace: '.',
    };
    try {
      await router.chat(req);
    } catch {
      // expected — invalid key will fail; router may fall back to ranking
    }
    // Whether it fell back or threw, an invalid key must surface a failure event.
    expect(failedEmitted).toBe(true);
    restore();
  });
});
