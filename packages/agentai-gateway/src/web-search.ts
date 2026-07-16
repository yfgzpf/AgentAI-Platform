/**
 * 多源网页搜索引擎 (借鉴 REASONIX + zyai web-tools + gemini-search-mcp)
 * ===================================================
 * 支持引擎 (按优先级自动降级):
 *   0. Browser     (免费, Playwright 真实浏览器搜索 Google, 不限流)
 *   1. Firecrawl  (API Key, 1000次/月免费, https://github.com/firecrawl)
 *   2. Tavily     (API Key, LLM 友好 JSON, https://tavily.com)
 *   3. Bing       (免费, HTML 抓取, 无需 Key)
 *   4. DuckDuckGo (免费, JSON API, 无需 Key)
 *   5. SearXNG    (自部署, 免费, 需配置 endpoint)
 *
 * web_fetch 支持:
 *   - Jina AI Reader (免费, r.jina.ai, 无需 Key)
 *   - Firecrawl Scrape (需 Key)
 *   - 原生 HTTP 抓取 (兜底)
 *
 * 环境变量:
 *   FIRECRAWL_API_KEY  — firecrawl.dev 密钥
 *   TAVILY_API_KEY     — tavily.com 密钥
 *   SEARXNG_ENDPOINT   — 自部署 SearXNG 地址 (如 http://localhost:8080)
 *   WEB_SEARCH_ENGINE  — 强制指定引擎 (browser|firecrawl|tavily|bing|duckduckgo|searxng)
 *   WEB_SEARCH_DISABLE_BROWSER — 设为 1 禁用 browser 引擎 (回退到 HTTP 搜索)
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  /** AI 生成答案 (Tavily/Perplexity 等 AI 原生引擎返回) */
  answer?: string;
}

