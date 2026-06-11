/**
 * Health Routes - 健康检查 / 工具列表
 * 提取自 index.ts
 */
import { Router, Request, Response } from 'express';
import type { AgentAIRouter } from '../llm-router.js';
import type { ToolRegistry } from '../tools.js';
import { getSummary } from '../evolution.js';
import { getSessionManager } from '../session-manager.js';

export interface HealthRouterDeps {
  router: AgentAIRouter;
  registry: ToolRegistry;
  sessions: Map<string, any>;
}

export function createHealthRouter(deps: HealthRouterDeps): Router {
  const r = Router();
  const { router, registry, sessions } = deps;

  r.get('/v1/health', (_req, res) => {
    const providerStats = router.getProviderStats();
    const evolutionSummary = getSummary();
    const sessionStats = getSessionManager().stats();

    res.json({
      ok: true,
      uptime: process.uptime(),
      timestamp: Date.now(),
      version: '0.1.0-alpha.1',
      providers: providerStats,
      tools: registry.listTools().length,
      sessions: sessions.size,
      sessionManager: sessionStats,
      evolution: evolutionSummary,
    });
  });

  r.get('/health', (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });

  r.get('/v1/tools', (_req, res) => {
    const tools = registry.listTools();
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
