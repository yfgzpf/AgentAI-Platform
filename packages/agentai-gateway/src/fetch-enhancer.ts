/**
 * FetchEnhancer — 网页信息结构化提取
 * ----------------------------------------------------
 * 学习 Agent-Reach 的"结构保留"思路:
 *   对 web_fetch 的 HTML 输出做结构化提取，而非简单去标签
 *
 * 输出格式:
 *   ## 标题
 *   **来源**: url
 *   **描述**: meta description
 *   **字数**: N
 *
 *   ### 页面结构
 *   - H1: xxx
 *   - H2: xxx (N)
 *
 *   ### 主要内容
 *   [清洗后的正文, 去导航/页脚/侧栏噪音]
 *
 * 安全:
 *   - URL 验证复用 sanitize.ts 的 isDangerousUrl
 *   - 超时保护 (15s)
 *   - 大小限制 (500KB HTML, 30KB 输出)
 */

export interface StructuredPageInfo {
  title: string;
  url: string;
  description: string;
  headings: Array<{ level: number; text: string; count: number }>;
  linkCount: number;
  wordCount: number;
  textContent: string;
}

/**
 * 从 HTML 中提取结构化信息
 */
export function extractStructuredInfo(html: string, url: string, maxTextLen = 30000): StructuredPageInfo {
  // 标题
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch?.[1]?.trim() || '';

  // Meta description
  const descMatch = html.match(/<meta[^>]*name=['"]description['"][^>]*content=['"]([^'"]*)['"]/i)
    || html.match(/<meta[^>]*content=['"]([^'"]*)['"][^>]*name=['"]description['"]/i);
  const description = descMatch?.[1]?.trim() || '';

  // 标题层级统计
  const headingMap = new Map<string, number>();
  for (let i = 1; i <= 6; i++) {
    const re = new RegExp(`<h${i}[^>]*>([^<]*)</h${i}>`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const text = (m[1] || '').trim();
      if (text) headingMap.set(text, (headingMap.get(text) || 0) + 1);
    }
  }
  const headings: StructuredPageInfo['headings'] = [];
  const seen = new Set<string>();
  for (let i = 1; i <= 6; i++) {
    const re2 = new RegExp(`<h${i}[^>]*>([^<]*)</h${i}>`, 'gi');
    let m2: RegExpExecArray | null;
    while ((m2 = re2.exec(html)) !== null) {
      const text = (m2[1] || '').trim();
      if (text && !seen.has(text) && text.length < 200) {
        seen.add(text);
        headings.push({ level: i, text, count: headingMap.get(text) || 1 });
      }
    }
  }

  // 链接数
  const linkMatches = html.match(/<a\s[^>]*href=/gi);
  const linkCount = linkMatches?.length || 0;

  // 清洗正文: 去script/style/noscript, 去HTML标签, 压缩空白
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

  // 去导航噪音: 重复的短词
  const lines = text.split(/[。！？\n.!?]+/);
  const cleanLines = lines.filter(l => {
    const trimmed = l.trim();
    if (trimmed.length < 4) return false;
    // 过滤纯导航词
    if (/^(首页|登录|注册|关于|联系|帮助|搜索|更多|返回|下一页|上一页|分享|收藏)$/.test(trimmed)) return false;
    return true;
  });
  text = cleanLines.join('。').slice(0, maxTextLen);

  return {
    title,
    url,
    description,
    headings,
    linkCount,
    wordCount: text.length,
    textContent: text,
  };
}

/**
 * 格式化为简洁的 Markdown 输出
 */
export function formatAsMarkdown(info: StructuredPageInfo): string {
  const lines: string[] = [];

  lines.push(`# ${info.title || '(无标题)'}`);
  lines.push('');
  lines.push(`**来源**: ${info.url}`);
  if (info.description) lines.push(`**描述**: ${info.description}`);
  lines.push(`**字数**: ${info.wordCount} | **链接**: ${info.linkCount}`);
  lines.push('');

  if (info.headings.length > 0) {
    lines.push('## 页面结构');
    for (const h of info.headings) {
      const prefix = '#'.repeat(h.level);
      lines.push(`- ${prefix} ${h.text}`);
    }
    lines.push('');
  }

  lines.push('## 主要内容');
  lines.push(info.textContent || '(无文本内容)');

  return lines.join('\n');
}