export interface WebFetchResult {
  url: string;
  title?: string;
  text: string;
  truncated: boolean;
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const DEFAULT_TOPK = 5;
const FETCH_MAX_CHARS = 32_000;
const FETCH_TIMEOUT_MS = 15_000;

// ======================== 引擎选择 ========================

export type SearchEngine = 'browser' | 'firecrawl' | 'tavily' | 'bing' | 'duckduckgo' | 'searxng';

/** 从环境变量获取用户指定的引擎 */
function getConfiguredEngine(): SearchEngine | null {
  const env = process.env.WEB_SEARCH_ENGINE?.toLowerCase().trim();
  if (env && ['browser', 'firecrawl', 'tavily', 'bing', 'duckduckgo', 'searxng'].includes(env)) {
    return env as SearchEngine;
  }
  return null;
}

/** 获取可用的 API Key */
function getApiKey(engine: string): string | null {
  const keys: Record<string, string | undefined> = {
    firecrawl: process.env.FIRECRAWL_API_KEY,
    tavily: process.env.TAVILY_API_KEY,
  };
  return keys[engine] || null;
}

/** 检查 Playwright 是否可用 (不实际启动, 只检查模块是否存在) */
function isBrowserEngineAvailable(): boolean {
  if (process.env.WEB_SEARCH_DISABLE_BROWSER === '1') return false;
  try {
    require.resolve('playwright');
    return true;
  } catch {
    return false;
  }
}

/** 自动选择最佳引擎: 用户指定 → Browser(免费) → 有 Key 的 → 免费引擎 */
function pickEngine(): SearchEngine {
  const configured = getConfiguredEngine();
  if (configured) return configured;
  // 优先使用 browser 引擎 (免费 + Google 级质量)
  if (isBrowserEngineAvailable()) return 'browser';
  if (getApiKey('firecrawl')) return 'firecrawl';
  if (getApiKey('tavily')) return 'tavily';
  if (process.env.SEARXNG_ENDPOINT) return 'searxng';
  return 'bing';
}

// ======================== 主搜索函数 ========================

export async function webSearch(
  query: string,
  opts: { topK?: number; engine?: SearchEngine; signal?: AbortSignal } = {},
): Promise<SearchResult[]> {
  const topK = Math.max(1, Math.min(20, opts.topK ?? DEFAULT_TOPK));
  const engine = opts.engine || pickEngine();

  switch (engine) {
    case 'browser':    return searchBrowser(query, topK, opts.signal);
    case 'firecrawl':  return searchFirecrawl(query, topK, opts.signal);
    case 'tavily':     return searchTavily(query, topK, opts.signal);
    case 'bing':       return searchBing(query, topK, opts.signal);
    case 'duckduckgo': return searchDuckDuckGo(query, topK, opts.signal);
    case 'searxng':    return searchSearxng(query, topK, opts.signal);
    default:           return searchBing(query, topK, opts.signal);
  }
}

// ======================== 多源降级搜索 ========================

export async function webSearchWithFallback(
  query: string,
  topK: number = DEFAULT_TOPK,
): Promise<{ results: SearchResult[]; engine: string }> {
  const preferred = pickEngine();
  const chain: SearchEngine[] = [preferred];
  for (const e of ['browser', 'firecrawl', 'tavily', 'bing', 'duckduckgo', 'searxng'] as SearchEngine[]) {
    if (!chain.includes(e)) {
      if (e === 'browser' && !isBrowserEngineAvailable()) continue;
      if ((e === 'firecrawl' || e === 'tavily') && !getApiKey(e)) continue;
      if (e === 'searxng' && !process.env.SEARXNG_ENDPOINT) continue;
      chain.push(e);
    }
  }

  let lastError = '';
  for (const engine of chain) {
    try {
      const results = await webSearch(query, { topK, engine });
      if (results.length > 0) return { results, engine };
    } catch (e: any) {
      lastError = e.message;
      console.warn(`[web-search] engine "${engine}" failed: ${e.message}, trying next...`);
    }
  }
  throw new Error(`All search engines failed. Last error: ${lastError}`);
}

// ======================== 各引擎实现 ========================

/** 1. Firecrawl — 1000 次/月免费 */
async function searchFirecrawl(query: string, topK: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const apiKey = getApiKey('firecrawl');
  if (!apiKey) throw new Error('Firecrawl API key not configured (FIRECRAWL_API_KEY)');

  const resp = await fetch('https://api.firecrawl.dev/v1/search', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit: topK }),
    signal: signal ?? AbortSignal.timeout(15000),
  });

  if (!resp.ok) {
    if (resp.status === 429) throw new Error('Firecrawl rate limited (429)');
    if (resp.status === 401) throw new Error('Firecrawl API key rejected (401)');
    throw new Error(`Firecrawl search failed: ${resp.status}`);
  }

  const data = await resp.json() as any;
  const items = data.web || data.results || [];
  return items.slice(0, topK).map((item: any) => ({
    title: item.title || '',
    url: item.url || '',
    snippet: item.description || item.content || '',
  }));
}

/** 2. Tavily — LLM 友好 JSON API */
async function searchTavily(query: string, topK: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const apiKey = getApiKey('tavily');
  if (!apiKey) throw new Error('Tavily API key not configured (TAVILY_API_KEY)');

  const resp = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'basic',
      max_results: topK,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
    }),
    signal: signal ?? AbortSignal.timeout(15000),
  });

  if (!resp.ok) {
    if (resp.status === 429) throw new Error('Tavily rate limited (429)');
    if (resp.status === 401 || resp.status === 403) throw new Error('Tavily API key rejected');
    throw new Error(`Tavily search failed: ${resp.status}`);
  }

  const data = await resp.json() as any;
  const results = data.results || [];
  return results.slice(0, topK).map((r: any) => ({
    title: r.title || '',
    url: r.url || '',
    snippet: r.content || '',
  }));
}

/** 3. Bing — 免费, HTML 抓取 (中国可直连 cn.bing.com) */
async function searchBing(query: string, topK: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const resp = await fetch(`https://cn.bing.com/search?q=${encodeURIComponent(query)}`, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
    signal: signal ?? AbortSignal.timeout(10000),
    redirect: 'follow',
  });

  if (!resp.ok) throw new Error(`Bing search failed: ${resp.status}`);
  const html = await resp.text();
  const results = parseBingResults(html).slice(0, topK);

  if (results.length === 0) {
    if (/captcha|verify you are human|access denied|forbidden/i.test(html)) {
      throw new Error('Bing blocked by anti-bot captcha');
    }
    throw new Error(`Bing returned no results (html: ${html.length} chars)`);
  }
  return results;
}

