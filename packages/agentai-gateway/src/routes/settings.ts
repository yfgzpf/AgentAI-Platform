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
  'agnes-video': 'AGNES_VIDEO_API_KEY',
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
  dxnt: 'DXNT_API_KEY',
};

/**
 * 2026-10-06 P0 安全修复: 环境变量名白名单校验
 * =================================================
 * 原实现:
 *   const envVar = ENV_KEY_MAP[provider] || `${provider.toUpperCase()}_API_KEY`;
 *   writeEnvKey(envVar, apiKey);process.env[envVar] = apiKey;
 *
 * provider 完全由请求体控制且无校验，而 envVar 会:
 *   1) 被写入 .env 文件（持久化到磁盘）
 *   2) 被赋值到 process.env（影响同进程所有后续代码）
 *
 * 可利用输入:
 *   provider 含 `=` 或换行时，写入 .env 的那一行会被拆成两条赋值:
 *      EVIL_KEY=x
 *      NODE_OPTIONS=--require evil.js   ← 注入了新的环境变量
 *   下次任何 `node` 子进程启动都会执行攻击者指定的代码。
 *
 * 现在: envVar 必须严格匹配 /^[A-Z][A-Z0-9_]*$/、长度 <= 64，
 * 且拒绝 PATH / COMSPEC / __PROTO__ 等敏感名。
 */
const ENV_NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const FORBIDDEN_ENV_NAMES = new Set([
  '__PROTO__', 'CONSTRUCTOR', 'PROTOTYPE',
  'PATH', 'COMSPEC', 'SYSTEMROOT', 'WINDIR', 'PATHEXT', 'LD_PRELOAD',
]);

function isValidEnvName(name: string): boolean {
  return ENV_NAME_RE.test(name) && !FORBIDDEN_ENV_NAMES.has(name);
}

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

/** 从 .env 文件删除指定 key */
function removeEnvKey(envVar: string): void {
  const envFile = findEnvFile();
  if (!envFile) return;
  if (!fs.existsSync(envFile)) return;
  const text = fs.readFileSync(envFile, 'utf-8');
  const lines = text.split('\n').filter(l => !l.startsWith(`${envVar}=`) && !l.startsWith(`${envVar} =`));
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
    // 2026-10-06 P0: 同样校验 —— 否则 GET 也能探测任意环境变量是否存在
    if (!isValidEnvName(envVar)) {
      return res.status(400).json({ error: 'provider 非法' });
    }

    // 优先从 process.env 读取（运行时已加载）
    const envValue = process.env[envVar] || readEnvKey(envVar);

    res.json({
      ok: !!envValue,
      masked: maskKey(envValue),
      envVar,
    });
  });

  /**
   * GET /v1/settings/keys/status
   * 返回所有已知 Provider 的密钥配置状态 (供前端模型选择器同步)
   */
  r.get('/v1/settings/keys/status', (_req: Request, res: Response) => {
    const allKeys: Record<string, string> = {
      AGENTAI_API_KEY: 'AGENTAI_API_KEY', ZHIPU_API_KEY: 'ZHIPU_API_KEY',
      AGNES_VIDEO_API_KEY: 'AGNES_VIDEO_API_KEY',
      DEEPSEEK_API_KEY: 'DEEPSEEK_API_KEY', OPENAI_API_KEY: 'OPENAI_API_KEY',
      SUPERAPI_API_KEY: 'SUPERAPI_API_KEY', SENSENOVA_API_KEY: 'SENSENOVA_API_KEY',
      LONGCAT_API_KEY: 'LONGCAT_API_KEY',
      DASHSCOPE_API_KEY: 'DASHSCOPE_API_KEY', VOLCANO_API_KEY: 'VOLCANO_API_KEY',
      MOONSHOT_API_KEY: 'MOONSHOT_API_KEY', ANTHROPIC_API_KEY: 'ANTHROPIC_API_KEY',
      MINIMAX_API_KEY: 'MINIMAX_API_KEY', DXNT_API_KEY: 'DXNT_API_KEY',
    };

    const status: Record<string, { ok: boolean; masked: string }> = {};
    for (const [key, envVar] of Object.entries(allKeys)) {
      const value = process.env[envVar] || readEnvKey(envVar);
      status[key] = { ok: !!value, masked: maskKey(value) };
    }
    res.json(status);
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
    // 2026-10-06 P0: provider 必须是已知项，或至少能推导出合法 envVar 名
    if (typeof provider !== 'string' || provider.length > 64) {
      return res.status(400).json({ error: 'provider 非法' });
    }

    const envVar = ENV_KEY_MAP[provider] || `${provider.toUpperCase()}_API_KEY`;
    // P0: 防止 provider 含 `=` / 换行 / 路径分隔符 → 向 .env 注入任意变量赋值
    if (!isValidEnvName(envVar)) {
      return res.status(400).json({ error: `非法的环境变量名: ${envVar.slice(0, 40)}` });
    }

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
   * DELETE /v1/settings/keys
   * Body: { provider }
   * 从 .env 和 process.env 删除密钥 (用户删除自定义模型时调用)
   */
  r.delete('/v1/settings/keys', (req: Request, res: Response) => {
    const { provider } = req.body || {};
    if (!provider) {
      return res.status(400).json({ error: 'provider 必填' });
    }
    // 2026-10-06 P0: 不校验则可删除 PATH / COMSPEC 等系统变量
    if (typeof provider !== 'string' || provider.length > 64) {
      return res.status(400).json({ error: 'provider 非法' });
    }

    const envVar = ENV_KEY_MAP[provider] || `${provider.toUpperCase()}_API_KEY`;
    if (!isValidEnvName(envVar)) {
      return res.status(400).json({ error: 'provider 非法' });
    }

    try {
      // 从 .env 文件删除
      removeEnvKey(envVar);
      // 从运行时环境变量删除
      delete process.env[envVar];

      // 通知 router 重新检查 key 状态
      if (deps?.router) {
        setImmediate(() => deps.router!.recheckApiKeys());
      }

      console.log(`[settings] ${envVar} 已从 .env 删除`);
      res.json({ ok: true, envVar });
    } catch (err: any) {
      res.status(500).json({ error: `删除失败: ${err.message}` });
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
    // 2026-10-06 P0: 同上，避免用合法 provider 名读出任意变量的值
    if (typeof provider !== 'string' || provider.length > 64) {
      return res.status(400).json({ error: 'provider 非法' });
    }

    const envVar = ENV_KEY_MAP[provider] || `${provider.toUpperCase()}_API_KEY`;
    // 优先使用前端传递的 apiKey，否则从 process.env 读取
    const key = apiKey || process.env[envVar];

    if (!key) {
      return res.status(400).json({ error: `未找到 ${envVar} 密钥，请先保存或传递 apiKey 参数` });
    }

    const url = baseURL.replace(/\/+$/, '') + '/chat/completions';

    try {
      // 某些 provider 可能需要不同的测试模型名
      const testModel = modelName || 'deepseek-flash';

      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
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
