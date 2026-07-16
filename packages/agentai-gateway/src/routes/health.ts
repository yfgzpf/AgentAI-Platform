/**
 * Health Routes - 健康检查 / 工具列表
 * 提取自 index.ts
 */
import { Router } from 'express';
import type { AgentAIRouter } from '../llm-router.js';
import type { ToolRegistry } from '../tool-registry.js';
import { getSummary } from '../evolution.js';
import { getSessionManager } from '../session-manager.js';
import { globalRateLimiter } from '../rate-limiter.js';

export interface HealthRouterDeps {
  router: AgentAIRouter;
  registry: ToolRegistry;
}

export function createHealthRouter(deps: HealthRouterDeps): Router {
  const r = Router();
  const { router, registry } = deps;

  r.get('/v1/health', (_req, res) => {
    const providerStats = typeof (router as any).getProviderStats === 'function' ? (router as any).getProviderStats() : {};
    const evolutionSummary = getSummary();
    const sessionStats = getSessionManager().stats();
    // 速率限制可观测性: 暴露各 provider 的 RPM/TPM 配额使用情况
    // (由 index.ts 订阅 router 事件填充, 仅用于监控, 不参与路由决策)
    let rateLimitsSummary = 'unavailable';
    try {
      rateLimitsSummary = typeof globalRateLimiter.getStatusSummary === 'function'
        ? globalRateLimiter.getStatusSummary()
        : 'unavailable';
    } catch { /* rate-limiter optional */ }

    res.json({
      ok: true,
      uptime: process.uptime(),
      timestamp: Date.now(),
      version: '0.1.0-alpha.1',
      providers: providerStats,
      tools: (typeof registry.list === 'function' ? registry.list() : []).length,
      sessionManager: sessionStats,
      evolution: evolutionSummary,
      rateLimits: rateLimitsSummary,
    });
  });

  r.get('/health', (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });

  r.get('/v1/tools', (_req, res) => {
    const tools = typeof registry.list === 'function' ? registry.list() : [];
    res.json({
      count: tools.length,
      tools: tools.map(t => ({
        name: t.name,
        description: t.description,
        riskLevel: t.riskLevel,
        parallelSafe: t.parallelSafe,
      })),
    });
  });

  return r;
}