/** 4. DuckDuckGo — 免费, JSON API (非 HTML 抓取, 更稳定) */
async function searchDuckDuckGo(query: string, topK: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const resp = await fetch(
    `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
    { headers: { 'User-Agent': USER_AGENT }, signal: signal ?? AbortSignal.timeout(10000) },
  );
  if (!resp.ok) throw new Error(`DuckDuckGo search failed: ${resp.status}`);
  const data = await resp.json() as any;

  const results: SearchResult[] = [];

  // Abstract (精选摘要)
  if (data.Abstract) {
    results.push({
      title: data.Heading || '摘要',
      url: data.AbstractURL || '',
      snippet: data.Abstract,
    });
  }

  // RelatedTopics
  if (data.RelatedTopics) {
    for (const topic of data.RelatedTopics) {
      if (results.length >= topK) break;
      if (topic.Text && topic.FirstURL) {
        results.push({
          title: topic.Text.split(' - ')[0] || topic.Text.substring(0, 80),
          url: topic.FirstURL,
          snippet: topic.Text,
        });
      }
      // 嵌套 Topics
      if (topic.Topics) {
        for (const sub of topic.Topics) {
          if (results.length >= topK) break;
          if (sub.Text && sub.FirstURL) {
            results.push({
              title: sub.Text.split(' - ')[0] || sub.Text.substring(0, 80),
              url: sub.FirstURL,
              snippet: sub.Text,
            });
          }
        }
      }
    }
  }

  if (results.length === 0) throw new Error('DuckDuckGo returned no results');
  return results;
}

/** 5. SearXNG — 自部署, 免费 */
async function searchSearxng(query: string, topK: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const baseUrl = process.env.SEARXNG_ENDPOINT || 'http://localhost:8080';
  const url = `${baseUrl}/search?format=json&q=${encodeURIComponent(query)}`;

  const resp = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
    signal: signal ?? AbortSignal.timeout(10000),
  });

  if (!resp.ok) throw new Error(`SearXNG search failed: ${resp.status}`);
  const data = await resp.json() as any;
  const items = data.results || [];
  if (items.length === 0) throw new Error('SearXNG returned no results');

  return items.slice(0, topK).map((r: any) => ({
    title: r.title || '',
    url: r.url || '',
    snippet: r.content || '',
  }));
}

// ======================== Browser 搜索引擎 ========================

/**
 * 0. Browser — 借用 Playwright 真实浏览器执行 Google 搜索
 *    核心原理 (借鉴 gemini-search-mcp):
 *    - 真实浏览器 TLS 指纹 → Google 不限流
 *    - 页面内 evaluate 提取结果 → 绕过反爬
 *    - 完全免费, 质量等同 Google 搜索
 */
async function searchBrowser(query: string, topK: number, signal?: AbortSignal): Promise<SearchResult[]> {
  // 动态导入 browser-engine (避免循环依赖 + 可选依赖缺失时不崩溃)
  const { getBrowserEngine } = await import('./browser-engine.js');
  const engine = getBrowserEngine();
  const ok = await engine.start();
  if (!ok) throw new Error('Browser engine not available (Playwright not installed)');

  // 导航到 Google 搜索页
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=zh-CN&num=${Math.min(topK, 10)}`;
  await engine.navigate(searchUrl, 'networkidle');

  // 在页面上下文内提取搜索结果 (真实浏览器流量, 不被限流)
  // 注意: evaluate 的代码在浏览器页面内执行, 无法访问 Node.js 变量
  const results: SearchResult[] = await engine.evaluate(`(() => {
    const items = [];
    // Google 搜索结果通常在 div.g 或 div[data-sokoban-container] 内
    const blocks = document.querySelectorAll('div.g, div[data-sokoban-container]');
    for (const block of blocks) {
      if (items.length >= ${topK}) break;
      const link = block.querySelector('a[href]');
      const titleEl = block.querySelector('h3');
      const snippetEl = block.querySelector('div[data-sncf], div.VwiC3b, span.aCOpRe, div.IsZvec');
      if (link && titleEl) {
        const href = link.href || '';
        // 过滤 Google 内部链接
        if (href && !href.startsWith('https://www.google.com') && !href.startsWith('https://maps.google.com')) {
          items.push({
            title: (titleEl.textContent || '').trim(),
            url: href,
            snippet: (snippetEl?.textContent || '').trim(),
          });
        }
      }
    }
    // 备用: 如果 div.g 没抓到, 尝试更通用的选择器
    if (items.length === 0) {
      const allLinks = document.querySelectorAll('a[href]');
      for (const a of allLinks) {
        if (items.length >= ${topK}) break;
        const href = a.href || '';
        const h3 = a.querySelector('h3') || a.closest('div')?.querySelector('h3');
        if (h3 && href && !href.startsWith('https://www.google') && !href.startsWith('https://maps.') && href.startsWith('http')) {
          items.push({
            title: (h3.textContent || '').trim(),
            url: href,
            snippet: '',
          });
        }
      }
    }
    return items;
  })()`);

  if (results.length === 0) {
    // 检测是否被验证码拦截
    const pageText = await engine.evaluate('document.body?.innerText?.slice(0, 500) || ""').catch(() => '');
    if (/captcha|unusual traffic|verify you are human|验证/i.test(pageText)) {
      throw new Error('Google blocked by anti-bot captcha');
    }
    throw new Error('Browser search returned no results (Google may have changed layout)');
  }
  return results;
}

// ======================== HTML 解析 ========================

/** 解析 Bing 搜索结果 HTML */
function parseBingResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  // b_algo 是 Bing 搜索结果条目的 class
  const re = /<li[^>]*class="b_algo"[^>]*>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const block = m[1]!;
    // 提取标题和链接
    const linkMatch = block.match(/<a[^>]*href="(https?:\/\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;
    const url = linkMatch[1]!;
    const title = linkMatch[2]!.replace(/<[^>]+>/g, '').trim();
    if (!title) continue;
    // 提取摘要
    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = snippetMatch ? snippetMatch[1]!.replace(/<[^>]+>/g, '').trim() : '';
    results.push({ title, url, snippet: snippet || '' });
  }
  return results;
}

