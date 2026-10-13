/**
 * 动态模型列表 API 路由
 * ----------------------------------------------------
 * GET /v1/models/available - compact provider list
 * GET /v1/models/providers - detailed provider status with masked apiKeyEnv
 */
import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { MODELS } from '../model-classifier.js';

/** 同时检查 process.env + config.json 中的密钥 */
function hasApiKey(envKey: string): boolean {
  if (process.env[envKey]) return true;
  try {
    const configPath = path.resolve(process.cwd(), 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.apiKeys?.[envKey]) return true;
    }
  } catch { /* 读 config.json 失败静默 */ }
  return false;
}

const PROVIDER_ENV_KEY: Record<string, string> = {
  agentai: 'AGENTAI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  openai: 'OPENAI_API_KEY',
  zhipu: 'ZHIPU_API_KEY',
  superapi: 'SUPERAPI_API_KEY',
  alrc: 'ALRC_API_KEY',
  sensenova: 'SENSENOVA_API_KEY',
  longcat: 'LONGCAT_API_KEY',
  // nvidia: 'NVIDIA_API_KEY', 已移除
  qwen: 'DASHSCOPE_API_KEY',
  moonshot: 'MOONSHOT_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  minimax: 'MINIMAX_API_KEY',
  doubao: 'VOLCANO_API_KEY',
};

/**
 * 模型工厂分组密钥 (2026-10-13)
 * 设置页 6 个分组各自写入 FACTORY_*_KEY, ALRC_API_KEY 可能始终为空。
 * 没有这段时, 只配了分组密钥的用户在模型下拉框里**看不到任何工厂模型**。
 */
const FACTORY_GROUP_ENV_KEYS = [
  'FACTORY_CHAT_KEY', 'FACTORY_GPT_KEY', 'FACTORY_CLAUDE_KEY',
  'FACTORY_GROK_KEY', 'FACTORY_IMAGE_KEY', 'FACTORY_VIDEO_KEY',
];

/** provider → 全部候选 envVar (主密钥 + 模型工厂分组密钥) */
function candidateEnvKeys(provider: string): string[] {
  const primary = PROVIDER_ENV_KEY[provider] || `${provider.toUpperCase()}_API_KEY`;
  if (provider === 'alrc' || provider === 'factory') {
    return [primary, ...FACTORY_GROUP_ENV_KEYS];
  }
  return [primary];
}

/** provider 是否配了任一候选密钥 */
function providerHasAnyKey(provider: string): boolean {
  return candidateEnvKeys(provider).some(hasApiKey);
}

export interface ProviderStatusResponse {
  hasKey: boolean;
  tripped: boolean;
  bestAvailableModel: string | null;
  models: Array<{ id: string; label: string; subModel?: string; isFree: boolean }>;
  isPaid: boolean;
}

export function getAllProvidersStatus(router?: any): Map<string, ProviderStatusResponse> {
  const result = new Map<string, ProviderStatusResponse>();
  const rp = router?.providers;
  if (rp && rp instanceof Map) {
    for (const [providerId, stats] of Array.from(rp.entries())) {
      if (!result.has(providerId)) {
        result.set(providerId, {
          hasKey: false,
          tripped: Boolean(stats?.tripped),
          bestAvailableModel: null,
          models: [],
          isPaid: false,
        });
      }
      const entry = result.get(providerId)!;
      entry.tripped = (stats as any).tripped === true;
      entry.hasKey = providerHasAnyKey(providerId);
    }
  }
  for (const model of MODELS) {
    const pid = model.provider;
    if (!result.has(pid)) {
      result.set(pid, {
        hasKey: false,
        tripped: false,
        bestAvailableModel: null,
        models: [],
        isPaid: !model.isFree,
      });
    }
    const entry = result.get(pid)!;
    if (!entry.hasKey) {
      entry.hasKey = providerHasAnyKey(pid);
    }
    entry.models.push({ id: model.id, label: model.label, subModel: model.subModel, isFree: model.isFree });
    if (!model.isFree) entry.isPaid = true;
  }
  for (const [pid, entry] of Array.from(result.entries())) {
    if (!entry.tripped && entry.models.length > 0) {
      const sorted = [...entry.models].sort((a, b) => a.isFree ? -1 : b.isFree ? 1 : 0);
      entry.bestAvailableModel = sorted[0].id;
    }
    if (!entry.hasKey) {
      entry.hasKey = providerHasAnyKey(pid);
    }
  }
  return result;
}

function getReason(providerId: string, status: ProviderStatusResponse): string {
  if (!status.hasKey) {
    // 2026-10-13: 模型工厂可能配在 6 个分组变量之一, 如实列出候选而不是只报 ALRC_API_KEY
    return 'Missing API Key (' + candidateEnvKeys(providerId).join(' / ') + ')';
  }
  if (status.tripped) return 'Circuit Breaker Tripped';
  if (status.models.length === 0) return 'No known models';
  return '';
}

export function createModelsRouter(router?: any): Router {
  const r = Router();

  r.get('/available', (_req: Request, res: Response) => {
    try {
      const all = getAllProvidersStatus(router);
      const items = Array.from(all.entries()).map(([name, st]) => ({
        name, modelCount: st.models.length, hasKey: st.hasKey,
        tripped: st.tripped, bestAvailableModel: st.bestAvailableModel, isPaid: st.isPaid,
      }));
      items.sort((a, b) => b.modelCount - a.modelCount);
      res.json({ ok: true, providers: items, total: items.length });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Failed to fetch models' });
    }
  });

  r.get('/providers', (_req: Request, res: Response) => {
    try {
      const all = getAllProvidersStatus(router);
      const items: Array<{
        provider: string; name: string; modelCount: number; hasKey: boolean;
        tripped: boolean; bestAvailableModel: string | null; isPaid: boolean;
        apiKeyEnv: string; reason: string;
        models: Array<{ id: string; label: string; subModel?: string; isFree: boolean }>;
      }> = []; 
      for (const [name, status] of Array.from(all.entries())) {
        const envCandidates = candidateEnvKeys(name);
        // 2026-10-13: 主密钥可能为空而分组密钥有值 —— 掩码必须取**实际生效的那个**,
        //   否则列表里 alrc 显示"有 Key"却不显示任何掩码片段, 与 hasKey 自相矛盾。
        const activeEnv = envCandidates.find((k) => hasApiKey(k)) || envCandidates[0];
        let maskedKey = '';
        if (status.hasKey) {
          const raw = process.env[activeEnv] || '';
          maskedKey = raw.length > 8 ? raw.slice(0, 4) + '****' + raw.slice(-4) : '';
        }
        items.push({
          provider: name,
          name: maskedKey ? name + ' (' + maskedKey + ')' : name,
          modelCount: status.models.length, hasKey: status.hasKey,
          tripped: status.tripped, bestAvailableModel: status.bestAvailableModel,
          isPaid: status.isPaid, apiKeyEnv: activeEnv, reason: getReason(name, status),
          models: status.models,
        });
      }
      items.sort((a, b) => b.modelCount - a.modelCount);
      res.json({ ok: true, providers: items, total: items.length });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Failed to fetch providers' });
    }
  });

  return r;
}