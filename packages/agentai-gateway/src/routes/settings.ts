/**
 * Settings Routes - API 密钥管理
 *   GET  /v1/settings/keys?provider=agentai  → 查询密钥状态
 *   POST /v1/settings/keys                   → 保存密钥到 .env
 */
import { Router, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';

const ENV_KEY_MAP: Record<string, string> = {
  agentai: 'AGENTAI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  openai: 'OPENAI_API_KEY',
  zhipu: 'ZHIPU_API_KEY',
};

/** 掩码 API Key, 只保留前 2 + 后 4 位 */
function maskKey(key: string | undefined): string {
  if (!key) return '';
  if (key.length <= 8) return key.slice(0, 2) + '***';
  return key.slice(0, 2) + '***' + key.slice(-4);
}

/** 查找 .env 文件路径 */
function findEnvFile(): string | null {
  const candidates = [
    process.env.AGENTAI_ENV_PATH || '',
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../.env'),
    path.resolve(process.cwd(), '../../.env'),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

/** 从 .env 读取指定 key */
function readEnvKey(envVar: string): string | undefined {
  const envFile = findEnvFile();
  if (!envFile) return undefined;
  const text = fs.readFileSync(envFile, 'utf-8');
  for (const line of text.split('\n')) {
    const m = line.match(new RegExp(`^${envVar}\\s*=\\s*(.*?)\\s*$`));
    if (m && m[1] !== undefined) return m[1].replace(/^['"]|['"]$/g, '');
  }
  return undefined;
}

/** 写入 .env 文件 */
function writeEnvKey(envVar: string, value: string): void {
  let envFile = findEnvFile();
  if (!envFile) {
    // 默认写到项目根目录
    envFile = path.resolve(process.cwd(), '../../.env');
    const dir = path.dirname(envFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  let text = '';
  if (fs.existsSync(envFile)) {
    text = fs.readFileSync(envFile, 'utf-8');
  }
  const lines = text.split('\n');
  const idx = lines.findIndex(l => l.startsWith(`${envVar}=`));
  if (idx >= 0) {
    lines[idx] = `${envVar}=${value}`;
  } else {
    lines.push(`${envVar}=${value}`);
  }
  fs.writeFileSync(envFile, lines.join('\n'), 'utf-8');
}

export interface SettingsRouterDeps {
  router?: { recheckApiKeys: () => void };
}

export function createSettingsRouter(deps?: SettingsRouterDeps): Router {
  const r = Router();

  /**
   * GET /v1/settings/keys?provider=agentai
   * 查询指定 provider 的密钥状态
   */
  r.get('/v1/settings/keys', (req: Request, res: Response) => {
    const provider = (req.query.provider as string) || 'agentai';
    const envVar = ENV_KEY_MAP[provider] || `${provider.toUpperCase()}_API_KEY`;

    // 优先从 process.env 读取（运行时已加载）
    const envValue = process.env[envVar] || readEnvKey(envVar);

    res.json({
      ok: !!envValue,
      masked: maskKey(envValue),
      envVar,
    });
  });

  /**
   * POST /v1/settings/keys
   * Body: { provider, apiKey }
   * 保存密钥到 .env 并刷新运行时的 process.env
   */
  r.post('/v1/settings/keys', (req: Request, res: Response) => {
    const { provider, apiKey } = req.body || {};
    if (!provider || !apiKey) {
      return res.status(400).json({ error: 'provider 和 apiKey 必填' });
    }

    const envVar = ENV_KEY_MAP[provider] || `${provider.toUpperCase()}_API_KEY`;

    try {
      // 写入 .env
      writeEnvKey(envVar, apiKey);
      // 刷新运行时环境变量
      process.env[envVar] = apiKey;

      // 通知 router 重新检查 key 状态
      if (deps?.router) {
        setImmediate(() => deps.router!.recheckApiKeys());
      }

      console.log(`[settings] ${envVar} 已保存到 .env`);
      res.json({ ok: true, envVar });
    } catch (err: any) {
      res.status(500).json({ error: `保存失败: ${err.message}` });
    }
  });

  /**
   * POST /v1/settings/keys/test
   * Body: { provider, baseURL, modelName, apiKey }
   * 通过 Gateway 代理测试模型连接（走与服务相同的网络路径）
   * 支持前端直接传递 apiKey（测试时密钥可能还未保存到 process.env）
   */
  r.post('/v1/settings/keys/test', async (req: Request, res: Response) => {
    const { provider, baseURL, modelName, apiKey } = req.body || {};
    if (!provider || !baseURL) {
      return res.status(400).json({ error: 'provider 和 baseURL 必填' });
    }

    const envVar = ENV_KEY_MAP[provider] || `${provider.toUpperCase()}_API_KEY`;
    // 优先使用前端传递的 apiKey，否则从 process.env 读取
    const key = apiKey || process.env[envVar];

    if (!key) {
      return res.status(400).json({ error: `未找到 ${envVar} 密钥，请先保存或传递 apiKey 参数` });
    }

    const url = baseURL.replace(/\/+$/, '') + '/chat/completions';

    try {
      // NVIDIA NIM 模型名包含 publisher/ 前缀 (如 deepseek-ai/deepseek-v4-flash)
      // 某些 provider 可能需要不同的测试模型名
      const testModel = modelName || 'deepseek-v4-flash';

      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
          // NVIDIA NIM 需要 Accept header
          ...(provider === 'nvidia' ? { 'Accept': 'application/json' } : {}),
        },
        body: JSON.stringify({
          model: testModel,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 5,
          stream: false,
        }),
        signal: AbortSignal.timeout(20000),
      });

      if (r.ok) {
        res.json({ ok: true, status: r.status });
      } else {
        const text = await r.text().catch(() => '');
        res.status(502).json({ error: `API 返回错误 HTTP ${r.status}: ${text.slice(0, 200)}` });
      }
    } catch (e: any) {
      res.status(502).json({ error: `连接失败: ${e.message}` });
    }
  });

  return r;
}