// ======================== web_fetch 实现 ========================

export async function webFetch(
  url: string,
  opts: { maxChars?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<WebFetchResult> {
  const maxChars = opts.maxChars ?? FETCH_MAX_CHARS;
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;

  if (!/^https?:\/\//i.test(url)) throw new Error(`web_fetch refuses non-HTTP URL: ${url}`);

  // 优先用 Jina AI Reader (免费, 返回干净的 Markdown)
  try {
    const jinaResult = await fetchWithJina(url, maxChars, timeoutMs, opts.signal);
    if (jinaResult) return jinaResult;
  } catch { /* Jina 失败, 降级到原生抓取 */ }

  // 降级: Firecrawl Scrape
  const firecrawlKey = getApiKey('firecrawl');
  if (firecrawlKey) {
    try {
      const fcResult = await fetchWithFirecrawl(url, firecrawlKey, maxChars, opts.signal);
      if (fcResult) return fcResult;
    } catch { /* Firecrawl 失败, 降级到原生 */ }
  }

  // 兜底: 原生 HTTP 抓取
  return fetchRaw(url, maxChars, timeoutMs, opts.signal);
}

/** Jina AI Reader — 免费, r.jina.ai, 返回 Markdown */
async function fetchWithJina(
  url: string, maxChars: number, timeoutMs: number, signal?: AbortSignal,
): Promise<WebFetchResult | null> {
  const resp = await fetch(`https://r.jina.ai/${url}`, {
    headers: { 'Accept': 'text/markdown', 'User-Agent': USER_AGENT },
    signal: signal ?? AbortSignal.timeout(timeoutMs),
  });
  if (!resp.ok) return null;
  const text = await resp.text();
  if (!text || text.length < 10) return null;
  const titleMatch = text.match(/^#\s+(.+)/m);
  const title = titleMatch ? titleMatch[1]!.trim() : undefined;
  const truncated = text.length > maxChars;
  return {
    url,
    title,
    text: truncated ? text.slice(0, maxChars) + '\n\n[… truncated …]' : text,
    truncated,
  };
}

/** Firecrawl Scrape — 需 API Key */
async function fetchWithFirecrawl(
  url: string, apiKey: string, maxChars: number, signal?: AbortSignal,
): Promise<WebFetchResult | null> {
  const resp = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, formats: ['markdown'] }),
    signal: signal ?? AbortSignal.timeout(15000),
  });
  if (!resp.ok) return null;
  const data = await resp.json() as any;
  const content = data.markdown || data.data?.markdown || '';
  if (!content) return null;
  const truncated = content.length > maxChars;
  return {
    url,
    title: data.metadata?.title,
    text: truncated ? content.slice(0, maxChars) + '\n\n[… truncated …]' : content,
    truncated,
  };
}

