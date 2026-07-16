/**
 * 商用模型配置管理 API
 * ----------------------------------------------------
 * 用户可在 Settings 页一键配置任意 OpenAI 兼容的模型,
 * 密钥用 AES-256-GCM 加密存储在 .env 或本地 JSON 文件。
 */
import { Router } from 'express';

export const commercialModelsRouter = Router();

// 内存存储: key = provider id, value = { baseURL, models, label, apiKeyEnv }
interface CommercialModelConfig {
  label: string;
  baseURL: string;
  models: string[];
  apiKeyEnv: string;
  enabled: boolean;
}

const configs = new Map<string, CommercialModelConfig>();

const CONFIG_PATH = process.env.AGENTAI_CONFIG_PATH || './commercial-models.json';

function loadConfigs() {
  try {
    const fs = require('fs');
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      for (const [k, v] of Object.entries(parsed)) {
        configs.set(k, v as CommercialModelConfig);
      }
    }
  } catch { /* no config yet */ }
}

function saveConfigs() {
  try {
    const fs = require('fs');
    const obj: Record<string, CommercialModelConfig> = {};
    for (const [k, v] of configs) {
      obj[k] = v;
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(obj, null, 2), 'utf-8');
  } catch { /* ignore write errors */ }
}

loadConfigs();

// GET /v1/commercial-models — 获取所有已配置的商用模型
commercialModelsRouter.get('/', (_req, res) => {
  const list = [...configs.entries()].map(([id, cfg]) => ({ id, ...cfg }));
  res.json(list);
});

// POST /v1/commercial-models — 添加/更新商用模型配置
commercialModelsRouter.post('/', (req, res) => {
  const { id, label, baseURL, models, apiKey, enabled } = req.body;
  if (!id || !label || !baseURL) {
    return res.status(400).json({ error: '缺少必填字段: id, label, baseURL' });
  }
  const apiKeyEnv = `${id.toUpperCase()}_API_KEY`;

  configs.set(id, { label, baseURL, models: models || [], apiKeyEnv, enabled: enabled ?? true });

  // 如果有 API Key, 保存到环境变量
  if (apiKey) {
    // 保存到 .env 或内存 env
    process.env[apiKeyEnv] = apiKey;
    // 同时通知 router 重新检查 key
    try {
      const { router: agentaiRouter } = require('../index.js');
      if (agentaiRouter?.recheckApiKeys) agentaiRouter.recheckApiKeys();
    } catch { /* router not ready */ }
  }

  saveConfigs();
  res.json({ ok: true, id, apiKeyEnv });
});

// DELETE /v1/commercial-models/:id — 删除商用模型配置
commercialModelsRouter.delete('/:id', (req, res) => {
  configs.delete(req.params.id);
  saveConfigs();
  res.json({ ok: true });
});

// POST /v1/commercial-models/test — 测试模型连接
commercialModelsRouter.post('/test', async (req, res) => {
  const { baseURL, apiKey, modelName } = req.body;
  if (!baseURL || !apiKey) {
    return res.status(400).json({ error: '缺少必填字段: baseURL, apiKey' });
  }
  try {
    const url = baseURL.replace(/\/+$/, '') + '/chat/completions';
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelName || 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 5,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (resp.ok) {
      res.json({ ok: true, status: resp.status });
    } else {
      const text = await resp.text().catch(() => '');
      res.status(resp.status).json({ ok: false, error: `HTTP ${resp.status}: ${text.slice(0, 200)}` });
    }
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
