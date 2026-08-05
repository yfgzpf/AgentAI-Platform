// @ts-nocheck
/**
 * 工具选对率评估框架
 * ----------------------
 * 目的: 量化 AI 从 141 个工具中选对工具的能力
 *
 * 用法:
 *   1. mock 模式 (无需 API key):  pnpm vitest run tool-selection-eval
 *   2. 真实 LLM 模式: 配置 AGENTAI_API_KEY 后跑 agentai-loop.run() 收集 tool_call
 *
 * 输出:
 *   - 总体选对率
 *   - 按工具分组的选对率 (哪些工具容易选错)
 *   - 按场景类型的选对率
 *   - baseline 报告
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { EXTRA_TOOLS } from '../tools.js';

interface EvalCase {
  id: string;
  category: 'file' | 'code' | 'web' | 'media' | 'system' | 'workflow' | 'meta';
  prompt: string;
  expectedTools: string[];   // 期望 AI 调用的工具
  alternatives?: string[];   // 可接受的替代 (语义相似)
  wrongTools?: string[];     // 明确不该选的
  notes?: string;
}

interface Provider {
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
  model: string;
}

// 20-30 个代表性 prompt 覆盖主要工具
const EVAL_CASES: EvalCase[] = [
  // ===== 文件操作 (5) =====
  {
    id: 'f01',
    category: 'file',
    prompt: '帮我看看 src/app.ts 文件里有什么内容',
    expectedTools: ['read_file'],
    wrongTools: ['write_file', 'generate_image'],
  },
  {
    id: 'f02',
    category: 'file',
    prompt: '在 src/ 目录下创建一个 utils.ts 文件, 内容是导出一个 add 函数',
    expectedTools: ['write_file'],
    alternatives: ['multi_edit'],
  },
  {
    id: 'f03',
    category: 'file',
    prompt: '把 src/app.ts 里的 console.log 改成 logger.info',
    expectedTools: ['multi_edit', 'read_file'],
    notes: '改前先读, 改用 multi_edit',
  },
  {
    id: 'f04',
    category: 'file',
    prompt: '列出当前工作目录的所有 .ts 文件',
    expectedTools: ['glob'],
    alternatives: ['search_content', 'list_directory'],
  },
  {
    id: 'f05',
    category: 'file',
    prompt: '查找所有用到 console.log 的文件',
    expectedTools: ['search_content'],
  },

  // ===== 代码操作 (5) =====
  {
    id: 'c01',
    category: 'code',
    prompt: '运行 npm test 看测试是否通过',
    expectedTools: ['run_code', 'run_background'],
    wrongTools: ['read_file'],
  },
  {
    id: 'c02',
    category: 'code',
    prompt: '执行 pnpm typecheck 检查类型错误',
    expectedTools: ['run_code', 'typecheck'],
  },
  {
    id: 'c03',
    category: 'code',
    prompt: '把刚才的修改提交到 git',
    expectedTools: ['git_smart_commit', 'git_commit'],
    wrongTools: ['read_file'],
  },
  {
    id: 'c04',
    category: 'code',
    prompt: '审查 src/agentai-loop.ts 的代码质量',
    expectedTools: ['code_review'],
    alternatives: ['read_file'],
  },
  {
    id: 'c05',
    category: 'code',
    prompt: '在所有文件中搜索 TODO 注释',
    expectedTools: ['search_content'],
  },

  // ===== 网络操作 (4) =====
  {
    id: 'w01',
    category: 'web',
    prompt: '搜索一下 React 19 的最新特性',
    expectedTools: ['web_search'],
  },
  {
    id: 'w02',
    category: 'web',
    prompt: '打开 https://github.com 看下首页',
    expectedTools: ['browser_navigate'],
    alternatives: ['web_fetch'],
  },
  {
    id: 'w03',
    category: 'web',
    prompt: '从 wikipedia.org/wiki/TypeScript 抓取内容',
    expectedTools: ['web_fetch'],
  },
  {
    id: 'w04',
    category: 'web',
    prompt: '在百度搜索 "agentai"',
    expectedTools: ['web_search'],
    alternatives: ['browser_navigate'],
  },

  // ===== 媒体生成 (3) =====
  {
    id: 'm01',
    category: 'media',
    prompt: '生成一张猫咪的图片',
    expectedTools: ['generate_image'],
  },
  {
    id: 'm02',
    category: 'media',
    prompt: '生成一个 10 秒的产品介绍视频',
    expectedTools: ['generate_video'],
  },
  {
    id: 'm03',
    category: 'media',
    prompt: '分析这张图片里有什么内容',
    expectedTools: ['capture_and_read'],
    alternatives: ['ocr_image', 'capture_screen'],
  },

  // ===== 系统操作 (3) =====
  {
    id: 's01',
    category: 'system',
    prompt: '播放一些音乐放松一下',
    expectedTools: ['control_music'],
  },
  {
    id: 's02',
    category: 'system',
    prompt: '把音量调到 50%',
    expectedTools: ['set_volume', 'control_music'],
  },
  {
    id: 's03',
    category: 'system',
    prompt: '锁屏',
    expectedTools: ['lock_screen'],
  },

  // ===== 工作流 (3) =====
  {
    id: 'wf01',
    category: 'workflow',
    prompt: '创建一个每日 9 点提醒我写日报的定时任务',
    expectedTools: ['schedule_task'],
  },
  {
    id: 'wf02',
    category: 'workflow',
    prompt: '执行装修报价模板',
    expectedTools: ['workflow_run'],
    alternatives: ['workflow_list_templates', 'activate_expert'],
  },
  {
    id: 'wf03',
    category: 'workflow',
    prompt: '发送一条通知到钉钉, 内容是"部署完成"',
    expectedTools: ['send_notification'],
  },

  // ===== 元任务 (3) =====
  {
    id: 'mt01',
    category: 'meta',
    prompt: '记一下: 项目的 Python 依赖在 requirements.txt',
    expectedTools: ['remember'],
  },
  {
    id: 'mt02',
    category: 'meta',
    prompt: '我想起来上次我们聊过数据库配置, 帮我回忆一下',
    expectedTools: ['recall_memory'],
    alternatives: ['search_content'],
  },
  {
    id: 'mt03',
    category: 'meta',
    prompt: '激活 UX 架构师专家',
    expectedTools: ['activate_expert'],
  },

  // ===== 浏览器自动化 (5) =====
  {
    id: 'b01',
    category: 'browser',
    prompt: '打开京东首页, 看看有什么活动',
    expectedTools: ['browser_navigate'],
  },
  {
    id: 'b02',
    category: 'browser',
    prompt: '在当前页面点击登录按钮 (#login-btn)',
    expectedTools: ['browser_click'],
  },
  {
    id: 'b03',
    category: 'browser',
    prompt: '在搜索框 (input[name=keyword]) 输入 "iPhone 15" 并按回车',
    expectedTools: ['browser_type'],
  },
  {
    id: 'b04',
    category: 'browser',
    prompt: '把这个页面的所有商品价格提取成表格',
    expectedTools: ['browser_extract'],
  },
  {
    id: 'b05',
    category: 'browser',
    prompt: '等页面加载完成后, 截一张全屏截图',
    expectedTools: ['browser_screenshot'],
    alternatives: ['browser_snapshot'],
  },

  // ===== 桌面自动化 (4) =====
  {
    id: 'd01',
    category: 'desktop',
    prompt: '截取整个屏幕, 看看现在显示了什么',
    expectedTools: ['capture_screen'],
  },
  {
    id: 'd02',
    category: 'desktop',
    prompt: '截屏并提取屏幕上的文字 (OCR)',
    expectedTools: ['capture_and_read'],
    alternatives: ['ocr_image'],
  },
  {
    id: 'd03',
    category: 'desktop',
    prompt: '点击屏幕上 "确定" 按钮的位置',
    expectedTools: ['click_text'],
    alternatives: ['find_text_on_screen', 'mouse_click'],
  },
  {
    id: 'd04',
    category: 'desktop',
    prompt: '启动 VSCode 编辑器',
    expectedTools: ['launch_app', 'open_application'],
  },

  // ===== 系统/进程 (3) =====
  {
    id: 'p01',
    category: 'process',
    prompt: '列出所有正在运行的进程, 看看哪个占用 CPU 高',
    expectedTools: ['list_processes'],
  },
  {
    id: 'p02',
    category: 'process',
    prompt: '结束 PID 1234 这个进程',
    expectedTools: ['kill_process'],
  },
  {
    id: 'p03',
    category: 'process',
    prompt: '列出所有打开的窗口, 找一下 "Chrome" 窗口',
    expectedTools: ['list_windows'],
  },

  // ===== 自进化/自创建 (4) =====
  {
    id: 'e01',
    category: 'evolution',
    prompt: '我经常需要把 JSON 转 CSV, 帮我创建一个自定义工具',
    expectedTools: ['create_tool', 'discover_or_create_skill'],
  },
  {
    id: 'e02',
    category: 'evolution',
    prompt: '我发现 PowerShell 不支持 &&, 帮我添加这条规则避免再犯',
    expectedTools: ['evolve_prompt'],
  },
  {
    id: 'e03',
    category: 'evolution',
    prompt: '我需要写一个能从 PDF 提取表格的技能, 帮我锻造',
    expectedTools: ['skill_forge'],
  },
  {
    id: 'e04',
    category: 'evolution',
    prompt: '现在系统健康吗? 有没有 API Key 失效或磁盘满',
    expectedTools: ['self_diagnose'],
  },

  // ===== 任务规划/项目探索 (4) =====
  {
    id: 't01',
    category: 'planning',
    prompt: '帮我做一个完整的市场调研报告, 涉及多个步骤',
    expectedTools: ['plan_task'],
  },
  {
    id: 't02',
    category: 'planning',
    prompt: '我有一个模糊的需求, 想做"智能客服"系统, 帮我生成 PRD',
    expectedTools: ['spec_generate'],
  },
  {
    id: 't03',
    category: 'planning',
    prompt: '探索这个项目的代码结构, 看看入口在哪',
    expectedTools: ['explore_project'],
  },
  {
    id: 't04',
    category: 'planning',
    prompt: '搜索代码库: 工具调度器在哪里实现的?',
    expectedTools: ['search_codebase'],
    alternatives: ['analyze_code', 'find_references'],
  },

  // ===== 行业/可视化 (2) =====
  {
    id: 'i01',
    category: 'industry',
    prompt: '识别一下这个用户属于哪个行业, 给出行业画像',
    expectedTools: ['industry_insight'],
  },
  {
    id: 'i02',
    category: 'industry',
    prompt: '画一个系统架构图, 展示 gateway → core → gui 的关系',
    expectedTools: ['generate_diagram'],
  },
];

// 真实 LLM 决策 - 让 AI 从 141 工具中选最合适的
// 多 provider 降级链: 失败/429/5xx → 切下一个, 全失败才降级 mock
// 特性: LRU cache + per-provider cooldown, 避免重复请求触发限流
const CACHE = new Map<string, { tools: string[]; providerUsed: string; ts: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const lastProviderCall = new Map<string, number>(); // provider name → 上次调用时间
const PROVIDER_COOLDOWN_MS = 500; // 同 provider 间隔 0.5s (DeepSeek 限流宽松)

async function cooldownProvider(name: string): Promise<void> {
  const last = lastProviderCall.get(name) || 0;
  const elapsed = Date.now() - last;
  if (elapsed < PROVIDER_COOLDOWN_MS) {
    await new Promise(r => setTimeout(r, PROVIDER_COOLDOWN_MS - elapsed));
  }
  lastProviderCall.set(name, Date.now());
}

async function llmSelectTools(
  prompt: string,
  allToolNames: string[],
  providers: Provider[],
): Promise<{ tools: string[]; providerUsed: string }> {
  // 1. 查 cache
  const cacheKey = `${prompt}|${allToolNames.length}`;
  const cached = CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return { tools: cached.tools, providerUsed: cached.providerUsed + ' (cached)' };
  }

  const toolsList = allToolNames.join(', ');
  // 强约束 prompt: 强制模型只输出工具名, 用 JSON 数组格式避免自然语言干扰
  const fullPrompt =
    `You are a tool selection AI. From the available tool list, select 1-3 most relevant tool names for the user request.\n\n` +
    `User request: ${prompt}\n\n` +
    `Available tools (${allToolNames.length}):\n${toolsList}\n\n` +
    `Respond ONLY with a JSON array of tool names, e.g. ["read_file", "write_file"]. No explanation, no markdown code fences.`;

  for (const p of providers) {
    if (!p.apiKey) continue;
    await cooldownProvider(p.name);
    if (process.env.EVAL_DEBUG) {
      console.log(`[eval-debug] trying ${p.name} promptLen=${fullPrompt.length}`);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const resp = await fetch(`${p.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${p.apiKey}`,
        },
        body: JSON.stringify({
          model: p.model,
          messages: [{ role: 'user', content: fullPrompt }],
          temperature: 0,
          max_tokens: 200,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        const code = resp.status;
        if (code === 429 || code >= 500) {
          console.warn(`[eval] ${p.name} ${code}: ${errText.slice(0, 80)}, try next`);
          continue;
        }
        console.warn(`[eval] ${p.name} ${code}: ${errText.slice(0, 80)}, try next`);
        continue;
      }

      const data = await resp.json();
      const content: string = data.choices?.[0]?.message?.content || '';
      // 多格式解析: JSON 数组 → 逗号分隔 → 行分隔
      let tools: string[] = [];
      // 1. 尝试 JSON 数组
      const jsonMatch = content.match(/\[[\s\S]*?\]/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          if (Array.isArray(parsed)) {
            tools = parsed.map((s: unknown) => String(s).toLowerCase().trim());
          }
        } catch { /* ignore */ }
      }
      // 2. fallback: 逗号/换行分隔
      if (tools.length === 0) {
        tools = content
          .split(/[,，\n;；|]/)
          .map(s => s.trim().toLowerCase().replace(/[`'\s"\\[\]]/g, ''))
          .filter(s => s.length > 0);
      }
      // 过滤: 只保留 allToolNames 中存在的
      tools = tools.filter(s => allToolNames.includes(s)).slice(0, 3);

      if (tools.length > 0) {
        CACHE.set(cacheKey, { tools, providerUsed: p.name, ts: Date.now() });
        return { tools, providerUsed: p.name };
      }
      console.warn(`[eval] ${p.name} returned empty (raw: ${JSON.stringify(content).slice(0, 100)}), try next`);
    } catch (e) {
      clearTimeout(timer);
      console.warn(`[eval] ${p.name} error: ${(e as Error).message.slice(0, 80)}, try next`);
    }
  }

  // 全部 provider 失败 → 降级 mock
  console.warn(`[eval] all providers failed, fallback to mock`);
  const mock = mockSelectTools(prompt, allToolNames);
  return { tools: mock, providerUsed: 'MOCK' };
}

// 加载 .env 到 process.env (vitest 不自动加载, 多路径探测)
function loadEnvFile(): void {
  // 候选路径: 用户指定 > monorepo root > packages/parent
  const candidates = [
    process.env.AGENTAI_ENV_PATH,
    path.resolve(process.cwd(), '../../.env'),      // packages/agentai-gateway -> monorepo root
    path.resolve(process.cwd(), '../../../.env'),   // 兼容更深的嵌套
    path.resolve(process.cwd(), '.env'),
  ].filter(Boolean) as string[];

  for (const envPath of candidates) {
    try {
      if (!fs.existsSync(envPath)) continue;
      const content = fs.readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
        if (m && !process.env[m[1]]) {
          process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
        }
      }
      console.log(`[eval] loaded .env from: ${envPath}`);
      return;
    } catch { /* try next */ }
  }
  console.warn(`[eval] .env not found in: ${candidates.join(', ')}`);
}
// 模拟 AI 决策 (基于 prompt 关键词 → 工具名) - LLM 失败时降级
function mockSelectTools(prompt: string, allToolNames: string[]): string[] {
  const lower = prompt.toLowerCase();
  const matched: string[] = [];

  // 关键词 → 工具映射 (mock 决策)
  const keywordMap: Record<string, string[]> = {
    '看看|读|查看|打开文件': ['read_file'],
    '创建|写入|生成文件|新建': ['write_file'],
    '改|替换|更新': ['multi_edit'],
    '列出|找.*文件|搜索.*\\.ts|所有.*文件': ['glob', 'search_content'],
    '搜索.*内容|搜索.*代码|查找': ['search_content'],
    '运行|执行|跑|test|测试': ['run_code', 'run_background'],
    'typecheck|类型检查': ['typecheck', 'run_code'],
    '提交|commit': ['git_smart_commit', 'git_commit'],
    '审查|review': ['code_review'],
    '搜.*网|搜索.*最新|搜索.*文档': ['web_search'],
    '打开.*网址|打开.*首页|访问': ['browser_navigate'],
    '抓取|fetch|获取.*内容.*网页': ['web_fetch'],
    '生成.*图|图片|画': ['generate_image'],
    '生成.*视频|video': ['generate_video'],
    '分析.*图|图片里|识别图': ['capture_and_read', 'vision_analyze'],
    '播放|音乐|听歌|放松': ['control_music'],
    '音量': ['set_volume', 'control_music'],
    '锁屏|锁.*屏幕': ['lock_screen'],
    '定时|提醒|cron|调度': ['schedule_task'],
    '执行.*模板|workflow|工作流|报价': ['workflow_run'],
    '发送.*通知|发送.*消息|发.*钉钉': ['send_notification'],
    '记.*下|记住|remember': ['remember'],
    '回忆|记起来|想起|recall': ['recall_memory', 'recall'],
    '激活.*专家|专家': ['activate_expert'],
  };

  for (const [pattern, tools] of Object.entries(keywordMap)) {
    if (new RegExp(pattern).test(lower)) {
      for (const t of tools) if (allToolNames.includes(t)) matched.push(t);
    }
  }

  return matched.length > 0 ? Array.from(new Set(matched)).slice(0, 3) : ['read_file'];
}

interface EvalResult {
  caseId: string;
  category: string;
  prompt: string;
  expected: string[];
  selected: string[];
  hit: boolean;        // 选中了至少一个 expected
  wrongSelected: boolean; // 选中了 wrongTools
  precision: number;   // selected 中 expected 的比例
  recall: number;      // expected 中被选中的比例
  providerUsed?: string; // 真实 LLM 模式下, 实际命中的 provider
}

function evaluateCase(c: EvalCase, allToolNames: string[]): EvalResult {
  const selected = mockSelectTools(c.prompt, allToolNames);
  return evalResult(c, selected, allToolNames);
}

async function evaluateCaseLLM(
  c: EvalCase,
  allToolNames: string[],
  providers: Provider[],
): Promise<EvalResult> {
  const { tools: selected, providerUsed } = await llmSelectTools(c.prompt, allToolNames, providers);
  const result = evalResult(c, selected, allToolNames);
  (result as EvalResult & { providerUsed?: string }).providerUsed = providerUsed;
  return result;
}

function evalResult(c: EvalCase, selected: string[], allToolNames: string[]): EvalResult {
  const expectedSet = new Set(c.expectedTools);
  const wrongSet = new Set(c.wrongTools || []);
  const altSet = new Set(c.alternatives || []);

  const allAccepted = new Set([...expectedSet, ...altSet]);

  const hit = selected.some(s => allAccepted.has(s));
  const wrongSelected = selected.some(s => wrongSet.has(s));
  const tp = selected.filter(s => allAccepted.has(s)).length;
  const precision = selected.length > 0 ? tp / selected.length : 0;
  const recall = c.expectedTools.length > 0 ? tp / c.expectedTools.length : 0;

  return {
    caseId: c.id,
    category: c.category,
    prompt: c.prompt,
    expected: c.expectedTools,
    selected,
    hit,
    wrongSelected,
    precision,
    recall,
  };
}

describe('工具选对率评估 (mock LLM 模式)', () => {
  const allToolNames = EXTRA_TOOLS.map(t => t.name);
  const results = EVAL_CASES.map(c => evaluateCase(c, allToolNames));

  it('评估数据集应至少 20 个 case', () => {
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(20);
  });

  it('评估数据集应覆盖 5+ 类别', () => {
    const categories = new Set(EVAL_CASES.map(c => c.category));
    expect(categories.size).toBeGreaterThanOrEqual(5);
  });

  it('每个 case 应有至少 1 个 expected tool', () => {
    for (const c of EVAL_CASES) {
      expect(c.expectedTools.length).toBeGreaterThan(0);
    }
  });

  it('所有 expected tools 必须在 141 工具清单中', () => {
    for (const c of EVAL_CASES) {
      for (const t of c.expectedTools) {
        expect(allToolNames).toContain(t);
      }
    }
  });

  it('所有 wrong tools 必须在 141 工具清单中', () => {
    for (const c of EVAL_CASES) {
      for (const t of c.wrongTools || []) {
        expect(allToolNames).toContain(t);
      }
    }
  });

  it('所有 alternatives 必须在 141 工具清单中', () => {
    for (const c of EVAL_CASES) {
      for (const t of c.alternatives || []) {
        expect(allToolNames).toContain(t);
      }
    }
  });

  it('mock LLM 整体选对率应 >= 50% (基于关键词基线)', () => {
    const hits = results.filter(r => r.hit).length;
    const rate = hits / results.length;
    console.log(`[eval] mock 选对率: ${(rate * 100).toFixed(1)}% (${hits}/${results.length})`);
    expect(rate).toBeGreaterThanOrEqual(0.5);
  });

  it('mock LLM 不应选错 (不命中 wrongTools)', () => {
    const wrongCases = results.filter(r => r.wrongSelected);
    expect(wrongCases.length).toBe(0);
  });

  it('应输出 baseline 报告', () => {
    const report = generateReport(results);
    console.log('\n' + report);
    expect(report).toContain('工具选对率 Baseline');
  });
});

describe('工具选对率评估 (真实 LLM 模式)', () => {
  loadEnvFile();

  // 多 provider 降级链: DEEPSEEK > AGENTAI > DXNT > ZHIPU > CLINE
  // 任一 provider 失败 (429/5xx) → 自动切下一个, 全失败才降级 mock
  const providers: Provider[] = [
    {
      name: 'DEEPSEEK',
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    },
    {
      name: 'AGENTAI',
      apiKey: process.env.AGENTAI_API_KEY || process.env.AGNES_API_KEY,
      baseUrl: process.env.AGENTAI_BASE_URL || process.env.AGNES_BASE_URL || 'https://api.agnes-ai.cn/v1',
      model: process.env.AGENTAI_MODEL || 'agnes-2.0-flash',
    },
    {
      name: 'DXNT',
      apiKey: process.env.DXNT_API_KEY,
      baseUrl: 'https://www.dxnt.com/v1',
      model: process.env.DXNT_MODEL || 'dxnt.com/free',
    },
    {
      name: 'ZHIPU',
      apiKey: process.env.ZHIPU_API_KEY,
      baseUrl: process.env.ZHIPU_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4',
      model: process.env.ZHIPU_MODEL || 'glm-4.7-flash',
    },
    {
      name: 'CLINE',
      apiKey: process.env.CLINE_API_KEY,
      baseUrl: process.env.CLINE_BASE_URL || 'https://api.cline.bot/api/v1',
      model: process.env.CLINE_MODEL || 'deepseek/deepseek-v4-flash',
    },
  ];

  const available = providers.filter(p => p.apiKey);
  // 真实 LLM 评估默认跳过 (避免 CI 无 API key 时触发真实请求), 仅当显式设置 EVAL_REAL_LLM=1 才执行
  if (process.env.EVAL_REAL_LLM !== '1' || available.length === 0) {
    it.skip('未显式设置 EVAL_REAL_LLM=1 或缺少 API Key, 跳过真实 LLM 评估', () => {});
    return;
  }
  console.log(`[eval] 可用 provider: ${available.map(p => p.name).join(', ')}`);
  const allToolNames = EXTRA_TOOLS.map(t => t.name);

  // 串行跑 (并发 1), 避免触发 provider 限流 (429)
  // 26 个 case × 2-5s = 1-2 分钟
  async function runSerial<T>(items: T[], fn: (item: T) => Promise<T>): Promise<T[]> {
    const out: T[] = [];
    for (const it of items) {
      out.push(await fn(it));
      // case 间间隔 1.5s, 避免连续请求触发限流
      await new Promise(r => setTimeout(r, 1500));
    }
    return out;
  }

  it('真实 LLM 选对率 baseline', async () => {
    console.log('[eval] ===== 真实 LLM Baseline 开始 =====');
    const t0 = Date.now();
    const results = await runSerial(EVAL_CASES, async c => evaluateCaseLLM(c, allToolNames, providers));
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    const hits = results.filter(r => r.hit).length;
    const wrong = results.filter(r => r.wrongSelected).length;
    const realLLM = results.filter(r => r.providerUsed && r.providerUsed !== 'MOCK');
    const mocked = results.filter(r => r.providerUsed === 'MOCK');
    const rate = hits / results.length;
    const avgPrecision = results.reduce((s, r) => s + r.precision, 0) / results.length;
    const avgRecall = results.reduce((s, r) => s + r.recall, 0) / results.length;

    // 按 provider 统计
    const byProvider: Record<string, number> = {};
    for (const r of realLLM) {
      const p = r.providerUsed || 'UNKNOWN';
      byProvider[p] = (byProvider[p] || 0) + 1;
    }

    console.log(`\n[eval] ===== 真实 LLM Baseline (${realLLM.length} 用 LLM, ${mocked.length} 降级) =====`);
    console.log(`[eval] 选对率: ${hits}/${results.length} = ${(rate * 100).toFixed(1)}%`);
    console.log(`[eval] 错选: ${wrong} 个 case 命中 wrongTools`);
    console.log(`[eval] 平均精确率: ${(avgPrecision * 100).toFixed(1)}%`);
    console.log(`[eval] 平均召回率: ${(avgRecall * 100).toFixed(1)}%`);
    console.log(`[eval] 耗时: ${elapsed}s (串行)`);
    console.log(`[eval] Provider 分布: ${JSON.stringify(byProvider)}`);
    if (mocked.length > 0) {
      console.log(`[eval] ⚠️ ${mocked.length} 个 case 降级到 mock (全部 provider 都失败)`);
    }
    console.log(`[eval] \n${generateReport(results, realLLM.length > 0 ? '真实 LLM' : 'mock LLM')}`);

    // 至少要有真实 LLM 数据 (不能全 mock)
    expect(realLLM.length).toBeGreaterThan(results.length / 2);
    // 不强制断言选对率 — 这是 baseline, 仅记录
    expect(rate).toBeGreaterThan(0);
  }, 600_000); // 10 分钟超时 (串行 26 个, 平均 20s/case)
});

function generateReport(results: EvalResult[], mode: string = 'mock LLM'): string {
  const total = results.length;
  const hits = results.filter(r => r.hit).length;
  const wrong = results.filter(r => r.wrongSelected).length;
  const avgPrecision = results.reduce((s, r) => s + r.precision, 0) / total;
  const avgRecall = results.reduce((s, r) => s + r.recall, 0) / total;

  const byCategory: Record<string, { total: number; hits: number }> = {};
  for (const r of results) {
    if (!byCategory[r.category]) byCategory[r.category] = { total: 0, hits: 0 };
    byCategory[r.category].total++;
    if (r.hit) byCategory[r.category].hits++;
  }

  let report = `# 工具选对率 Baseline (${mode} 模式)\n\n`;
  report += `**总体**: ${hits}/${total} = ${(hits / total * 100).toFixed(1)}% 选对\n`;
  report += `**错选**: ${wrong} 个 case 命中了 wrong tools\n`;
  report += `**平均精确率**: ${(avgPrecision * 100).toFixed(1)}%\n`;
  report += `**平均召回率**: ${(avgRecall * 100).toFixed(1)}%\n\n`;

  report += '## 按类别分组\n\n';
  report += '| 类别 | 选对率 |\n|------|--------|\n';
  for (const [cat, stat] of Object.entries(byCategory)) {
    const rate = (stat.hits / stat.total * 100).toFixed(1);
    report += `| ${cat} | ${stat.hits}/${stat.total} (${rate}%) |\n`;
  }

  report += '\n## 详细结果\n\n';
  report += '| ID | 类别 | 选对 | 期望 | 实际选择 |\n|----|------|------|------|----------|\n';
  for (const r of results) {
    const mark = r.hit ? (r.wrongSelected ? '⚠️' : '✅') : '❌';
    report += `| ${r.caseId} | ${r.category} | ${mark} | ${r.expected.join('/')} | ${r.selected.join('/')} |\n`;
  }

  report += '\n## 升级到真实 LLM 模式\n\n';
  report += '```bash\n';
  report += '# 1. 配置 API Key (在 .env 文件中)\n';
  report += 'export AGENTAI_API_KEY=sk-xxx\n\n';
  report += '# 2. 跑评估 (自动降级链: ZHIPU > DXNT > AGENTAI > CLINE)\n';
  report += 'pnpm vitest run tool-selection-eval\n';
  report += '```\n';

  return report;
}