/** 原生 HTTP 抓取 — 兜底方案 */
async function fetchRaw(
  url: string, maxChars: number, timeoutMs: number, signal?: AbortSignal,
): Promise<WebFetchResult> {
  const resp = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,text/plain,*/*' },
    signal: signal ?? AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
  });
  if (!resp.ok) throw new Error(`web_fetch failed: HTTP ${resp.status} for ${url}`);

  const contentType = resp.headers.get('content-type') || '';
  const raw = await resp.text();

  // 提取标题
  const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1]!.replace(/\s+/g, ' ').trim() : undefined;

  // HTML → 纯文本
  let text = raw;
  if (contentType.includes('text/html')) {
    text = htmlToText(raw);
  }

  const truncated = text.length > maxChars;
  return {
    url,
    title,
    text: truncated ? text.slice(0, maxChars) + '\n\n[… truncated …]' : text,
    truncated,
  };
}

/** 简易 HTML → 纯文本转换 */
function htmlToText(html: string): string {
  let s = html;
  // 移除 script/style/nav/footer
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  s = s.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  s = s.replace(/<aside[\s\S]*?<\/aside>/gi, '');
  // 块级标签 → 换行
  s = s.replace(/<\/(p|div|br|h[1-6]|li|tr|section|article)>/gi, '\n');
  s = s.replace(/<(p|div|br|h[1-6]|li|tr|section|article)[^>]*>/gi, '\n');
  // 移除所有标签
  s = s.replace(/<[^>]+>/g, '');
  // 解码 HTML 实体
  s = s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
       .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  // 压缩空白
  s = s.replace(/[ \t]+/g, ' ');
  s = s.replace(/\n[ \t]+/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

// ======================== 格式化输出 ========================

export function formatSearchResults(query: string, results: SearchResult[], engine?: string): string {
  const lines: string[] = [`query: ${query}`];
  if (engine) lines.push(`engine: ${engine}`);

  // AI 原生答案 (如果有)
  const _r0 = results[0];
  const hasAnswer = results.length > 0 && !_r0!.url && _r0!.answer;
  if (hasAnswer) {
    lines.push('\nanswer:');
    lines.push(`  ${_r0!.answer!}`);
    const sources = results.slice(1);
    lines.push(`\nsources (${sources.length}):`);
    sources.forEach((r, i) => {
      lines.push(`\n${i + 1}. ${r.title}`);
      lines.push(`   ${r.url}`);
      if (r.snippet) lines.push(`   ${r.snippet}`);
    });
  } else {
    lines.push(`\nresults (${results.length}):`);
    results.forEach((r, i) => {
      lines.push(`\n${i + 1}. ${r.title}`);
      lines.push(`   ${r.url}`);
      if (r.snippet) lines.push(`   ${r.snippet}`);
    });
  }

  return lines.join('\n');
}

/** 获取当前搜索引狿配置信息 (供前端设置页显示) */
export function getSearchEngineStatus(): {
  current: SearchEngine;
  available: Array<{ engine: SearchEngine; configured: boolean; label: string }>;
} {
  const current = pickEngine();
  const available = [
    { engine: 'browser' as const, configured: isBrowserEngineAvailable(), label: 'Browser (免费, Google搜索, 不限流)' },
    { engine: 'firecrawl' as const, configured: !!getApiKey('firecrawl'), label: 'Firecrawl (1000次/月免费)' },
    { engine: 'tavily' as const, configured: !!getApiKey('tavily'), label: 'Tavily (LLM友好)' },
    { engine: 'bing' as const, configured: true, label: 'Bing (免费, HTML抓取)' },
    { engine: 'duckduckgo' as const, configured: true, label: 'DuckDuckGo (免费, JSON API)' },
    { engine: 'searxng' as const, configured: !!process.env.SEARXNG_ENDPOINT, label: 'SearXNG (自部署)' },
  ];
  return { current, available };
}
