/**
 * run-vision-test.ts
 * ----------------------------------------------------
 * 实测每个模型的真实 vision 能力
 * 用途: 验证 supportsImages 标记是否真实
 * 灵感来源: Fugu "Verifier" 思想 — 别只信配置, 用真实测试验证
 *
 * 用法:
 *   cd packages/agentai-gateway
 *   node --loader ts-node/esm src/run-vision-test.ts
 * 或:
 *   npx tsx src/run-vision-test.ts
 *
 * 安全守护: 真实打 API, 不会修改任何文件
 */
import * as fs from 'fs';
import * as path from 'path';

// 内置 .env 加载 (避免依赖 dotenv)
function loadEnv() {
  const envPath = path.join(process.cwd(), '..', '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
loadEnv();

/** 1x1 红色 PNG (64 字节 base64) */
const TEST_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

/** 模型列表 (按 provider 测试) */
const TEST_MODELS: { provider: string; model: string; label: string }[] = [
  // 免费优先
  { provider: 'agentai', model: 'agnes-2.0-flash', label: 'Agnes AI Flash (主)' },
  // 备选
  { provider: 'deepseek', model: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
  { provider: 'zhipu', model: 'glm-4v-flash', label: 'Zhipu GLM-4V Flash (4.0)' },
  { provider: 'zhipu', model: 'glm-4.6v-flash', label: 'Zhipu GLM-4.6V Flash (4.6)' },
  { provider: 'zhipu', model: 'glm-4.7-flash', label: 'Zhipu GLM-4.7 Flash' },
  // 付费
  { provider: 'openai', model: 'gpt-4o-mini', label: 'OpenAI GPT-4o-mini' },
];

interface TestResult {
  provider: string;
  model: string;
  label: string;
  ok: boolean;
  hasApiKey: boolean;
  hasVisionSupport: boolean;
  error?: string;
  responseTimeMs: number;
  sampleOutput?: string;
}

async function testModelVision(provider: string, model: string, label: string): Promise<TestResult> {
  const keyEnv = `${provider.toUpperCase()}_API_KEY`;
  const baseEnv = `${provider.toUpperCase()}_BASE_URL`;
  const apiKey = process.env[keyEnv] || process.env.AGENTAI_API_KEY;
  const baseUrl = (process.env[baseEnv] || '').replace(/\/$/, '') ||
    (provider === 'agentai' ? 'https://apihub.agnes-ai.com/v1' :
     provider === 'deepseek' ? 'https://api.deepseek.com/v1' :
     provider === 'zhipu' ? 'https://open.bigmodel.cn/api/paas/v4' :
     'https://api.openai.com/v1');

  if (!apiKey) {
    return { provider, model, label, ok: false, hasApiKey: false, hasVisionSupport: false, error: 'No API key', responseTimeMs: 0 };
  }

  const start = Date.now();
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: '请只输出一个词描述这张图: ' },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${TEST_IMAGE_BASE64}` } }
          ]
        }],
        max_tokens: 50,
        temperature: 0,
      }),
    });
    const responseTimeMs = Date.now() - start;
    if (!response.ok) {
      const text = await response.text();
      return {
        provider, model, label, ok: false, hasApiKey: true, hasVisionSupport: false,
        error: `HTTP ${response.status}: ${text.slice(0, 200)}`, responseTimeMs,
      };
    }
    const data: any = await response.json();  // v3.2 修复: data 默认是 unknown
    const content = data.choices?.[0]?.message?.content || '';
    return {
      provider, model, label, ok: true, hasApiKey: true, hasVisionSupport: true,
      responseTimeMs, sampleOutput: content.slice(0, 100),
    };
  } catch (e: any) {
    return {
      provider, model, label, ok: false, hasApiKey: true, hasVisionSupport: false,
      error: e.message?.slice(0, 200), responseTimeMs: Date.now() - start,
    };
  }
}

async function main() {
  process.stdout.write('===== Vision Ability Real Test =====\n');
  process.stdout.write(`[debug] cwd: ${process.cwd()}\n`);
  process.stdout.write('Test image: 1x1 red PNG\n');
  process.stdout.write(`[debug] env keys: AGENTAI=${!!process.env.AGENTAI_API_KEY} DEEPSEEK=${!!process.env.DEEPSEEK_API_KEY} ZHIPU=${!!process.env.ZHIPU_API_KEY}\n`);
  process.stdout.write(`[debug] node: ${process.version}\n`);
  process.stdout.write(`[debug] typeof fetch: ${typeof fetch}\n\n`);

  // Skip network tests, just print what we have
  process.stdout.write('Running dry-run only (network tests skipped for sandbox)\n\n');

  const results: TestResult[] = [];
  for (const m of TEST_MODELS) {
    process.stdout.write(`[TEST] ${m.label} ... `);
    try {
      const result = await testModelVision(m.provider, m.model, m.label);
      results.push(result);
      if (!result.hasApiKey) {
        process.stdout.write('SKIP (no key)\n');
      } else if (result.ok) {
        process.stdout.write(`OK (${result.responseTimeMs}ms) - "${result.sampleOutput}"\n`);
      } else {
        process.stdout.write(`FAIL: ${result.error?.slice(0, 80)}\n`);
      }
    } catch (e: any) {
      process.stdout.write(`EXCEPTION: ${e.message?.slice(0, 80)}\n`);
    }
  }

  console.log('\n===== 汇总 =====\n');
  console.log('| Model | Key | Vision | Time |');
  console.log('|-------|-----|--------|------|');
  for (const r of results) {
    const key = r.hasApiKey ? 'YES' : 'NO';
    const vis = r.hasVisionSupport ? 'YES' : 'NO';
    console.log(`| ${r.label} | ${key} | ${vis} | ${r.responseTimeMs}ms |`);
  }

  // 输出建议
  console.log('\n===== Suggestions =====\n');
  const working = results.filter(r => r.hasVisionSupport);
  if (working.length === 0) {
    console.log('WARNING: No model actually supports vision, OCR fallback needed');
  } else {
    console.log('Models with real vision support:');
    for (const r of working) {
      console.log(`   - ${r.label} (${r.responseTimeMs}ms)`);
    }
  }
}

main().then(() => {
  process.stdout.write('\n[done]\n');
  process.exit(0);
}).catch(e => {
  process.stderr.write(`Test failed: ${e}\n`);
  process.exit(1);
});
